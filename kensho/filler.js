// ブラウザ内で実行するフォーム入力関数（autoapply.mjs から page.evaluate で呼ぶ）。
// 画面のブックマークレット（components/KenshoList.tsx）と同じ判定ルール。
// 戻り値には個人情報を含めない（ログに出るため）。
;(P) => {
  const full = (P.sei || '') + (P.mei || '')
  const fullKana = (P.seiKana || '') + (P.meiKana || '')
  const addr = (P.pref || '') + (P.city || '') + (P.addr || '')
  const [by, bm, bd] = (P.birth || '').split('-')
  const tel = (P.tel || '').replace(/\D/g, '')
  const zip = (P.zip || '').replace(/\D/g, '')
  const kata = (s) => (s || '').replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60))
  const comment = P.comment || 'いつも楽しく拝見しています。商品の魅力がよく伝わってきて、ぜひ試してみたいと思いました。当選したら家族と一緒に大切に使わせていただきます。'
  const SKIP = /その他|答えたくない|回答しない|回答しません|わからない|分からない|選択して|選んで|^-+$|^\s*$/
  const NO_TOUCH = /メルマガ|メールマガジン|配信を希望|ニュースレター|案内を受け|受け取る|お知らせを希望/
  const CONSENT = /同意|規約|ポリシー|個人情報の取り?扱/
  const POSITIVE = /とても|非常に|満足|好き|はい|ある|あり|興味がある|使ってみたい|買いたい|購入したい|知っている|良い|よい/
  const rules = [
    [/mail|メール/i, (h) => (/確認|confirm|再入力|again/i.test(h) ? P.email : P.email)],
    [/(zip|postal|post_?code|郵便)/i, (h) => (/(2|second|後|下)/.test(h) ? zip.slice(3) : /(1|first|前|上)/.test(h) ? zip.slice(0, 3) : zip)],
    [/(tel|phone|電話|携帯)/i, (h) => (/(1|first)$/.test(h) ? tel.slice(0, 3) : /(2|second)$/.test(h) ? tel.slice(3, 7) : /(3|third)$/.test(h) ? tel.slice(7) : tel)],
    [/(pref|都道府県|region|address-level1)/i, () => P.pref],
    [/(city|市区町村|address-level2|addr(ess)?1|住所1)/i, () => (P.city || '') + (P.addr || '')],
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
    [/(age|年齢)/i, () => P.age],
    [/(name|氏名|名前|お名前)/i, () => full],
  ]
  const labelOf = (el) => {
    let t = ''
    if (el.id) {
      const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]')
      if (l) t += ' ' + l.textContent
    }
    const wrap = el.closest('label, tr, dl, li, fieldset, .form-group, .row, div')
    if (wrap) t += ' ' + (wrap.textContent || '').slice(0, 80)
    return t
  }
  const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length)
  const setVal = (el, v) => {
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
    el.dispatchEvent(new Event('blur', { bubbles: true }))
    return true
  }
  let n = 0
  let q = 0
  document.querySelectorAll('input, select, textarea').forEach((el) => {
    const type = (el.getAttribute('type') || '').toLowerCase()
    if (['hidden', 'submit', 'button', 'checkbox', 'radio', 'file', 'password', 'image', 'search'].includes(type)) return
    if (!visible(el) || el.disabled || el.readOnly || el.value) return
    const h = [el.name, el.id, el.getAttribute('autocomplete'), el.getAttribute('placeholder'), el.getAttribute('aria-label')].join(' ')
    const hl = h + ' ' + labelOf(el)
    const isFree = /感想|理由|意見|コメント|メッセージ|ご要望|自由|エピソード|思い出|ひと言|一言|お聞かせ|教えて/.test(hl.slice(0, 120))
    if (!(isFree && el instanceof HTMLTextAreaElement)) {
      for (const [re, get] of rules) {
        if (re.test(h) || (!h.trim() && re.test(hl)) || re.test(hl.slice(0, 40))) {
          const v = get(hl)
          if (v && setVal(el, v)) n++
          return
        }
      }
    }
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
  if (P.gender) {
    document.querySelectorAll('input[type=radio]').forEach((r) => {
      const t = (r.value + ' ' + labelOf(r)).slice(0, 40)
      if (t.includes(P.gender) && !r.checked) {
        r.click()
        n++
      }
    })
  }
  const pick = (xs, text) => {
    const ok = xs.filter((x) => !SKIP.test(text(x)) && !NO_TOUCH.test(text(x)) && !CONSENT.test(text(x)))
    return ok.find((x) => POSITIVE.test(text(x))) || ok[0]
  }
  const groups = new Map()
  document.querySelectorAll('input[type=radio], input[type=checkbox]').forEach((el) => {
    if (el.disabled || !el.name) return
    const k = el.type + ':' + el.name
    groups.set(k, [...(groups.get(k) || []), el])
  })
  let consent = 0
  groups.forEach((els, k) => {
    if (els.some((e) => e.checked)) return
    const t = (e) => (labelOf(e).slice(0, 60) + ' ' + e.value).trim()
    if (k.startsWith('checkbox:') && els.length < 2) {
      const e = els[0]
      if (CONSENT.test(t(e)) && !NO_TOUCH.test(t(e))) {
        e.click()
        consent++
      }
      return
    }
    if (els.some((e) => NO_TOUCH.test(t(e)))) return
    const c = pick(els, (e) => (e.labels?.[0]?.textContent || e.value || '').trim())
    if (c) {
      c.click()
      q++
    }
  })
  document.querySelectorAll('[role=radiogroup]').forEach((g) => {
    const rs = Array.from(g.querySelectorAll('[role=radio]'))
    if (!rs.length || rs.some((r) => r.getAttribute('aria-checked') === 'true')) return
    const c = pick(rs, (r) => r.getAttribute('aria-label') || r.getAttribute('data-value') || r.textContent || '')
    if (c) {
      c.click()
      q++
    }
  })
  document.querySelectorAll('[role=checkbox][aria-checked=false]').forEach((c) => {
    const t = (c.getAttribute('aria-label') || c.textContent || '').slice(0, 60)
    if (CONSENT.test(t) && !NO_TOUCH.test(t)) {
      c.click()
      consent++
    }
  })
  // 未入力の必須項目（個人情報は返さない。項目の種類だけ）
  const missing = []
  document.querySelectorAll('input[required], select[required], textarea[required], [aria-required=true]').forEach((el) => {
    if (!visible(el)) return
    const type = (el.getAttribute('type') || '').toLowerCase()
    if (type === 'checkbox' || type === 'radio') {
      if (el.name && document.querySelector(`input[name="${CSS.escape(el.name)}"]:checked`)) return
      if (el.checked) return
    } else if (el.value) return
    missing.push((el.name || el.id || type || el.tagName).slice(0, 30))
  })
  return {
    filled: n,
    survey: q,
    consent,
    missing,
    captcha: !!document.querySelector('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="turnstile"], .g-recaptcha, .h-captcha, .cf-turnstile'),
    login: !!document.querySelector('input[type=password]'),
  }
}
