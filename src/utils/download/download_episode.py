import os
import re
import requests
import threading
from src.var                            import print_separator, print_status, Colors
from src.utils.download.download_video  import download_video
from src.utils.ts.convert_ts_to_mp4     import convert_ts_to_mp4
import time

PREFIX_URL = "https://myanimelist.net/search/prefix.json"

_mal_search_cache = {}
_cache_lock = threading.Lock()


def normalize(text):
    if text is None: return ""
    return re.sub(r"[^\w\s]", "", str(text).lower().strip())

def _get_best_title(anime):
    titles = anime.get("titles", [])
    
    for title in titles:
        if title.get("type") == "English":
            return title.get("title") or ""
    
    for title in titles:
        if title.get("type") == "Default":
            return title.get("title") or ""
    
    if titles:
        return titles[0].get("title") or ""
    
    return anime.get("title") or "Unknown"

def _fetch_prefix_json(query, media_type="all", timeout=15.0, max_retries=5):
    params = {"type": media_type, "keyword": query, "v": 1}
 
    for attempt in range(max_retries):
        try:
            resp = requests.get(PREFIX_URL, params=params, timeout=timeout)
        except requests.RequestException as e:
            print_status(f"Request error (attempt {attempt + 1}): {e}", "warning")
            time.sleep(1.5 * (attempt + 1))
            continue
 
        if resp.status_code == 429:
            wait = 1.5 * (attempt + 1)
            print_status(f"Rate limited (429). Waiting {wait:.1f}s...", "warning")
            time.sleep(wait)
            continue
 
        break
 
    if resp is None or resp.status_code != 200:
        status = resp.status_code if resp is not None else "no response"
        print_status(f"Failed to fetch prefix.json (status: {status})", "warning")
        return None
 
    try:
        return resp.json()
    except ValueError:
        print_status("Failed to parse JSON response", "warning")
        return None
 
 
def _flatten_categories(data, wanted_type=None):
    if not data:
        return []
 
    results = []
    for category in data.get("categories", []):
        cat_type = category.get("type")
        if wanted_type and cat_type != wanted_type:
            continue
        for item in category.get("items", []):
            results.append(item)
    return results

def _auto_select_by_es_score(results, gap_ratio=2.0):
    if not results:
        return None

    if len(results) == 1:
        return results[0]

    scored = sorted(results, key=lambda r: r.get("es_score", 0), reverse=True)
    top, runner_up = scored[0], scored[1]

    top_score = top.get("es_score", 0)
    runner_up_score = runner_up.get("es_score", 0)

    if runner_up_score <= 0:
        return top

    if top_score >= runner_up_score * gap_ratio:
        return top

    return None


def search_anime_on_mal(anime_name, interactive=True, alt_names=None):
    cache_key = anime_name.lower().strip()
    if cache_key in _mal_search_cache:
        print_status(f"Using cached MAL data for: {anime_name}", "info")
        return _mal_search_cache[cache_key]

    seen = set()
    queries = []
    for name in [anime_name] + list(alt_names or []):
        key = name.lower().strip()
        if name and key not in seen:
            seen.add(key)
            queries.append(name)

    all_results = []
    for query in queries:
        print_status(f"Searching MAL for: {query}", "info")

        data = _fetch_prefix_json(query, media_type="anime")
        results = _flatten_categories(data, wanted_type="anime")
        if not results:
            continue
        all_results = results

        tv_series = [r for r in results if (r.get("payload", {}).get("media_type") or "").lower() in ["tv", "ona"]]
        other_types = [r for r in results if r not in tv_series]

        name_normalized = normalize(query)
        for item in tv_series + other_types:
            if normalize(item.get("name")) == name_normalized:
                print_status(f"Found exact match: {item['name']}", "success")
                result = {
                    "mal_id": item.get("id"),
                    "title": item.get("name"),
                    "type": item.get("payload", {}).get("media_type"),
                }
                _mal_search_cache[cache_key] = result
                return result

        auto_match = _auto_select_by_es_score(results)
        if auto_match:
            print_status(f"Auto-selected top result: {auto_match['name']}", "success")
            result = {
                "mal_id": auto_match.get("id"),
                "title": auto_match.get("name"),
                "type": auto_match.get("payload", {}).get("media_type"),
            }
            _mal_search_cache[cache_key] = result
            return result

    if not all_results:
        print_status(f"No results found for '{anime_name}'", "warning")
        _mal_search_cache[cache_key] = None
        return None

    tv_series = [r for r in all_results if (r.get("payload", {}).get("media_type") or "").lower() in ["tv", "ona"]]

    if interactive:
        candidates = tv_series if tv_series else all_results
        print_status("No exact match. Candidates:", "info")
        for idx, item in enumerate(candidates):
            payload = item.get("payload", {})
            print(f"  [{idx}] {item['name']} "
                  f"({payload.get('media_type')}, {payload.get('start_year')}, "
                  f"score {payload.get('score')})")

        choice = input("Select index (or blank to skip): ").strip()
        if not choice.isdigit() or int(choice) >= len(candidates):
            _mal_search_cache[cache_key] = None
            return None

        selected = candidates[int(choice)]
        result = {
            "mal_id": selected.get("id"),
            "title": selected.get("name"),
            "type": selected.get("payload", {}).get("media_type"),
        }
        _mal_search_cache[cache_key] = result
        return result
    else:
        first_item = tv_series[0] if tv_series else all_results[0]
        print_status(f"Using first result: {first_item['name']}", "info")
        result = {
            "mal_id": first_item.get("id"),
            "title": first_item.get("name"),
            "type": first_item.get("payload", {}).get("media_type"),
        }
        _mal_search_cache[cache_key] = result
        return result

def create_match_file(save_dir, anime_name, interactive=True, alt_names=None):
    with _cache_lock:
        try:
            if not anime_name:
                print_status("Cannot create match file: anime_name is empty", "error")
                return
            
            match_file_path = os.path.join(save_dir, '.match')
            cache_key = anime_name.lower().strip()
            
            if cache_key in _mal_search_cache:
                print_status(f"Using cached MAL data (already in memory)", "info")
                return
            
            if os.path.exists(match_file_path):
                print_status(f"Match file already exists: {match_file_path}", "info")
                
                try:
                    with open(match_file_path, 'r', encoding='utf-8') as f:
                        lines = f.readlines()
                        mal_id = None
                        title = None
                        for line in lines:
                            if line.startswith('mal-id:'):
                                mal_id_str = line.split(':', 1)[1].strip()
                                if mal_id_str != 'unknown':
                                    mal_id = int(mal_id_str)
                            elif line.startswith('title:'):
                                title = line.split(':', 1)[1].strip()
                        
                        if mal_id and title:
                            _mal_search_cache[cache_key] = {
                                "mal_id": mal_id,
                                "title": title,
                                "type": "TV"
                            }
                            print_status(f"Loaded MAL data from existing file into cache", "info")
                        else:
                            _mal_search_cache[cache_key] = None
                except Exception as e:
                    print_status(f"Could not read existing match file: {e}", "warning")
                    _mal_search_cache[cache_key] = None
                
                return
            
            print_separator()
            print(f"{Colors.BOLD}{Colors.HEADER}🔍 Searching for anime on MyAnimeList...{Colors.ENDC}")
            print_separator()
            
            mal_data = search_anime_on_mal(anime_name, interactive=interactive, alt_names=alt_names)
            
            if mal_data:
                with open(match_file_path, 'w', encoding='utf-8') as match_file:
                    match_file.write(f"title: {mal_data['title']}\n")
                    match_file.write(f"mal-id: {mal_data['mal_id']}\n")
                
                print_separator()
                print_status(f"✓ Match file created: {match_file_path}", "success")
                print_status(f"  → Title: {mal_data['title']}", "info")
                print_status(f"  → MAL ID: {mal_data['mal_id']}", "info")
                print_status(f"  → Type: {mal_data['type']}", "info")
                print_separator()
            else:
                with open(match_file_path, 'w', encoding='utf-8') as match_file:
                    match_file.write(f"title: {anime_name}\n")
                    match_file.write("mal-id: unknown\n")
                
                print_separator()
                print_status(f"Match file created with default values: {match_file_path}", "warning")
                print_status(f"Could not find or match anime on MAL", "warning")
                print_separator()
                
        except Exception as e:
            print_status(f"Error creating match file: {str(e)}", "error")


def download_episode(episode_num, url, video_source, anime_name, save_dir, use_ts_threading=False, automatic_mp4=False, pre_selected_tool=None, no_mal=False, interactive=True, warp_auto=False, warp_threshold_kb=1024, warp_window=20, warp_max_retries=2, ts_only=False):
    if not video_source:
        print_status(f"Could not extract video source for episode {episode_num}", "error")
        return False, None
    
    print_separator()
    print_status(f"Processing episode: {episode_num}", "info")
    print_status(f"Source: {url[:60]}...", "info")
    
    season_dir = save_dir
    os.makedirs(season_dir, exist_ok=True)

    if no_mal:
        print_status("Skipping MAL matching (--no-mal)", "info")
    elif not anime_name:
        print_status("anime_name is empty, skipping MAL matching", "warning")
    else:
        create_match_file(season_dir, anime_name, interactive=interactive)
    
    is_hls = 'm3u8' in str(video_source) or 'LULU_DEFERRED:' in str(video_source)

    # --- .ts only mode: never convert, write straight to a .ts container ---
    # Pas de HLS = pas de segments .ts a garder: on refuse la source au lieu de rapatrier un .mp4.
    # Renvoyer False fait passer download_episode_with_fallback au player suivant.
    if ts_only:
        automatic_mp4 = False
        pre_selected_tool = None
        if not is_hls:
            print_status(f"Episode {episode_num}: direct file source (no HLS playlist), skipped in --ts mode", "warning")
            return False, None

    base_path = os.path.join(season_dir, f"{anime_name if anime_name else 'episode'}_{episode_num}")
    save_path = base_path + ('.ts' if (ts_only and is_hls) else '.mp4')
    
    # --- Smart skip: detect if episode already fully downloaded ---
    def _should_skip_existing(path, video_src, page_url):
        if not os.path.exists(path):
            # also check the other container (.ts leftovers for HLS, or an already converted .mp4)
            alt_path = base_path + ('.mp4' if path.endswith('.ts') else '.ts')
            if os.path.exists(alt_path) and os.path.getsize(alt_path) > 50 * 1024 * 1024:
                print_status(f"Skipping episode {episode_num} already exists -> {alt_path}", "success")
                return alt_path
            return None
        local_size = os.path.getsize(path)
        if local_size == 0:
            try: os.remove(path)
            except: pass
            return None

        # HLS (.m3u8) -> no reliable Content-Length, use size heuristic
        if 'm3u8' in str(video_src) or 'LULU_DEFERRED:' in str(video_src):
            if local_size > 200 * 1024 * 1024:
                print_status(f"Skipping episode {episode_num} already exists ({local_size // (1024*1024)} MB) -> {path}", "success")
                return path
            print_status(f"Found small/partial HLS file ep {episode_num} ({local_size // (1024*1024)} MB), re-downloading...", "warning")
            try: os.remove(path)
            except: pass
            return None

        # Direct MP4 (Sibnet, SendVid...) -> verify via Content-Length
        # Resolve LULU deferred first
        actual_url = video_src
        if isinstance(actual_url, str) and actual_url.startswith("LULU_DEFERRED:"):
            try:
                from src.utils.extract.extract_luluvdo_video_source import extract_luluvdo_video_source
                resolved = extract_luluvdo_video_source(actual_url[len("LULU_DEFERRED:"):])
                if resolved:
                    actual_url = resolved
            except Exception:
                pass

        # Build headers similar to download_video
        try:
            from urllib.parse import urlparse
            target = page_url if page_url else actual_url
            if target and not target.startswith(('http://','https://')):
                target = 'https://' + target
            parsed = urlparse(target) if target else None
            origin = f"{parsed.scheme}://{parsed.netloc}" if parsed and parsed.netloc and 'tnmr.org' not in target else ''
            referer = f"{origin}/" if origin else ''
            from src.var import DEFAULT_USER_AGENT
            headers = {'User-Agent': DEFAULT_USER_AGENT, 'Accept': 'video/webm,video/mp4,video/*;q=0.9,*/*;q=0.8'}
            if referer: headers['Referer'] = referer
            if origin: headers['Origin'] = origin

            remote_size = None
            # Try HEAD first (fast), fallback to GET stream
            try:
                h = requests.head(actual_url, headers=headers, timeout=8, allow_redirects=True)
                if h.status_code == 200 and h.headers.get('content-length'):
                    remote_size = int(h.headers.get('content-length'))
            except Exception:
                pass
            if remote_size is None:
                try:
                    r = requests.get(actual_url, headers=headers, stream=True, timeout=8)
                    if r.status_code == 200 and r.headers.get('content-length'):
                        remote_size = int(r.headers.get('content-length'))
                    r.close()
                except Exception:
                    pass

            if remote_size:
                # Consider complete if local >= 98% of remote (tolerance for headers/ads)
                if local_size >= remote_size * 0.98:
                    print_status(f"Skipping episode {episode_num} already exists ({local_size // (1024*1024)} MB / {remote_size // (1024*1024)} MB) -> {path}", "success")
                    return path
                else:
                    print_status(f"Found partial file ep {episode_num} ({local_size // (1024*1024)} MB / {remote_size // (1024*1024)} MB), re-downloading...", "warning")
                    try: os.remove(path)
                    except: pass
                    return None
        except Exception as e:
            print_status(f"Could not verify remote size for ep {episode_num}: {e}", "warning")

        # Fallback heuristic if we couldn't get remote size
        if local_size > 150 * 1024 * 1024:
            print_status(f"Skipping episode {episode_num} already exists ({local_size // (1024*1024)} MB) -> {path}", "success")
            return path
        print_status(f"Found small/partial file ep {episode_num} ({local_size // (1024*1024)} MB), re-downloading...", "warning")
        try: os.remove(path)
        except: pass
        return None

    existing_path = _should_skip_existing(save_path, video_source, url)
    if existing_path:
        return True, existing_path
    
    print(f"\n{Colors.BOLD}{Colors.HEADER}⬇️ DOWNLOADING EPISODE {episode_num}{Colors.ENDC}")
    print_separator()
    
    # Warp auto retry loop
    last_video_source = video_source
    for warp_attempt in range(warp_max_retries + 1):
        try:
            success, output_path = download_video(
                last_video_source, save_path,
                use_ts_threading=use_ts_threading, url=url,
                automatic_mp4=automatic_mp4, interactive=interactive, ts_only=ts_only,
                warp_auto=warp_auto, warp_threshold_kb=warp_threshold_kb, warp_window=warp_window
            )
            break
        except Exception as e:
            # Check if it's our throttle error
            from src.utils.download.download_video import WarpThrottleError
            if isinstance(e, WarpThrottleError) and warp_auto:
                if warp_attempt < warp_max_retries:
                    print_status(f"Episode {episode_num}: {e} -> Warp toggle {warp_attempt+1}/{warp_max_retries}", "warning")
                    try:
                        from src.utils.network.warp_manager import warp_toggle, get_public_ip
                        old_ip = get_public_ip()
                        if warp_toggle():
                            new_ip = get_public_ip()
                            print_status(f"Warp IP {old_ip} -> {new_ip}, re-fetching video source for ep {episode_num}...", "info")
                            # Re-fetch fresh link (st token may be IP-bound)
                            try:
                                from src.utils.fetch.fetch_video_source import fetch_video_source
                                fresh = fetch_video_source(url)
                                if fresh:
                                    last_video_source = fresh
                                    # Clean partial
                                    for p in [save_path, base_path + '.ts', base_path + '.mp4']:
                                        if os.path.exists(p):
                                            try: os.remove(p)
                                            except: pass
                                    continue
                            except Exception as fe:
                                print_status(f"Failed to re-fetch source: {fe}", "warning")
                        else:
                            print_status("Warp toggle failed, retrying download anyway", "warning")
                            continue
                    except Exception as we:
                        print_status(f"Warp error: {we}", "warning")
                print_status(f"Episode {episode_num}: Warp throttle but max retries reached", "error")
                return False, None
            else:
                print_status(f"Download failed for episode {episode_num}: {str(e)}", "error")
                return False, None
    else:
        # loop exhausted without break
        print_status(f"Download failed for episode {episode_num} after warp retries", "error")
        return False, None
    
    if not success:
        print_status(f"Failed to download episode {episode_num}", "error")
        return False, None
    
    print_separator()
    
    if is_hls and output_path and output_path.endswith('.ts'):
        print_status(f"Video saved as {output_path} (MPEG-TS format, playable in VLC or similar players)", "success")
        if automatic_mp4:
            success, final_path = convert_ts_to_mp4(output_path, save_path, pre_selected_tool)
            if success:
                print_status(f"Episode {episode_num} successfully saved to: {final_path}", "success")
                try:
                    os.remove(output_path)
                    print_status(f"Removed temporary .ts file: {output_path}", "info")
                except Exception as e:
                    print_status(f"Could not remove temporary .ts file: {str(e)}", "warning")
                return True, final_path
            else:
                print_status(f"Conversion failed for episode {episode_num}, keeping .ts file: {output_path}", "error")
                return False, output_path
        else:
            print_status(f"Keeping .ts file for episode {episode_num}: {output_path}", "info")
            return True, output_path
    else:
        final_path = output_path or save_path
        print_status(f"Episode {episode_num} successfully saved to: {final_path}", "success")
        return True, final_path
