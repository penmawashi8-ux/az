'use client'

import { useEffect, useMemo, useState } from 'react'
import './kensho.css'

type Item = {
  id: string
  source: string
  url: string
  title: string
  company: string
  published: string
  deadline: string | null
  winners: number | null
  value: number
  prize: string
  prizeShort?: string
  image?: string | null
  xPost?: string | null
  xNeeds?: string[]
  xTags?: string[]
  xPrompt?: string
  xPhrases?: string[]
  webOpen?: boolean
  methods: string[]
  entryUrl: string | null
  score: number
  addedAt: string
}

type Data = { updatedAt: string; methodLabels: Record<string, string>; items: Item[] }
type Mark = 'applied' | 'hidden'
type Tab = 'todo' | 'x' | 'history' | 'hidden'

// GitHub Actions が毎時更新する kensho-data ブランチ
const DATA_URL = 'https://raw.githubusercontent.com/penmawashi8-ux/az/kensho-data/data.json'
const APPLIED_URL = 'https://raw.githubusercontent.com/penmawashi8-ux/az/kensho-data/applied.json'
type BotResult = {
  status: 'applied' | 'skip' | 'fail' | 'unknown'
  reason: string
  at: string
  title?: string
  prize?: string
  url?: string
  entryUrl?: string
  deadline?: string | null
  image?: string | null
  reapplied?: string[]
  reapplyNote?: string
}
const BOT_LABEL: Record<string, string> = { applied: '自動応募済み', skip: '自動応募できず', fail: '自動応募に失敗', unknown: '自動応募（完了未確認）' }
// 送信まで進んだもの（完了画面を確認できなかったものも含む）
const OKS = ['applied', 'unknown']
const MARKS_KEY = 'kensho.marks.v1'
const PREFS_KEY = 'kensho.prefs.v1'
const PROFILE_KEY = 'kensho.profile.v1'
// ワンボタン応募でXへ移動している間、連続応募モードの続きを覚えておく
const RUN_KEY = 'kensho.run.v1'
const USERSCRIPT_PATH = '/kensho/x-oneclick.user.js'
// public/kensho/x-oneclick.user.js の @version と合わせる
const USERSCRIPT_VERSION = '1.0.1'

function readLS<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key)
    return v ? (JSON.parse(v) as T) : fallback
  } catch {
    return fallback
  }
}
function writeLS(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v))
  } catch {
    /* private mode etc. */
  }
}

/** カード見出しに出す賞品名（短縮名がなければ説明文/タイトルを短く） */
function prizeLabel(it: Item): string {
  if (it.prizeShort) return it.prizeShort
  const src = (it.prize || it.title).replace(/^[\s、,]+/, '')
  return src.length > 30 ? src.slice(0, 30) + '…' : src
}

/** PR TIMES の画像は小さいサイズで取得 */
function thumb(url: string): string {
  return url.replace(/width=\d+&height=\d+/, 'width=320&height=320')
}

const X_STATUS = /^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/status(?:es)?\/(\d+)/

/** Xキャンペーンの告知ポスト（アカウント名とポストID） */
function xPostOf(it: Item): { user: string; id: string; url: string } | null {
  for (const u of [it.xPost, it.entryUrl]) {
    const m = u ? X_STATUS.exec(u) : null
    if (m) return { user: m[1], id: m[2], url: `https://x.com/${m[1]}/status/${m[2]}` }
  }
  return null
}
// 工事・取付が必要な賞品、割引クーポン類は表示しない（収集側でも除外）
const EXCLUDED = (it: Item) =>
  /工事|取付|取り付け|施工|リフォーム|設置費|交換費/.test(`${it.prizeShort || ''} ${it.prize} ${it.title}`) ||
  /クーポン|割引券|値引|円引|[%％]\s*OFF|OFF券|優待券|割引/.test(`${it.prizeShort || ''} ${it.prize}`)
const isX = (it: Item) => it.methods.includes('x') && !!xPostOf(it)

/** 返信・引用用の文面（指定ハッシュタグ付き）。欲しい商品を聞かれていれば賞品名を入れる */
function defaultPostText(it: Item): string {
  const p = it.xPrompt || ''
  const prize = it.prizeShort ? it.prizeShort.replace(/^[「『]|[」』]$/g, '') : ''
  let body = '素敵なキャンペーンありがとうございます！応募します。当たったら嬉しいです。'
  if (/欲しい|どれ|希望/.test(p) && prize) body = `${prize}が欲しいです！ぜひ当たりますように。`
  else if (/感想|好き|楽しみ|応援/.test(p)) body = 'いつも楽しみにしています！これからも応援しています。'
  // 指定された文言（例：「これからもローソンプリント」）は必ず先頭に入れる
  const phrases = (it.xPhrases || []).join('\n')
  const tags = (it.xTags || []).join(' ')
  return [phrases, body, tags].filter(Boolean).join('\n')
}

/**
 * Xの画面を開く。PCでは小さな別ウィンドウ（毎回同じ1枚を使い回す）で開くので、
 * タブが増えず、閉じれば元の画面に戻れる。スマホでは通常どおり新しいタブ/アプリで開く。
 */
function openX(url: string) {
  const narrow = window.matchMedia('(max-width: 700px)').matches
  const w = narrow
    ? window.open(url, '_blank', 'noopener')
    : window.open(url, 'kensho-x', `popup,width=560,height=760,left=${Math.max(0, window.screenX + window.outerWidth - 580)},top=${window.screenY + 40}`)
  if (!narrow && w) w.focus()
}

function daysLeft(deadline: string | null): number | null {
  if (!deadline) return null
  const now = new Date()
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  const [y, m, d] = deadline.split('-').map(Number)
  return Math.round((Date.UTC(y, m - 1, d) - today) / 86400000)
}

const PROFILE_FIELDS: { key: string; label: string; placeholder: string }[] = [
  { key: 'sei', label: '姓', placeholder: '山田' },
  { key: 'mei', label: '名', placeholder: '花子' },
  { key: 'seiKana', label: 'せい（ふりがな）', placeholder: 'やまだ' },
  { key: 'meiKana', label: 'めい（ふりがな）', placeholder: 'はなこ' },
  { key: 'email', label: 'メール', placeholder: 'you@example.com' },
  { key: 'tel', label: '電話番号', placeholder: '09012345678' },
  { key: 'zip', label: '郵便番号', placeholder: '1000001' },
  { key: 'pref', label: '都道府県', placeholder: '東京都' },
  { key: 'city', label: '市区町村', placeholder: '千代田区' },
  { key: 'addr', label: '番地', placeholder: '千代田1-1' },
  { key: 'bldg', label: '建物名・部屋', placeholder: '' },
  { key: 'birth', label: '生年月日', placeholder: '1990-01-01' },
  { key: 'gender', label: '性別', placeholder: '女性' },
  { key: 'comment', label: '自由記述アンケートの回答（空なら定型文）', placeholder: 'いつも楽しく拝見しています…' },
]

/** 応募フォームに自動入力するブックマークレット（プロフィールは端末内だけに埋め込む） */
function buildBookmarklet(p: Record<string, string>): string {
  const fn = (P0: Record<string, string>) => {
    // 全角数字などを半角に揃える
    const P: Record<string, string> = {}
    for (const [k, v] of Object.entries(P0 || {})) P[k] = typeof v === 'string' ? v.normalize('NFKC').trim() : v
    const full = (P.sei || '') + (P.mei || '')
    const fullKana = (P.seiKana || '') + (P.meiKana || '')
    const addr = (P.pref || '') + (P.city || '') + (P.addr || '')
    const [by, bm, bd] = (P.birth || '').split('-')
    const tel = (P.tel || '').replace(/\D/g, '')
    const zip = (P.zip || '').replace(/\D/g, '')
    const kata = (s: string) => s.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60))
    // 同じ名前で末尾だけ 1/2/3 違う欄が並んでいれば分割入力（maxlength が無い場合も）
    const splitIndex = (el: HTMLInputElement) => {
      const n = el.name || el.id || ''
      const m = n.match(/^(.*?)([-_]?)([123])$/)
      if (!m) return 0
      const other = m[1] + m[2] + (m[3] === '1' ? '2' : '1')
      return document.querySelector(`[name="${CSS.escape(other)}"], [id="${CSS.escape(other)}"]`) ? Number(m[3]) : 0
    }
    type R = [RegExp, (h: string, el: HTMLInputElement) => string | undefined]
    const rules: R[] = [
      [/mail|メール/i, () => P.email],
      // 分割入力は maxlength と name/id の末尾だけで判断（ラベル内の「例：812-8577」で誤判定しない）
      [/(zip|postal|post_?code|郵便)/i, (h, el) => {
        const id = `${el.name || ''} ${el.id || ''}`.trim()
        const si = splitIndex(el)
        if (el.maxLength === 3 || si === 1 || /(_a|first|前|上)$/i.test(id)) return zip.slice(0, 3)
        if (el.maxLength === 4 || si === 2 || /(_b|second|後|下)$/i.test(id)) return zip.slice(3)
        if (el.maxLength === 8 || /-/.test(el.placeholder || '')) return `${zip.slice(0, 3)}-${zip.slice(3)}`
        return zip
      }],
      [/(tel|phone|電話|携帯)/i, (h, el) => {
        const id = `${el.name || ''} ${el.id || ''}`.trim()
        const parts = tel.length === 11 ? [tel.slice(0, 3), tel.slice(3, 7), tel.slice(7)] : [tel.slice(0, 2), tel.slice(2, 6), tel.slice(6)]
        const si = splitIndex(el)
        if (si) return parts[si - 1]
        if (el.maxLength > 0 && el.maxLength <= 5) {
          if (/first$/i.test(id)) return parts[0]
          if (/second$/i.test(id)) return parts[1]
          if (/third$/i.test(id)) return parts[2]
        }
        if (el.maxLength === 13 || /\d-\d/.test(el.placeholder || '')) return parts.join('-')
        return tel
      }],
      [/(pref|都道府県|region|address-level1)/i, () => P.pref],
      [/(city|市区町村|address-level2|addr(ess)?1|住所1)/i, () => P.city + (P.addr || '')],
      [/(bldg|building|建物|マンション|addr(ess)?3|address-line2|住所3)/i, () => P.bldg],
      [/(street|番地|addr(ess)?2|address-line1|住所2)/i, () => P.addr],
      [/(住所|address)/i, () => addr + (P.bldg ? ' ' + P.bldg : '')],
      [/(sei.?kana|last.?name.?kana|family.?name.?kana|セイ|せい|姓.*(カナ|かな|フリガナ|ふりがな))/i, (h) => (/カナ|カタカナ|フリガナ|kana/i.test(h) ? kata(P.seiKana) : P.seiKana)],
      [/(mei.?kana|first.?name.?kana|given.?name.?kana|メイ|めい|名.*(カナ|かな|フリガナ|ふりがな))/i, (h) => (/カナ|カタカナ|フリガナ|kana/i.test(h) ? kata(P.meiKana) : P.meiKana)],
      [/(kana|furigana|フリガナ|ふりがな|カナ)/i, (h) => (/カナ|フリガナ|katakana/i.test(h) ? kata(fullKana) : fullKana)],
      [/(last.?name|family.?name|sei\b|姓|苗字)/i, () => P.sei],
      [/(first.?name|given.?name|mei\b|^名$|名\(下\))/i, () => P.mei],
      [/(birth.*year|生年|year)/i, () => by],
      [/(birth.*month|month|生月)/i, () => bm && String(+bm)],
      [/(birth.*day|^day|生日)/i, () => bd && String(+bd)],
      [/(birth|誕生|生年月日)/i, () => P.birth],
      [/(name|氏名|名前|お名前)/i, () => full],
    ]
    const labelOf = (el: HTMLElement) => {
      let t = ''
      const id = el.id
      if (id) {
        const l = document.querySelector('label[for="' + CSS.escape(id) + '"]')
        if (l) t += ' ' + l.textContent
      }
      const wrap = el.closest('label, tr, dl, li, .form-group, .row, div')
      if (wrap) t += ' ' + (wrap.textContent || '').slice(0, 80)
      return t
    }
    const setVal = (el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, v: string) => {
      const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
      if (el instanceof HTMLSelectElement) {
        const opt = Array.from(el.options).find((o) => o.text.trim() === v || o.value === v || o.text.includes(v))
        if (!opt) return false
        v = opt.value
      }
      setter ? setter.call(el, v) : (el.value = v)
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
      return true
    }
    let n = 0
    let q = 0
    const survey = P.survey !== 'off'
    const comment = P.comment || 'いつも楽しく拝見しています。商品の魅力がよく伝わってきて、ぜひ試してみたいと思いました。当選したら家族と一緒に大切に使わせていただきます。'
    // 選ばない選択肢 / 触らないチェック（同意・メルマガ等は本人が確認する）
    const SKIP = /その他|答えたくない|回答しない|回答しません|わからない|分からない|選択して|選んで|^-+$|^\s*$/
    const NO_TOUCH = /同意|規約|ポリシー|個人情報|メルマガ|メールマガジン|配信を希望|ニュースレター|案内を受け|受け取る/
    document.querySelectorAll<HTMLInputElement>('input, select, textarea').forEach((el) => {
      const type = (el.getAttribute('type') || '').toLowerCase()
      if (['hidden', 'submit', 'button', 'checkbox', 'radio', 'file', 'password', 'image'].includes(type)) return
      if (el.value) return
      const h = [el.name, el.id, el.getAttribute('autocomplete'), el.getAttribute('placeholder'), el.getAttribute('aria-label')].join(' ')
      const hl = h + ' ' + labelOf(el)
      const isFree = /感想|理由|意見|コメント|メッセージ|ご要望|自由|エピソード|思い出|ひと言|一言|お聞かせ|教えて/.test(hl.slice(0, 120))
      if (!(survey && isFree && (el instanceof HTMLTextAreaElement))) {
        for (const [re, get] of rules) {
          if (re.test(h) || (!h.trim() && re.test(hl)) || re.test(hl.slice(0, 40))) {
            const v = get(hl, el)
            if (v && setVal(el, v)) n++
            return
          }
        }
      }
      if (!survey) return
      // ---- アンケート：プロフィールに該当しない項目
      if (el instanceof HTMLSelectElement) {
        const opts = Array.from(el.options).filter((o) => o.value && !o.disabled && !SKIP.test(o.text))
        if (opts.length) {
          setVal(el, opts[Math.floor(opts.length / 2)].value)
          q++
        }
      } else if (el instanceof HTMLTextAreaElement || isFree) {
        if (setVal(el, comment)) q++
      }
    })
    // 性別ラジオ
    if (P.gender) {
      document.querySelectorAll<HTMLInputElement>('input[type=radio]').forEach((r) => {
        const t = (r.value + ' ' + labelOf(r)).slice(0, 40)
        if (t.includes(P.gender) && !r.checked) {
          r.click()
          n++
        }
      })
    }
    if (survey) {
      const POSITIVE = /とても|非常に|満足|好き|はい|ある|あり|興味がある|使ってみたい|買いたい|購入したい|知っている|良い|よい/
      const pick = <T,>(xs: T[], text: (x: T) => string) => {
        const ok = xs.filter((x) => !SKIP.test(text(x)) && !NO_TOUCH.test(text(x)))
        return ok.find((x) => POSITIVE.test(text(x))) || ok[0]
      }
      // 通常のラジオ・チェックボックス（name単位のグループ）
      const groups = new Map<string, HTMLInputElement[]>()
      document.querySelectorAll<HTMLInputElement>('input[type=radio], input[type=checkbox]').forEach((el) => {
        if (el.disabled || !el.name) return
        const k = el.type + ':' + el.name
        groups.set(k, [...(groups.get(k) || []), el])
      })
      groups.forEach((els, k) => {
        if (els.some((e) => e.checked)) return
        if (k.startsWith('checkbox:') && els.length < 2) return // 単独チェック＝同意系なので触らない
        const t = (e: HTMLInputElement) => (labelOf(e).slice(0, 40) + ' ' + e.value).trim()
        if (els.some((e) => NO_TOUCH.test(t(e)))) return
        const c = pick(els, (e) => (e.labels?.[0]?.textContent || e.value || '').trim())
        if (c) {
          c.click()
          q++
        }
      })
      // Googleフォーム等（role属性ベース）
      document.querySelectorAll<HTMLElement>('[role=radiogroup]').forEach((g) => {
        const rs = Array.from(g.querySelectorAll<HTMLElement>('[role=radio]'))
        if (!rs.length || rs.some((r) => r.getAttribute('aria-checked') === 'true')) return
        const c = pick(rs, (r) => r.getAttribute('aria-label') || r.getAttribute('data-value') || r.textContent || '')
        if (c) {
          c.click()
          q++
        }
      })
      const cbGroups = new Map<Element, HTMLElement[]>()
      document.querySelectorAll<HTMLElement>('[role=checkbox]').forEach((c) => {
        const g = c.closest('[role=listitem], [role=group], fieldset') || c.parentElement!
        cbGroups.set(g, [...(cbGroups.get(g) || []), c])
      })
      cbGroups.forEach((cs) => {
        if (cs.length < 2 || cs.some((c) => c.getAttribute('aria-checked') === 'true')) return
        const c = pick(cs, (x) => x.getAttribute('aria-label') || x.getAttribute('data-answer-value') || x.textContent || '')
        if (c) {
          c.click()
          q++
        }
      })
    }
    const summary = '個人情報' + n + '項目' + (survey ? '・アンケート' + q + '問' : '')
    if (P.autosubmit !== 'on') {
      alert('懸賞オートフィル: ' + summary + 'を入力しました。\n同意チェックと内容を確認して送信してください。')
      return
    }
    // ---- 送信まで自動（設定でオンにした場合のみ）
    // CAPTCHAがあるページは人が解く必要があるので止める
    if (document.querySelector('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="turnstile"], .g-recaptcha, .h-captcha, .cf-turnstile')) {
      alert('懸賞オートフィル: ' + summary + 'を入力しました。\n画像認証があるので、認証を済ませて送信してください。')
      return
    }
    // 応募規約への同意（メルマガ等の配信希望には触れない）
    document.querySelectorAll<HTMLInputElement>('input[type=checkbox]').forEach((c) => {
      const t = labelOf(c).slice(0, 60) + ' ' + c.value
      if (!c.checked && /同意|規約|ポリシー|個人情報の取り?扱/.test(t) && !/メルマガ|メールマガジン|配信|ニュース|案内/.test(t)) c.click()
    })
    document.querySelectorAll<HTMLElement>('[role=checkbox][aria-checked=false]').forEach((c) => {
      const t = (c.getAttribute('aria-label') || c.textContent || '').slice(0, 60)
      if (/同意|規約|ポリシー/.test(t) && !/メルマガ|配信|案内/.test(t)) c.click()
    })
    const btns = Array.from(document.querySelectorAll<HTMLElement>('button, input[type=submit], input[type=image], a[role=button], [role=button]'))
      .filter((b) => (b as HTMLElement).offsetParent !== null && !(b as HTMLButtonElement).disabled)
    const txt = (b: HTMLElement) => ((b as HTMLInputElement).value || b.getAttribute('aria-label') || b.textContent || '').trim()
    const NG = /戻る|修正|キャンセル|リセット|クリア|ログイン|検索|シェア|閉じる/
    const btn =
      btns.find((b) => /応募する|送信する|この内容で|^送信$|^応募$|確定|エントリー/.test(txt(b)) && !NG.test(txt(b))) ||
      btns.find((b) => /確認|次へ|進む|submit/i.test(txt(b)) && !NG.test(txt(b))) ||
      btns.find((b) => (b as HTMLInputElement).type === 'submit' && !NG.test(txt(b)))
    if (!btn) {
      alert('懸賞オートフィル: ' + summary + 'を入力しました。\n送信ボタンが見つからないので、手動で送信してください。')
      return
    }
    setTimeout(() => btn.click(), 400)

  }
  const src = `(${fn.toString()})(${JSON.stringify(p)})`
  return 'javascript:' + encodeURIComponent(src)
}

export default function KenshoList() {
  const [data, setData] = useState<Data | null>(null)
  const [bot, setBot] = useState<Record<string, BotResult>>({})
  const [error, setError] = useState<string | null>(null)
  const [marks, setMarks] = useState<Record<string, Mark>>({})
  const [tab, setTab] = useState<Tab>('todo')
  const [hidePurchase, setHidePurchase] = useState(true)
  const [sort, setSort] = useState<'score' | 'deadline'>('score')
  const [profile, setProfile] = useState<Record<string, string>>({})
  const [showProfile, setShowProfile] = useState(false)
  const [undo, setUndo] = useState<{ id: string; prev?: Mark } | null>(null)
  // 連続応募モード（X）：対象IDのキューと現在位置、押したステップ
  // まとめて1回：フォロー・リポスト・いいねを元の投稿ページ1枚で済ませる（Xとの往復が1回になる）
  const [oneTrip, setOneTrip] = useState(true)
  const [run, setRun] = useState<{ queue: string[]; i: number; done: Record<string, boolean>; text?: string } | null>(null)
  // ワンボタン応募用のユーザースクリプトが入っているか（入っていればバージョン）
  const [ext, setExt] = useState<string | null>(null)
  const [kxMsg, setKxMsg] = useState<string | null>(null)

  useEffect(() => {
    const check = () => setExt(document.documentElement.dataset.kenshoX || null)
    check()
    window.addEventListener('kensho-x-ready', check)
    const t = setTimeout(check, 1500)
    return () => {
      window.removeEventListener('kensho-x-ready', check)
      clearTimeout(t)
    }
  }, [])

  // ワンボタン応募からの戻り（?kx=懸賞ID&kxok=1）：応募済みにして連続応募モードの続きへ
  useEffect(() => {
    if (!data) return
    const q = new URLSearchParams(location.search)
    const kx = q.get('kx')
    if (!kx) return
    const ok = q.get('kxok') === '1'
    window.history.replaceState(null, '', location.pathname)
    const saved = readLS<{ queue: string[]; i: number; done: Record<string, boolean>; text?: string } | null>(RUN_KEY, null)
    try {
      localStorage.removeItem(RUN_KEY)
    } catch {
      /* ignore */
    }
    const it = data.items.find((x) => x.id === kx)
    const writes = !!it?.xNeeds?.some((n) => ['reply', 'quote', 'hashtag'].includes(n))
    if (!ok) {
      // 押せなかった：同じ懸賞のまま連続応募モードに戻す
      setKxMsg('自動で押せなかったので、手で押した場合は「応募済みにして次へ」を押してください')
      if (saved) setRun({ ...saved, done: {} })
      return
    }
    if (!saved || saved.queue[saved.i] !== kx) {
      if (!writes) mark(kx, 'applied', false)
      return
    }
    const done = { ...saved.done, follow: true, rt: true, like: true, post: true }
    if (writes) setRun({ ...saved, done })
    else {
      mark(kx, 'applied', false)
      if (saved.i + 1 >= saved.queue.length) setRun(null)
      else setRun({ ...saved, i: saved.i + 1, done: {}, text: undefined })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  useEffect(() => {
    setMarks(readLS(MARKS_KEY, {}))
    const prefs = readLS(PREFS_KEY, { hidePurchase: true, sort: 'score' as const, oneTrip: true })
    setHidePurchase(prefs.hidePurchase)
    setSort(prefs.sort)
    if (typeof prefs.oneTrip === 'boolean') setOneTrip(prefs.oneTrip)
    setProfile(readLS(PROFILE_KEY, {}))
    const get = (u: string) => fetch(u, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
    get(DATA_URL)
      .catch(() => get((process.env.NEXT_PUBLIC_BASE_PATH || '') + '/kensho/data.json'))
      .then(setData)
      .catch((e) => setError(String(e)))
    get(APPLIED_URL).then(setBot).catch(() => {})
  }, [])

  useEffect(() => writeLS(PREFS_KEY, { hidePurchase, sort, oneTrip }), [hidePurchase, sort, oneTrip])

  const markOf = (id: string): Mark | undefined => marks[id] || (['applied', 'unknown'].includes(bot[id]?.status || '') ? 'applied' : undefined)

  const mark = (id: string, m: Mark | undefined, withUndo = true) => {
    const next = { ...marks }
    if (m) next[id] = m
    else delete next[id]
    writeLS(MARKS_KEY, next)
    setMarks(next)
    setUndo(withUndo ? { id, prev: marks[id] } : null)
  }

  const items = useMemo(() => {
    if (!data) return []
    let xs = data.items.filter((it) => !EXCLUDED(it)).filter((it) => {
      const m = markOf(it.id)
      const visible = !(hidePurchase && it.methods.includes('purchase'))
      if (tab === 'todo') return !m && visible && !isX(it)
      if (tab === 'x') return !m && visible && isX(it)
      if (tab === 'history') return false
      return m === tab
    })
    if (sort === 'deadline') xs = [...xs].sort((a, b) => (a.deadline || '9999').localeCompare(b.deadline || '9999'))
    return xs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, marks, bot, tab, hidePurchase, sort])

  const counts = useMemo(() => {
    const c = { todo: 0, x: 0, applied: 0, hidden: 0 }
    data?.items.filter((it) => !EXCLUDED(it)).forEach((it) => {
      const m = markOf(it.id)
      if (m) c[m]++
      else if (!(hidePurchase && it.methods.includes('purchase'))) c[isX(it) ? 'x' : 'todo']++
    })
    return c
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, marks, bot, hidePurchase])

  type Hist = { note?: string; id: string; status: string; how: '自動' | '手動'; at: string; prize: string; title: string; url: string; deadline?: string | null; image?: string | null; reason?: string; entryUrl?: string }
  const history: Hist[] = useMemo(() => {
    const out: Hist[] = []
    const byId = new Map((data?.items || []).map((i) => [i.id, i]))
    Object.entries(bot).forEach(([id, b]) => {
      const it = byId.get(id)
      out.push({
        id,
        status: b.status,
        how: '自動',
        at: b.at,
        prize: b.prize || (it ? prizeLabel(it) : b.title || id),
        title: b.title || it?.title || '',
        url: b.url || it?.url || '',
        deadline: b.deadline ?? it?.deadline,
        image: b.image ?? it?.image,
        reason: b.reason,
        entryUrl: b.entryUrl || it?.entryUrl || undefined,
        note: b.reapplied?.length ? (b.reapplyNote ? `再応募せず：${b.reapplyNote.replace('のため再応募せず', '')}` : '正しいメールで再応募済み') : undefined,
      })
    })
    Object.entries(marks).forEach(([id, m]) => {
      if (m !== 'applied' || bot[id]?.status === 'applied') return
      const it = byId.get(id)
      if (!it) return
      out.push({ id, status: 'applied', how: '手動', at: '', prize: prizeLabel(it), title: it.title, url: it.url, deadline: it.deadline, image: it.image })
    })
    return out.sort((a, b) => (b.at || '').localeCompare(a.at || ''))
  }, [data, bot, marks])
  const [histFilter, setHistFilter] = useState<'applied' | 'ng'>('applied')

  const bookmarklet = useMemo(() => buildBookmarklet(profile), [profile])
  const labels = data?.methodLabels || {}

  return (
    <main className="kensho">
      <header className="k-head">
        <h1>懸賞リスト</h1>
        <p className="k-sub">
          {data ? `更新 ${new Date(data.updatedAt).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}・毎時自動収集` : '読み込み中…'}
        </p>
      </header>

      <nav className="k-tabs" role="tablist">
        {(['todo', 'x', 'history', 'hidden'] as Tab[]).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
            {t === 'todo' ? '未応募' : t === 'x' ? 'X' : t === 'history' ? '応募済み' : 'スキップ'}
            <span className="k-count">{t === 'history' ? history.filter((h) => OKS.includes(h.status)).length : counts[t]}</span>
          </button>
        ))}
      </nav>

      <div className="k-tools">
        <label>
          <input type="checkbox" checked={hidePurchase} onChange={(e) => setHidePurchase(e.target.checked)} /> 購入必須を隠す
        </label>
        <select value={sort} onChange={(e) => setSort(e.target.value as 'score' | 'deadline')} aria-label="並び順">
          <option value="score">おすすめ順</option>
          <option value="deadline">締切が近い順</option>
        </select>
        <button className="k-link" onClick={() => setShowProfile((v) => !v)}>
          自動入力設定
        </button>
      </div>

      {showProfile && (
        <section className="k-profile">
          <p className="k-note">応募フォームの自動入力用です。この端末のブラウザの中にだけ保存され、サーバーやGitHubには一切送信されません。ブックマーク登録後は、ブックマーク側にも同じ内容が入ります。</p>
          <div className="k-grid">
            {PROFILE_FIELDS.map((f) => (
              <label key={f.key}>
                <span>{f.label}</span>
                <input
                  value={profile[f.key] || ''}
                  placeholder={f.placeholder}
                  onChange={(e) => {
                    const next = { ...profile, [f.key]: e.target.value }
                    setProfile(next)
                    writeLS(PROFILE_KEY, next)
                  }}
                />
              </label>
            ))}
          </div>
          <label className="k-check">
            <input
              type="checkbox"
              checked={profile.survey !== 'off'}
              onChange={(e) => {
                const next = { ...profile, survey: e.target.checked ? 'on' : 'off' }
                setProfile(next)
                writeLS(PROFILE_KEY, next)
              }}
            />{' '}
            アンケートにも自動で回答する（選択式は好意的な選択肢、自由記述は上の文）
          </label>
          <label className="k-check">
            <input
              type="checkbox"
              checked={profile.autosubmit === 'on'}
              onChange={(e) => {
                const next = { ...profile, autosubmit: e.target.checked ? 'on' : 'off' }
                setProfile(next)
                writeLS(PROFILE_KEY, next)
              }}
            />{' '}
            <b>送信まで自動</b>：応募規約への同意にチェックして送信ボタンまで押す（確認画面がある場合はもう一度ブックマークを押す。画像認証があるページでは止まる。メルマガ購読には触れない）
          </label>
          <p className="k-note">
            下のリンクをブックマークに登録（PCはドラッグ、スマホは長押し→コピーしてブックマークのURLに貼り付け）。応募フォームでそのブックマークを開くと入力されます。
          </p>
          <p className="k-note">
            <b>完全自動応募</b>を使うには、下のボタンで設定をコピーし、GitHubのリポジトリ → Settings → Secrets and variables → Actions → New repository secret で、名前を <code>KENSHO_PROFILE</code> にして貼り付けてください（暗号化して保存され、公開されません）。
          </p>
          <button className="k-btn k-copy" onClick={() => navigator.clipboard?.writeText(JSON.stringify(profile))}>
            自動応募用の設定をコピー
          </button>
          <a className="k-bm" href={bookmarklet} onClick={(e) => e.preventDefault()}>
            懸賞オートフィル
          </a>
          <button className="k-link" onClick={() => navigator.clipboard?.writeText(bookmarklet)}>
            URLをコピー
          </button>
        </section>
      )}

      {error && <p className="k-empty">データを読み込めませんでした（{error}）</p>}
      {data && items.length === 0 && tab !== 'history' && <p className="k-empty">{tab === 'todo' ? '新しい懸賞はありません。次の更新を待ちましょう。' : 'まだありません。'}</p>}

      {tab === 'x' && items.length > 0 && (
        <button className="k-btn primary k-runall" onClick={() => setRun({ queue: items.map((i) => i.id), i: 0, done: {} })}>
          連続応募モード（{items.length}件）
        </button>
      )}
      {tab === 'x' && items.length > 0 && (
        <label className="k-note k-onetrip">
          <input type="checkbox" checked={oneTrip} onChange={(e) => setOneTrip(e.target.checked)} /> まとめて1回で開く（フォロー・リポスト・いいねを投稿ページで一度に）
        </label>
      )}

      {tab === 'history' && (
        <section>
          <div className="k-seg" role="group" aria-label="表示">
            <button className={histFilter === 'applied' ? 'on' : ''} onClick={() => setHistFilter('applied')}>
              応募できた {history.filter((h) => OKS.includes(h.status)).length}
            </button>
            <button className={histFilter === 'ng' ? 'on' : ''} onClick={() => setHistFilter('ng')}>
              自動でできなかった {history.filter((h) => !OKS.includes(h.status)).length}
            </button>
          </div>
          {history.filter((h) => (histFilter === 'applied' ? OKS.includes(h.status) : !OKS.includes(h.status))).length === 0 && (
            <p className="k-empty">まだありません。</p>
          )}
          <ul className="k-hist">
            {history
              .filter((h) => (histFilter === 'applied' ? OKS.includes(h.status) : !OKS.includes(h.status)))
              .map((h) => {
                const d = daysLeft(h.deadline ?? null)
                return (
                  <li key={h.id} className="k-hrow">
                    {h.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img className="k-hthumb" src={thumb(h.image)} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(e) => (e.currentTarget.style.visibility = 'hidden')} />
                    ) : (
                      <div className="k-hthumb" aria-hidden="true" />
                    )}
                    <div className="k-hbody">
                      <a className="k-hprize" href={h.url} target="_blank" rel="noopener noreferrer">
                        {h.prize}
                      </a>
                      <div className="k-meta">
                        <span className={`k-how ${h.how === '自動' ? 'auto' : ''}`}>{h.how}</span>
                        {h.at && <span>{new Date(h.at).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' })} 応募</span>}
                        {h.deadline && <span>締切 {h.deadline.slice(5).replace('-', '/')}{d !== null && d < 0 ? '（終了）' : ''}</span>}
                      </div>
                      {h.status === 'unknown' && <p className="k-bot">送信済み（完了画面は確認できず）</p>}
                      {h.note && <p className="k-bot">{h.note}</p>}
                      {OKS.includes(h.status) && h.reason && h.reason !== '完了画面を確認できず' && (
                        <p className="k-bot">{h.reason.replace(/^・/, '').replace('メール欄なし', '応募フォームにメール欄なし（確認メールは届きません）')}</p>
                      )}
                      {!OKS.includes(h.status) && (
                        <p className="k-bot k-bot-skip">
                          {BOT_LABEL[h.status]}
                          {h.reason ? `：${h.reason}` : ''}
                          {h.entryUrl && (d === null || d >= 0) && (
                            <>
                              {' '}
                              <a className="k-link" href={h.entryUrl} target="_blank" rel="noopener noreferrer">
                                手動で応募
                              </a>
                            </>
                          )}
                        </p>
                      )}
                    </div>
                  </li>
                )
              })}
          </ul>
        </section>
      )}

      <ul className="k-list">
        {items.map((it) => {
          const d = daysLeft(it.deadline)
          const target = it.entryUrl || it.url
          return (
            <li key={it.id} className="k-card">
              <div className="k-top">
                {it.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="k-thumb" src={thumb(it.image)} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(e) => (e.currentTarget.style.visibility = 'hidden')} />
                ) : (
                  <div className="k-thumb k-thumb-empty" aria-hidden="true" />
                )}
                <div className="k-head2">
                  <p className="k-prizename">{prizeLabel(it)}</p>
                  <div className="k-meta">
                    {it.winners ? <span className="k-win">{it.winners.toLocaleString()}名</span> : null}
                    {it.value ? <span>{it.value >= 10000 ? `${it.value / 10000}万円` : `${it.value.toLocaleString()}円`}相当</span> : null}
                    <span className={d !== null && d <= 3 ? 'k-urgent' : ''}>
                      {d === null ? '締切不明' : d === 0 ? '今日まで' : `あと${d}日`}
                    </span>
                    <span className="k-score" title="おすすめ度">{it.score}</span>
                  </div>
                </div>
              </div>
              <a className="k-title" href={it.url} target="_blank" rel="noopener noreferrer">
                {it.title}
              </a>
              <div className="k-chips">
                {it.methods.map((m) => (
                  <span key={m} className={`k-chip k-${m}`}>
                    {labels[m] || m}
                  </span>
                ))}
                {it.company && <span className="k-company">{it.company}</span>}
              </div>
              {bot[it.id] ? (
                <p className={`k-bot k-bot-${bot[it.id].status}`}>
                  {BOT_LABEL[bot[it.id].status]}
                  {bot[it.id].reason ? `：${bot[it.id].reason}` : ''}
                </p>
              ) : it.webOpen ? (
                <p className="k-bot">自動応募の対象（次の実行で応募します）</p>
              ) : null}
              <div className="k-actions">
                {tab === 'x' ? (
                  <>
                    <a className="k-btn primary" href={xPostOf(it)!.url} target="_blank" rel="noopener noreferrer" onClick={(e) => {
                      e.preventDefault()
                      openX(xPostOf(it)!.url)
                      mark(it.id, 'applied')
                    }}>
                      投稿を開く
                    </a>
                    <button className="k-btn" onClick={() => mark(it.id, 'hidden')}>
                      スキップ
                    </button>
                  </>
                ) : tab === 'todo' ? (
                  <>
                    <a
                      className="k-btn primary"
                      href={target}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => mark(it.id, 'applied')}
                    >
                      応募ページを開く
                    </a>
                    <button className="k-btn" onClick={() => mark(it.id, 'hidden')}>
                      スキップ
                    </button>
                  </>
                ) : (
                  <button className="k-btn" onClick={() => mark(it.id, undefined)}>
                    未応募に戻す
                  </button>
                )}
              </div>
            </li>
          )
        })}
      </ul>

      {run && data && (() => {
        const cur = data.items.find((x) => x.id === run.queue[run.i])
        const xp = cur && xPostOf(cur)
        const finish = (m?: Mark) => {
          if (cur && m) mark(cur.id, m, false)
          if (run.i + 1 >= run.queue.length) setRun(null)
          else setRun({ ...run, i: run.i + 1, done: {}, text: undefined })
        }
        if (!cur || !xp) return null
        // 押す順番：フォロー → リポスト →（条件にあれば）いいね。最後を押すと自動で応募済みにして次の懸賞へ
        const needs = cur.xNeeds
        const wantLike = !needs || needs.includes('like')
        const wantQuote = !!needs?.includes('quote')
        // 引用ポストだけが条件の懸賞では通常のリポストはしない（新しいデータでは repost の有無で判断）
        const wantRepost = !needs || !wantQuote || needs.includes('repost') || cur.xPhrases === undefined
        const steps: { key: string; label: string; href: string }[] = oneTrip
          ? [{ key: 'post', label: `投稿を開いてフォロー${wantRepost ? '・リポスト' : ''}${wantLike ? '・いいね' : ''}`, href: xp.url }]
          : [
              { key: 'follow', label: `@${xp.user} をフォロー`, href: `https://x.com/intent/follow?screen_name=${xp.user}` },
              ...(wantRepost ? [{ key: 'rt', label: 'リポスト', href: `https://x.com/intent/retweet?tweet_id=${xp.id}` }] : []),
            ]
        if (!oneTrip && wantLike) steps.push({ key: 'like', label: 'いいね', href: `https://x.com/intent/like?tweet_id=${xp.id}` })
        // 返信・引用・ハッシュタグ投稿が条件なら、文面入りの投稿画面を開く手順を足す
        const postText = run.text ?? defaultPostText(cur)
        const enc = encodeURIComponent
        if (needs?.includes('reply') && !wantQuote)
          steps.push({ key: 'reply', label: '返信する', href: `https://x.com/intent/post?in_reply_to=${xp.id}&text=${enc(postText)}` })
        if (needs?.includes('quote'))
          steps.push({ key: 'quote', label: '引用ポストする', href: `https://x.com/intent/post?text=${enc(postText)}&url=${enc(xp.url)}` })
        if (needs?.includes('hashtag') && !needs.includes('reply') && !needs.includes('quote'))
          steps.push({ key: 'tagpost', label: 'ハッシュタグ付きで投稿', href: `https://x.com/intent/post?text=${enc(postText)}` })
        const writes = steps.some((st) => ['reply', 'quote', 'tagpost'].includes(st.key))
        // 自分で書く必要がある内容（予想・写真など）
        const manual = /予想|クイズ|答え|写真|画像|動画|スクショ|スクリーンショット|理由|エピソード/.test(cur.xPrompt || '')
        const si = steps.findIndex((st) => !run.done[st.key])
        const next = si >= 0 ? steps[si] : null
        return (
          <div className="k-modal" role="dialog" aria-modal="true" aria-label="連続応募モード">
            <div className="k-sheet">
              <div className="k-sheet-head">
                <span>
                  {run.i + 1} / {run.queue.length}
                </span>
                <button aria-label="閉じる" onClick={() => setRun(null)}>
                  ×
                </button>
              </div>
              <div className="k-top">
                {cur.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="k-thumb" src={thumb(cur.image)} alt="" referrerPolicy="no-referrer" onError={(e) => (e.currentTarget.style.visibility = 'hidden')} />
                ) : (
                  <div className="k-thumb k-thumb-empty" aria-hidden="true" />
                )}
                <div className="k-head2">
                  <p className="k-prizename">{prizeLabel(cur)}</p>
                  <div className="k-meta">
                    {cur.winners ? <span className="k-win">{cur.winners.toLocaleString()}名</span> : null}
                    <span>{daysLeft(cur.deadline) === null ? '締切不明' : `あと${daysLeft(cur.deadline)}日`}</span>
                  </div>
                </div>
              </div>
              <ol className="k-progress" aria-label="手順">
                {steps.map((st, k) => (
                  <li key={st.key} className={run.done[st.key] ? 'done' : k === si ? 'cur' : ''}>
                    {run.done[st.key] ? '✓' : k + 1} {st.label}
                  </li>
                ))}
              </ol>
              {writes && (
                <div className="k-compose">
                  {cur.xPrompt && <p className="k-note">条件：{cur.xPrompt}</p>}
                  {manual && <p className="k-warn">答えや写真が必要な条件です。文面を書き換えてから投稿してください。</p>}
                  <label className="k-note" htmlFor="k-posttext">
                    投稿する文面（Xで投稿ボタンを押す前にも直せます）
                  </label>
                  <textarea id="k-posttext" className="k-posttext" rows={3} value={postText} onChange={(e) => setRun({ ...run, text: e.target.value })} />
                  <a className="k-link" href={xp.url} target="_blank" rel="noopener noreferrer">
                    元の投稿を見る
                  </a>
                </div>
              )}
              {kxMsg && <p className="k-warn">{kxMsg}</p>}
              {ext && ext !== USERSCRIPT_VERSION && (
                <p className="k-warn">
                  ワンボタン応募のスクリプトに新しい版があります（今 {ext} → {USERSCRIPT_VERSION}）。
                  <a className="k-link" href={(process.env.NEXT_PUBLIC_BASE_PATH || '') + USERSCRIPT_PATH}>
                    ここを開いて
                  </a>
                  Userscriptsで上書きインストールしてください。
                </p>
              )}
              {ext && next && ['follow', 'rt', 'like', 'post'].includes(next.key) && (
                <button
                  className="k-btn primary k-big"
                  onClick={() => {
                    writeLS(RUN_KEY, run)
                    setKxMsg(null)
                    const job = {
                      item: cur.id,
                      user: xp.user,
                      id: xp.id,
                      like: wantLike,
                      back: location.origin + location.pathname,
                    }
                    location.href = `${xp.url}#kensho=${encodeURIComponent(JSON.stringify(job))}`
                  }}
                >
                  ワンボタン応募（フォロー・リポスト{wantLike ? '・いいね' : ''}）
                </button>
              )}
              {!ext && (
                <details className="k-note">
                  <summary>ワンボタン応募を使うには</summary>
                  無料のブラウザ拡張にスクリプトを入れると、ボタン1回でフォロー・リポスト・いいねを押して戻ってこられます。iPhoneはApp Storeの「Userscripts」（Safariの拡張機能で有効にする）、PCは「Tampermonkey」を入れてから、
                  <a className="k-link" href={(process.env.NEXT_PUBLIC_BASE_PATH || '') + USERSCRIPT_PATH} target="_blank" rel="noopener noreferrer">
                    スクリプト
                  </a>
                  を開いて追加してください。XにはSafari（またはPCのブラウザ）でログインしておく必要があります。
                </details>
              )}
              {next && ext && ['follow', 'rt', 'like', 'post'].includes(next.key) ? null : next ? (
                <a
                  className="k-btn primary k-big"
                  href={next.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => {
                    // 状態更新で href が次の手順に書き換わる前に、今の手順のURLを確実に開く
                    e.preventDefault()
                    openX(next.href)
                    const done = { ...run.done, [next.key]: true }
                    if (si === steps.length - 1) {
                      // 最後の手順：開いたら自動で応募済みにして次へ
                      setTimeout(() => finish('applied'), 300)
                    } else setRun({ ...run, done })
                  }}
                >
                  {next.label}
                </a>
              ) : (
                <button className="k-btn primary k-big" onClick={() => finish('applied')}>
                  応募済みにして次へ
                </button>
              )}
              {oneTrip && si === 0 && (
                <p className="k-note">
                  開いた投稿で @{xp.user} のフォロー・リポスト{wantLike ? '・いいね' : ''}を押したら、閉じて戻ってください。戻ると次の懸賞が出ています。
                </p>
              )}
              <div className="k-actions">
                <button className="k-btn" onClick={() => finish('hidden')}>
                  この懸賞はスキップ
                </button>
              </div>
              <label className="k-note k-onetrip">
                <input type="checkbox" checked={oneTrip} onChange={(e) => setOneTrip(e.target.checked)} /> まとめて1回で開く（フォロー・リポスト・いいねを投稿ページで一度に）
              </label>
            </div>
          </div>
        )
      })()}

      {undo && (
        <div className="k-toast" role="status">
          移動しました
          <button
            onClick={() => {
              mark(undo.id, undo.prev, false)
            }}
          >
            元に戻す
          </button>
          <button aria-label="閉じる" onClick={() => setUndo(null)}>
            ×
          </button>
        </div>
      )}
    </main>
  )
}
