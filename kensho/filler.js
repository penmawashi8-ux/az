// ブラウザ内で実行するフォーム入力関数（autoapply.mjs から page.evaluate で呼ぶ）。
// 画面のブックマークレット（components/KenshoList.tsx）と同じ判定ルール。
// 戻り値には個人情報を含めない（ログに出るため）。
;(P0) => {
  // 全角数字・全角英字（ＩＭＥで入力したプロフィール）を半角に揃える
  const P = {}
  for (const [k, v] of Object.entries(P0 || {})) P[k] = typeof v === 'string' ? v.normalize('NFKC').trim() : v
  if (P.email) P.email = P.email.replace(/\s+/g, '')
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
  const PERSONAL_Q = /第\s*\d\s*子|お子|子ども|子供|こども|妊娠|出産|年収|世帯|家族構成|職業|勤務|会社|役職|学年|学校|child|kids|baby|pregnan|income|occupation/i
  const POSITIVE = /とても|非常に|満足|好き|はい|ある|あり|興味がある|使ってみたい|買いたい|購入したい|知っている|良い|よい/
  // 同じ名前で末尾だけ 1/2/3 違う欄が並んでいれば分割入力（maxlength が無い場合も）
  const splitIndex = (el) => {
    const n = el.name || el.id || ''
    const m = n.match(/^(.*?)([-_]?)([123])$/)
    if (!m) return 0
    const other = m[1] + m[2] + (m[3] === '1' ? '2' : '1')
    return document.querySelector(`[name="${CSS.escape(other)}"], [id="${CSS.escape(other)}"]`) ? Number(m[3]) : 0
  }
  const rules = [
    [/mail|メール/i, (h) => (/確認|confirm|再入力|again/i.test(h) ? P.email : P.email)],
    // 分割入力（郵便番号 3+4、電話番号 3/4/4 など）は入力欄の maxlength と name/id の末尾だけで判断する
    // （ラベルの「例：812-8577」などの数字で誤判定しないため）
    [/(zip|postal|post_?code|郵便)/i, (h, el) => {
      const id = `${el.name || ''} ${el.id || ''}`.trim()
      const ml = el.maxLength
      const si = splitIndex(el)
      if (ml === 3 || si === 1 || /(_a|first|head|前|上)$/i.test(id)) return zip.slice(0, 3)
      if (ml === 4 || si === 2 || /(_b|second|tail|後|下)$/i.test(id)) return zip.slice(3)
      if (ml === 8 || /-/.test(el.placeholder || '')) return `${zip.slice(0, 3)}-${zip.slice(3)}`
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
      if (el.maxLength === 13 || /\d-\d/.test(el.placeholder || '')) return `${parts[0]}-${parts[1]}-${parts[2]}`
      return tel
    }],
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
    [/(age|年齢)/i, (h, el) => {
      let a = P.age
      if (!a && /^\d{4}-\d{1,2}-\d{1,2}$/.test(P.birth || '')) {
        const [y, m, d] = P.birth.split('-').map(Number)
        const now = new Date()
        a = String(now.getFullYear() - y - (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d) ? 1 : 0))
      }
      if (!a) return ''
      if (el instanceof HTMLSelectElement) {
        // 「30代」形式 or 「35歳」形式
        const dec = `${Math.floor(Number(a) / 10) * 10}代`
        const hit = (x) => [a, `${a}歳`, `${a}才`].includes((x || '').trim())
        const o = Array.from(el.options).find((o) => hit(o.text) || hit(o.value)) || Array.from(el.options).find((o) => o.text.includes(dec) || o.value.includes(dec))
        return o ? o.value : ''
      }
      return a
    }],
    [/(name|氏名|名前|お名前)/i, () => full],
  ]
  const labelOf = (el) => {
    let t = ''
    if (el.id) {
      const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]')
      if (l) t += ' ' + l.textContent
    }
    const wrap = el.closest('label, tr, dl, li, fieldset, .form-group, .row, div') || el.parentElement
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
    if (!visible(el) || el.disabled || el.readOnly) return
    // 入力済みなら触らない。ただし空の選択肢がないプルダウンの先頭（北海道・16歳など）は未選択とみなす
    if (el instanceof HTMLSelectElement ? el.selectedIndex > 0 || (el.value && Array.from(el.options).some((o) => o.defaultSelected)) : el.value) return
    const h = [el.name, el.id, el.getAttribute('autocomplete'), el.getAttribute('placeholder'), el.getAttribute('aria-label')].join(' ')
    const hl = h + ' ' + labelOf(el)
    const FREE = /感想|理由|意見|コメント|メッセージ|ご要望|自由|エピソード|思い出|ひと言|一言|お聞かせ|教えて|message|comment|\bmsg\b/i
    const own = `${el.name} ${el.id} ${el.getAttribute('placeholder') || ''} ${(el.labels && el.labels[0]?.innerText) || ''} ${el.parentElement && el.parentElement.querySelectorAll('input, textarea, select').length === 1 ? el.parentElement.textContent.slice(0, 40) : ''}`
    const isFree = FREE.test(own) || FREE.test(hl.slice(0, 120))
    if (!(isFree && (el instanceof HTMLTextAreaElement || FREE.test(own)))) {
      // 欄そのものの name/id/ラベルで決まるルールを優先し、なければ周辺の文言で判断する
      const own = `${h} ${(el.labels && el.labels[0]?.innerText) || ''}`
      const rule = rules.find(([re]) => re.test(own)) || rules.find(([re]) => (!h.trim() && re.test(hl)) || re.test(hl.slice(0, 40)))
      if (rule) {
        const v = rule[1](hl, el)
        if (v && setVal(el, v)) n++
        else if (!v && el instanceof HTMLSelectElement && /age|年齢/i.test(own) && !Array.from(el.options).some((o) => !o.value)) {
          // 年齢が分からないのに空の選択肢がない（最初の年齢が入ったまま送られる）→ 送らない
          el.setAttribute('data-kensho-unknown', '1')
        }
        return
      }
    }
    // 子ども・妊娠・年収・職業など本人の状況を表す任意項目は、適当に埋めない（事実と違う回答になるため）
    if (PERSONAL_Q.test(`${el.name} ${el.id} ${hl.slice(0, 60)}`) && !el.required) return
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
      if (/子|child|kid|baby|赤ちゃん/i.test(`${r.name} ${r.id}`)) return // お子様の性別に本人の性別を入れない
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
    if (PERSONAL_Q.test(`${k} ${labelOf(els[0]).slice(0, 60)}`) && !els.some((e) => e.required)) return
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
  document.querySelectorAll('[data-kensho-unknown]').forEach((el) => missing.push(`${(el.name || el.id || 'age').slice(0, 20)}(不明)`))
  document.querySelectorAll('input[required], select[required], textarea[required], [aria-required=true]').forEach((el) => {
    if (!visible(el)) return
    const type = (el.getAttribute('type') || '').toLowerCase()
    // 選択肢をまとめた枠（div[aria-required] や role=radiogroup）は、中で何か選ばれていれば埋まっている
    if (!/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) {
      if (el.querySelector('input:checked, [aria-checked=true], option:checked:not([value=""])')) return
      if (!el.querySelector('input, select, textarea, [role=radio], [role=checkbox]')) return
    } else if (type === 'checkbox' || type === 'radio') {
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
