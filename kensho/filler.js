// ブラウザ内で実行するフォーム入力関数（autoapply.mjs から page.evaluate で呼ぶ）。
// 画面のブックマークレット（components/KenshoList.tsx）と同じ判定ルール。
// 戻り値には個人情報を含めない（ログに出るため）。
;async (P0) => {
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
  const comment = P.comment || 'いつも楽しく拝見しています。これからも応援しています。'
  const SKIP = /その他|答えたくない|回答しない|回答しません|わからない|分からない|選択して|選んで|^-+$|^\s*$/
  const NO_TOUCH = /メルマガ|メールマガジン|配信を希望|ニュースレター|案内を受け|受け取る|お知らせを希望|ファンクラブ|入会|会員登録|会員になる|メール配信|情報配信|お知らせメール|fan.?club|mail.?mag|newsletter|magazine/i
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
    [/(city|市区町村|municipality|address-level2|addr(ess)?1|住所1)/i, (h, el) => (/municipality/i.test(el.name || '') && document.querySelector('[name$="block_number"]') ? P.city : (P.city || '') + (P.addr || ''))],
    [/(bldg|building|建物|マンション|addr(ess)?3|address-line2|住所3)/i, () => P.bldg],
    [/(street|番地|block_?number|addr(ess)?2|address-line1|住所2)/i, () => P.addr],
    [/(住所|address)/i, () => addr + (P.bldg ? ' ' + P.bldg : '')],
    [/(sei.?kana|last.?name.?kana|family.?name.?kana|セイ|せい|姓.*(カナ|かな|フリガナ|ふりがな))/i, (h) => (/ふりがな|ひらがな|hiragana/i.test(h) ? P.seiKana : kata(P.seiKana))],
    [/(mei.?kana|first.?name.?kana|given.?name.?kana|メイ|めい|名.*(カナ|かな|フリガナ|ふりがな))/i, (h) => (/ふりがな|ひらがな|hiragana/i.test(h) ? P.meiKana : kata(P.meiKana))],
    [/(kana|furigana|フリガナ|ふりがな|カナ)/i, (h) => (/ふりがな|ひらがな|hiragana/i.test(h) ? fullKana : kata(fullKana))],
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
        const o = Array.from(el.options).find((o) => hit(o.text) || hit(o.value)) || Array.from(el.options).find((o) => o.text.includes(dec) || o.value.includes(dec)) || Array.from(el.options).find((o) => o.value && ageFits(o.text))
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
  // 必須か：required属性のほか、項目ラベルに「必須」と書いてある形式（form.run 等）
  // その欄だけを含む一番外側のまとまり（他の項目の入力欄を含まない範囲）
  const baseName = (e) => (e.name || e.id || '').replace(/(_(last|first)_name(_katakana)?|_postal_code|_region|_municipality|_block_number|_building|_confirm|_fr_other_text|_other|\[\])$/, '')
  const blockOf = (el) => {
    let best = el.parentElement
    let x = el.parentElement
    for (let i = 0; x && x.parentElement && i < 10; i++) {
      const p = x.parentElement
      if (p.tagName === 'FORM' || p.tagName === 'BODY') break
      const others = Array.from(p.querySelectorAll('input, select, textarea')).filter((e) => e.type !== 'hidden' && visible(e) && baseName(e) !== baseName(el))
      if (others.length) break
      best = p
      x = p
    }
    return best
  }
  const isReq = (el) => {
    if (el.required || el.getAttribute('aria-required') === 'true') return true
    const t = (blockOf(el)?.innerText || '').replace(/\s+/g, ' ')
    return t.length < 800 && /必須/.test(t) && !/^.{0,30}任意/.test(t)
  }
  // 年齢（生年月日から）に合う選択肢：「31〜40歳」「30代」「20歳以下」「71歳以上」など
  const myAge = (() => {
    if (P.age) return Number(P.age)
    if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(P.birth || '')) {
      const [y, m, d] = P.birth.split('-').map(Number)
      const now = new Date()
      return now.getFullYear() - y - (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d) ? 1 : 0)
    }
    return null
  })()
  const ageFits = (txt) => {
    if (myAge == null) return false
    const t = (txt || '').normalize('NFKC').replace(/^\s*[0-9a-zA-Z]{1,2}\s*[.)．:：、]\s*/, '')
    let m = t.match(/(\d+)\s*[〜~～\-ー－]\s*(\d+)/)
    if (m) return myAge >= +m[1] && myAge <= +m[2]
    if ((m = t.match(/(\d+)\s*歳?\s*代/))) return Math.floor(myAge / 10) * 10 === +m[1]
    if ((m = t.match(/(\d+)\s*歳?\s*(以下|未満)/))) return m[2] === '以下' ? myAge <= +m[1] : myAge < +m[1]
    if ((m = t.match(/(\d+)\s*歳?\s*以上/))) return myAge >= +m[1]
    return false
  }
  // 選択肢グループの「設問文」：選択肢の文言より広い、最も近い親要素のテキストの先頭
  const qText = (el, siblings) => {
    // 選択肢の文言を全部取り除いても文字が残る親要素＝設問文を含むブロック
    const opts = (siblings || [el]).map((e) => ((e.labels && e.labels[0]?.innerText) || e.value || '').replace(/\s+/g, ' ').trim()).filter(Boolean)
    let x = el.parentElement
    for (let i = 0; x && i < 10; i++, x = x.parentElement) {
      let t = (x.innerText || '').replace(/\s+/g, ' ').trim()
      if (t.length > 1500) break
      for (const o of opts) t = t.split(o).join(' ')
      t = t.replace(/\s+/g, ' ').trim()
      if (t.length > 3) return t.slice(0, 80)
    }
    return ''
  }
  const AGE_Q = /年齢|年代|age/i
  const JOB_Q = /職業|ご職業|occupation|job/i
  // 職業はユーザー指定で「会社員」（選択肢になければ近いもの→その他）
  const JOB_PICK_RE = /^(会社員|正社員|会社勤め|給与所得者|社員)/
  // 「1.会社員」「A) 会社員」のような番号付きの選択肢にも対応
  const clean = (t) => (t || '').normalize('NFKC').replace(/^\s*[0-9a-zA-Z]{1,2}\s*[.)．:：、]\s*/, '').trim()
  const JOB_PICK = { test: (t) => JOB_PICK_RE.test(clean(t)) }
  const GENDER_Q = /性別|gender|sex/i
  const setVal = (el, v) => {
    const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
    if (el instanceof HTMLSelectElement) {
      const opt = Array.from(el.options).find((o) => o.text.trim() === v || o.value === v || o.text.includes(v))
      if (!opt) return false
      v = opt.value
    }
    setter ? setter.call(el, v) : (el.value = v)
    el.setAttribute('data-kensho-v', '1')
    el.dispatchEvent(((t) => { const e = document.createEvent('Event'); e.initEvent(t, true, true); return e })('input'))
    el.dispatchEvent(((t) => { const e = document.createEvent('Event'); e.initEvent(t, true, true); return e })('change'))
    el.dispatchEvent(((t) => { const e = document.createEvent('Event'); e.initEvent(t, true, true); return e })('blur'))
    return true
  }
  let n = 0
  let q = 0
  // WEBCAS 等：郵便番号「名前_left/_right」、電話「_areacode/_citycode/_subscribercode」（ラベルが離れた列にある）
  {
    const zip = (P.zip || '').replace(/\D/g, '')
    const tel = (P.tel || '').replace(/\D/g, '')
    document.querySelectorAll('input[name$="_left"]').forEach((l) => {
      const r = document.querySelector(`input[name="${CSS.escape(l.name.replace(/_left$/, '_right'))}"]`)
      if (r && l.maxLength === 3 && r.maxLength === 4 && zip.length === 7 && !l.value && setVal(l, zip.slice(0, 3)) && setVal(r, zip.slice(3))) n++
    })
    document.querySelectorAll('input[name$="_areacode"]').forEach((x) => {
      const b = x.name.replace(/_areacode$/, '')
      const c = document.querySelector(`input[name="${CSS.escape(b + '_citycode')}"]`), s = document.querySelector(`input[name="${CSS.escape(b + '_subscribercode')}"]`)
      if (!c || !s || x.value || tel.length < 10) return
      const t3 = tel.length === 11 ? [tel.slice(0, 3), tel.slice(3, 7), tel.slice(7)] : [tel.slice(0, 2), tel.slice(2, 6), tel.slice(6)]
      if (setVal(x, t3[0]) && setVal(c, t3[1]) && setVal(s, t3[2])) n++
    })
  }
  // SPIRAL のフォーム：郵便番号は「名前:a / 名前:t」、電話は「名前:a / :e / :n」に分かれ、ラベルがない
  document.querySelectorAll('input[name$=":a"]').forEach((a) => {
    const base = a.name.slice(0, -2)
    const by = (suf) => document.querySelector(`input[name="${CSS.escape(base + suf)}"]`)
    const zip = (P.zip || '').replace(/\D/g, '')
    const tel = (P.tel || '').replace(/\D/g, '')
    if (by(':t') && !by(':e') && zip.length === 7) {
      if (setVal(a, zip.slice(0, 3)) && setVal(by(':t'), zip.slice(3))) n++
    } else if (by(':e') && by(':n') && tel.length >= 10) {
      const t3 = tel.length === 11 ? [tel.slice(0, 3), tel.slice(3, 7), tel.slice(7)] : [tel.slice(0, 2), tel.slice(2, 6), tel.slice(6)]
      if (setVal(a, t3[0]) && setVal(by(':e'), t3[1]) && setVal(by(':n'), t3[2])) n++
    }
  })
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
    // 「その他（自由回答）」の詳細欄は、その他を選んだときだけ後で埋める（選んでいないのに書くとエラーになる）
    const near = (el.parentElement?.innerText || '').replace(/\s+/g, ' ').slice(0, 30)
    if (!(el instanceof HTMLSelectElement) && /その他|other/i.test(`${el.name} ${el.id} ${own} ${near}`)) return
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
    const head = `${el.name} ${el.id} ${hl.slice(0, 60)}`
    if (el instanceof HTMLSelectElement && AGE_Q.test(head) && Array.from(el.options).filter((o) => /\d+\s*(歳|才|代)/.test(o.text)).length >= 2) {
      const o = Array.from(el.options).find((o) => o.value && ageFits(o.text))
      if (o) { setVal(el, o.value); n++ } else if (isReq(el)) el.setAttribute('data-kensho-unknown', '1')
      return
    }
    if (PERSONAL_Q.test(head) && !isReq(el)) return
    if (el instanceof HTMLSelectElement && GENDER_Q.test(head) && !/子/.test(head)) {
      const g = (P.gender || '').replace(/性$/, '')
      const o = g && Array.from(el.options).find((o) => o.value && clean(o.text).startsWith(g))
      if (o) { setVal(el, o.value); n++ } else if (isReq(el)) { const na = Array.from(el.options).find((o) => /無回答|回答しない|答えたくない/.test(o.text)); na ? setVal(el, na.value) : el.setAttribute('data-kensho-unknown', '1') }
      return
    }
    if (el instanceof HTMLSelectElement && JOB_Q.test(head)) {
      const o = Array.from(el.options).find((o) => o.value && JOB_PICK.test(o.text)) || Array.from(el.options).find((o) => /その他/.test(o.text))
      if (o) { setVal(el, o.value); q++ } else el.setAttribute('data-kensho-unknown', '1')
      return
    }
    if (el instanceof HTMLSelectElement) {
      const opts = Array.from(el.options).filter((o) => o.value && !o.disabled && !SKIP.test(o.text))
      if (opts.length) {
        setVal(el, opts[Math.floor(opts.length / 2)].value)
        q++
      }
    } else if (isFree || (el instanceof HTMLTextAreaElement && isReq(el))) {
      // 感想・メッセージ等の自由記述、または必須のテキストエリアだけ定型文を入れる（任意の「よく使うお店」等には書かない）
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
    const gl = `${k} ${qText(els[0], els)}`
    const req = els.some((e) => isReq(e))
    const txt = (e) => (e.labels?.[0]?.textContent || e.value || '').trim()
    if (AGE_Q.test(gl) && !/性別/.test(gl) && els.filter((e) => /\d+\s*(歳|才|代)/.test(txt(e))).length >= 2) {
      const c = els.find((e) => ageFits(txt(e)))
      if (c) { c.click(); n++ } else if (req) els[0].setAttribute('data-kensho-unknown', '1')
      return
    }
    if (/性別|gender|sex/i.test(gl) && !/子/.test(gl)) {
      const c = P.gender && els.find((e) => clean(txt(e)).startsWith(P.gender.replace(/性$/, '')))
      if (c) { c.click(); n++ } else if (req) { const na = els.find((e) => /無回答|回答しない|答えたくない/.test(txt(e))); na ? na.click() : els[0].setAttribute('data-kensho-unknown', '1') }
      return
    }
    if (JOB_Q.test(gl) && req) {
      const c = els.find((e) => JOB_PICK.test(txt(e))) || els.find((e) => /その他/.test(txt(e)))
      if (c) { c.click(); q++ } else els[0].setAttribute('data-kensho-unknown', '1')
      return
    }
    if (PERSONAL_Q.test(gl) && !req) return
    const t = (e) => (labelOf(e).slice(0, 60) + ' ' + e.value).trim()
    if (k.startsWith('checkbox:') && els.length < 2) {
      const e = els[0]
      if (CONSENT.test(t(e)) && !NO_TOUCH.test(t(e))) {
        e.click()
        consent++
      }
      return
    }
    if (els.some((e) => NO_TOUCH.test(t(e))) || NO_TOUCH.test(gl)) {
      // メルマガ等の配信希望が必須なら「希望しない」を選ぶ（任意なら触らない）
      if (req && k.startsWith('radio:')) {
        const no = els.find((e) => /希望しない|受け取らない|入会しない|登録しない|加入しない|不要|しない|いいえ/.test(txt(e)))
        if (no) { no.click(); q++ }
      }
      return
    }
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
  // 「その他」を選んだ選択肢の詳細欄（その他を選ばせた場合のみ）を埋める
  await new Promise((r) => setTimeout(r, 400)) // 「その他」を選ぶと詳細欄が後から表示されるので待つ
  document.querySelectorAll('input[type=radio]:checked, input[type=checkbox]:checked').forEach((r) => {
    const t = ((r.labels && r.labels[0]?.innerText) || r.value || '').trim()
    if (!/その他/.test(t)) return
    const box = blockOf(r)
    const other = Array.from((box || document).querySelectorAll('input[type=text], textarea')).find((e) => visible(e) && !e.value && (/other|その他/i.test(e.name || '') || box))
    if (other && setVal(other, 'その他')) q++
  })
  // 未入力の必須項目（個人情報は返さない。項目の種類だけ）
  const missing = []
  document.querySelectorAll('[data-kensho-unknown]').forEach((el) => missing.push(`${(el.name || el.id || 'age').slice(0, 20)}(不明)`))
  // ラベルに「必須」とある項目の未回答（form.run 等）
  const seenReq = new Set()
  document.querySelectorAll('input, select, textarea').forEach((el) => {
    if (!visible(el) || el.type === 'hidden' || el.disabled || seenReq.has(el.name)) return
    if (el.required || !isReq(el) || /building|bldg|建物|_fr_other/i.test(el.name || '')) return
    seenReq.add(el.name)
    if (el.type === 'radio' || el.type === 'checkbox') {
      if (el.name && document.querySelector(`input[name="${CSS.escape(el.name)}"]:checked`)) return
    } else if (el instanceof HTMLSelectElement ? el.selectedIndex > 0 || (el.value && !el.options[0]?.text.match(/選択/)) : el.value) return
    missing.push(`${(el.name || el.id).slice(0, 24)}(必須)`)
  })
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
      // name のないラジオは同じ枠の中でどれか選ばれていれば埋まっている
      if (!el.name && type === 'radio' && el.parentElement?.parentElement?.closest('div, td, dd, li, fieldset')?.querySelector('input[type=radio]:checked')) return
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
