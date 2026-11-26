#!/usr/bin/env python3
"""情報源候補の取得可否と robots.txt を確認する（調査用）."""
import re
import urllib.parse
import urllib.request

UA = "Mozilla/5.0 (compatible; kensho-collector/1.0; personal RSS reader)"
CANDIDATES = [
    "https://koubo.jp/category/present/all",
    "https://precam.jp/",
    "https://www.chance.com/present/",
    "https://www.knshow.com/",
    "https://doraken.jp/",
    "https://www.nyandaful.jp/",
    "https://kensho.kotane.net/",
    "https://bestcalendar.jp/events/%E6%87%B8%E8%B3%9E",
    "https://www.monipla.com/",
    "https://kenshonavi.com/",
    "https://www.kenshonavi.com/",
    "https://www.kensho-box.com/",
    "https://kenshobox.jp/",
]


def get(url):
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "ja"})
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, r.geturl(), r.read().decode(r.headers.get_content_charset() or "utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, url, ""
    except Exception as e:  # noqa: BLE001
        return f"ERR {type(e).__name__}", url, ""


for u in CANDIDATES:
    st, final, body = get(u)
    title = re.search(r"<title[^>]*>(.*?)</title>", body, re.S)
    links = len(re.findall(r"<a\s", body))
    cf = "cloudflare-challenge" if "Just a moment" in body else ""
    p = urllib.parse.urlsplit(final)
    rst, _, robots = get(f"{p.scheme}://{p.netloc}/robots.txt")
    dis = []
    agent_all = False
    for line in robots.splitlines():
        l = line.strip()
        if l.lower().startswith("user-agent:"):
            agent_all = l.split(":", 1)[1].strip() == "*"
        elif agent_all and l.lower().startswith("disallow:"):
            dis.append(l.split(":", 1)[1].strip())
    print(f"== {u}\n   status={st} final={final} size={len(body)} links={links} {cf}\n"
          f"   title={(title.group(1).strip()[:60] if title else '')!r}\n   robots({rst}) disallow*={dis[:12]}")
