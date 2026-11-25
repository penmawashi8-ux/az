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
  methods: string[]
  entryUrl: string | null
  score: number
  addedAt: string
}

type Data = { updatedAt: string; methodLabels: Record<string, string>; items: Item[] }
type Mark = 'applied' | 'hidden'
type Tab = 'todo' | 'applied' | 'hidden'

// GitHub Actions が毎時更新する kensho-data ブランチ
const DATA_URL = 'https://raw.githubusercontent.com/penmawashi8-ux/az/kensho-data/data.json'
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
    alert('懸賞オートフィル: 個人情報' + n + '項目' + (survey ? '・アンケート' + q + '問' : '') + 'を入力しました。\n同意チェックと内容を確認して送信してください。')
  }
  const src = `(${fn.toString()})(${JSON.stringify(p)})`
  return 'javascript:' + encodeURIComponent(src)
}

export default function KenshoList() {
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [marks, setMarks] = useState<Record<string, Mark>>({})
  const [tab, setTab] = useState<Tab>('todo')
  const [hidePurchase, setHidePurchase] = useState(true)
  const [sort, setSort] = useState<'score' | 'deadline'>('score')
  const [profile, setProfile] = useState<Record<string, string>>({})
  const [showProfile, setShowProfile] = useState(false)
  const [undo, setUndo] = useState<{ id: string; prev?: Mark } | null>(null)

  useEffect(() => {
    setMarks(readLS(MARKS_KEY, {}))
    const prefs = readLS(PREFS_KEY, { hidePurchase: true, sort: 'score' as const })
    setHidePurchase(prefs.hidePurchase)
    setSort(prefs.sort)
    setProfile(readLS(PROFILE_KEY, {}))
    const get = (u: string) => fetch(u, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
    get(DATA_URL)
      .catch(() => get('/kensho/data.json'))
      .then(setData)
      .catch((e) => setError(String(e)))
  }, [])

  useEffect(() => writeLS(PREFS_KEY, { hidePurchase, sort }), [hidePurchase, sort])

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
    let xs = data.items.filter((it) => {
      const m = marks[it.id]
      if (tab === 'todo') return !m && !(hidePurchase && it.methods.includes('purchase'))
      return m === tab
    })
    if (sort === 'deadline') xs = [...xs].sort((a, b) => (a.deadline || '9999').localeCompare(b.deadline || '9999'))
    return xs
  }, [data, marks, tab, hidePurchase, sort])

  const counts = useMemo(() => {
    const c = { todo: 0, applied: 0, hidden: 0 }
    data?.items.forEach((it) => {
      const m = marks[it.id]
      if (m) c[m]++
      else if (!(hidePurchase && it.methods.includes('purchase'))) c.todo++
    })
    return c
  }, [data, marks, hidePurchase])

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
        {(['todo', 'applied', 'hidden'] as Tab[]).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
            {t === 'todo' ? '未応募' : t === 'applied' ? '応募済み' : 'スキップ'}
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
          <p className="k-note">
            下のリンクをブックマークに登録（PCはドラッグ、スマホは長押し→コピーしてブックマークのURLに貼り付け）。応募フォームでそのブックマークを開くと入力されます。
          </p>
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

      <ul className="k-list">
        {items.map((it) => {
          const d = daysLeft(it.deadline)
          const target = it.entryUrl || it.url
          return (
            <li key={it.id} className="k-card">
              <div className="k-row">
                <span className="k-score" title="おすすめ度">{it.score}</span>
                <div className="k-meta">
                  {it.winners ? <span>{it.winners.toLocaleString()}名</span> : null}
                  {it.value ? <span>{it.value >= 10000 ? `${it.value / 10000}万円` : `${it.value.toLocaleString()}円`}相当</span> : null}
                  <span className={d !== null && d <= 3 ? 'k-urgent' : ''}>
                    {d === null ? '締切不明' : d === 0 ? '今日まで' : `あと${d}日`}
                  </span>
                </div>
              </div>
              <a className="k-title" href={it.url} target="_blank" rel="noopener noreferrer">
                {it.title}
              </a>
              {it.prize && !it.title.includes(it.prize.slice(2, 22)) && <p className="k-prize">{it.prize}</p>}
              <div className="k-chips">
                {it.methods.map((m) => (
                  <span key={m} className={`k-chip k-${m}`}>
                    {labels[m] || m}
                  </span>
                ))}
                {it.company && <span className="k-company">{it.company}</span>}
              </div>
              <div className="k-actions">
                {tab === 'todo' ? (
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
