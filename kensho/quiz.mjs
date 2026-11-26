// 応募フォームのクイズ（「正解者の中から抽選」など）を解く。
// 1) ANTHROPIC_API_KEY があれば Claude にキャンペーンページの本文を読ませて解く
// 2) なければ、選択肢のうちキャンペーン本文に一番多く出てくるものを選ぶ（答えはページ内にあることが多い）
// 個人情報は扱わない（問題文・選択肢・キャンペーン本文だけを渡す）。
import Anthropic from '@anthropic-ai/sdk'

const QUIZ_HINT = /クイズ|問題|正解|答え|Q\s*\d|Ｑ\s*\d|問\s*\d|第\s*\d\s*問|いくつ|何(色|個|人|年|月|日|番)|どれ|どこ|だれ|誰/

/** フォーム内のクイズらしき設問を集める（id は data-kensho-q で目印を付ける） */
export async function collectQuiz(frame) {
  return frame.evaluate((hintSrc) => {
    const hint = new RegExp(hintSrc)
    const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length)
    const ctxOf = (el) => {
      // 入力欄から親をたどり、問題文を含む最小のまとまり（設問ブロック）を探す。フォーム全体まで来たら止める
      let x = el.parentElement
      for (let k = 0; x && k < 6 && x.tagName !== 'FORM' && x.tagName !== 'BODY'; k++, x = x.parentElement) {
        const t = (x.innerText || '').replace(/\s+/g, ' ').trim()
        if (t.length > 1500) break
        if (hint.test(t)) return t.slice(0, 600)
      }
      const box = el.closest('fieldset, tr, dl, li, p, .form-group, .question, [role=listitem]') || el.parentElement
      return (box?.innerText || '').replace(/\s+/g, ' ').trim().slice(-500)
    }
    // 年齢・都道府県・性別・生年月日など個人情報の欄はクイズではない
    const PERSONAL = /age|pref|state|sex|gender|birth|year|month|day|zip|post|tel|phone|mail|name|addr|kana|job|occupation|年齢|都道府県|性別|生年|誕生|職業|住所|電話|氏名|名前/i
    const isPersonal = (el, opts) =>
      PERSONAL.test(`${el.name} ${el.id}`) ||
      (opts.length >= 40 && opts.includes('東京都')) ||
      opts.filter((o) => /^\d+代|代以上$|男性|女性/.test(o)).length >= 2
    const labelText = (el) => ((el.labels && el.labels[0]?.innerText) || el.getAttribute('aria-label') || el.value || '').replace(/\s+/g, ' ').trim()
    const qs = []
    let n = 0
    // ラジオ・チェックボックス（name単位）
    const groups = new Map()
    document.querySelectorAll('input[type=radio], input[type=checkbox]').forEach((el) => {
      if (!el.name || el.disabled || !visible(el)) return
      groups.set(el.name, [...(groups.get(el.name) || []), el])
    })
    groups.forEach((els) => {
      if (els.length < 2) return
      if (isPersonal(els[0], els.map(labelText))) return
      const ctx = ctxOf(els[0])
      if (!hint.test(ctx)) return
      const id = `q${n++}`
      els.forEach((e, i) => e.setAttribute('data-kensho-q', `${id}:${i}`))
      qs.push({ id, kind: els[0].type, question: ctx, options: els.map(labelText) })
    })
    // セレクト
    document.querySelectorAll('select').forEach((el) => {
      if (el.disabled || !visible(el)) return
      const opts = Array.from(el.options).filter((o) => o.value).map((o) => o.text.trim())
      if (isPersonal(el, opts)) return
      const ctx = ctxOf(el)
      if (!hint.test(ctx)) return
      const id = `q${n++}`
      el.setAttribute('data-kensho-q', id)
      if (opts.length >= 2) qs.push({ id, kind: 'select', question: ctx, options: opts })
    })
    // Googleフォーム等の role=radiogroup
    document.querySelectorAll('[role=radiogroup]').forEach((g) => {
      const ctx = ctxOf(g)
      if (!hint.test(ctx)) return
      const rs = Array.from(g.querySelectorAll('[role=radio]'))
      if (rs.length < 2) return
      const id = `q${n++}`
      rs.forEach((r, i) => r.setAttribute('data-kensho-q', `${id}:${i}`))
      qs.push({ id, kind: 'role-radio', question: ctx, options: rs.map((r) => r.getAttribute('aria-label') || r.getAttribute('data-value') || r.innerText.trim()) })
    })
    // 記述式の答え欄
    document.querySelectorAll('input[type=text], input:not([type]), textarea').forEach((el) => {
      if (el.disabled || !visible(el) || el.value) return
      const meta = `${el.name} ${el.id} ${el.placeholder} ${labelText(el)}`
      const near = (el.parentElement?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 80)
      const ctx = ctxOf(el)
      // 記述式は入力欄そのもの（名前・ラベル・すぐ隣の文言）がクイズの答え欄と分かる場合だけ
      if (!/答え|正解|クイズ|answer|quiz/i.test(meta + ' ' + near)) return
      if (/感想|意見|理由|コメント|ご要望/.test(ctx.slice(0, 80))) return
      const id = `q${n++}`
      el.setAttribute('data-kensho-q', id)
      qs.push({ id, kind: 'text', question: ctx, options: [] })
    })
    return qs
  }, QUIZ_HINT.source)
}

const client = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null

async function askClaude(questions, context) {
  const schema = {
    type: 'object',
    properties: {
      answers: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            answer: { type: 'string', description: '選択式は選択肢の文字列そのまま。記述式は答えの語句。分からなければ空文字' },
          },
          required: ['id', 'answer'],
          additionalProperties: false,
        },
      },
    },
    required: ['answers'],
    additionalProperties: false,
  }
  const prompt =
    `懸賞キャンペーンの応募フォームにあるクイズに答えてください。答えはキャンペーンページの本文に書かれていることが多いので、まず本文から探し、なければ一般常識で答えてください。自信がない設問は answer を空文字にしてください。\n\n` +
    `<campaign_page>\n${context.slice(0, 40000)}\n</campaign_page>\n\n<questions>\n${JSON.stringify(questions, null, 1)}\n</questions>`
  const res = await client.beta.messages.create({
    model: 'claude-opus-5-5',
    max_tokens: 4000,
    output_config: { effort: 'low', format: { type: 'json_schema', schema } },
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    messages: [{ role: 'user', content: prompt }],
  })
  if (res.stop_reason === 'refusal') return {}
  const text = res.content.find((b) => b.type === 'text')?.text
  if (!text) return {}
  const out = {}
  for (const a of JSON.parse(text).answers || []) if (a.answer) out[a.id] = a.answer
  return out
}

/** 本文に一番多く出てくる選択肢（同点・0回なら答えない） */
function guessFromText(questions, context) {
  const out = {}
  const norm = (s) => s.normalize('NFKC').replace(/\s+/g, '')
  const body = norm(context)
  for (const q of questions) {
    if (!q.options.length) continue
    const scored = q.options
      .map((o) => ({ o, c: o.length >= 2 ? body.split(norm(o)).length - 1 : 0 }))
      .sort((a, b) => b.c - a.c)
    if (scored[0].c > 0 && scored[0].c > (scored[1]?.c ?? 0)) out[q.id] = scored[0].o
  }
  return out
}

/** クイズを解いてフォームに反映。戻り値は {asked, answered, via} */
// ページ全体にクイズ形式の懸賞だと分かる記述がある場合だけクイズとして扱う（普通のアンケートの「Q1」と区別）
const QUIZ_PAGE = /クイズ|正解(者|した|の方|された)|問題に(答え|回答)|答えを(選|入力|記入)/

export async function solveQuiz(frame, context) {
  const formText = await frame.evaluate(() => document.body?.innerText || '').catch(() => '')
  if (!QUIZ_PAGE.test(`${context}\n${formText}`)) return { asked: 0, answered: 0, via: '' }
  const questions = await collectQuiz(frame)
  if (!questions.length) return { asked: 0, answered: 0, via: '' }
  let answers = {}
  let via = 'page-text'
  if (client) {
    try {
      answers = await askClaude(questions, context)
      via = 'claude'
    } catch (e) {
      if (e instanceof Anthropic.APIError) console.log(`   quiz: Claude API error ${e.status}`)
      else throw e
    }
  }
  if (!Object.keys(answers).length) {
    answers = guessFromText(questions, context)
    via = 'page-text'
  }
  let answered = 0
  for (const q of questions) {
    const a = answers[q.id]
    if (!a) continue
    const ok = await frame.evaluate(
      ([q, a]) => {
        const norm = (s) => (s || '').normalize('NFKC').replace(/\s+/g, '')
        const fire = (el) => ['input', 'change', 'blur'].forEach((t) => el.dispatchEvent(new Event(t, { bubbles: true })))
        if (q.kind === 'text') {
          const el = document.querySelector(`[data-kensho-q="${q.id}"]`)
          if (!el) return false
          el.value = a
          fire(el)
          return true
        }
        if (q.kind === 'select') {
          const el = document.querySelector(`[data-kensho-q="${q.id}"]`)
          const opt = el && Array.from(el.options).find((o) => norm(o.text) === norm(a) || norm(o.text).includes(norm(a)))
          if (!opt) return false
          el.value = opt.value
          fire(el)
          return true
        }
        const i = q.options.findIndex((o) => norm(o) === norm(a)) >= 0 ? q.options.findIndex((o) => norm(o) === norm(a)) : q.options.findIndex((o) => norm(o).includes(norm(a)) || norm(a).includes(norm(o)))
        if (i < 0) return false
        const el = document.querySelector(`[data-kensho-q="${q.id}:${i}"]`)
        if (!el) return false
        el.click()
        return true
      },
      [q, a],
    )
    if (ok) answered++
  }
  return { asked: questions.length, answered, via }
}
