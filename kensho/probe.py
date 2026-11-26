#!/usr/bin/env python3
"""調査用: チャンスイットの一覧・詳細ページの構造（応募先URLの持ち方）を確認する."""
import re
import time
import urllib.request

UA = "Mozilla/5.0 (compatible; kensho-collector/1.0; personal RSS reader)"


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "ja"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read().decode(r.headers.get_content_charset() or "utf-8", "replace")


top = get("https://www.chance.com/present/")
hrefs = re.findall(r'href="([^"]+)"', top)
pat = {}
for h in hrefs:
    k = re.sub(r"\d+", "N", h)
    pat[k] = pat.get(k, 0) + 1
print("TOP patterns:", sorted(pat.items(), key=lambda x: -x[1])[:25])
details = [h for h in hrefs if re.search(r"/present/[^\"]*\d", h)][:3]
print("details:", details)
for d in details:
    u = d if d.startswith("http") else "https://www.chance.com" + d
    time.sleep(1.5)
    s = get(u)
    t = re.sub(r"<[^>]+>", "\n", re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", "", s))
    lines = [l.strip() for l in t.split("\n") if l.strip()]
    print("==", u)
    print("  ext:", [h for h in re.findall(r'href="(https?://[^"]+)"', s) if "chance.com" not in h][:10])
    print("  jump:", re.findall(r'href="([^"]*(?:jump|go)\.srv[^"]*)"', s)[:5])
    i = next((k for k, l in enumerate(lines) if "応募" in l), 0)
    print("  text:", " | ".join(lines[max(0, i - 10): i + 25])[:900])
