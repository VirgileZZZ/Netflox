import re
from bs4 import BeautifulSoup

from src.var import print_status
def extract_sibnet_video_source(html_content, preferred_quality="best"):
    if not html_content:
        return None
    soup = BeautifulSoup(html_content, 'html.parser')
    scripts = soup.find_all('script', type='text/javascript')
    for script in scripts:
        if 'player.src' in script.text:
            # Extract ALL src entries (some pages have 360p/720p/1080p)
            srcs = re.findall(r'src:\s*"([^"]+)"', script.text)
            if not srcs:
                continue
            # Normalize URLs
            normalized = []
            for src in srcs:
                if src.startswith('//'):
                    src = f"https:{src}"
                elif not src.startswith('https://'):
                    src = f"https://video.sibnet.ru{src}"
                normalized.append(src)

            if len(normalized) == 1:
                return normalized[0]

            # Try to pick best quality by parsing quality labels in script
            # e.g., "720p" or "1080p" near src, or use file name
            quals = re.findall(r'(\d{3,4})p', script.text)
            if not quals:
                # Fallback: look for bare numbers like 1080,720 in text
                quals = re.findall(r'\b(1080|720|480|360)\b', script.text)
            # Map src -> quality if we can
            candidates = []
            for idx, src in enumerate(normalized):
                q = 0
                # Try to infer from surrounding text or URL
                # Look for quality near this src in the original text
                # Fallback to order: later entries often higher quality
                if idx < len(quals):
                    try:
                        q = int(quals[idx])
                    except:
                        q = 0
                if q == 0:
                    # Try extract from URL itself (with or without p)
                    m = re.search(r'(\d{3,4})p', src)
                    if m:
                        q = int(m.group(1))
                    else:
                        m2 = re.search(r'(1080|720|480|360)', src)
                        if m2:
                            q = int(m2.group(1))
                candidates.append((q, idx, src))

            # If preferred_quality is numeric, try to match closest
            if preferred_quality != "best":
                try:
                    pref = int(str(preferred_quality).replace('p',''))
                    # Find exact or closest lower
                    candidates_sorted = sorted(candidates, key=lambda x: abs(x[0]-pref))
                    # Prefer exact or higher, else lower
                    exact = [c for c in candidates if c[0]==pref]
                    if exact:
                        return exact[0][2]
                    # else return highest <= pref, else best
                    lower = [c for c in candidates if c[0]<=pref and c[0]>0]
                    if lower:
                        return max(lower, key=lambda x: x[0])[2]
                except:
                    pass

            # Default: best quality (max q, then last index)
            candidates_sorted = sorted(candidates, key=lambda x: (x[0], x[1]), reverse=True)
            best = candidates_sorted[0][2]
            if len(candidates) > 1:
                print_status(f"Sibnet: found {len(candidates)} qualities, picking best {candidates_sorted[0][0]}p", "info")
            return best
    print_status("Could not extract video source from Sibnet", "warning")
    return None