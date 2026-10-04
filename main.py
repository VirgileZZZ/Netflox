from src.utils.config.config import get_cookies, set_cookies, check_cookies
from src.utils.print.print_status import print_status
from src.var import Colors, get_domain, print_header, print_separator, print_tutorial, generate_requests_headers, SourceDomains
from src.utils.check.is_cloudflare_here import check_if_cloudflare_enabled

def tutorial_input():
    print_status("No valid Cloudflare cookies found. Let's set them up!", "info")
    print_status(f"1. Open {get_domain()} in your browser.", "info")
    print_status("2. Press F12 to open Developer Tools.", "info")
    print_status(f"3. Go to the 'Application' tab → Cookies → select {get_domain()}.", "info")
    print_status("4. Copy the value of the 'cf_clearance' cookie.", "info")
    cf_clearance = input("Paste the cf_clearance value here: ").strip()

    print_status("5. In DevTools Console (F12 → Console), run:", "info")
    print_status("   navigator.userAgent", "info")
    print_status("6. Copy the User-Agent string printed in console WITHOUT the ' .", "info")
    user_agent = input("Paste the User-Agent here: ").strip()

    return cf_clearance, user_agent

print("Checking if cloudflare is enabled..")
cloudflare = check_if_cloudflare_enabled(domain=get_domain(), headers={"User-Agent": "Mozilla/5.0"})

if cloudflare:
    print("Cloudflare is enabled, either wait (Unknown time) or follow this:")
    cookies_info = get_cookies()
    if cookies_info is False:
        cf_clearance, user_agent = tutorial_input()
        set_cookies(cf_clearance, user_agent)
    cf_clearance, headers = get_cookies()
    request_headers = {"User-Agent": headers.get("User-Agent")}

    while not check_cookies(domain=get_domain(), headers=request_headers):
        print_status("Please update your Cloudflare cookies or use the same User-Agent as before.", "error")
        cf_clearance, user_agent = tutorial_input()
        set_cookies(cf_clearance, user_agent)

    user_agent = headers.get("User-Agent")
    headers = generate_requests_headers(cf_clearance, user_agent)
else:
    headers = generate_requests_headers("None", "Mozilla/5.0")

import os
import re
import sys
import argparse
from concurrent.futures                         import ThreadPoolExecutor, as_completed
from src.utils.fetch.fetch_episodes             import fetch_episodes
from src.utils.fetch.fetch_video_source         import fetch_video_source
from src.utils.print.print_episodes             import print_episodes
from src.utils.get.get_player_choice            import get_player_choice
from src.utils.get.get_episode_choice           import get_episode_choice
from src.utils.check.check_package              import check_package
from src.utils.check.check_ffmpeg_installed     import check_ffmpeg_installed
from src.utils.validate_anime_sama_url          import validate_anime_sama_url
from src.utils.extract.extract_anime_name       import extract_anime_name
from src.utils.get.get_save_directory           import get_save_directory, format_save_path
from src.utils.download.download_episode        import download_episode, create_match_file
from src.utils.fetch.fetch_alt_titles           import fetch_alt_titles
from src.utils.download.download_episode_with_fallback import download_episode_with_fallback
from src.utils.search.search_anime              import search_anime
from src.utils.search.expand_catalogue          import expand_catalogue_url
from src.utils.download.download_scan           import download_scan
from src.utils.settings.settings_menu           import settings_menu
from src.utils.spawn.spawn_jobs                  import build_child_argv, spawn_jobs

# PLEASE DO NOT REMOVE: Original code from https://github.com/sertrafurr/Anime-Sama-Downloader

def parse_selection_indices(user_input, count):
    """Parse a 1-based selection string (comma list, ranges like 12-49, or 'all') into 0-based indices."""
    user_input = user_input.strip().lower()
    if not user_input:
        return []

    if user_input == 'all':
        return list(range(count))

    indices = []
    seen = set()
    for part in user_input.split(','):
        part = part.strip()
        if not part:
            continue
        try:
            if '-' in part:
                start, end = map(int, part.split('-', 1))
                nums = range(start, end + 1)
            else:
                nums = [int(part)]
        except ValueError:
            print_status(f"Invalid selection: '{part}'", "error")
            continue

        for num in nums:
            if num in seen:
                continue
            seen.add(num)
            if 1 <= num <= count:
                indices.append(num - 1)
            else:
                print_status(f"Number {num} is out of range (1-{count})", "error")

    return indices


def resolve_player(episodes, wanted):
    """Retrouve la cle exacte d'un player a partir d'un nom libre ('sibnet', 'Vidmoly (VF)'...)."""
    avail = list(episodes.keys())
    if wanted in avail:
        return wanted

    for p in avail:
        if wanted.lower() in p.lower():
            return p

    target = wanted.lower()
    domain_map = SourceDomains.DOMAIN_MAP
    search_domains = []
    if target in domain_map:
        val = domain_map[target]
        if isinstance(val, list):
            search_domains.extend(val)
        else:
            search_domains.append(val)
    else:
        search_domains.append(target)

    for p in avail:
        for u in episodes[p][:5]:
            if any(d in u.lower() for d in search_domains):
                return p

    return None


def is_direct_player(episodes, player):
    """True si ce player ne sert que des fichiers complets (Sibnet, SendVid): aucun segment .ts a garder."""
    sample = [u for u in (episodes.get(player) or [])[:5] if u]
    return bool(sample) and all(SourceDomains.is_direct_mp4_url(u) for u in sample)


def best_player(episodes, prefer_ts=True):
    """Player avec le plus d'episodes exploitables (choix automatique, sans question).

    Par defaut (et en mode --ts) les hebergeurs qui ne servent qu'un fichier direct
    (Sibnet, SendVid) sont relegues en dernier: ils ne produisent aucun segment .ts.
    Avec --mp4 le classement redevient purement quantitatif.
    """
    best, best_score = None, None
    for player, urls in episodes.items():
        score = sum(1 for u in urls if SourceDomains.is_valid_url(u, category=player))
        hls_capable = 0 if (prefer_ts and is_direct_player(episodes, player)) else 1
        rank = (hls_capable, score)
        if best_score is None or rank > best_score:
            best, best_score = player, rank
    return best


def order_players_prefer_ts(episodes, player_order):
    """Laisse le player choisi en tete, mais repousse les hebergeurs 'fichier direct' en fin de fallback.

    Resultat: on tente d'abord tout ce qui peut donner du .ts, et on ne retombe sur un
    .mp4 que si aucun player HLS n'a l'episode.
    """
    head, tail = player_order[:1], player_order[1:]
    hls = [p for p in tail if not is_direct_player(episodes, p)]
    direct = [p for p in tail if is_direct_player(episodes, p)]
    return head + hls + direct


def season_label(url):
    """'.../re-zero/saison1/vostfr/' -> 'saison1'."""
    if 'nakanime' in url.lower():
        m = re.search(r'/season/(\d+)', url)
        return f"saison{m.group(1)}" if m else "saison1"
    parts = [p for p in url.split('/') if p]
    return parts[-2] if len(parts) >= 2 else 'saison'


def format_episode_numbers(numbers):
    """[1,2,3,7] -> '1-3,7' (format accepte par --episodes)."""
    if not numbers:
        return ''
    out = []
    start = prev = numbers[0]
    for n in numbers[1:]:
        if n == prev + 1:
            prev = n
            continue
        out.append(f"{start}-{prev}" if start != prev else str(start))
        start = prev = n
    out.append(f"{start}-{prev}" if start != prev else str(start))
    return ','.join(out)


def chunk_numbers(numbers, parts):
    """Decoupe une liste d'episodes en tranches contigues equilibrees (une par terminal)."""
    parts = max(1, min(parts, len(numbers)))
    base, extra = divmod(len(numbers), parts)
    chunks, start = [], 0
    for i in range(parts):
        size = base + (1 if i < extra else 0)
        chunks.append(numbers[start:start + size])
        start += size
    return [c for c in chunks if c]


def plan_split_jobs(season_urls, args, headers):
    """Prepare une commande par terminal: une par saison, ou N par saison en mode 'episode'."""
    jobs = []
    for season_url in season_urls:
        label = f"{extract_anime_name(season_url) or 'anime'} {season_label(season_url)}"

        if "/scan" in season_url.lower():
            print_status(f"Skipping {label}: scans are not supported in split mode", "warning")
            continue

        episodes = fetch_episodes(season_url, headers=headers)
        if not episodes:
            print_status(f"Skipping {label}: could not fetch the episode list", "warning")
            continue

        prefer_ts = not args.mp4
        player = resolve_player(episodes, args.player) if args.player else best_player(episodes, prefer_ts)
        if not player:
            print_status(f"Skipping {label}: player '{args.player}' not available here", "warning")
            continue

        if prefer_ts and is_direct_player(episodes, player):
            detail = "--ts will fall back to another player" if args.ts else "episodes will be saved as .mp4"
            print_status(f"{label}: '{player}' only serves direct files; {detail}", "warning")

        urls = episodes[player]
        if args.latest:
            wanted = [len(urls)]
        elif args.episodes and args.episodes.strip().lower() != 'all':
            wanted = [i + 1 for i in parse_selection_indices(args.episodes, len(urls))]
        else:
            wanted = [i + 1 for i in range(len(urls))
                      if 'vk.com' not in urls[i] and 'myvi.tv' not in urls[i]]

        if not wanted:
            print_status(f"Skipping {label}: no downloadable episode", "warning")
            continue

        groups = [wanted] if args.split == 'season' else chunk_numbers(wanted, args.terminals)
        for group in groups:
            spec = format_episode_numbers(group)
            jobs.append({
                'title': f"{label} [{player}] ep {spec}",
                'argv': build_child_argv(args, season_url, spec, player=player),
            })

    return jobs


def filter_seasons_by_lang(options, lang):
    if lang == 'all':
        return options
    kept = [o for o in options if o['url'].lower().rstrip('/').endswith('/' + lang)]
    if not kept:
        print_status(f"No '{lang}' version found, keeping every language", "warning")
        return options
    return kept


def process_season(base_url, args, headers, interactive, pause_at_end=True):
    is_valid, error_msg = validate_anime_sama_url(base_url)
    if not is_valid:
        print_status(error_msg, "error")
        return 1

    if "/scan" in base_url.lower():
        download_scan(base_url, headers)
        return 0

    anime_name = extract_anime_name(base_url)
    print_status(f"Detected anime: {anime_name}", "info")
    episodes = fetch_episodes(base_url, headers=headers)
    if not episodes:
        print_status("Failed to fetch episodes.", "error")
        return 1

    print_episodes(episodes)

    player_choice = None
    if args.player:
        player_choice = resolve_player(episodes, args.player)
        if not player_choice:
            print_status(f"Player '{args.player}' not found.", "error")
            return 1
    else:
        player_choice = get_player_choice(episodes)

    if not player_choice:
        return 1

    episode_indices = None

    if args.latest:
        if episodes and player_choice in episodes:
            count = len(episodes[player_choice])
            if count > 0:
                episode_indices = [count - 1]
                print_status(f"Latest episode selected: Episode {count}", "info")
            else:
                print_status("No episodes found to select latest.", "error")
                return 1
        else:
            return 1

    if not episode_indices:
        if args.episodes:
            if args.episodes.strip().lower() == 'all':
                episode_indices = []
                for i in range(len(episodes[player_choice])):
                    if 'vk.com' not in episodes[player_choice][i] and 'myvi.tv' not in episodes[player_choice][i]:
                        episode_indices.append(i)
            else:
                # accepte "1,2,5", les intervalles "12-49" et un melange des deux
                episode_indices = parse_selection_indices(args.episodes, len(episodes[player_choice]))
                if not episode_indices:
                    print_status("Invalid episode list format", "error")
                    return 1
        else:
             if not args.latest:
                episode_indices = get_episode_choice(episodes, player_choice)

    if episode_indices is None or not episode_indices:
        return 1

    get_anime_name = extract_anime_name(base_url)
    if 'nakanime.tv' in base_url.lower() or 'nakanime.fr' in base_url.lower():
        m_season = re.search(r'/season/(\d+)', base_url)
        get_saison_info = f"saison{m_season.group(1)}" if m_season else "saison1"
    else:
        get_saison_info = base_url.split('/')[-3]


    if args.dest:
         save_dir = format_save_path(get_anime_name, get_saison_info, base_path=args.dest)
    elif interactive:
        save_dir = get_save_directory(get_anime_name, get_saison_info)
    else:
        save_dir = format_save_path(get_anime_name, get_saison_info)

    if not args.dest and not interactive:
         os.makedirs(save_dir, exist_ok=True)

    if isinstance(episode_indices, int):
        episode_indices = [episode_indices]

    urls = [episodes[player_choice][index] for index in episode_indices]
    episode_numbers = [index + 1 for index in episode_indices]
    def _player_lang(player_key):
        m = re.search(r'\(([^)]+)\)\s*$', player_key)
        return m.group(1).strip().upper() if m else None

    chosen_lang = _player_lang(player_choice)
    other_players = [p for p in episodes.keys() if p != player_choice]
    if chosen_lang:
        same_lang = [p for p in other_players if _player_lang(p) == chosen_lang]
        other_lang = [p for p in other_players if _player_lang(p) != chosen_lang]
        player_order = [player_choice] + same_lang + other_lang
    else:
        player_order = [player_choice] + other_players

    # Sans --mp4, on privilegie le .ts: les hebergeurs a fichier direct passent en fin de fallback
    if not args.mp4:
        player_order = order_players_prefer_ts(episodes, player_order)

    if not args.no_mal and get_anime_name:
        os.makedirs(save_dir, exist_ok=True)
        alt_names = fetch_alt_titles(base_url, headers=headers)
        create_match_file(save_dir, get_anime_name, interactive=interactive, alt_names=alt_names)

    print(f"\n{Colors.BOLD}{Colors.HEADER}🎬 PROCESSING EPISODES{Colors.ENDC}")
    print_separator()
    print_status(f"Player: {player_choice}", "info")
    print_status(f"Episodes selected: {', '.join(map(str, episode_numbers))}", "info")

    quality = getattr(args, 'quality', 'best')
    warp_auto = getattr(args, 'warp_auto', False)
    warp_threshold = getattr(args, 'warp_threshold', 400)
    warp_window = getattr(args, 'warp_window', 60)
    if warp_auto:
        print_status(f"Warp auto enabled: <{warp_threshold}kB/s pendant {warp_window}s -> toggle Warp + retry", "info")
    if quality != "best":
        print_status(f"Quality preference: {quality}", "info")

    video_sources = fetch_video_source(urls, quality=quality)
    if not video_sources:
        print_status("Could not extract video sources", "error")
        return 1

    if isinstance(video_sources, str):
        video_sources = [video_sources]

    # --- Quick pre-filter: if .mp4 exists, let download_episode do precise HEAD check ---
    # We just log how many files already on disk; actual skip happens in download_episode
    existing_on_disk = 0
    for ep_num in episode_numbers:
        for ext in ('.mp4', '.ts'):
            p = os.path.join(save_dir, f"{get_anime_name}_{ep_num}{ext}")
            if os.path.exists(p) and os.path.getsize(p) > 30 * 1024 * 1024:
                existing_on_disk += 1
                break
    if existing_on_disk:
        print_status(f"Found {existing_on_disk}/{len(episode_numbers)} episodes already on disk — will verify and skip complete ones", "info")

    use_threading = args.threads
    use_ts_threading = args.fast
    automatic_mp4 = args.mp4
    pre_selected_tool = args.tool
    ts_only = args.ts
    if ts_only:
        # --ts wins: no conversion at all, the file stays a raw MPEG-TS
        automatic_mp4 = False
        pre_selected_tool = None
        print_status("TS only mode: episodes are kept as .ts (no mp4 conversion)", "info")
    elif not automatic_mp4:
        # Aucun flag: on privilegie le .ts (source HLS) et on accepte le .mp4 quand
        # aucun player HLS ne sert l'episode. Rien n'est converti dans les deux cas.
        print_status("Prefer .ts mode: HLS sources are kept as .ts, direct sources fall back to .mp4", "info")
    # Fix: --mp4 sans --tool doit defauter à 'av' (sinon reste en .ts en non-interactif)
    if automatic_mp4 and not pre_selected_tool:
        pre_selected_tool = 'av'

    if interactive:
        if len(episode_indices) > 1 and not args.threads:
            thread_choice = input(f"{Colors.BOLD}Download all episodes simultaneously? (t/1/y = yes / s = no): {Colors.ENDC}").strip().lower()
            use_threading = thread_choice in ['t', 'threaded', '1', 'y', 'yes']

        if any('m3u8' in src for src in video_sources if src):
            if use_threading:
                print_status("Using threading with M3U8.", "warning")

            if not args.fast:
                 ts_thread_choice = input(f"{Colors.BOLD}Download .ts files simultaneously (fast)? (y/n): {Colors.ENDC}").strip().lower()
                 use_ts_threading = ts_thread_choice in ['t', 'threaded', '1', 'y', 'yes']

            if not args.mp4 and not ts_only:
                print_status("Output format: .ts is the raw download (plays in VLC/MPV), .mp4 needs a conversion step.", "info")
                format_choice = input(f"{Colors.BOLD}Output format? (1 = .ts preferred, .mp4 only if no HLS / 2 = .mp4 / 3 = .ts only, default: 1): {Colors.ENDC}").strip().lower()
                automatic_mp4 = format_choice in ['2', 'mp4', '.mp4', 'y', 'yes']
                ts_only = format_choice in ['3', 'ts', '.ts', 'tsonly', 'ts-only']
                if ts_only:
                    pre_selected_tool = None
                    print_status("TS only mode: episodes are kept as .ts (no mp4 conversion)", "info")
                elif not automatic_mp4:
                    pre_selected_tool = None
                    print_status("Prefer .ts mode: HLS sources are kept as .ts, direct sources fall back to .mp4", "info")

                if automatic_mp4:
                    if not pre_selected_tool:
                         while True:
                            t = input(f"{Colors.BOLD}Tool (1=av, 2=ffmpeg): {Colors.ENDC}").strip()
                            if t in ['1', 'av', '']:
                                pre_selected_tool = 'av'
                                break
                            elif t in ['2', 'ffmpeg']:
                                pre_selected_tool = 'ffmpeg'
                                break

    failed_downloads = 0
    try:
        if use_threading and len(episode_indices) > 1:
            # Sibnet/direct MP4 throttles badly with >3 parallel connections -> limit workers
            # If warp-auto, force 1 worker to avoid concurrent warp toggles
            if warp_auto:
                max_workers = 1
                print_status("Warp auto: forcing 1 worker to avoid concurrent toggles", "info")
            else:
                is_direct = any(x in player_choice.lower() for x in ["sibnet", "sendvid"])
                max_workers = 3 if is_direct else 5
            print_status(f"Starting threaded downloads ({max_workers} workers max to avoid throttling)...", "info")
            with ThreadPoolExecutor(max_workers=max_workers) as executor:
                future_to_episode = {
                    executor.submit(download_episode_with_fallback, ep_num, ep_idx, episodes, player_order, get_anime_name, save_dir, video_src, use_ts_threading, automatic_mp4, pre_selected_tool, args.no_mal, interactive, warp_auto, warp_threshold, warp_window, ts_only=ts_only): ep_num
                    for ep_num, ep_idx, video_src in zip(episode_numbers, episode_indices, video_sources)
                }
                for future in as_completed(future_to_episode):
                    ep_num = future_to_episode[future]
                    try:
                        success, _ = future.result()
                        if not success: failed_downloads += 1
                    except Exception as e:
                        print_status(f"Error ep {ep_num}: {e}", "error")
                        failed_downloads += 1
        else:
            for episode_num, ep_idx, video_source in zip(episode_numbers, episode_indices, video_sources):
                success, _ = download_episode_with_fallback(episode_num, ep_idx, episodes, player_order, get_anime_name, save_dir, video_source, use_ts_threading, automatic_mp4, pre_selected_tool, args.no_mal, interactive, warp_auto, warp_threshold, warp_window, ts_only=ts_only)
                if not success: failed_downloads += 1

        print_separator()
        if failed_downloads == 0:
            print_status("All downloads completed! 🎉", "success")
            if interactive and pause_at_end: input(f"{Colors.BOLD}Press Enter to exit...{Colors.ENDC}")
            return 0
        else:
            print_status(f"Completed with {failed_downloads} failed", "warning")
            if interactive and pause_at_end: input(f"{Colors.BOLD}Press Enter to exit...{Colors.ENDC}")
            return 1

    except KeyboardInterrupt:
        print_status("Interrupted", "error")
        return 1
    except Exception as e:
        print_status(f"Error: {e}", "error")
        return 1


def main():
    parser = argparse.ArgumentParser(formatter_class=argparse.RawTextHelpFormatter)
    parser.add_argument("--url", default=None)
    parser.add_argument("--search", default=None)
    parser.add_argument("--episodes", default=None)
    parser.add_argument("--player", default=None)
    parser.add_argument("--dest", default=None)
    parser.add_argument("--threads", action='store_true')
    parser.add_argument("--fast", action='store_true')
    parser.add_argument("--mp4", action='store_true')
    parser.add_argument("--ts", action='store_true', help="Download only .ts files (no mp4 conversion)")
    parser.add_argument("--tool", default=None)
    parser.add_argument("--no-mal", action='store_true', help="Disable MyAnimeList research")
    parser.add_argument("--latest", action='store_true', help="Download only the latest episode")
    parser.add_argument("--quality", default="best", help="Preferred quality for Sibnet (best/1080/720/480)")
    parser.add_argument("--warp-auto", action='store_true', help="Auto toggle Warp if speed <1MB/s for 20s")
    parser.add_argument("--warp-threshold", type=int, default=1024, help="Warp auto threshold kB/s (default 1024 = 1MB/s)")
    parser.add_argument("--warp-window", type=int, default=20, help="Warp auto window seconds (default 20)")
    parser.add_argument("--all-seasons", action='store_true',
                        help="Take every season of the catalogue URL without asking")
    parser.add_argument("--lang", default="vostfr", choices=["vostfr", "vf", "all"],
                        help="Language kept by --all-seasons (default vostfr)")
    parser.add_argument("--split", default="none", choices=["none", "season", "episode"],
                        help="Spread the work over several terminals: one per season, or --terminals per season")
    parser.add_argument("--terminals", type=int, default=4,
                        help="Terminals per season when --split episode (default 4, max 16)")
    parser.add_argument("--stagger", type=float, default=5.0,
                        help="Seconds between two terminal launches (default 5)")
    parser.add_argument("--no-window", action='store_true',
                        help="Run the split jobs in the background (logs) instead of new terminals")
    parser.add_argument("--dry-run", action='store_true',
                        help="With --split: print the commands that would be launched, launch nothing")
    parser.add_argument("--wait", action='store_true',
                        help="Keep the launcher alive until every split job is done")

    
    args = parser.parse_args()
    if args.ts and args.mp4:
        parser.error("--ts and --mp4 are mutually exclusive")
    if args.terminals < 1:
        parser.error("--terminals must be >= 1")
    args.terminals = min(args.terminals, 16)
    interactive = len(sys.argv) == 1

    if not check_package(ask_install=True, first_run=True):
        print_status("Some required packages were missing. Would you like to install them now? (y/n): ", "warning")
        ask_user = input().strip().lower()
        if ask_user in ['y', 'yes', '1']:
            if not check_package(ask_install=True, first_run=False):
                print_status("Failed to install required packages. Please install them manually and re-run the script.", "error")
                sys.exit(1)
        else:
            print_status("Cannot proceed without required packages. Exiting.", "warning")
            input("Press Enter to exit...")
            sys.exit(1)

    if not check_ffmpeg_installed():
        print_status("FFmpeg is not installed or not found in the PATH. You could consider installing it from https://ffmpeg.org/download.html", "error")

    try:
        print_header()
        
        base_url = args.url
        season_urls = None

        if args.search and not base_url:
            results = search_anime(args.search, headers=headers)
            if not results:
                print_status("No results found for search query.", "error")
                return 1
            print(f"\n{Colors.BOLD}{Colors.HEADER}🔍 SEARCH RESULTS{Colors.ENDC}")
            print_separator()
            for i, res in enumerate(results, 1):
                support_text = ""
                if res.get('support') == "Anime Supported":
                    support_text = f" {Colors.OKGREEN}(Anime Supported){Colors.ENDC}"
                elif res.get('support') == "Scans Supported":
                    support_text = f" {Colors.OKGREEN}(Scans Supported){Colors.ENDC}"
                site_tag = f" [{res.get('site')}]" if res.get('site') else ""
                print(f"{Colors.OKCYAN}{i}. {res['title']}{site_tag}{support_text} ({res['url']}){Colors.ENDC}")
            
            while True:
                try:
                    choice = input(f"{Colors.BOLD}Select anime (1-{len(results)}): {Colors.ENDC}").strip()
                    if choice.isdigit():
                        idx = int(choice) - 1
                        if 0 <= idx < len(results):
                            base_url = results[idx]['url']
                            break
                    print_status("Invalid choice", "error")
                except KeyboardInterrupt:
                    return 1



        if not base_url:
            show_tutorial = input(f"{Colors.BOLD}Show tutorial? (y/n, default: n): {Colors.ENDC}").strip().lower()
            if show_tutorial in ['y', 'yes', '1']:
                print_tutorial()
                input(f"\n{Colors.BOLD}Press Enter to continue...{Colors.ENDC}")
            
            while True:
                print(f"\n{Colors.BOLD}{Colors.HEADER}🔗 ANIME-SAMA SELECTION{Colors.ENDC}")
                print_separator()
                print(f"{Colors.OKCYAN}1. Paste URL{Colors.ENDC}")
                print(f"{Colors.OKCYAN}2. Search Anime{Colors.ENDC}")
                print(f"{Colors.OKCYAN}3. Settings{Colors.ENDC}")
                mode = input(f"{Colors.BOLD}Choice (1/2/3): {Colors.ENDC}").strip()
                
                if mode == '1':
                    while True:
                        base_url = input(f"{Colors.BOLD}Enter the complete anime-sama URL: {Colors.ENDC}").strip()
                        if not base_url: continue
                        break
                    break
                elif mode == '2':
                    query = input(f"{Colors.BOLD}Enter search query: {Colors.ENDC}").strip()
                    results = search_anime(query, headers=headers)
                    if not results:
                        print_status("No results found.", "error")
                        continue
                    
                    print(f"\n{Colors.BOLD}{Colors.HEADER}🔍 SEARCH RESULTS{Colors.ENDC}")
                    print_separator()
                    for i, res in enumerate(results, 1):
                         support_text = ""
                         if res.get('support') == "Anime Supported":
                             support_text = f" {Colors.OKGREEN}(Anime Supported){Colors.ENDC}"
                         elif res.get('support') == "Scans Supported":
                             support_text = f" {Colors.OKGREEN}(Scans Supported){Colors.ENDC}"
                         elif res.get('support') == "Anime & Scans Supported":
                             support_text = f" {Colors.OKGREEN}(Anime & Scans Supported){Colors.ENDC}"
                         elif res.get('support') == "Unknown":
                             support_text = f" {Colors.FAIL}(Status Unknown){Colors.ENDC}"
                         site_tag = f" [{res.get('site')}]" if res.get('site') else ""
                         print(f"{Colors.OKCYAN}{i}. {res['title']}{site_tag}{support_text}{Colors.ENDC}")
                    
                    valid_choice = False
                    while True:
                        choice = input(f"{Colors.BOLD}Select anime (1-{len(results)}) or 'c' to cancel: {Colors.ENDC}").strip()
                        if choice.lower() == 'c': break
                        if choice.isdigit():
                            idx = int(choice) - 1
                            if 0 <= idx < len(results):
                                base_url = results[idx]['url']
                                options = expand_catalogue_url(base_url, headers=headers)
                                if options:
                                    anime_opts = []
                                    scan_opts = []
                                    for opt in options:
                                        if '/scan' in opt['url'].lower():
                                            scan_opts.append(opt)
                                        else:
                                            anime_opts.append(opt)
                                    
                                    options = anime_opts + scan_opts
                                    
                                    print(f"\n{Colors.BOLD}{Colors.HEADER}📅 AVAILABLE SEASONS/VERSIONS{Colors.ENDC}")
                                    print_separator()
                                    
                                    idx_counter = 1
                                    if anime_opts:
                                         print(f"{Colors.BOLD}--- Anime ---{Colors.ENDC}")
                                         for opt in anime_opts:
                                             print(f"{Colors.OKCYAN}{idx_counter}. {opt['name']} ({opt['url']}){Colors.ENDC}")
                                             idx_counter += 1
                                    
                                    if scan_opts:
                                         print(f"{Colors.BOLD}--- Scans ---{Colors.ENDC}")
                                         for opt in scan_opts:
                                             print(f"{Colors.OKBLUE}{idx_counter}. {opt['name']} ({opt['url']}){Colors.ENDC}")
                                             idx_counter += 1
                                    
                                    while True:
                                        s_choice = input(
                                            f"{Colors.BOLD}Select season(s) (1-{len(options)}, "
                                            "comma-separated example 1,2,3, ranges like 1-3, or 'all'): "
                                            f"{Colors.ENDC}"
                                        )
                                        s_indices = parse_selection_indices(s_choice, len(options))
                                        if s_indices:
                                            season_urls = [options[i]['url'] for i in s_indices]
                                            base_url = season_urls[0]
                                            valid_choice = True
                                            break
                                        print_status("Invalid choice", "error")
                                    if valid_choice:
                                        break
                                else:
                                    print_status("This page doesn't seem to contain any anime downloadable content.", "warning")
                                    continue
                    if valid_choice: 
                        break
                elif mode == '3':
                    settings_menu()
                else:
                    print_status("Invalid option", "error")
        
        if args.all_seasons and base_url:
            print_status("Expanding catalogue (all seasons)...", "info")
            options = expand_catalogue_url(base_url, headers=headers)
            options = [opt for opt in options if '/scan' not in opt['url'].lower()]
            options = filter_seasons_by_lang(options, args.lang)
            if not options:
                print_status("No season found for this URL.", "error")
                return 1
            season_urls = [opt['url'] for opt in options]
            base_url = season_urls[0]
            print(f"\n{Colors.BOLD}{Colors.HEADER}📅 {len(season_urls)} SEASON(S) SELECTED{Colors.ENDC}")
            print_separator()
            for opt in options:
                print(f"{Colors.OKCYAN}  • {opt['name']} ({opt['url']}){Colors.ENDC}")

        is_valid, _ = validate_anime_sama_url(base_url)
        if season_urls is None and not is_valid:
            print_status("Checking for seasons/versions...", "info")
            season_options = expand_catalogue_url(base_url, headers=headers)
            if season_options:
                anime_opts = []
                scan_opts = []
                for opt in season_options:
                     if '/scan' in opt['url'].lower():
                         scan_opts.append(opt)
                     else:
                         anime_opts.append(opt)
                
                season_options = anime_opts + scan_opts

                print(f"\n{Colors.BOLD}{Colors.HEADER}📅 AVAILABLE SEASONS/VERSIONS{Colors.ENDC}")
                print_separator()

                idx_counter = 1
                if anime_opts:
                        print(f"{Colors.BOLD}--- Anime ---{Colors.ENDC}")
                        for opt in anime_opts:
                            print(f"{Colors.OKCYAN}{idx_counter}. {opt['name']} ({opt['url']}){Colors.ENDC}")
                            idx_counter += 1
                
                if scan_opts:
                        print(f"{Colors.BOLD}--- Scans ---{Colors.ENDC}")
                        for opt in scan_opts:
                            print(f"{Colors.OKBLUE}{idx_counter}. {opt['name']} ({opt['url']}){Colors.ENDC}")
                            idx_counter += 1
                
                while True:
                    choice = input(
                        f"{Colors.BOLD}Select season(s) (1-{len(season_options)}, "
                        "comma-separated example 1,2,3, ranges like 1-3, or 'all'): "
                        f"{Colors.ENDC}"
                    )
                    indices = parse_selection_indices(choice, len(season_options))
                    if indices:
                        season_urls = [season_options[i]['url'] for i in indices]
                        base_url = season_urls[0]
                        break
                    print_status("Invalid choice", "error")
            else:
                 print_status("Could not find any seasons/versions. Please define one manually (url/saison...)", "warning")

        if season_urls is None:
            season_urls = [base_url]

        if args.split != 'none':
            print_status(f"Split mode '{args.split}': preparing one command per "
                         f"{'season' if args.split == 'season' else 'episode batch'}...", "info")
            jobs = plan_split_jobs(season_urls, args, headers)
            if not jobs:
                print_status("Nothing to launch.", "error")
                return 1
            if args.dry_run:
                import subprocess as _sp
                print(f"\n{Colors.BOLD}{Colors.HEADER}🧪 DRY RUN - {len(jobs)} COMMAND(S){Colors.ENDC}")
                print_separator()
                for job in jobs:
                    print(f"{Colors.OKCYAN}# {job['title']}{Colors.ENDC}")
                    print(_sp.list2cmdline(job['argv']))
                print_separator()
                print_status("DRY RUN: nothing was launched, no window opened.", "warning")
                print_status("Re-run the exact same command WITHOUT --dry-run to open the terminals.", "info")
                return 0
            return spawn_jobs(jobs, new_window=not args.no_window, keep_open=True,
                              stagger=args.stagger, wait=args.wait)

        multi = len(season_urls) > 1
        overall_rc = 0
        for i, season_url in enumerate(season_urls):
            if multi:
                print(f"\n{Colors.BOLD}{Colors.HEADER}=== Saison {i + 1}/{len(season_urls)} ==={Colors.ENDC}")
            rc = process_season(season_url, args, headers, interactive, pause_at_end=not multi)
            if rc != 0:
                overall_rc = 1

        if multi and interactive:
            input(f"{Colors.BOLD}Press Enter to exit...{Colors.ENDC}")

        return overall_rc
    except Exception as e:
        print_status(f"Fatal: {e}", "error")
        return 1

if __name__ == "__main__":
    sys.exit(main())
