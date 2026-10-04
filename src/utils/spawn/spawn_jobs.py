import os
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
import time

from src.var import Colors, print_status, print_separator

# Options rejouees telles quelles dans chaque terminal enfant
FLAG_OPTIONS = {
    'threads':    '--threads',
    'fast':       '--fast',
    'mp4':        '--mp4',
    'ts':         '--ts',
    'no_mal':     '--no-mal',
    'warp_auto':  '--warp-auto',
}

VALUE_OPTIONS = {
    'player':          '--player',
    'dest':            '--dest',
    'tool':            '--tool',
    'quality':         '--quality',
    'warp_threshold':  '--warp-threshold',
    'warp_window':     '--warp-window',
}

# Les options a valeur sont rejouees telles quelles: l'enfant doit voir exactement
# les memes reglages que la commande tapee par l'utilisateur.


def _main_script():
    script = sys.argv[0] if sys.argv and sys.argv[0] else 'main.py'
    return os.path.abspath(script)


def build_child_argv(args, url, episodes, player=None):
    """Reconstruit la ligne de commande d'un terminal enfant (toujours non interactif).

    Les options de telechargement tapees par l'utilisateur (--ts, --mp4, --fast,
    --threads, --tool, --quality...) sont recopiees a l'identique: un enfant lance
    sans --ts se comporte donc comme la commande parente sans --ts.
    Seules les options du lanceur (--all-seasons, --split, --terminals, --stagger,
    --dry-run, --wait, --no-window, --lang, --latest) restent chez le parent, qui a
    deja resolu la saison, le player et la liste exacte d'episodes de chaque job.
    """
    argv = [sys.executable or 'python', _main_script(), '--url', url, '--episodes', episodes]

    if player:
        argv += ['--player', player]

    for dest, flag in FLAG_OPTIONS.items():
        if getattr(args, dest, False):
            argv.append(flag)

    for dest, flag in VALUE_OPTIONS.items():
        if dest == 'player' and player:
            continue
        value = getattr(args, dest, None)
        if value is None:
            continue
        argv += [flag, str(value)]

    return argv


def _safe_title(title):
    # Les titres partent dans un .bat / un emulateur de terminal: on reste en ASCII simple
    cleaned = re.sub(r'[^A-Za-z0-9 _.\-]', ' ', title)
    return re.sub(r'\s+', ' ', cleaned).strip()[:80] or 'anime-downloader'


def _write_launcher_bat(argv, title, keep_open, jobs_dir, index):
    path = os.path.join(jobs_dir, f"job_{index:02d}.bat")
    lines = [
        "@echo off",
        f"title {_safe_title(title)}",
        subprocess.list2cmdline(argv),
    ]
    if keep_open:
        lines += ["echo.", "echo [job termine - exit code %ERRORLEVEL%]", "pause"]
    with open(path, 'w', encoding='ascii', errors='replace', newline='\r\n') as f:
        f.write("\n".join(lines) + "\n")
    return path


def _launch_new_window(argv, title, keep_open, workdir, jobs_dir, index):
    """Ouvre un vrai terminal visible. Retourne le Popen, ou None si impossible."""
    if os.name == 'nt':
        bat = _write_launcher_bat(argv, title, keep_open, jobs_dir, index)
        return subprocess.Popen(
            ['cmd', '/c', bat],
            cwd=workdir,
            creationflags=getattr(subprocess, 'CREATE_NEW_CONSOLE', 0),
        )

    cmdline = ' '.join(shlex.quote(a) for a in argv)
    if keep_open:
        cmdline += '; echo; read -p "[job termine] Appuie sur Entree..."'

    title = _safe_title(title)
    for term in ('gnome-terminal', 'konsole', 'xfce4-terminal', 'x-terminal-emulator', 'xterm'):
        if not shutil.which(term):
            continue
        if term == 'gnome-terminal':
            cmd = [term, '--title', title, '--', 'bash', '-lc', cmdline]
        elif term == 'konsole':
            cmd = [term, '-p', f'tabtitle={title}', '-e', 'bash', '-lc', cmdline]
        elif term == 'xfce4-terminal':
            cmd = [term, '--title', title, '-x', 'bash', '-lc', cmdline]
        else:
            cmd = [term, '-T', title, '-e', 'bash', '-lc', cmdline]
        return subprocess.Popen(cmd, cwd=workdir)

    if sys.platform == 'darwin':
        script = f'tell application "Terminal" to do script "cd {shlex.quote(workdir)} && {cmdline}"'
        return subprocess.Popen(['osascript', '-e', script])

    return None


def _launch_background(argv, log_path, workdir):
    log = open(log_path, 'ab')
    kwargs = {}
    if os.name == 'nt':
        kwargs['creationflags'] = getattr(subprocess, 'CREATE_NO_WINDOW', 0)
    else:
        kwargs['start_new_session'] = True
    return subprocess.Popen(
        argv, cwd=workdir, stdin=subprocess.DEVNULL,
        stdout=log, stderr=subprocess.STDOUT, **kwargs
    )


def spawn_jobs(jobs, new_window=True, keep_open=True, stagger=0.0, wait=False):
    """
    jobs: liste de {'title': str, 'argv': [...]}.
    Lance chaque job dans son propre terminal (ou en arriere-plan si new_window=False).
    Retourne 0 si tout a pu etre lance.
    """
    if not jobs:
        print_status("No job to launch", "error")
        return 1

    workdir = os.path.dirname(_main_script()) or os.getcwd()
    jobs_dir = tempfile.mkdtemp(prefix='anime-dl-jobs-')

    print(f"\n{Colors.BOLD}{Colors.HEADER}🚀 LAUNCHING {len(jobs)} JOB(S){Colors.ENDC}")
    print_separator()
    for job in jobs:
        print(f"{Colors.OKCYAN}  • {job['title']}{Colors.ENDC}")
    print_separator()

    processes = []
    failed = 0
    for index, job in enumerate(jobs, 1):
        if stagger and index > 1:
            time.sleep(stagger)

        proc = None
        if new_window:
            proc = _launch_new_window(job['argv'], job['title'], keep_open, workdir, jobs_dir, index)
            if proc is None:
                print_status("No terminal emulator found, falling back to background jobs", "warning")
                new_window = False

        if proc is None:
            log_path = os.path.join(jobs_dir, f"job_{index:02d}.log")
            proc = _launch_background(job['argv'], log_path, workdir)
            print_status(f"[{index}/{len(jobs)}] {job['title']} -> log: {log_path}", "info")
        else:
            print_status(f"[{index}/{len(jobs)}] {job['title']} (pid {proc.pid})", "success")

        if proc is None:
            failed += 1
        else:
            processes.append(proc)

    if not wait:
        print_separator()
        print_status(f"{len(processes)} job(s) launched. Each one downloads on its own.", "success")
        return 1 if failed else 0

    print_status("Waiting for every job to finish...", "loading")
    rc = 0
    for proc in processes:
        try:
            if proc.wait() != 0:
                rc = 1
        except KeyboardInterrupt:
            print_status("Interrupted: the launched jobs keep running in their own terminal", "warning")
            return 1
    print_status("All jobs finished", "success" if rc == 0 else "warning")
    return rc if not failed else 1
