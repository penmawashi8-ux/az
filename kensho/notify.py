#!/usr/bin/env python3
"""新着懸賞を ntfy.sh でスマホにプッシュ通知する（NTFY_TOPIC 未設定なら何もしない）."""
import json
import os
import sys
import urllib.request

topic = os.environ.get("NTFY_TOPIC", "").strip()
if not topic:
    print("NTFY_TOPIC not set; skip notify")
    sys.exit(0)

min_score = int(os.environ.get("NTFY_MIN_SCORE", "30"))
page = os.environ.get("KENSHO_PAGE_URL", "https://az-tawny.vercel.app/kensho")
path = sys.argv[1] if len(sys.argv) > 1 else "kensho/.new_items.json"
try:
    items = [i for i in json.load(open(path, encoding="utf-8")) if i["score"] >= min_score]
except (OSError, ValueError):
    items = []
if not items:
    print("no notable new items")
    sys.exit(0)

lines = []
for it in items[:5]:
    w = f"{it['winners']}名 " if it.get("winners") else ""
    dl = f"〆{it['deadline'][5:].replace('-', '/')} " if it.get("deadline") else ""
    lines.append(f"[{it['score']}] {w}{dl}{it['title'][:50]}")
if len(items) > 5:
    lines.append(f"ほか{len(items) - 5}件")

req = urllib.request.Request(
    f"https://ntfy.sh/{topic}",
    data="\n".join(lines).encode("utf-8"),
    headers={
        "Title": f"新着懸賞 {len(items)}件".encode("utf-8"),
        "Click": page,
        "Tags": "gift",
    },
    method="POST",
)
urllib.request.urlopen(req, timeout=20).read()
print(f"notified {len(items)} items")
