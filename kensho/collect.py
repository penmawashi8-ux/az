#!/usr/bin/env python3
"""懸賞コレクター.

PR TIMES / @Press の公開RSSからプレゼントキャンペーンを拾い、
締切・当選数・応募方法・応募先URLを抽出してスコア順に public/kensho/data.json へ保存する。
標準ライブラリのみ。GitHub Actions から1時間ごとに実行する想定。
"""
from __future__ import annotations

import datetime as dt
import html
import json
import math
import os
import re
import sys
import time
import unicodedata
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_PATH = os.environ.get("KENSHO_DATA") or os.path.join(ROOT, "public", "kensho", "data.json")
STATE_PATH = os.environ.get("KENSHO_STATE") or os.path.join(ROOT, "kensho", "state.json")
NEW_PATH = os.environ.get("KENSHO_NEW") or os.path.join(ROOT, "kensho", ".new_items.json")

JST = dt.timezone(dt.timedelta(hours=9))
UA = "Mozilla/5.0 (compatible; kensho-collector/1.0; personal RSS reader)"
FETCH_DELAY = 1.5          # 詳細ページ取得の間隔（秒）
MAX_DETAIL_FETCH = int(os.environ.get("KENSHO_MAX_FETCH", "400"))
NO_DEADLINE_TTL_DAYS = 30  # 締切不明のものは公開から30日で消す

FEEDS = [
    ("prtimes", "https://prtimes.jp/index.rdf"),
    ("atpress", "https://www.atpress.ne.jp/rss/index.rdf"),
]
# 解析ルールの版。上げると収集済みの懸賞も次回以降に読み直す
PARSE_VERSION = 7

KEYWORD_PAGES = [
    # チャンスイット：応募先へのリンク(jump.srv)は robots.txt でロボット禁止なので、
    # 一覧に載せて本人がタップして応募する（自動応募はしない）
    ("chance", "https://www.chance.com/present/list/easy-entry/"),
    ("chance", "https://www.chance.com/present/list/?order=1"),
    # 公募ガイド：Web応募フォームの懸賞が多い。ジャンル別ページも全部見る
    *[("koubo", f"https://koubo.jp/category/present/{c}") for c in (
        "all", "baby", "entertainment", "fashion", "food", "gift-certificate", "life",
        "luxury", "pet", "prize", "talent", "travel-voucher")],
    # 公募ガイドの懸賞一覧（全ページ。ジャンル別ページは先頭40件程度しか出ないため）
    *[("koubo", f"https://koubo.jp/contest/list?c=13&p={p}") for p in range(1, 61)],
    ("prtimes", "https://prtimes.jp/topics/keywords/" + urllib.parse.quote("プレゼントキャンペーン")),
    ("prtimes", "https://prtimes.jp/topics/keywords/" + urllib.parse.quote("キャンペーン")),
    *[("prtimes", "https://prtimes.jp/topics/keywords/" + urllib.parse.quote(k))
      for k in ("プレゼント", "抽選", "アンケート", "プレゼント企画", "懸賞")],
]

# 一覧段階の粗いフィルタ（タイトル+概要）
CANDIDATE_RE = re.compile(r"プレゼント|抽選|当たる|当選|名様|懸賞|応募")
# 詳細段階の確認：抽選系の語 と 賞品系の語 の両方が必要
LOTTERY_RE = re.compile(r"抽選|名様|当選")
PRIZE_RE = re.compile(r"プレゼント|当たる|賞品|景品")

TODAY = dt.datetime.now(JST).date()


# ---------------------------------------------------------------- utils
def norm(s: str) -> str:
    return unicodedata.normalize("NFKC", s)


def fetch(url: str, timeout: int = 25) -> str | None:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "ja"})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                raw = r.read()
                cs = r.headers.get_content_charset() or "utf-8"
                return raw.decode(cs, errors="replace")
        except Exception as e:  # noqa: BLE001
            print(f"  fetch fail ({attempt + 1}/3) {url}: {e}", file=sys.stderr)
            time.sleep(2 * (attempt + 1))
    return None


def html_to_lines(fragment: str) -> list[str]:
    fragment = re.sub(r"(?is)<(script|style|svg|noscript)[^>]*>.*?</\1>", " ", fragment)
    fragment = re.sub(r"(?i)<br\s*/?>|</(p|div|li|tr|h\d|td|th|dd|dt)>", "\n", fragment)
    text = html.unescape(re.sub(r"<[^>]+>", " ", fragment))
    text = norm(text)
    return [re.sub(r"[ \t　]+", " ", l).strip() for l in text.split("\n") if l.strip()]


def load_json(path: str, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def save_json(path: str, obj) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)
        f.write("\n")
    os.replace(tmp, path)


# ---------------------------------------------------------------- feeds
def parse_rss(source: str, xml: str) -> list[dict]:
    out = []
    for m in re.finditer(r'<item[^>]*rdf:about="([^"]+)"[^>]*>(.*?)</item>', xml, re.S):
        url, body = m.group(1), m.group(2)

        def tag(name: str) -> str:
            t = re.search(rf"<{name}>(.*?)</{name}>", body, re.S)
            if not t:
                return ""
            v = t.group(1)
            v = re.sub(r"^<!\[CDATA\[|\]\]>$", "", v.strip())
            return norm(html.unescape(re.sub(r"<[^>]+>", "", v))).strip()

        out.append({
            "source": source,
            "url": url.strip(),
            "title": tag("title"),
            "desc": tag("description"),
            "company": tag("dc:corp") or tag("dc:creator"),
            "published": (tag("dc:date") or "")[:10],
        })
    return out


def parse_keyword_page(source: str, page: str) -> list[dict]:
    if source == "chance":
        ids = list(dict.fromkeys(re.findall(r'/present/detail/(\d+)/', page)))
        return [{"source": "chance", "url": f"https://www.chance.com/present/detail/{i}/", "title": "", "desc": "",
                 "company": "", "published": ""} for i in ids]
    if source == "koubo":
        ids = list(dict.fromkeys(re.findall(r'href="/contest/(\d+)"', page)))
        return [{"source": "koubo", "url": f"https://koubo.jp/contest/{i}", "title": "", "desc": "",
                 "company": "", "published": ""} for i in ids]
    urls = sorted(set(re.findall(r'/main/html/rd/p/[0-9.]+\.html', page)))
    return [{"source": source, "url": "https://prtimes.jp" + u, "title": "", "desc": "",
             "company": "", "published": ""} for u in urls]


# ---------------------------------------------------------------- extraction
DATE_PATTERNS = [
    re.compile(r"(?P<y>20\d{2})\s*年\s*(?P<m>\d{1,2})\s*月\s*(?P<d>\d{1,2})\s*日"),
    re.compile(r"(?P<y>20\d{2})\s*[/.\-]\s*(?P<m>\d{1,2})\s*[/.\-]\s*(?P<d>\d{1,2})"),
    re.compile(r"(?<![\d/])(?P<m>\d{1,2})\s*月\s*(?P<d>\d{1,2})\s*日"),
    re.compile(r"(?<![\d/.])(?P<m>1[0-2]|0?[1-9])/(?P<d>3[01]|[12]\d|0?[1-9])(?![\d/])"),
]
PERIOD_LABEL_RE = re.compile(r"応募期間|募集期間|実施期間|キャンペーン期間|開催期間|応募締切|応募締め切り|締切|締め切り|〆切|応募受付|受付期間|投稿期間|参加期間|期間")


def find_dates(s: str, base: dt.date) -> list[tuple[int, dt.date]]:
    found: list[tuple[int, dt.date]] = []
    taken: list[tuple[int, int]] = []
    for pat in DATE_PATTERNS:
        for m in pat.finditer(s):
            if any(a <= m.start() < b for a, b in taken):
                continue
            try:
                mo, d = int(m.group("m")), int(m.group("d"))
                y = int(m.groupdict().get("y") or 0)
                if not y:
                    y = base.year
                    cand = dt.date(y, mo, d)
                    if cand < base - dt.timedelta(days=60):
                        cand = dt.date(y + 1, mo, d)
                else:
                    cand = dt.date(y, mo, d)
            except ValueError:
                continue
            taken.append((m.start(), m.end()))
            found.append((m.start(), cand))
    found.sort()
    return found


def extract_deadline(lines: list[str], base: dt.date) -> str | None:
    # ラベル付きの行（＋直後2行）を優先。期間なら最後の日付が締切。
    for i, line in enumerate(lines):
        if PERIOD_LABEL_RE.search(line) and len(line) < 200:
            window = " ".join(lines[i:i + 3])
            ds = find_dates(window, base)
            if ds:
                # 「期間」行に複数日付があるとき、開始〜終了なので最後を採用
                return max(d for _, d in ds[:4]).isoformat()
    # 「〜まで」表現
    for line in lines:
        m = re.search(r"(.{0,40})まで", line)
        if m and ("応募" in line or "キャンペーン" in line):
            ds = find_dates(m.group(1), base)
            if ds:
                return ds[-1][1].isoformat()
    return None


def extract_winners(text: str) -> int | None:
    nums = []
    for m in re.finditer(r"([\d,]+)\s*(?:名様|名に|名へ|名を|名が|名\)|組様|組に|人様)", text):
        try:
            n = int(m.group(1).replace(",", ""))
        except ValueError:
            continue
        ctx = text[max(0, m.start() - 40): m.end() + 10]
        if 0 < n <= 100000 and re.search(r"抽選|当選|プレゼント|当たる|名様", ctx):
            nums.append(n)
    return max(nums) if nums else None


def extract_prize(lines: list[str], title: str) -> str:
    for line in lines:
        if re.search(r"名様|名に|人に", line) and re.search(r"プレゼント|当たる|贈呈|進呈", line) and len(line) < 160:
            return line
    m = re.search(r"[「『【]?([^「」『』【】]{2,60})[」』】]?(?:を|が)?(?:抽選で)?.{0,20}プレゼント", title)
    return m.group(0) if m else ""


# ---- 賞品名（短縮）
GENERIC = re.compile(r"^(?:豪華|素敵な|すてきな|各種|特別な|オリジナル)?(?:賞品|景品|プレゼント|商品|グッズ|ノベルティ|記念品)$")
CUT = re.compile(r"[!！?？。】]|[」』](?:が|は)|開催|キャンペーン(?:で|では|を|に)|中から|方に|方へ|方を対象に|対象に|では|には|として|記念して|ので|さらに")
PATS = [
    re.compile(r"(?:名様?|名)\s*に\s*[、,]?\s*(.{2,60}?)\s*(?:を|が)\s*(?:各\d+[^\s]{0,3}\s*)?(?:プレゼント|進呈|贈呈|当た)"),
    re.compile(r"(.{2,60}?)\s*(?:を|が)\s*(?:抽選で)\s*(?:合計|最大|計)?\s*[\d,]+\s*(?:名|組)"),
    re.compile(r"(.{2,60}?)\s*(?:が|を)\s*(?:抽選で)?\s*(?:合計|最大)?\s*(?:[\d,]+\s*名様?に)?\s*(?:当たる|当たります|もらえる)"),
    re.compile(r"(.{2,60}?)\s*を\s*(?:工事費込みで|無料で|抽選で)?\s*プレゼント"),
]
def _clean_prize(s: str) -> str:
    s = re.split(CUT, s)[-1]
    s = re.sub(r"^(?:抽選で|合計|最大|計|\d+名様?に|、|,|の|より|から|\s)+", "", s)
    s = re.sub(r"^(?:キャンペーン\d*|第\d+弾|数量限定|限定|豪華|人気の?)\s*", "", s)
    s = s.lstrip(" 　、,・:：-~〜」』）)】]").rstrip(" 　、,・:：-~〜「『（(【[")
    if s.count("「") < s.count("」"): s = s.replace("」", "", 1)
    if len(s) > 26:
        b = re.findall(r"[「『]([^」』]{2,30})[」』]", s)
        if b: s = b[-1]
    s = re.sub(r"^[「『]([^」』]*)[」』]$", r"\1", s).strip()
    return s
def extract_prize_short(cands: list[str]) -> str:
    for t in cands:
        t = norm(t)
        for p in PATS:
            for m in p.finditer(t):
                v = _clean_prize(m.group(1))
                if 2 <= len(v) <= 40 and not GENERIC.match(v) and not re.search(r"キャンペーン|応募|フォロー|リポスト|投稿", v):
                    return v
    return ""


X_STATUS_RE = re.compile(r"https?://(?:www\.|mobile\.)?(?:x|twitter)\.com/([A-Za-z0-9_]{1,15})/status(?:es)?/(\d{5,25})")


def extract_x_post(frag: str) -> str | None:
    """本文中で最初に出てくるXのポストURL（キャンペーン告知投稿）"""
    m = X_STATUS_RE.search(html.unescape(frag))
    return f"https://x.com/{m.group(1)}/status/{m.group(2)}" if m else None


METHOD_HEAD_RE = re.compile(r"(応募|参加)(方法|手順|ステップ|条件)|STEP|ステップ|キャンペーン(概要|内容|詳細)|応募のしかた")
# 「①」等はNFKC正規化で「1」になるので、行頭の数字＋（記号 or @ or 日本語）を手順の行とみなす
METHOD_STEP_RE = re.compile(r"^\s*(?:[①-⑩]|[1-9](?:[.．、)）:：]|⃣|(?=[@\u3000-\u30ff\u4e00-\u9fff\uff01-\uff5e]))|STEP\s*\d|\(\d\))")


def method_text(text: str) -> str:
    """記事全体ではなく「応募方法」の部分と手順の行だけを取り出す（会社紹介や機能説明を条件と誤読しないため）"""
    lines = [l.strip() for l in norm(text).split("\n") if l.strip()]
    keep = []
    for i, l in enumerate(lines):
        if METHOD_HEAD_RE.search(l) and len(l) < 200:
            keep.extend(lines[i:i + 8])
        elif METHOD_STEP_RE.match(l) and re.search(r"フォロー|リポスト|リツイート|RT|いいね|引用|返信|リプライ|コメント|投稿|ハッシュタグ|#", l):
            keep.append(l)
    return "\n".join(dict.fromkeys(keep))


def extract_x_needs(text: str) -> list[str]:
    """Xキャンペーンの参加条件（フォロー・リポストは基本なので、追加条件だけ拾う）"""
    t = re.sub(r"\s+", "", text)
    needs = []
    if re.search(r"いいね", t):
        needs.append("like")
    quote = bool(re.search(r"引用(?:リポスト|ポスト|RT|ツイート)", t))
    if quote:
        needs.append("quote")
    # 「コメントを入れて引用ポスト」のコメントは引用の中身なので、返信とは数えない
    # 実際に返信を求める書き方のときだけ（「リマインドリプライ機能」のような説明文には反応しない）
    if re.search(r"(?:返信|リプライ)(?:して|で|する|を(?:送|し)|欄|に)|コメント欄", t) or (not quote and re.search(r"(?:この投稿|ポスト|ツイート)に.{0,15}コメント|コメント(?:して|で応募)", t)):
        needs.append("reply")
    # 通常のリポスト（引用リポストとは別）が条件か
    if re.search(r"(?<!引用)(?:リポスト|リツイート|RT)(?!キャンペーン)", t):
        needs.append("repost")
    if re.search(r"ハッシュタグ|#\S+を(?:付け|つけ)", t):
        needs.append("hashtag")
    return needs


# 指定ハッシュタグ（#〜 / ＃〜）。キャンペーン共通の一般的なものは除く
HASHTAG_RE = re.compile(r"[#＃]([^\s#＃、。,.!！?？「」『』()（）【】\[\]<>＜＞・/／:：;；\"'”’]{2,40})")


# 「#」なしで括弧書きされた指定ハッシュタグ（例：ハッシュタグ「雪見だいふく米」、ハッシュタグ【〇〇】）
BRACKET_TAG_RE = re.compile(r"ハッシュタグ\s*(?:は|:|：)?\s*[「『【\[]\s*[#＃]?([^」』】\]\s#＃]{2,40})\s*[」』】\]]")
# 「〇〇」をつけて投稿／引用（空白や句読点を含まない短い語はハッシュタグとして付ける書き方が多い）
ATTACH_TAG_RE = re.compile(r"[「『]([^」』\s、。,.!！?？]{2,30})[」』]\s*を\s*(?:つけ|付け)て")


def extract_x_tags(text: str) -> list[str]:
    tags = []
    t0 = norm(text)
    found = ["#" + m.group(1) for m in HASHTAG_RE.finditer(t0)] + ["#" + m.group(1) for m in BRACKET_TAG_RE.finditer(t0)] + ["#" + m.group(1) for m in ATTACH_TAG_RE.finditer(t0)]
    for t in found:
        t = "#" + t.lstrip("#＃")  # 「#〇〇」をつけて → ##〇〇 にならないように
        if t not in tags and not re.fullmatch(r"#(PR|pr|拡散希望|プレゼント企画)", t):
            tags.append(t)
    return tags[:5]


def extract_x_phrases(text: str) -> list[str]:
    """投稿に入れるよう指定された文言（例：「これからもローソンプリント」＆コメントを入れて引用ポスト）"""
    out = []
    for sent in re.split(r"[\n。]|[①-⑩]|(?<!\d)(?=[1-9](?:[.．、)）:：⃣]|\s*@))", norm(text)):
        if not re.search(r"引用|返信|リプライ|コメント|投稿|ポスト|入れて|付けて|つけて|添えて", sent):
            continue
        for m in re.finditer(r"[「『]([^」』]{2,40})[」』]", sent):
            ph = m.group(1).strip()
            if ph.startswith(("#", "＃")) or re.search(r"キャンペーン$|プレゼント$", ph):
                continue
            if re.search(r"ハッシュタグ\s*(?:は|:|：)?\s*$", sent[:m.start()]) or re.match(r"\s*を\s*(?:つけ|付け)て", sent[m.end():]):
                continue  # ハッシュタグとして別に扱う
            if ph not in out:
                out.append(ph)
    return out[:3]


def extract_x_follows(text: str) -> list[str]:
    """フォローが条件になっているアカウント（複数指定に対応）"""
    out = []
    for line in re.split(r"[\n。]", norm(text)):
        if "フォロー" not in line:
            continue
        for m in re.finditer(r"@([A-Za-z0-9_]{1,15})", line):
            if m.group(1) not in out:
                out.append(m.group(1))
    return out[:5]


def needs_image_tag(text: str) -> bool:
    """指定ハッシュタグが画像の中にしか書かれていない"""
    return bool(re.search(r"画像(に|内|の中)(記載|書かれ|ある|表示)|画像に記載の|画像内の(ハッシュタグ|#)", norm(text)))


def extract_x_prompt(text: str) -> str:
    """返信・引用で答えることを求められている内容（例：「欲しい商品をコメント」）"""
    for line in re.split(r"[\n。]", norm(text)):
        if re.search(r"返信|リプライ|コメント|引用", line) and len(line) < 160:
            return line.strip()
    return ""


def extract_image(page: str) -> str | None:
    m = re.search(r'<meta[^>]+property="og:image"[^>]+content="([^"]+)"', page) or \
        re.search(r'<meta[^>]+content="([^"]+)"[^>]+property="og:image"', page)
    return html.unescape(m.group(1)) if m else None


PRIZE_VALUE_RE = re.compile(r"([\d,]+(?:\.\d+)?)\s*(万)?\s*円")


def extract_value(text: str) -> int:
    """賞品額の目安（円）。'XX円分' など賞品文脈のものだけ。"""
    best = 0
    for m in PRIZE_VALUE_RE.finditer(text):
        ctx = text[max(0, m.start() - 30): m.end() + 15]
        if not re.search(r"分|相当|ギフト|券|ペイ|ポイント|現金|賞金|賞品|プレゼント", ctx):
            continue
        if re.search(r"税込|税抜|価格|定価|販売|円\(税", ctx):
            continue
        try:
            v = float(m.group(1).replace(",", ""))
        except ValueError:
            continue
        if m.group(2):
            v *= 10000
        if v <= 10_000_000:
            best = max(best, int(v))
    return best


METHOD_RULES = [
    ("x", r"(?:X|Twitter|ツイッター).{0,40}(?:フォロー|リポスト|リツイート|RT|引用|返信|リプライ)|フォロー.{0,20}(?:リポスト|リツイート|RT)"),
    ("instagram", r"(?:Instagram|インスタ).{0,40}(?:フォロー|いいね|コメント|投稿)"),
    ("line", r"LINE.{0,20}(?:友だち|友達|お友だち)"),
    ("tiktok", r"TikTok.{0,40}(?:フォロー|いいね|投稿)"),
    ("form", r"応募フォーム|フォームから|フォームより|特設サイト(?:から|より|にて)|WEB(?:から|より)|Web(?:から|より)|ウェブ(?:から|より)|専用ページ|キャンペーンサイト"),
    ("survey", r"アンケート(?:に回答|回答|にお答え)"),
    ("purchase", r"レシート|購入者|購入いただ|ご購入|お買い上げ|対象商品を(?:購入|お買)|購入金額|ご利用金額|応募券|シリアル(?:コード|番号)"),
    ("hagaki", r"はがき|ハガキ|葉書|郵送"),
    ("visit", r"店頭で|来店|会場で|ご来場"),
]
METHOD_LABEL = {"x": "X", "instagram": "Instagram", "line": "LINE", "tiktok": "TikTok", "form": "Webフォーム",
                "survey": "アンケート", "purchase": "購入必須", "hagaki": "ハガキ", "visit": "来店"}


CONTEXTUAL = {"purchase", "visit", "hagaki"}  # 応募条件の文脈でだけ判定する
CONDITION_RE = re.compile(r"応募|参加|対象|条件|いただいた方|された方|した方|抽選")


def extract_methods(text: str) -> list[str]:
    lines = text.split("\n")
    cond = "\n".join(l for l in lines if CONDITION_RE.search(l))
    out = []
    for k, pat in METHOD_RULES:
        if re.search(pat, cond if k in CONTEXTUAL else text):
            out.append(k)
    return out


SKIP_HOSTS = ("prtimes.jp", "atpress.ne.jp", "facebook.com/sharer", "twitter.com/intent", "x.com/intent",
              "line.me/R/msg", "b.hatena", "pocket", "google.com", "apple.com/jp/app", "play.google",
              "tayori.com", "jooto.com", "predge.jp")
SNS_PROFILE_RE = re.compile(r"^https?://(?:www\.)?(?:x|twitter|instagram|tiktok|facebook|youtube)\.com/[^/?#]+/?(?:\?.*)?$")


def extract_entry_url(fragment: str) -> str | None:
    anchors = []
    for m in re.finditer(r'<a\b[^>]*href="(https?://[^"]+)"[^>]*>(.*?)</a>', fragment, re.S | re.I):
        href = html.unescape(m.group(1))
        text = norm(html.unescape(re.sub(r"<[^>]+>", "", m.group(2)))).strip()
        if any(h in href for h in SKIP_HOSTS):
            continue
        anchors.append((href, text, m.start()))
    if not anchors:
        return None

    def rank(a):
        href, text, pos = a
        r = 0
        ctx = fragment[max(0, pos - 300):pos]
        ctx_t = norm(html.unescape(re.sub(r"<[^>]+>", "", ctx)))
        if re.search(r"応募", text):
            r += 50
        if re.search(r"キャンペーン|特設|詳細|こちら|参加", text):
            r += 25
        if re.search(r"応募|キャンペーン", ctx_t[-80:]):
            r += 20
        if re.search(r"campaign|cp|present|lottery|entry|form|cmp", href, re.I):
            r += 20
        if re.search(r"forms\.gle/|docs\.google\.com/forms|form\.run/|formzu|questant\.jp|forms\.office\.com|survey|enquete|/form", href, re.I):
            r += 40
        if re.search(r"(?:x|twitter)\.com/[^/]+/status/|instagram\.com/(?:p|reel)/", href):
            r += 30
        if SNS_PROFILE_RE.match(href):
            r -= 15
        return r

    best = max(anchors, key=rank)
    return best[0] if rank(best) > 0 else None


def score(item: dict) -> int:
    s = 0.0
    w = item.get("winners") or 0
    s += min(35, 8 * math.log10(w + 1) * 1.6) if w else 5
    v = item.get("value") or 0
    if v:
        s += min(25, 6 * math.log10(v / 500 + 1) * 2)
    m = set(item.get("methods", []))
    if m & {"x", "instagram", "line", "tiktok", "form", "survey"} and "purchase" not in m:
        s += 20  # 誰でも無料で即応募
    if "purchase" in m:
        s -= 20
    if "hagaki" in m:
        s -= 8
    if "visit" in m:
        s -= 15
    if item.get("entryUrl"):
        s += 10
    if re.search(r"現金|ギフト券|ギフトカード|Amazon|QUOカード|ペイ|ポイント|商品券", item.get("title", "") + item.get("prize", "")):
        s += 10
    dl = item.get("deadline")
    if dl:
        days = (dt.date.fromisoformat(dl) - TODAY).days
        if days <= 3:
            s += 5  # 締切間近
    return int(round(max(0, min(100, s))))


# 受け取るだけで済まない賞品は除外：自宅での工事・取付が必要なもの、割引クーポン類
EXCLUDE_WORK_RE = re.compile(r"工事|取付|取り付け|施工|リフォーム|設置費|交換費")
EXCLUDE_COUPON_RE = re.compile(r"クーポン|割引券|値引|円引|[%％]\s*OFF|OFF券|優待券|割引")


# 怪しい懸賞：使い捨てによく使われるドメイン、金銭・機微情報の要求、詐欺的な文言
SUSPICIOUS_TLD_RE = re.compile(r"^https?://[^/]+\.(?:xyz|top|click|icu|buzz|cfd|sbs|rest|monster|work|loan|win|bid|gq|tk|ml|cf|ga|zip|mov)(?:[:/]|$)", re.I)
SUSPICIOUS_TEXT_RE = re.compile(r"当選確定|必ず当たる|全員当選.{0,10}(送料|手数料)|あなたが選ばれ|おめでとうございます.{0,10}当選|送料(を|は)?(ご)?負担|手数料.{0,10}(お支払|振込|必要)|代引き|クレジットカード(番号|情報)|口座番号|暗証番号|マイナンバー|協賛企業.{0,15}(提供|連絡|ご案内)|第三者(へ|に)?の?提供に同意")


def is_suspicious(item: dict) -> bool:
    url = item.get("entryUrl") or ""
    text = " ".join(str(item.get(k, "")) for k in ("title", "prize", "howTo"))
    return bool(SUSPICIOUS_TLD_RE.match(url) or SUSPICIOUS_TEXT_RE.search(text))


def is_excluded(item: dict) -> bool:
    if is_suspicious(item):
        return True
    prize = item.get("prizeShort", "") + " " + item.get("prize", "")
    return bool(EXCLUDE_WORK_RE.search(prize + " " + item.get("title", "")) or EXCLUDE_COUPON_RE.search(prize))


KOUBO_LABELS = ["締切日", "主催者", "賞", "応募資格", "主催者サイト", "募集内容", "応募方法/応募先",
                "応募時の会員登録", "募集期間", "諸権利", "出典:"]
SNS_HOST_RE = re.compile(r"^https?://(?:www\.|mobile\.)?(?:x|twitter|instagram|tiktok|facebook|youtube|line)\.(?:com|me)/|^https?://lin\.ee/")
WEB_ENTRY_RE = re.compile(r"応募フォーム|フォーム|WEB|Web|ウェブ|特設サイト|キャンペーンサイト|アンケート|専用ページ|サイト(?:から|より|内)|応募する|応募ボタン|応募ページ|応募バナー|キャンペーンページ|特設ページ|エントリー(?:ページ|フォーム|ボタン)?|クイズに(?:回答|答え)")


def analyze_koubo(cand: dict, page: str) -> dict | None:
    """koubo.jp の懸賞詳細ページ（項目が構造化されている）"""
    lines = html_to_lines(page)
    try:
        st = lines.index("締切日")
    except ValueError:
        return None
    f: dict[str, list[str]] = {}
    cur = None
    for l in lines[st:]:
        if l in KOUBO_LABELS:
            cur = l.rstrip("：")
        elif l.startswith("コンテストの趣旨") or l == "こんな公募もいかがですか?":
            break
        elif cur:
            f.setdefault(cur, []).append(l)
    title = lines[st - 3] if st >= 3 else cand["title"]
    pub = next((l for l in lines[st - 3: st] if re.match(r"\d{4}/\d{1,2}/\d{1,2} 掲載", l)), "")
    published = ""
    if pub:
        y, m, d = re.findall(r"\d+", pub)[:3]
        published = f"{int(y):04d}-{int(m):02d}-{int(d):02d}"
    base = dt.date.fromisoformat(published) if published else TODAY
    ds = find_dates(" ".join(f.get("締切日", [])), base)
    deadline = ds[-1][1].isoformat() if ds else None
    if deadline and dt.date.fromisoformat(deadline) < TODAY:
        return None
    i = page.find("主催者サイト")
    m = re.search(r'href="(https?://(?!koubo\.jp)[^"]+)"', page[i:]) if i >= 0 else None
    site = re.sub(r"#\d+$", "", html.unescape(m.group(1))) if m else None
    if site:
        # 「…/terms）およびBabyTech®」のように本文が混ざったURLを、URLとして有効な部分だけに切る
        mm = re.match(r"https?://[!-~]+", site)
        site = mm.group(0).rstrip(").,;:'\"]") if mm else None
    how = " ".join(f.get("応募方法/応募先", []))
    body = " ".join(f.get("募集内容", []))
    prize_lines = f.get("賞", [])
    full = f"{title}\n{how}\n{body}\n" + "\n".join(prize_lines)
    methods = extract_methods(full)
    sns_only = bool(site and SNS_HOST_RE.match(site))
    if not sns_only and WEB_ENTRY_RE.search(how) and "form" not in methods:
        methods.append("form")
    if site and re.match(r"^https?://(?:www\.)?(?:x|twitter)\.com/", site) and "x" not in methods:
        methods.insert(0, "x")
    if site and "instagram.com" in site and "instagram" not in methods:
        methods.insert(0, "instagram")
    member = " ".join(f.get("応募時の会員登録", []))
    prize_short = re.sub(r"^[【\[]|[】\]]$", "", prize_lines[0]).strip() if prize_lines else ""
    if len(prize_short) > 40:
        prize_short = extract_prize_short(prize_lines + [body, title]) or prize_short[:40] + "…"
    item = {
        "id": re.sub(r"\W+", "_", cand["url"].split("//", 1)[-1]),
        "source": "koubo",
        "url": cand["url"],
        "title": title,
        "company": " ".join(f.get("主催者", []))[:60],
        "published": published or TODAY.isoformat(),
        "deadline": deadline,
        "winners": extract_winners(full),
        "value": extract_value(full),
        "prize": " ".join(prize_lines)[:200],
        "prizeShort": prize_short,
        "image": extract_image(page),
        "xPost": extract_x_post(f'href="{site}"') if site else None,
        "xNeeds": extract_x_needs(how) if site and "x.com" in site else [],
        "xTags": extract_x_tags(how + " " + body) if site and "x.com" in site else [],
        "xPrompt": extract_x_prompt(how) if site and "x.com" in site else "",
        "xPhrases": extract_x_phrases(how) if site and "x.com" in site else [],
        "xFollows": extract_x_follows(how) if site and "x.com" in site else [],
        "xImageTag": needs_image_tag(how) if site and "x.com" in site else False,
        "methods": methods,
        "entryUrl": site,
        "howTo": how[:300],
        # 会員登録不要・Webフォームで応募・購入/郵送/来店なし → 自動応募の対象
        # ハガキ「または」Webで応募できるものはWebで応募する（ハガキだけ・購入・来店が必要なものは除く）
        "webOpen": (member.startswith("不要") and "form" in methods and not sns_only
                    and not ({"purchase", "visit", "line"} & set(methods))
                    and not re.search(r"アプリ(を|内|から|で)|会員登録|ログイン|メンバー登録|会員番号|ID(を|で|の)?(取得|登録|連携)|友だち(追加|登録)", how)),
        "pv": PARSE_VERSION,
        "addedAt": dt.datetime.now(JST).isoformat(timespec="seconds"),
    }
    if is_excluded(item):
        return None
    item["score"] = score(item)
    return item


CHANCE_LABELS = ["プレゼント内容", "当選者数", "応募締切", "主催者", "応募形式", "カテゴリー"]
CHANCE_METHOD = [("x", r"X|Twitter"), ("instagram", r"Instagram|インスタ"), ("line", r"LINE"), ("tiktok", r"TikTok"),
                 ("survey", r"アンケート"), ("form", r"WEB|Web|ウェブ|メール|アンケート|クイズ"),
                 ("purchase", r"レシート|購入|クローズド"), ("hagaki", r"ハガキ|はがき")]


def analyze_chance(cand: dict, page: str) -> dict | None:
    lines = html_to_lines(page)
    try:
        st = lines.index("プレゼント内容")
    except ValueError:
        return None
    f: dict[str, list[str]] = {}
    cur = None
    for l in lines[st: st + 80]:
        if l in CHANCE_LABELS:
            cur = l
        elif l.startswith("掲載日"):
            cur = "_desc"
        elif l.startswith("お得な情報満載") or l.startswith("他にも、"):
            break
        elif cur:
            f.setdefault(cur, []).append(l)
    prize = " ".join(f.get("プレゼント内容", []))[:120]
    how = " ".join(f.get("応募形式", []))
    desc = " ".join(f.get("_desc", []))[:400]
    ds = find_dates(" ".join(f.get("応募締切", [])), TODAY)
    deadline = ds[0][1].isoformat() if ds else None
    if deadline and dt.date.fromisoformat(deadline) < TODAY:
        return None
    methods = [k for k, pat in CHANCE_METHOD if re.search(pat, how)]
    if re.search(r"購入|レシート|お買い上げ", desc) and "purchase" not in methods:
        methods.append("purchase")
    cid = re.search(r"/detail/(\d+)/", cand["url"]).group(1)
    item = {
        "id": re.sub(r"\W+", "_", cand["url"].split("//", 1)[-1]),
        "source": "chance",
        "url": cand["url"],
        "title": desc[:80] or prize,
        "company": " ".join(f.get("主催者", []))[:60],
        "published": TODAY.isoformat(),
        "deadline": deadline,
        "winners": extract_winners(" ".join(f.get("当選者数", [])) + " " + desc),
        "value": extract_value(desc),
        "prize": prize,
        "prizeShort": re.sub(r"\s+", " ", prize)[:40],
        "image": extract_image(page),
        "xPost": None,
        "xNeeds": [],
        "xTags": [],
        "xPrompt": "",
        "xPhrases": [],
        "xFollows": [],
        "xImageTag": False,
        "methods": methods,
        # 応募ページへの転送リンク（本人がタップする用。ロボットは辿らない）
        "entryUrl": f"https://www.chance.com/jump.srv?id={cid}",
        "howTo": desc[:300],
        "webOpen": False,
        "pv": PARSE_VERSION,
        "addedAt": dt.datetime.now(JST).isoformat(timespec="seconds"),
    }
    if is_excluded(item):
        return None
    item["score"] = score(item)
    return item


def analyze(cand: dict, page: str) -> dict | None:
    if cand["source"] == "chance":
        return analyze_chance(cand, page)
    if cand["source"] == "koubo":
        return analyze_koubo(cand, page)
    if cand["source"] == "prtimes":
        i = page.find('id="press-release-body"')
        j = page.find('js-press-release-image-list', i)
        frag = page[i:j if j > i else i + 120000] if i >= 0 else page
        if not cand["title"]:
            t = re.search(r"<title>(.*?)</title>", page, re.S)
            cand["title"] = norm(html.unescape(t.group(1))).split("|")[0].strip() if t else ""
        if not cand["published"]:
            d = re.search(r'"datePublished"\s*:\s*"(\d{4}-\d{2}-\d{2})', page) or \
                re.search(r"(20\d{2})年(\d{1,2})月(\d{1,2})日 \d{1,2}時", norm(page))
            if d and d.lastindex == 1:
                cand["published"] = d.group(1)
            elif d:
                cand["published"] = f"{d.group(1)}-{int(d.group(2)):02d}-{int(d.group(3)):02d}"
        if not cand["company"]:
            c = re.search(r'"publisher"\s*:\s*\{[^}]*"name"\s*:\s*"([^"]+)"', page)
            cand["company"] = c.group(1) if c and "PR TIMES" not in c.group(1) else ""
    else:
        i = page.find('id="news_body_block"')
        j = page.find('id="article-footer"', i)
        frag = page[i:j if j > i else i + 120000] if i >= 0 else page

    lines = html_to_lines(frag)
    text = "\n".join(lines)
    full = cand["title"] + "\n" + text
    if not (LOTTERY_RE.search(full) and PRIZE_RE.search(full)):
        return None

    try:
        base = dt.date.fromisoformat(cand["published"]) if cand["published"] else TODAY
    except ValueError:
        base = TODAY
    deadline = extract_deadline(lines, base)
    if deadline and dt.date.fromisoformat(deadline) < TODAY:
        return None

    item = {
        "id": re.sub(r"\W+", "_", cand["url"].split("//", 1)[-1]),
        "source": cand["source"],
        "url": cand["url"],
        "title": cand["title"],
        "company": cand["company"],
        "published": cand["published"] or TODAY.isoformat(),
        "deadline": deadline,
        "winners": extract_winners(full),
        "value": extract_value(full),
        "prize": extract_prize(lines, cand["title"]),
        "prizeShort": "",
        "image": extract_image(page),
        "xPost": extract_x_post(frag),
        "xNeeds": extract_x_needs(method_text(text)),
        "xTags": extract_x_tags(method_text(text)) if extract_x_post(frag) else [],
        "xPrompt": extract_x_prompt(method_text(text)) if extract_x_post(frag) else "",
        "xPhrases": extract_x_phrases(method_text(text)) if extract_x_post(frag) else [],
        "xFollows": extract_x_follows(method_text(text)) if extract_x_post(frag) else [],
        "xImageTag": needs_image_tag(method_text(text)) if extract_x_post(frag) else False,
        "methods": extract_methods(full),
        "entryUrl": extract_entry_url(frag),
        "webOpen": False,
        "addedAt": dt.datetime.now(JST).isoformat(timespec="seconds"),
    }
    item["prizeShort"] = extract_prize_short(
        [item["prize"], cand["title"]] + [l for l in lines if re.search(r"プレゼント|当た|賞品|景品", l) and len(l) < 200])
    if is_excluded(item):
        return None
    eu = item.get("entryUrl") or ""
    item["pv"] = PARSE_VERSION
    item["webOpen"] = bool(eu and not SNS_HOST_RE.match(eu) and "form" in item["methods"]
                           and not ({"purchase", "visit"} & set(item["methods"]))
                           and not re.search(r"会員登録|ログイン|マイページ", text))
    item["score"] = score(item)
    return item


# ---------------------------------------------------------------- main
def is_alive(item: dict) -> bool:
    if item.get("deadline"):
        return dt.date.fromisoformat(item["deadline"]) >= TODAY
    try:
        pub = dt.date.fromisoformat(item["published"])
    except (KeyError, ValueError):
        return False
    return (TODAY - pub).days <= NO_DEADLINE_TTL_DAYS


def main() -> int:
    data = load_json(DATA_PATH, {"items": []})
    state = load_json(STATE_PATH, {"seen": []})
    seen: list[str] = state.get("seen", [])
    seen_set = set(seen)
    items = {it["url"]: it for it in data.get("items", []) if is_alive(it)}

    cands: dict[str, dict] = {}
    for src, url in FEEDS:
        xml = fetch(url)
        if not xml:
            continue
        for c in parse_rss(src, xml):
            if c["url"] in seen_set or c["url"] in items:
                continue
            if CANDIDATE_RE.search(c["title"] + c["desc"]):
                cands[c["url"]] = c
    for src, url in KEYWORD_PAGES:
        page = fetch(url)
        if not page:
            continue
        for c in parse_keyword_page(src, page):
            if c["url"] not in seen_set and c["url"] not in items:
                cands.setdefault(c["url"], c)

    # 旧形式（賞品名・画像なし）のアイテムを再解析
    for it in list(items.values()):
        if it.get("pv", 0) < PARSE_VERSION or "xPhrases" not in it or (it["source"] not in ("koubo", "chance") and ("prizeShort" not in it or "xNeeds" not in it or "webOpen" not in it)):
            cands.setdefault(it["url"], {"source": it["source"], "url": it["url"], "title": it["title"],
                                         "desc": "", "company": it.get("company", ""), "published": it.get("published", "")})

    print(f"candidates: {len(cands)}")
    new_items = []
    for n, c in enumerate(list(cands.values())[:MAX_DETAIL_FETCH]):
        time.sleep(FETCH_DELAY if n else 0)
        page = fetch(c["url"])
        if page is None:
            continue  # 次回リトライ
        seen.append(c["url"])
        seen_set.add(c["url"])
        it = analyze(c, page)
        old = items.get(c["url"])
        if it:
            if old:  # 再解析：初出時刻を維持し、新着扱いにしない
                it["addedAt"] = old.get("addedAt", it["addedAt"])
            else:
                new_items.append(it)
            items[it["url"]] = it
            print(f"  {'~' if old else '+'} [{it['score']:3d}] {it['prizeShort'] or '-'} | {it['title'][:40]}")
        elif old:
            del items[c["url"]]

    # スコアは締切接近で変わるので毎回再計算
    alive = [it for it in items.values() if is_alive(it) and not is_excluded(it)]
    for it in alive:
        it["score"] = score(it)
    alive.sort(key=lambda x: (-x["score"], x.get("deadline") or "9999"))

    save_json(DATA_PATH, {
        "updatedAt": dt.datetime.now(JST).isoformat(timespec="seconds"),
        "methodLabels": METHOD_LABEL,
        "items": alive,
    })
    save_json(STATE_PATH, {"seen": seen[-6000:]})

    # 通知用（GitHub Actions が読む）
    with open(NEW_PATH, "w", encoding="utf-8") as f:
        json.dump(sorted(new_items, key=lambda x: -x["score"]), f, ensure_ascii=False)
    print(f"new: {len(new_items)}, total alive: {len(alive)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
