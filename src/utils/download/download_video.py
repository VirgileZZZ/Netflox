import os
import re
import requests
from urllib.parse import urlparse
import time
import collections
from tqdm import tqdm
from concurrent.futures                 import ThreadPoolExecutor, as_completed

from src.var                            import Colors, print_status, DEFAULT_USER_AGENT
from src.utils.parse.parse_ts_segments  import parse_ts_segments

class WarpThrottleError(Exception):
    pass

class SpeedMonitor:
    def __init__(self, threshold_bytes_per_sec=1024*1024, window_sec=20):
        self.threshold = threshold_bytes_per_sec
        self.window = window_sec
        self.samples = collections.deque()  # (timestamp, bytes)
        self.total_bytes = 0
        self.start_time = time.time()
        self.last_check = self.start_time
        self.enabled = threshold_bytes_per_sec > 0 and window_sec > 0

    def add_bytes(self, n):
        if not self.enabled:
            return
        now = time.time()
        self.samples.append((now, n))
        self.total_bytes += n
        # prune old samples outside window
        cutoff = now - self.window
        while self.samples and self.samples[0][0] < cutoff:
            self.samples.popleft()

    def should_throttle(self):
        if not self.enabled:
            return False
        now = time.time()
        if now - self.start_time < self.window:
            return False
        if now - self.last_check < 5:
            return False
        self.last_check = now
        # sum bytes in window
        window_bytes = sum(b for _, b in self.samples)
        avg = window_bytes / self.window if self.window else 0
        if avg > 0 and avg < self.threshold:
            return True
        return False

    def avg_speed(self):
        if not self.samples:
            return 0
        window_bytes = sum(b for _, b in self.samples)
        return window_bytes / self.window if self.window else 0

def download_video(video_url, save_path, use_ts_threading=False, url='',automatic_mp4=False, threaded_mp4=False, interactive=True, warp_auto=False, warp_threshold_kb=1024, warp_window=20, ts_only=False):
    print_status(f"Starting download: {os.path.basename(save_path)}", "loading")
    speed_monitor = SpeedMonitor(threshold_bytes_per_sec=warp_threshold_kb*1024 if warp_auto else 0, window_sec=warp_window if warp_auto else 0)
    if warp_auto:
        print_status(f"Warp auto enabled: <{warp_threshold_kb}kB/s for {warp_window}s -> toggle Warp", "info")
    ua = DEFAULT_USER_AGENT

    target = url if url else video_url
    if target and not target.startswith(('http://', 'https://')):
        target = 'https://' + target

    if target and 'tnmr.org' not in target:
        parsed = urlparse(target)
        origin = f"{parsed.scheme}://{parsed.netloc}"
        referer = f"{origin}/"
    else:
        referer = ''
        origin = ''

    headers = {
        'User-Agent': ua,
        'Accept': 'video/webm,video/mp4,video/*;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
    }
    if referer:
        headers['Referer'] = referer
    if origin:
        headers['Origin'] = origin

   
    if video_url.startswith("LULU_DEFERRED:"):
        embed_url = video_url[len("LULU_DEFERRED:"):]
        from src.utils.extract.extract_luluvdo_video_source import extract_luluvdo_video_source
        resolved = extract_luluvdo_video_source(embed_url)
        if not resolved:
            print_status(f"Download failed: could not resolve LuluStream token for {embed_url[:60]}", "error")
            return False, None
        video_url = resolved
        from urllib.parse import urlparse as _up
        _p = _up(embed_url)
        headers['Referer'] = f"{_p.scheme}://{_p.netloc}/"
        headers.pop('Origin', None)
        headers.pop('Accept-Language', None)

    try:
        if 'm3u8' in video_url:
            from urllib.parse import urljoin

            response = requests.get(video_url, headers=headers, timeout=10)
            response.raise_for_status()
            content = response.text

            if "#EXT-X-STREAM-INF" in content:
                best_bandwidth = -1
                best_url = None
                lines = content.splitlines()
                for i, line in enumerate(lines):
                    if line.startswith("#EXT-X-STREAM-INF"):
                        bw_match = re.search(r'BANDWIDTH=(\d+)', line)
                        bw = int(bw_match.group(1)) if bw_match else 0
                        candidate = lines[i+1].strip() if i+1 < len(lines) else None
                        if candidate:
                            if bw > best_bandwidth:
                                best_bandwidth = bw
                                best_url = candidate
                if best_url:
                    if not best_url.startswith('http'):
                        best_url = urljoin(response.url, best_url)
                    variant_resp = requests.get(best_url, headers=headers, timeout=10)
                    variant_resp.raise_for_status()
                    content = variant_resp.text
            base_for_join = response.url
            try:
                if 'variant_resp' in locals():
                    base_for_join = variant_resp.url
            except Exception:
                pass

            init_segment_url = None
            map_match = re.search(r'#EXT-X-MAP:URI=["\']?([^"\',\s]+)["\']?', content)
            if map_match:
                init_uri = map_match.group(1)
                init_segment_url = init_uri if init_uri.startswith('http') else urljoin(base_for_join, init_uri)

            segments = []
            if init_segment_url:
                segments.append(init_segment_url)

            for line in content.splitlines():
                line = line.strip()
                if not line or line.startswith('#'):
                    continue
                if not line.startswith('http'):
                    seg_url = urljoin(base_for_join, line)
                else:
                    seg_url = line
                segments.append(seg_url)
            if not segments:
                print_status("No .ts segments found in M3U8 playlist", "error")
                return False, None
            
            os.makedirs(os.path.dirname(save_path), exist_ok=True)
            temp_ts_path = os.path.splitext(save_path)[0] + '.ts'
            random_string = os.path.basename(temp_ts_path)

            if automatic_mp4 is False and use_ts_threading is False:
                if interactive:
                    print(f"\n{Colors.BOLD}{Colors.OKCYAN}Threaded Download Option{Colors.ENDC}")
                    print_status("Threaded downloading is faster but should not be used on weak Wi-Fi.", "info")
                    use_threads = input(f"{Colors.BOLD}Use threaded download for faster performance? (y/n, default: n): {Colors.ENDC}").strip().lower()
                    use_threads = use_threads in ['y', 'yes', '1']
                else:
                    use_threads = False
            else:
                use_threads = use_ts_threading
            
            if use_threads:
                segment_data = []
                
                def download_segment(segment_url, index):
                    for attempt in range(3):
                        try:
                            seg_response = requests.get(segment_url, headers=headers, stream=True, timeout=10)
                            seg_response.raise_for_status()
                            data = seg_response.content
                            speed_monitor.add_bytes(len(data))
                            if speed_monitor.should_throttle():
                                raise WarpThrottleError(f"Segment speed <{speed_monitor.threshold/1024:.0f}kB/s for {speed_monitor.window}s")
                            return index, data
                        except WarpThrottleError:
                            raise
                        except requests.RequestException as e:
                            if attempt < 2:
                                time.sleep(2)
                            else:
                                print_status(f"Failed to download segment {index+1}: {str(e)}", "error")
                                return index, None
                    return index, None

                with ThreadPoolExecutor(max_workers=10) as executor:
                    future_to_segment = {executor.submit(download_segment, url, i): i for i, url in enumerate(segments)}
                    try:
                        with tqdm(total=len(segments), desc=f"📥 {random_string}", unit="segment") as pbar:
                            for future in as_completed(future_to_segment):
                                index, content = future.result()
                                if content is None:
                                    print_status(f"Aborting download due to failure in segment {index+1}", "error")
                                    # cancel remaining
                                    for f in future_to_segment:
                                        f.cancel()
                                    return False, None
                                segment_data.append((index, content))
                                pbar.update(1)
                    except WarpThrottleError as e:
                        print_status(str(e), "warning")
                        for f in future_to_segment:
                            f.cancel()
                        raise

                segment_data.sort(key=lambda x: x[0])
                
                with open(temp_ts_path, 'wb') as f:
                    for _, content in segment_data:
                        f.write(content)
            else:
                with open(temp_ts_path, 'wb') as f:
                    for i, segment_url in enumerate(tqdm(segments, desc=f"📥 {random_string}", unit="segment")):
                        for attempt in range(3):
                            try:
                                seg_response = requests.get(segment_url, headers=headers, stream=True, timeout=10)
                                seg_response.raise_for_status()
                                f.write(seg_response.content)
                                break
                            except requests.RequestException as e:
                                if attempt < 2:
                                    time.sleep(2)
                                else:
                                    print_status(f"Failed to download segment {i+1}: {str(e)}", "error")
                                    return False, None
            
            print_status(f"Combined {len(segments)} segments into {temp_ts_path}", "success")
            return True, temp_ts_path
        else:
            # .ts only: pas de playlist ici, donc rien a telecharger en MPEG-TS -> on refuse
            if ts_only:
                print_status("TS only mode: this source is a direct file (no HLS playlist), skipped", "warning")
                return False, None
            # Not a playlist: the stream is a real container, a .ts name would be a lie
            if save_path.endswith('.ts'):
                save_path = os.path.splitext(save_path)[0] + '.mp4'
            response = requests.get(video_url, stream=True, headers=headers, timeout=30)
            total_size = int(response.headers.get('content-length', 0))
            
            if response.status_code != 200:
                print_status(f"Download failed with status code: {response.status_code}", "error")
                return False, None
            
            os.makedirs(os.path.dirname(save_path), exist_ok=True)
            
            with open(save_path, 'wb') as f:
                with tqdm(
                    total=total_size, 
                    unit='B', 
                    unit_scale=True, 
                    desc=f"📥 {os.path.basename(save_path)}",
                    bar_format='{l_bar}{bar}| {n_fmt}/{total_fmt} [{elapsed}<{remaining}, {rate_fmt}]'
                ) as pbar:
                    for chunk in response.iter_content(chunk_size=1024 * 1024):
                        if chunk:
                            f.write(chunk)
                            pbar.update(len(chunk))
                            speed_monitor.add_bytes(len(chunk))
                            if speed_monitor.should_throttle():
                                pbar.close()
                                f.close()
                                # remove partial to allow retry
                                try:
                                    os.remove(save_path)
                                except:
                                    pass
                                raise WarpThrottleError(f"Speed <{speed_monitor.threshold/1024:.0f}kB/s for {speed_monitor.window}s (avg {speed_monitor.avg_speed()/1024:.0f}kB/s)")
            
            print_status(f"Download completed successfully!", "success")
            return True, save_path
    except WarpThrottleError:
        raise
    except Exception as e:
        print_status(f"Download failed: {str(e)}", "error")
        return False, None
