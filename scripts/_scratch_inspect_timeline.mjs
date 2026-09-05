import { chromium } from 'playwright-core'

const EXECUTABLE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const BASE = 'http://localhost:3000'
const EMAIL = 'walk-fixture@letsride.dev'
const PASSWORD = 'WalkFixture2-2026-09-02'
const RIDE_ID = process.argv[2] || '33ce4cea-6f12-41d3-bf44-0259490f4041'
const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy

const browser = await chromium.launch({
  executablePath: EXECUTABLE,
  args: proxy
    ? [`--proxy-server=${proxy}`, '--proxy-bypass-list=localhost;127.0.0.1', '--ignore-certificate-errors']
    : [],
})
const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await context.newPage()

page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE ERROR:', m.text().slice(0, 300)) })
page.on('pageerror', (e) => console.log('PAGE ERROR:', String(e).slice(0, 300)))

await page.goto(`${BASE}/auth/login`, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('input[name="email"]')
await page.fill('input[name="email"]', EMAIL)
await page.fill('input[name="password"]', PASSWORD)
await Promise.all([
  page.waitForURL((u) => !u.pathname.startsWith('/auth/login'), { timeout: 30_000 }).catch(() => {}),
  page.click('button[type="submit"]'),
])
console.log('after sign-in, url =', page.url())

await page.goto(`${BASE}/rides/detail?id=${RIDE_ID}`, { waitUntil: 'networkidle' })
await page.waitForTimeout(3000)
console.log('detail url =', page.url())

const bodyText = await page.evaluate(() => document.body.innerText)
console.log('=== BODY TEXT ===')
console.log(bodyText)

await page.screenshot({ path: '/tmp/claude-0/-home-user-LetsRide/1fc97ed2-2635-5ec8-9668-166874ca5b69/scratchpad/ride-detail.png', fullPage: true })
console.log('screenshot saved')

await browser.close()
