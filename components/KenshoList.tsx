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
  webOpen?: boolean
  methods: string[]
  entryUrl: string | null
  score: number
  addedAt: string
}

type Data = { updatedAt: string; methodLabels: Record<string, string>; items: Item[] }
type Mark = 'applied' | 'hidden'
type Tab = 'todo' | 'x' | 'applied' | 'hidden'

// GitHub Actions が毎時更新する kensho-data ブランチ
const DATA_URL = 'https://raw.githubusercontent.com/penmawashi8-ux/az/kensho-data/data.json'
const APPLIED_URL = 'https://raw.githubusercontent.com/penmawashi8-ux/az/kensho-data/applied.json'
type BotResult = { status: 'applied' | 'skip' | 'fail' | 'unknown'; reason: string; at: string }
const BOT_LABEL: Record<string, string> = { applied: '自動応募済み', skip: '自動応募できず', fail: '自動応募に失敗', unknown: '自動応募（完了未確認）' }
const MARKS_KEY = 'kensho.marks.v1'
const PREFS_KEY = 'kensho.prefs.v1'
const PROFILE_KEY = 'kensho.profile.v1'

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
  const fn = (P: Record<string, string>) => {
    const full = (P.sei || '') + (P.mei || '')
    const fullKana = (P.seiKana || '') + (P.meiKana || '')
    const addr = (P.pref || '') + (P.city || '') + (P.addr || '')
    const [by, bm, bd] = (P.birth || '').split('-')
    const tel = (P.tel || '').replace(/\D/g, '')
    const zip = (P.zip || '').replace(/\D/g, '')
    const kata = (s: string) => s.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60))
    type R = [RegExp, (h: string) => string | undefined]
    const rules: R[] = [
      [/mail|メール/i, () => P.email],
      [/(zip|postal|post_?code|郵便)/i, (h) => (/(2|second|後|下)/.test(h) ? zip.slice(3) : /(1|first|前|上)/.test(h) ? zip.slice(0, 3) : zip)],
      [/(tel|phone|電話|携帯)/i, (h) => (/(1|first)$/.test(h) ? tel.slice(0, 3) : /(2|second)$/.test(h) ? tel.slice(3, 7) : /(3|third)$/.test(h) ? tel.slice(7) : tel)],
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
            const v = get(hl)
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
  const [run, setRun] = useState<{ queue: string[]; i: number; done: Record<string, boolean> } | null>(null)

  useEffect(() => {
    setMarks(readLS(MARKS_KEY, {}))
    const prefs = readLS(PREFS_KEY, { hidePurchase: true, sort: 'score' as const })
    setHidePurchase(prefs.hidePurchase)
    setSort(prefs.sort)
    setProfile(readLS(PROFILE_KEY, {}))
    const get = (u: string) => fetch(u, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
    get(DATA_URL)
      .catch(() => get((process.env.NEXT_PUBLIC_BASE_PATH || '') + '/kensho/data.json'))
      .then(setData)
      .catch((e) => setError(String(e)))
    get(APPLIED_URL).then(setBot).catch(() => {})
  }, [])

  useEffect(() => writeLS(PREFS_KEY, { hidePurchase, sort }), [hidePurchase, sort])

  const markOf = (id: string): Mark | undefined => marks[id] || (bot[id]?.status === 'applied' ? 'applied' : undefined)

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
        {(['todo', 'x', 'applied', 'hidden'] as Tab[]).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
            {t === 'todo' ? '未応募' : t === 'x' ? 'X' : t === 'applied' ? '応募済み' : 'スキップ'}
            <span className="k-count">{counts[t]}</span>
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
      {data && items.length === 0 && <p className="k-empty">{tab === 'todo' ? '新しい懸賞はありません。次の更新を待ちましょう。' : 'まだありません。'}</p>}

      {tab === 'x' && items.length > 0 && (
        <button className="k-btn primary k-runall" onClick={() => setRun({ queue: items.map((i) => i.id), i: 0, done: {} })}>
          連続応募モード（{items.length}件）
        </button>
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
                    <a className="k-btn primary" href={xPostOf(it)!.url} target="_blank" rel="noopener noreferrer" onClick={() => mark(it.id, 'applied')}>
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
          else setRun({ ...run, i: run.i + 1, done: {} })
        }
        if (!cur || !xp) return null
        // 押す順番：フォロー → リポスト →（条件にあれば）いいね。最後を押すと自動で応募済みにして次の懸賞へ
        const needs = cur.xNeeds
        const steps: { key: string; label: string; href: string }[] = [
          { key: 'follow', label: `@${xp.user} をフォロー`, href: `https://x.com/intent/follow?screen_name=${xp.user}` },
          { key: 'rt', label: 'リポスト', href: `https://x.com/intent/retweet?tweet_id=${xp.id}` },
        ]
        if (!needs || needs.includes('like')) steps.push({ key: 'like', label: 'いいね', href: `https://x.com/intent/like?tweet_id=${xp.id}` })
        const si = steps.findIndex((st) => !run.done[st.key])
        const next = si >= 0 ? steps[si] : null
        const extra = (needs || []).filter((n) => n !== 'like')
        const EXTRA_LABEL: Record<string, string> = { quote: '引用ポスト', reply: '返信', hashtag: 'ハッシュタグ付き投稿' }
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
              {extra.length > 0 && (
                <p className="k-warn">
                  この懸賞は{extra.map((n) => EXTRA_LABEL[n]).join('・')}も条件です。
                  <a className="k-link" href={xp.url} target="_blank" rel="noopener noreferrer">
                    投稿を開く
                  </a>
                </p>
              )}
              {next ? (
                <a
                  className="k-btn primary k-big"
                  href={next.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => {
                    // 状態更新で href が次の手順に書き換わる前に、今の手順のURLを確実に開く
                    e.preventDefault()
                    window.open(next.href, '_blank', 'noopener')
                    const done = { ...run.done, [next.key]: true }
                    if (si === steps.length - 1 && extra.length === 0) {
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
              <div className="k-actions">
                <button className="k-btn" onClick={() => finish('hidden')}>
                  この懸賞はスキップ
                </button>
              </div>
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
