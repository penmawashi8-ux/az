// ==UserScript==
// @name         懸賞リスト ワンボタン応募
// @namespace    penmawashi8-ux.kensho
// @version      1.0.3
// @description  懸賞リストの「ワンボタン応募」から開いたXの投稿で、フォロー・リポスト・いいねを押して懸賞リストへ戻る
// @match        https://x.com/*
// @match        https://twitter.com/*
// @match        https://mobile.twitter.com/*
// @match        https://penmawashi8-ux.github.io/az/kensho/*
// @downloadURL  https://penmawashi8-ux.github.io/az/kensho/x-oneclick.user.js
// @updateURL    https://penmawashi8-ux.github.io/az/kensho/x-oneclick.user.js
// @run-at       document-start
// @grant        none
// ==/UserScript==

/*
 * 懸賞リストのボタンを押したときだけ動く（URL末尾の #kensho=... が目印）。
 * 普段Xを見ているときは何もしない。
 */
;(function () {
  'use strict'
  const VERSION = '1.0.3'
  const JOB_KEY = 'kensho.xjob'

  // 懸賞リスト側：このスクリプトが入っていることを知らせる
  if (location.hostname.endsWith('github.io')) {
    // 読み込み開始直後はページの枠がまだ無いことがあり、画面の描画で目印が消えることもあるので、
    // 保存領域にも書き、数秒間は目印を付け直し続ける
    const ready = () => {
      try {
        localStorage.setItem('kensho.x', JSON.stringify({ v: VERSION, at: Date.now() }))
      } catch (e) {
        /* ignore */
      }
      try {
        if (document.documentElement) document.documentElement.setAttribute('data-kensho-x', VERSION)
        window.dispatchEvent(new Event('kensho-x-ready'))
      } catch (e) {
        /* ignore */
      }
    }
    ready()
    document.addEventListener('DOMContentLoaded', ready)
    window.addEventListener('load', ready)
    let n = 0
    const t = setInterval(() => {
      ready()
      if (++n >= 20) clearInterval(t)
    }, 500)
    return
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  // 人が押すくらいの間隔をあける
  const pause = () => sleep(700 + Math.random() * 700)

  async function waitFor(fn, timeout = 12000) {
    const end = Date.now() + timeout
    while (Date.now() < end) {
      const v = fn()
      if (v) return v
      await sleep(250)
    }
    return null
  }

  function loadJob() {
    // 目印は ?kensho=… と #kensho=… の両方で渡される（Xの画面書き換えでどちらかが消えても拾えるように）
    const raw = new URLSearchParams(location.search).get('kensho') || (location.hash.match(/#kensho=(.+)$/) || [])[1]
    if (raw) {
      try {
        let txt = raw
        try {
          txt = decodeURIComponent(raw)
        } catch (e) {
          /* already decoded */
        }
        const job = JSON.parse(txt)
        job.stage = 'post'
        job.log = []
        sessionStorage.setItem(JOB_KEY, JSON.stringify(job))
        const q = new URLSearchParams(location.search)
        q.delete('kensho')
        const qs = q.toString()
        history.replaceState(history.state, '', location.pathname + (qs ? '?' + qs : ''))
        return job
      } catch (e) {
        return null
      }
    }
    try {
      return JSON.parse(sessionStorage.getItem(JOB_KEY) || 'null')
    } catch (e) {
      return null
    }
  }
  const saveJob = (job) => sessionStorage.setItem(JOB_KEY, JSON.stringify(job))

  let bar
  function banner(text, job, showBack) {
    if (!document.body) {
      document.addEventListener('DOMContentLoaded', () => banner(text, job, showBack), { once: true })
      return
    }
    if (!bar || !bar.isConnected) {
      bar = document.createElement('div')
      bar.style.cssText =
        'position:fixed;left:8px;right:8px;bottom:12px;z-index:2147483647;background:#c2502a;color:#fff;font:600 15px/1.5 system-ui,sans-serif;padding:12px 14px;border-radius:12px;box-shadow:0 4px 16px rgba(0,0,0,.3);display:flex;gap:10px;align-items:center'
      document.body.appendChild(bar)
    }
    bar.textContent = ''
    const span = document.createElement('span')
    span.style.flex = '1'
    span.textContent = text
    bar.appendChild(span)
    if (showBack && job) {
      const b = document.createElement('button')
      b.textContent = '懸賞リストへ戻る'
      b.style.cssText = 'background:#fff;color:#c2502a;border:0;border-radius:8px;padding:8px 10px;font:700 14px system-ui,sans-serif'
      b.onclick = () => goBack(job, false)
      bar.appendChild(b)
    }
  }

  function goBack(job, ok) {
    sessionStorage.removeItem(JOB_KEY)
    const u = new URL(job.back)
    u.searchParams.set('kx', job.item)
    u.searchParams.set('kxok', ok ? '1' : '0')
    location.href = u.toString()
  }

  const lc = (s) => (s || '').toLowerCase()
  const followBtn = (user) =>
    [...document.querySelectorAll('[data-testid$="-follow"], [data-testid$="-unfollow"]')].find((b) =>
      lc(b.getAttribute('aria-label')).includes('@' + lc(user))
    )

  /** 告知ポスト本体（返信スレッドの親ポストではなく、URLのIDのポスト） */
  function focalTweet(id) {
    for (const a of document.querySelectorAll('article a[href*="/status/' + id + '"]')) {
      if (a.querySelector('time')) return a.closest('article')
    }
    return document.querySelector('article[tabindex="-1"]')
  }

  async function onPost(job) {
    banner('懸賞リスト：ポストを読み込み中…', job, true)
    const art = await waitFor(() => focalTweet(job.id))
    if (!art) return fail(job, 'ポストが見つかりません（ログインしていないかも）')
    await pause()

    // リポスト（引用ポストだけが条件の懸賞ではしない）
    if (job.repost === false) {
      /* skip */
    } else if (art.querySelector('[data-testid="unretweet"]')) job.log.push('リポスト済み')
    else {
      const rt = art.querySelector('[data-testid="retweet"]')
      if (!rt) return fail(job, 'リポストボタンが見つかりません')
      rt.click()
      const ok = await waitFor(() => document.querySelector('[data-testid="retweetConfirm"]'), 5000)
      if (!ok) return fail(job, 'リポストの確認ボタンが見つかりません')
      await sleep(300 + Math.random() * 300)
      ok.click()
      job.log.push('リポスト')
      await pause()
    }

    // いいね
    if (job.like) {
      if (art.querySelector('[data-testid="unlike"]')) job.log.push('いいね済み')
      else {
        const lk = art.querySelector('[data-testid="like"]')
        if (!lk) return fail(job, 'いいねボタンが見つかりません')
        lk.click()
        job.log.push('いいね')
        await pause()
      }
    }

    // フォロー：ポスト画面にボタンがあればここで、なければプロフィールへ
    const fb = followBtn(job.user)
    if (fb) return doFollow(job, fb)
    toProfile(job)
  }

  function toProfile(job) {
    job.stage = 'follow'
    saveJob(job)
    location.href = location.origin + '/' + job.user
  }

  async function onProfile(job) {
    banner('懸賞リスト：@' + job.user + ' をフォロー中…', job, true)
    const fb = await waitFor(() => followBtn(job.user))
    if (!fb) return fail(job, 'フォローボタンが見つかりません')
    await pause()
    return doFollow(job, fb)
  }

  async function doFollow(job, fb) {
    if (/-unfollow$/.test(fb.dataset.testid || '')) job.log.push('フォロー済み')
    else {
      fb.click()
      // フォローするとボタンが「フォロー中」に変わるか、ポスト画面では消える
      const ok = await waitFor(() => {
        const b = followBtn(job.user)
        return !b || !b.isConnected || /-unfollow$/.test(b.dataset.testid || '')
      }, 6000)
      if (!ok) {
        // ポスト画面で確認できなければ、プロフィールで確かめ直す（済んでいれば「フォロー済み」になる）
        if (job.stage !== 'follow') return toProfile(job)
        return fail(job, 'フォローできたか確認できません')
      }
      job.log.push('フォロー')
    }
    banner('完了：' + job.log.join('・') + '。懸賞リストに戻ります', job, false)
    await sleep(900)
    goBack(job, true)
  }

  function fail(job, why) {
    sessionStorage.removeItem(JOB_KEY)
    banner('自動で押せませんでした：' + why + '。手で押してから戻ってください', job, true)
  }

  const job = loadJob()
  if (!job) return
  if (job.stage === 'post') onPost(job)
  else if (job.stage === 'follow') onProfile(job)
})()
