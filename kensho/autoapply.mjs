#!/usr/bin/env node
// Webオープン懸賞の自動応募ロボット（GitHub Actions から実行）
//
// data.json の webOpen な懸賞を1件ずつブラウザで開き、応募フォームを探して
// プロフィール（Secrets の KENSHO_PROFILE）で入力・アンケート回答・規約同意・送信まで行う。
// 結果は applied.json に記録し、同じ懸賞には二度応募しない。
//
// 安全のためのルール：
//  - 画像認証(CAPTCHA)・ログインが必要なページは応募しない
//  - 規約に「自動応募/ツール/プログラムによる応募は禁止・無効」とある懸賞は応募しない
//  - 必須項目が埋められないときは送信しない
//  - メルマガ購読のチェックには触れない
//  - KENSHO_SUBMIT=1 のときだけ実際に送信する（それ以外は入力までの試運転）
//  - ログには個人情報を出さない（懸賞ID・ドメイン・結果だけ）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { solveQuiz } from './quiz.mjs'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const DATA = process.env.KENSHO_DATA || 'data/data.json'
const APPLIED = process.env.KENSHO_APPLIED || 'data/applied.json'
const SUBMIT = process.env.KENSHO_SUBMIT === '1'
const MAX = Number(process.env.KENSHO_MAX_APPLY || 15)

let profile
try {
  profile = JSON.parse(process.env.KENSHO_PROFILE || '')
} catch {
  console.log('KENSHO_PROFILE が未設定のため自動応募はスキップ')
  process.exit(0)
}
if (!profile.email || !(profile.sei || profile.mei)) {
  console.log('KENSHO_PROFILE に名前とメールアドレスが必要です。自動応募はスキップ')
  process.exit(0)
}
profile.survey = 'on'

const filler = fs.readFileSync(path.join(DIR, 'filler.js'), 'utf8').replace(/^\s*\/\/.*$/gm, '').trim().replace(/^;/, '')
const data = JSON.parse(fs.readFileSync(DATA, 'utf8'))
const applied = fs.existsSync(APPLIED) ? JSON.parse(fs.readFileSync(APPLIED, 'utf8')) : {}
// 再応募の指示（プロフィール修正時など）。before より前に送信済みのものを1回だけやり直す
const REAPPLY = fs.existsSync(path.join(DIR, 'reapply.json')) ? JSON.parse(fs.readFileSync(path.join(DIR, 'reapply.json'), 'utf8')) : null
const needsReapply = (a) =>
  !!REAPPLY && ['applied', 'unknown'].includes(a.status) && a.at < REAPPLY.before && !(a.reapplied || []).includes(REAPPLY.tag)
// 規約で重複応募が禁止されている（＝再応募すると無効になりうる）
const NO_DUP = /(重複|複数回|二重|同一人物|同一の方)[^。]{0,25}(応募|エントリー)?[^。]{0,25}(無効|禁止|不可|できません|お断り|認め|対象外|取り消)|(お?一人様?|おひとり様?|1人|１人|お一人)\s*(につき)?\s*(1|１|一)\s*(回|口)(限り|まで|のみ)?/

// ロボットの版。上げると「フォームが見つからない」等でスキップした懸賞に再挑戦する
const BOT_VERSION = 4
const RETRYABLE = /フォームが見つからない|入力欄が個人情報フォームでない|必須項目が埋められない|クイズに答えられない/
const ENTRY_LINK = /応募フォーム|応募する|応募はこちら|ご応募はこちら|応募ページ|エントリー|参加する|アンケートに(回答|答え)|アンケートはこちら|今すぐ応募|応募画面|フォームへ|応募へ|^\s*応募\s*$|ENTRY|Entry|APPLY|Apply|応募受付|応募ボタン|プレゼントに応募|キャンペーンに参加/
const ENTRY_NG = /応募要項|応募規約|応募方法|応募資格|応募条件|注意事項|当選発表|よくある|FAQ|プライバシー/
const FORM_HREF = /forms\.gle\/|docs\.google\.com\/forms|form\.run\/|formzu|questant\.jp|forms\.office\.com|tayori\.com\/form|formmailer|cuenote|\/(entry|apply|enquete|questionnaire|form)(\/|\.|\?|$)/i
const NO_AUTO = /(自動|機械的|プログラム|ツール|ボット|bot|スクリプト|代行)[^。]{0,30}(応募|エントリー|参加)[^。]{0,30}(禁止|無効|お断り|認め|できません|対象外|取り消)/i
const DONE = /応募(が|を)?(完了|受け付け|受付)|受け?付けました|受付(が|を)?完了|送信(が|を)?完了|ご応募(いただき|頂き)|ありがとうございました|ありがとうございます|エントリー(が|を)?完了|thank\s*you/i
const NG_BTN = /戻る|修正|キャンセル|リセット|クリア|ログイン|検索|シェア|閉じる|会員登録|新規登録/
const SUBMIT_BTN = /応募する|送信する|この内容で|^送信$|^応募$|確定|エントリーする|応募を確定|上記内容で/
const NEXT_BTN = /確認|次へ|進む|submit/i

const targets = data.items
  .filter((it) => {
    if (!it.webOpen || !it.entryUrl) return false
    const a = applied[it.id]
    if (!a) return true
    if (needsReapply(a)) return true
    if (a.status === 'fail') return (a.tries || 1) < 3 || (a.v || 1) < BOT_VERSION
    if (a.status === 'skip') return RETRYABLE.test(a.reason || '') && (a.v || 1) < BOT_VERSION
    return false
  })
  .sort((a, b) => Number(!!applied[b.id]) - Number(!!applied[a.id]) || b.score - a.score) // 再応募を優先
  .slice(0, MAX)

console.log(`mode=${SUBMIT ? 'SUBMIT' : 'DRY-RUN'} targets=${targets.length} already=${Object.keys(applied).length}`)
if (!targets.length) process.exit(0)

const browser = await chromium.launch()
const ctx = await browser.newContext({
  locale: 'ja-JP',
  timezoneId: 'Asia/Tokyo',
  viewport: { width: 1280, height: 900 },
})
ctx.setDefaultTimeout(15000)
ctx.setDefaultNavigationTimeout(30000)

/** 入力欄が一番多いフレーム（Googleフォーム等の埋め込みにも対応） */
async function bestFrame(page) {
  let best = null
  let bestN = 0
  for (const f of page.frames()) {
    const n = await f
      .evaluate(() =>
        Array.from(document.querySelectorAll('input, textarea, select, [role=radiogroup]')).filter((e) => {
          const t = (e.getAttribute('type') || '').toLowerCase()
          return !['hidden', 'submit', 'button', 'search', 'image'].includes(t) && (e.offsetWidth || e.offsetHeight)
        }).length,
      )
      .catch(() => 0)
    if (n > bestN) [best, bestN] = [f, n]
  }
  return { frame: best, inputs: bestN }
}

async function pageText(page) {
  const parts = await Promise.all(page.frames().map((f) => f.evaluate(() => document.body?.innerText || '').catch(() => '')))
  return parts.join('\n')
}

/** 応募フォームが見つからなければ「応募はこちら」系のリンクを最大2回たどる */
async function findForm(page) {
  for (let hop = 0; hop < 3; hop++) {
    const { frame, inputs } = await bestFrame(page)
    if (frame && inputs >= 2) return { page, frame }
    if (hop === 2) break
    // 遅延読み込みの部分も出すため最後までスクロール
    await page.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += 800) {
        window.scrollTo(0, y)
        await new Promise((r) => setTimeout(r, 120))
      }
    }).catch(() => {})
    const link = await page.evaluate(
      ([src, ngSrc, formSrc]) => {
        const re = new RegExp(src)
        const ng = new RegExp(ngSrc)
        const formRe = new RegExp(formSrc, 'i')
        const here = location.href.split('#')[0]
        const els = Array.from(document.querySelectorAll('a[href], button, [role=button], input[type=button], input[type=image]'))
        const label = (e) =>
          ((e.textContent || '') + ' ' + (e.getAttribute('aria-label') || '') + ' ' + (e.value || '') + ' ' +
            Array.from(e.querySelectorAll('img')).map((i) => i.alt).join(' ')).replace(/\s+/g, ' ').trim()
        const ok = (e) => {
          if (e.tagName === 'A' && (!e.href || e.href.split('#')[0] === here)) return false
          const t = label(e)
          return t.length <= 40 && re.test(t) && !ng.test(t)
        }
        // 1) フォームサービスへの直リンク 2) 応募ボタン（表示中を優先）
        let el = els.find((e) => e.tagName === 'A' && formRe.test(e.href) && e.href.split('#')[0] !== here)
        if (!el) el = els.find((e) => ok(e) && (e.offsetWidth || e.offsetHeight)) || els.find((e) => ok(e) && e.tagName === 'A')
        if (!el) return null
        return el.tagName === 'A' ? { href: el.href } : { click: true, idx: els.indexOf(el) }
      },
      [ENTRY_LINK.source, ENTRY_NG.source, FORM_HREF.source],
    )
    if (!link) break
    if (link.href) {
      if (/^(mailto|tel|javascript):/.test(link.href)) break
      if (/(x|twitter|instagram|line|tiktok|facebook)\.(com|me)\//.test(link.href)) return { page, frame: null, sns: true }
      await page.goto(link.href, { waitUntil: 'domcontentloaded' })
    } else {
      const popup = page.context().waitForEvent('page', { timeout: 5000 }).catch(() => null)
      await page.locator('a[href], button, [role=button], input[type=button], input[type=image]').nth(link.idx).click()
      const p2 = await popup
      if (p2) {
        await p2.waitForLoadState('domcontentloaded').catch(() => {})
        page = p2
      }
    }
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {})
  }
  return { page, frame: null }
}

async function clickSubmit(frame) {
  return frame.evaluate(
    ([okSrc, nextSrc, ngSrc]) => {
      const ok = new RegExp(okSrc)
      const next = new RegExp(nextSrc, 'i')
      const ng = new RegExp(ngSrc)
      const txt = (b) => (b.value || b.getAttribute('aria-label') || b.textContent || '').trim()
      const btns = Array.from(document.querySelectorAll('button, input[type=submit], input[type=image], a[role=button], [role=button]')).filter(
        (b) => (b.offsetWidth || b.offsetHeight) && !b.disabled && !ng.test(txt(b)),
      )
      const b = btns.find((b) => ok.test(txt(b))) || btns.find((b) => next.test(txt(b))) || btns.find((b) => b.type === 'submit')
      if (!b) return null
      b.click()
      return txt(b).slice(0, 20)
    },
    [SUBMIT_BTN.source, NEXT_BTN.source, NG_BTN.source],
  )
}

// ログ・記録に個人情報が残らないよう、プロフィールの値を伏せる
const SECRETS = Object.values(profile).filter((v) => typeof v === 'string' && v.length >= 2).flatMap((v) => [v, v.normalize('NFKC'), v.normalize('NFKC').replace(/\D/g, '')].filter((x) => x.length >= 2))
function mask(t) {
  let out = t || ''
  for (const v of SECRETS) out = out.split(v).join('***')
  return out.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '***@***').replace(/\d{2,4}-?\d{2,4}-?\d{3,4}/g, '***')
}
// 自分の情報では答えられない項目（出産予定日・会員番号・希望店舗など）→ 応募資格がない可能性
const UNFILLABLE = /予定日|お子様|子ども|子供|学年|学校名|会員番号|会員ID|お客様番号|店舗|店名|シリアル|コード|レシート|購入日|購入店|expected|due_?date|member_?(no|id)|shop|store|serial|receipt|child|kids/i

const SCAM_TEXT = /当選確定|必ず当たる|あなたが選ばれ|おめでとうございます[^。]{0,10}当選|送料(を|は)?(ご)?負担|手数料[^。]{0,10}(お支払|振込|必要)|代引き|事務手数料/
const SENSITIVE_FIELD = /card|cvv|cvc|security.?code|有効期限|カード番号|口座|bank|account.?number|暗証|pin\b|マイナンバー|my.?number|個人番号|password|パスワード/i
async function checkRisk(p, frame, text) {
  const url = frame.url()
  if (!url.startsWith('https://')) return '暗号化されていないページ'
  if (SCAM_TEXT.test(text)) return '金銭要求・詐欺的な文言'
  const sens = await frame
    .evaluate((src) => {
      const re = new RegExp(src, 'i')
      return Array.from(document.querySelectorAll('input, select, textarea')).some((e) =>
        re.test(`${e.name} ${e.id} ${e.placeholder || ''} ${e.getAttribute('autocomplete') || ''} ${(e.labels && e.labels[0]?.innerText) || ''}`),
      )
    }, SENSITIVE_FIELD.source)
    .catch(() => false)
  if (sens) return 'カード・口座・パスワード等の入力欄'
  // 送信先が別ドメインでかつ http の場合も危険
  const insecurePost = await frame.evaluate(() => Array.from(document.forms).some((f) => f.action && f.action.startsWith('http://'))).catch(() => false)
  if (insecurePost) return '暗号化されない送信先'
  return ''
}

async function applyOne(it, reapply = false) {
  const trace = []
  let hasEmail = false
  const page = await ctx.newPage()
  page.on('dialog', (d) => d.accept().catch(() => {}))
  try {
    await page.goto(it.entryUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {})
    const landing = await pageText(page) // クイズの答え探し用（キャンペーン本文）
    const found = await findForm(page)
    if (found.sns) return { status: 'skip', reason: 'SNS応募' }
    if (!found.frame) {
      // 改善用の手がかり（ボタン/リンクの文言とURLのパスだけ。個人情報は含まない）
      const hints = await found.page
        .evaluate(() =>
          Array.from(document.querySelectorAll('a[href], button'))
            .map((e) => ({ t: (e.textContent || Array.from(e.querySelectorAll('img')).map((i) => i.alt).join(' ')).replace(/\s+/g, ' ').trim().slice(0, 24), h: e.href ? new URL(e.href).pathname.slice(0, 40) : 'button' }))
            .filter((x) => /応募|キャンペーン|参加|アンケート|フォーム|entry|form|apply|こちら/i.test(x.t + x.h))
            .slice(0, 8),
        )
        .catch(() => [])
      console.log('   hints', JSON.stringify(hints))
      return { status: 'skip', reason: 'フォームが見つからない' }
    }
    let { page: p, frame } = found
    // 問い合わせフォーム・検索フォーム等に誤って送信しない
    const where = `${frame.url()} ${await p.title().catch(() => '')}`
    if (/お?問い?合わ?せ|contact|inquiry|toiawase|support|ログイン|login|会員登録|signup|register/i.test(where))
      return { status: 'skip', reason: '応募フォームではない（問い合わせ/会員登録等）' }
    const text = await pageText(p)
    if (NO_AUTO.test(text)) return { status: 'skip', reason: '規約で自動応募禁止' }
    // 怪しい懸賞・危険なフォームには個人情報を入れない
    const risk = await checkRisk(p, frame, `${landing}\n${text}`)
    if (risk) return { status: 'skip', reason: `安全のため応募せず(${risk})` }
    if (reapply && NO_DUP.test(`${landing}\n${text}`)) return { status: 'keep', reason: '規約で重複応募禁止のため再応募せず' }

    let quizNote = ''
    for (let round = 0; round < 4; round++) {
      if (round === 0) {
        const qz = await solveQuiz(frame, `${landing}\n${text}`)
        if (qz.asked) {
          quizNote = `・クイズ${qz.answered}/${qz.asked}(${qz.via})`
          if (qz.answered < qz.asked) return { status: 'skip', reason: `クイズに答えられない(${qz.answered}/${qz.asked})` }
        }
      }
      const r = await frame.evaluate(`(${filler})(${JSON.stringify(profile)})`)
      if (r.login) return { status: 'skip', reason: 'ログインが必要' }
      if (r.captcha) return { status: 'skip', reason: '画像認証あり' }
      if (round === 0 && r.filled === 0) return { status: 'skip', reason: '入力欄が個人情報フォームでない' }
      if (round === 0) {
        const info = await frame.evaluate((src) => {
          const re = new RegExp(src)
          const vis = (e) => !!(e.offsetWidth || e.offsetHeight)
          const lab = (e) => `${e.name} ${e.id} ${e.placeholder || ''} ${(e.labels && e.labels[0]?.innerText) || ''} ${(e.closest('tr, dl, li, .form-group, label')?.innerText || e.parentElement?.innerText || '').slice(0, 40)}`
          const fields = Array.from(document.querySelectorAll('input[type=text], input:not([type]), input[type=date], input[type=number], textarea')).filter(vis)
          return {
            email: !!document.querySelector('input[type=email], input[name*=mail i], input[id*=mail i]'),
            blank: fields.filter((e) => !e.value && re.test(lab(e))).map((e) => (e.name || e.id).slice(0, 20)),
          }
        }, UNFILLABLE.source)
        hasEmail = info.email
        if (info.blank.length) return { status: 'skip', reason: `答えられない項目あり(${info.blank.slice(0, 3).join(',')})` }
      }
      if (r.missing.length) return { status: 'skip', reason: `必須項目が埋められない(${r.missing.slice(0, 3).join(',')})` }
      if (!SUBMIT) return { status: 'dry-ok', reason: `入力${r.filled}・アンケート${r.survey}・同意${r.consent}${quizNote}` }

      const before = p.url()
      const beforeText = await pageText(p)
      const btn = await clickSubmit(frame)
      if (!btn) return { status: 'fail', reason: '送信ボタンが見つからない' }
      await p.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {})
      await p.waitForTimeout(1500)
      const after = await pageText(p)
      // 送信後に新しく現れた文言だけで完了を判定（ページに元々ある「応募完了」等の宣伝文に反応しない）
      const seen = new Set(beforeText.split('\n').map((l) => l.trim()))
      const fresh = after.split('\n').map((l) => l.trim()).filter((l) => l && !seen.has(l)).join('\n')
      trace.push(`${round}:${btn}→${new URL(p.url()).pathname.slice(0, 40)} ${mask(fresh).replace(/\s+/g, ' ').slice(0, 120)}`)
      if (/(必須|入力してください|正しく入力|エラー|不正)/.test(fresh.slice(0, 1500))) return { status: 'fail', reason: '送信時に入力エラー', trace }
      if (DONE.test(fresh)) {
        return { status: 'applied', reason: (/メール.{0,10}(確認|認証|届|送信)/.test(fresh) ? '確認メールあり' : '') + quizNote + (hasEmail ? '' : '・メール欄なし'), trace }
      }
      // 画面が変わらなければ二重送信しないよう、ここで止める
      if (p.url() === before && !fresh.trim()) break
      // 確認画面など：次のフレームを探してもう一度
      const nf = await bestFrame(p)
      frame = nf.frame || p.mainFrame()
    }
    return { status: 'unknown', reason: '完了画面を確認できず', trace }
  } catch (e) {
    return { status: 'fail', reason: String(e.message || e).split('\n')[0].slice(0, 80) }
  } finally {
    await page.context().pages().forEach((pg) => pg !== page && pg.close().catch(() => {}))
    await page.close().catch(() => {})
  }
}

const tally = {}
for (const it of targets) {
  const prev = applied[it.id]
  const reapply = !!prev && needsReapply(prev)
  const res = await applyOne(it, reapply)
  const host = (() => {
    try {
      return new URL(it.entryUrl).host
    } catch {
      return '?'
    }
  })()
  console.log(`[${res.status}]${reapply ? '(再応募)' : ''} ${it.id} ${host} ${res.reason}`)
  if (reapply) {
    // 再応募は1回だけ。送信できなかった/しなかった場合も前回の記録は残す
    const tags = [...(prev.reapplied || []), REAPPLY.tag]
    if (['applied', 'unknown'].includes(res.status)) {
      applied[it.id] = { ...prev, ...res, at: new Date().toISOString(), v: BOT_VERSION, reapplied: tags }
    } else {
      applied[it.id] = { ...prev, reapplied: tags, reapplyNote: res.reason }
    }
    tally[res.status] = (tally[res.status] || 0) + 1
    continue
  }
  tally[res.status] = (tally[res.status] || 0) + 1
  // 試運転の結果は記録しない（本番で改めて応募する）。失敗は次回再挑戦せず記録。
  if (res.status !== 'dry-ok')
    applied[it.id] = {
      ...res,
      host,
      at: new Date().toISOString(),
      v: BOT_VERSION,
      tries: (applied[it.id]?.tries || 0) + 1,
      // 履歴表示用（締切後に一覧から消えても残るように）
      title: it.title,
      prize: it.prizeShort || (it.prize || '').slice(0, 60),
      url: it.url,
      entryUrl: it.entryUrl,
      deadline: it.deadline,
      image: it.image || null,
    }
}
await browser.close()
fs.writeFileSync(APPLIED, JSON.stringify(applied, null, 1) + '\n')
console.log('summary', JSON.stringify(tally))
