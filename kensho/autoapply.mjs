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

const ENTRY_LINK = /応募フォーム|応募する|応募はこちら|ご応募はこちら|応募ページ|エントリー|参加する|アンケートに(回答|答え)|今すぐ応募|応募画面|フォームへ|応募へ/
const NO_AUTO = /(自動|機械的|プログラム|ツール|ボット|bot|スクリプト|代行)[^。]{0,30}(応募|エントリー|参加)[^。]{0,30}(禁止|無効|お断り|認め|できません|対象外|取り消)/i
const DONE = /応募(が|を)?(完了|受け付け|受付)|受け?付けました|受付(が|を)?完了|送信(が|を)?完了|ご応募(いただき|頂き)|ありがとうございました|ありがとうございます|エントリー(が|を)?完了|thank\s*you/i
const NG_BTN = /戻る|修正|キャンセル|リセット|クリア|ログイン|検索|シェア|閉じる|会員登録|新規登録/
const SUBMIT_BTN = /応募する|送信する|この内容で|^送信$|^応募$|確定|エントリーする|応募を確定|上記内容で/
const NEXT_BTN = /確認|次へ|進む|submit/i

const targets = data.items
  .filter((it) => it.webOpen && it.entryUrl && (!applied[it.id] || (applied[it.id].status === 'fail' && (applied[it.id].tries || 1) < 3)))
  .sort((a, b) => b.score - a.score)
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
    const link = await page.evaluate((src) => {
      const re = new RegExp(src)
      const els = Array.from(document.querySelectorAll('a[href], button'))
      const el = els.find((e) => re.test((e.textContent || e.getAttribute('aria-label') || '').trim()) && (e.offsetWidth || e.offsetHeight))
      if (!el) return null
      return el.tagName === 'A' ? { href: el.href } : { click: true, idx: els.indexOf(el) }
    }, ENTRY_LINK.source)
    if (!link) break
    if (link.href) {
      if (/^(mailto|tel|javascript):/.test(link.href)) break
      if (/(x|twitter|instagram|line|tiktok|facebook)\.(com|me)\//.test(link.href)) return { page, frame: null, sns: true }
      await page.goto(link.href, { waitUntil: 'domcontentloaded' })
    } else {
      const popup = page.context().waitForEvent('page', { timeout: 5000 }).catch(() => null)
      await page.locator('a[href], button').nth(link.idx).click()
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

async function applyOne(it) {
  const page = await ctx.newPage()
  page.on('dialog', (d) => d.accept().catch(() => {}))
  try {
    await page.goto(it.entryUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {})
    const found = await findForm(page)
    if (found.sns) return { status: 'skip', reason: 'SNS応募' }
    if (!found.frame) return { status: 'skip', reason: 'フォームが見つからない' }
    let { page: p, frame } = found
    const text = await pageText(p)
    if (NO_AUTO.test(text)) return { status: 'skip', reason: '規約で自動応募禁止' }

    for (let round = 0; round < 4; round++) {
      const r = await frame.evaluate(`(${filler})(${JSON.stringify(profile)})`)
      if (r.login) return { status: 'skip', reason: 'ログインが必要' }
      if (r.captcha) return { status: 'skip', reason: '画像認証あり' }
      if (round === 0 && r.filled === 0) return { status: 'skip', reason: '入力欄が個人情報フォームでない' }
      if (r.missing.length) return { status: 'skip', reason: `必須項目が埋められない(${r.missing.slice(0, 3).join(',')})` }
      if (!SUBMIT) return { status: 'dry-ok', reason: `入力${r.filled}・アンケート${r.survey}・同意${r.consent}` }

      const before = p.url()
      const btn = await clickSubmit(frame)
      if (!btn) return { status: 'fail', reason: '送信ボタンが見つからない' }
      await p.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {})
      await p.waitForTimeout(1500)
      const after = await pageText(p)
      if (DONE.test(after) && !/(必須|入力してください|正しく入力|エラー)/.test(after.slice(0, 2000))) {
        return { status: 'applied', reason: /メール.{0,10}(確認|認証|届)/.test(after) ? '確認メールあり' : '' }
      }
      // 確認画面など：次のフレームを探してもう一度
      const nf = await bestFrame(p)
      frame = nf.frame || p.mainFrame()
      if (p.url() === before && round > 0 && !nf.frame) break
    }
    return { status: 'unknown', reason: '完了画面を確認できず' }
  } catch (e) {
    return { status: 'fail', reason: String(e.message || e).split('\n')[0].slice(0, 80) }
  } finally {
    await page.context().pages().forEach((pg) => pg !== page && pg.close().catch(() => {}))
    await page.close().catch(() => {})
  }
}

const tally = {}
for (const it of targets) {
  const res = await applyOne(it)
  const host = (() => {
    try {
      return new URL(it.entryUrl).host
    } catch {
      return '?'
    }
  })()
  console.log(`[${res.status}] ${it.id} ${host} ${res.reason}`)
  tally[res.status] = (tally[res.status] || 0) + 1
  // 試運転の結果は記録しない（本番で改めて応募する）。失敗は次回再挑戦せず記録。
  if (res.status !== 'dry-ok') applied[it.id] = { ...res, host, at: new Date().toISOString(), tries: (applied[it.id]?.tries || 0) + 1 }
}
await browser.close()
fs.writeFileSync(APPLIED, JSON.stringify(applied, null, 1) + '\n')
console.log('summary', JSON.stringify(tally))
