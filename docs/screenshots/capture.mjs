#!/usr/bin/env node
// Takes the README screenshots from a running app that holds the DEMO data (see seed_demo.py and README.md in this
// folder). It drives a headless Chrome over its debugging protocol, so it needs Node 22+ and Chrome, and no npm packages.
//
//   DEMO_PASSWORD=... node docs/screenshots/capture.mjs
//
// Each page is shot in both themes at the same size, with the theme set explicitly in localStorage (not left to the
// system preference). It refuses to run unless the account it logs in as is demo@example.com, so it cannot photograph
// anyone's real data by being pointed at the wrong server.
//
// Settings (environment): ONLY (comma-separated shot names to redo, e.g. dashboard,offers), API_URL (default http://localhost:8000), APP_URL (http://localhost:5173), CHROME (path to the
// Chrome binary), DEMO_EMAIL (demo@example.com), LANDING_BOTH=1 (also shoot the landing page in dark, to compare).

import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const API = process.env.API_URL ?? 'http://localhost:8000'
const APP = process.env.APP_URL ?? 'http://localhost:5173'
const EMAIL = process.env.DEMO_EMAIL ?? 'demo@example.com'
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const OUT = dirname(fileURLToPath(import.meta.url))

const WIDTH = 1280 // CSS pixels; the picture is WIDTH x SCALE wide
const SCALE = 1.5
// The Kanban board is a strip of nine columns that scrolls sideways. This width ends the picture exactly after the sixth
// full column (at 1280 the sixth is cut in half, and at 1440 the seventh is), so no card is clipped at the edge.
const BOARD_WIDTH = 1340

const password = process.env.DEMO_PASSWORD
if (!password) {
  console.error('Set DEMO_PASSWORD to the demo account password (the one used with seed_demo.py).')
  process.exit(1)
}
if (!existsSync(CHROME)) {
  console.error(`Chrome not found at ${CHROME}. Set CHROME to its path.`)
  process.exit(1)
}

// --- the demo account's login token ---------------------------------------------------------------------------------

async function demoToken() {
  const login = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password }) })
  if (!login.ok) throw new Error(`Could not log in to ${API} as ${EMAIL} (${login.status}). Is the demo backend running, and is DEMO_PASSWORD right?`)
  const { access_token: token } = await login.json()
  const me = await (await fetch(`${API}/auth/me`, { headers: { authorization: `Bearer ${token}` } })).json()
  if (me.email !== 'demo@example.com') throw new Error(`Refusing to shoot: ${API} says this is ${me.email}, not the demo account.`)
  return token
}

// --- a very small Chrome DevTools Protocol client --------------------------------------------------------------------

async function startChrome() {
  const profile = mkdtempSync(join(tmpdir(), 'joblogga-shots-'))
  const chrome = spawn(
    CHROME,
    ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', '--force-color-profile=srgb', '--font-render-hinting=none'],
    { stdio: 'ignore' },
  )
  const portFile = join(profile, 'DevToolsActivePort')
  for (let i = 0; i < 300 && !existsSync(portFile); i++) await sleep(100) // a cold start can take a while
  if (!existsSync(portFile)) throw new Error('Chrome did not start.')
  const [port, path] = readFileSync(portFile, 'utf8').trim().split('\n')
  const socket = new WebSocket(`ws://127.0.0.1:${port}${path}`)
  await new Promise((resolve, reject) => ((socket.onopen = resolve), (socket.onerror = reject)))

  let next = 0
  const pending = new Map()
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data)
    const waiting = pending.get(message.id)
    if (!waiting) return
    pending.delete(message.id)
    message.error ? waiting.reject(new Error(`${waiting.method}: ${message.error.message}`)) : waiting.resolve(message.result)
  }
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = ++next
      pending.set(id, { resolve, reject, method })
      socket.send(JSON.stringify({ id, method, params, sessionId }))
    })
  const close = async () => {
    socket.close()
    const exited = new Promise((resolve) => chrome.once('exit', resolve))
    chrome.kill()
    await exited
    try {
      rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    } catch {
      // A temporary folder left behind is not worth failing a run for.
    }
  }
  return { send, close }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// --- the shots ----------------------------------------------------------------------------------------------------------

const noLoading = `!document.body.innerText.includes('Loading')`
const SHOTS = [
  {
    name: 'applications-list',
    path: '/applications',
    height: 1180, // the top of the page, not all of it
    ready: `${noLoading} && document.querySelectorAll('main a[href^="/applications/"]').length > 10 && !!document.querySelector('[role=status], section')`,
  },
  {
    name: 'kanban-board',
    path: '/applications?view=board',
    width: BOARD_WIDTH,
    height: 1100,
    ready: `${noLoading} && document.querySelectorAll('main a[href^="/applications/"]').length > 10`,
  },
  {
    name: 'dashboard',
    path: '/dashboard',
    fullPage: true,
    ready: `${noLoading} && !!document.querySelector('[role=progressbar]') && document.querySelectorAll('.recharts-bar-rectangle').length >= 6`,
    // The resume card is shown as its table, which is where a version with too few applications is labelled "too few to judge".
    prepare: `(() => {
      const card = [...document.querySelectorAll('section')].find((s) => s.querySelector('h2')?.textContent === 'Response rate by resume version')
      const button = [...card.querySelectorAll('button')].find((b) => b.textContent === 'View as table')
      button.click()
    })()`,
    readyAfterPrepare: `document.body.innerText.includes('too few to judge')`,
  },
  {
    name: 'offers',
    path: '/offers',
    fullPage: true,
    ready: `${noLoading} && document.body.innerText.includes('Offer recorded') && document.body.innerText.includes('Brightwater Labs')`,
  },
]

// The landing page is shot to just below its sample ledger: the hero and the login, not the text under them.
const LANDING = { name: 'landing', path: '/', loggedOut: true, height: 1050, ready: `!!document.querySelector('form') && document.body.innerText.includes('A logbook for your job search')` }

async function until(send, sessionId, expression, what) {
  for (let i = 0; i < 200; i++) {
    const { result } = await send('Runtime.evaluate', { expression, returnByValue: true }, sessionId)
    if (result.value) return
    await sleep(150)
  }
  const { result } = await send('Runtime.evaluate', { expression: `location.href + '\\n' + document.body.innerText.slice(0, 400)`, returnByValue: true }, sessionId)
  throw new Error(`Timed out waiting for ${what}. The page was showing:\n${result.value}`)
}

async function shoot(chrome, token, shot, theme, file) {
  const { send } = chrome
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  const to = (method, params) => send(method, params, sessionId)
  const size = (height) => to('Emulation.setDeviceMetricsOverride', { width: shot.width ?? WIDTH, height, deviceScaleFactor: SCALE, mobile: false })

  await size(shot.height ?? 900)
  await to('Page.enable')
  // Runs before the page's own scripts, including the one in index.html that reads the theme.
  const seed = `try { localStorage.setItem('joblogga-theme', ${JSON.stringify(theme)}); ${shot.loggedOut ? `localStorage.removeItem('joblogga_token');` : `localStorage.setItem('joblogga_token', ${JSON.stringify(token)});`} } catch (e) {}`
  await to('Page.addScriptToEvaluateOnNewDocument', { source: seed })
  await to('Page.navigate', { url: `${APP}${shot.path}` })

  await until(send, sessionId, shot.ready, `${shot.name} to load`)
  if (shot.prepare) {
    await to('Runtime.evaluate', { expression: shot.prepare })
    await until(send, sessionId, shot.readyAfterPrepare, `${shot.name} to settle`)
  }
  // No transitions, animation or blinking caret in the picture; wait for the fonts.
  await to('Runtime.evaluate', { expression: `(() => { const s = document.createElement('style'); s.textContent = '*,*::before,*::after{transition:none!important;animation:none!important;caret-color:transparent!important}'; document.head.append(s); document.activeElement?.blur?.() })()` })
  await to('Runtime.evaluate', { expression: 'document.fonts.ready.then(() => true)', awaitPromise: true })

  const check = await to('Runtime.evaluate', { expression: `document.documentElement.classList.contains('dark')`, returnByValue: true })
  if (check.result.value !== (theme === 'dark')) throw new Error(`${shot.name}: the page is not in the ${theme} theme`)

  if (shot.fullPage) {
    const { result } = await to('Runtime.evaluate', { expression: 'Math.ceil(document.documentElement.scrollHeight)', returnByValue: true })
    await size(result.value)
    await sleep(600) // the charts re-measure at the new height
  }
  await sleep(400)
  const { data } = await to('Page.captureScreenshot', { format: 'png', fromSurface: true })
  writeFileSync(join(OUT, file), Buffer.from(data, 'base64'))
  await send('Target.closeTarget', { targetId })
  console.log(`wrote ${file}`)
}

const only = process.env.ONLY?.split(',') // e.g. ONLY=dashboard,offers to redo just those
const token = await demoToken()
const chrome = await startChrome()
try {
  const wanted = (shot) => !only || only.includes(shot.name)
  for (const theme of ['light', 'dark']) for (const shot of SHOTS.filter(wanted)) await shoot(chrome, token, shot, theme, `${shot.name}-${theme}.png`)
  if (wanted(LANDING)) await shoot(chrome, token, LANDING, 'light', 'landing.png')
  if (process.env.LANDING_BOTH) await shoot(chrome, token, LANDING, 'dark', 'landing-dark.png')
} finally {
  await chrome.close()
}
