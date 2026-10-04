import subprocess
import time
import requests
from src.var import print_status

WARP_CLI = r"C:\Program Files\Cloudflare\Cloudflare WARP\warp-cli.exe"
WARP_LOCK = None  # will be threading.Lock set at import

try:
    import threading
    WARP_LOCK = threading.Lock()
except:
    pass

def _run_warp(args, timeout=10):
    try:
        result = subprocess.run([WARP_CLI] + args, capture_output=True, text=True, timeout=timeout)
        return result.stdout + result.stderr, result.returncode == 0
    except FileNotFoundError:
        return "warp-cli not found", False
    except Exception as e:
        return str(e), False

def is_warp_connected():
    out, ok = _run_warp(["status"])
    return "Connected" in out

def get_warp_status():
    out, ok = _run_warp(["status"])
    return out.strip()

def get_public_ip(timeout=5):
    try:
        r = requests.get("https://1.1.1.1/cdn-cgi/trace", timeout=timeout)
        for line in r.text.splitlines():
            if line.startswith("ip="):
                return line.split("=",1)[1].strip()
    except:
        pass
    try:
        r = requests.get("https://ifconfig.me/ip", timeout=timeout)
        return r.text.strip()
    except:
        return "unknown"

def warp_connect(timeout=15):
    out, ok = _run_warp(["connect"], timeout=timeout)
    # wait up to 10s for Connected
    for _ in range(10):
        time.sleep(1)
        if is_warp_connected():
            return True
    return False

def warp_disconnect(timeout=10):
    out, ok = _run_warp(["disconnect"], timeout=timeout)
    time.sleep(1)
    return not is_warp_connected()

def warp_toggle(max_retries=2):
    """
    Toggle Warp to get new IP: if connected -> disconnect, if disconnected -> connect
    Returns True if toggle succeeded (state changed)
    """
    if WARP_LOCK:
        acquired = WARP_LOCK.acquire(blocking=False)
        if not acquired:
            print_status("Warp toggle already in progress by another thread, skipping", "warning")
            return False
    else:
        acquired = True

    try:
        old_ip = get_public_ip()
        was_connected = is_warp_connected()
        print_status(f"Warp toggle: current IP {old_ip} warp_connected={was_connected}", "info")
        # True toggle: flip state
        if was_connected:
            print_status("Warp toggle: disconnecting to get new route...", "loading")
            if warp_disconnect():
                new_ip = get_public_ip()
                print_status(f"Warp disconnected new IP {new_ip} (was {old_ip})", "success")
                return True
            else:
                print_status("Warp disconnect failed", "warning")
                return False
        else:
            for attempt in range(max_retries):
                print_status(f"Warp toggle attempt {attempt+1}/{max_retries}: connect...", "loading")
                if warp_connect():
                    new_ip = get_public_ip()
                    print_status(f"Warp connected new IP {new_ip} (was {old_ip})", "success")
                    if new_ip != old_ip:
                        print_status(f"IP changed {old_ip} -> {new_ip}", "success")
                    return True
                else:
                    print_status(f"Warp connect failed attempt {attempt+1}", "warning")
                    time.sleep(2)
            print_status("Warp toggle failed after retries", "error")
            return False
    finally:
        if WARP_LOCK and acquired:
            WARP_LOCK.release()

def warp_ensure_connected():
    if not is_warp_connected():
        print_status("Warp not connected, connecting...", "loading")
        return warp_connect()
    return True
