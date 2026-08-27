import { chromium } from 'playwright-core'

const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const BASE = 'http://localhost:3000'
const A = { email: 'pd313-a@letsride.dev', password: 'Pd313-walk-Aa1!' }
const B = { email: 'pd313-b@letsride.dev', password: 'Pd313-walk-Aa1!' }
const clubId = 'a6e20d9a-8f37-43a5-8f01-91be265efa04'

const browser = await chromium.launch({ executablePath: EXE })
const log = (...a) => console.log(...a)

async function session(who) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  await page.goto(`${BASE}/auth/login`, { waitUntil: 'domcontentloaded' })
  await page.fill('input[name="email"]', who.email)
  await page.fill('input[name="password"]', who.password)
  await page.click('button[type="submit"]')
  await page.waitForURL(/\/postcards/, { timeout: 30000 })
  log(`signed in: ${who.email}`)
  return { ctx, page, errors }
}

const a = await session(A)
const b = await session(B)

// ---- B joins ----
await b.page.goto(`${BASE}/clubs/detail?id=${clubId}`, { waitUntil: 'domcontentloaded' })
await b.page.waitForTimeout(3000)
let bText = await b.page.locator('body').innerText()
log('B sees "Join the club to read and start threads":', /Join the club to read and start threads/.test(bText))
const joinBtn = b.page.getByRole('button', { name: /Join Club/i })
log('B join button count:', await joinBtn.count())
if (await joinBtn.count()) {
  await joinBtn.first().click()
  await b.page.waitForTimeout(4000)
  bText = await b.page.locator('body').innerText()
  log('B is now member (sees Start a thread):', /Start a thread/.test(bText))
}

// ---- 5. B creates a thread; A (owner) moderates it ----
await b.page.goto(`${BASE}/clubs/detail/threads/new?id=${clubId}`, { waitUntil: 'domcontentloaded' })
await b.page.waitForTimeout(1500)
await b.page.fill('input[name="title"]', 'PD-313 thread by B for owner moderation')
await b.page.click('button[type="submit"]')
await b.page.waitForURL(/\/clubs\/detail\/thread\?id=/, { timeout: 30000 })
const thread2 = new URL(b.page.url()).searchParams.get('id')
log('CHECK5 B created thread', thread2)

await a.page.goto(`${BASE}/clubs/detail/thread?id=${thread2}`, { waitUntil: 'domcontentloaded' })
await a.page.waitForTimeout(3000)
const optCount = await a.page.locator('button[aria-label="Thread options"]').count()
log("CHECK5 owner sees Thread options on B's thread:", optCount > 0)
if (optCount) {
  await a.page.click('button[aria-label="Thread options"]')
  await a.page.waitForTimeout(600)
  await a.page.click('text=Delete thread')
  await a.page.waitForTimeout(4000)
  log('CHECK5 after moderate, url:', a.page.url())
  const t = await a.page.locator('body').innerText()
  log('CHECK5 screen text:', JSON.stringify(t.replace(/\s+/g, ' ').slice(0, 220)))
}

// ---- 6. unread dot ----
await a.page.goto(`${BASE}/clubs/detail/threads/new?id=${clubId}`, { waitUntil: 'domcontentloaded' })
await a.page.waitForTimeout(1500)
await a.page.fill('input[name="title"]', 'PD-313 unread-dot thread')
await a.page.click('button[type="submit"]')
await a.page.waitForURL(/\/clubs\/detail\/thread\?id=/, { timeout: 30000 })
const thread3 = new URL(a.page.url()).searchParams.get('id')
await a.page.waitForTimeout(4000)
log('CHECK6 thread3', thread3)

await a.page.goto(`${BASE}/clubs/detail/threads?id=${clubId}`, { waitUntil: 'domcontentloaded' })
await a.page.waitForTimeout(3500)
let labels = await a.page.locator('a[aria-label]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))
log('CHECK6 labels BEFORE B posts:', JSON.stringify(labels))

await b.page.goto(`${BASE}/clubs/detail/thread?id=${thread3}`, { waitUntil: 'domcontentloaded' })
await b.page.waitForTimeout(3000)
await b.page.fill('textarea[name="body"], input[name="body"]', 'PD-313 message from B')
await b.page.click('button[aria-label="Send"]')
await b.page.waitForTimeout(4000)
log('CHECK6 B message visible to B:', (await b.page.locator('body').innerText()).includes('PD-313 message from B'))

await a.page.goto(`${BASE}/clubs/detail/threads?id=${clubId}`, { waitUntil: 'domcontentloaded' })
await a.page.waitForTimeout(4000)
labels = await a.page.locator('a[aria-label]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))
log('CHECK6 labels AFTER B posts:', JSON.stringify(labels))
log('CHECK6 dots AFTER B posts:', await a.page.locator('a[aria-label*="unread messages"]').count())
// also the club screen's own section
await a.page.goto(`${BASE}/clubs/detail?id=${clubId}`, { waitUntil: 'domcontentloaded' })
await a.page.waitForTimeout(4000)
log('CHECK6 dots on club screen:', await a.page.locator('a[aria-label*="unread messages"]').count())

await a.page.goto(`${BASE}/clubs/detail/thread?id=${thread3}`, { waitUntil: 'domcontentloaded' })
await a.page.waitForTimeout(4000)
log('CHECK6 A sees B message:', (await a.page.locator('body').innerText()).includes('PD-313 message from B'))
await a.page.goto(`${BASE}/clubs/detail/threads?id=${clubId}`, { waitUntil: 'domcontentloaded' })
await a.page.waitForTimeout(4000)
labels = await a.page.locator('a[aria-label]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))
log('CHECK6 labels AFTER A opens it:', JSON.stringify(labels))
log('CHECK6 dots AFTER A opens it:', await a.page.locator('a[aria-label*="unread messages"]').count())

// ---- 7. copy sweep ----
for (const [name, url] of [
  ['club', `${BASE}/clubs/detail?id=${clubId}`],
  ['threads', `${BASE}/clubs/detail/threads?id=${clubId}`],
  ['thread', `${BASE}/clubs/detail/thread?id=${thread3}`],
  ['threads/new', `${BASE}/clubs/detail/threads/new?id=${clubId}`],
  ['clubs', `${BASE}/clubs`],
]) {
  await a.page.goto(url, { waitUntil: 'domcontentloaded' })
  await a.page.waitForTimeout(3000)
  const t = await a.page.locator('body').innerText()
  log(`COPY[${name}] discussion hits:`, JSON.stringify(t.match(/[Dd]iscussion\w*/g) || []), '| Threads:', /Threads/.test(t), '| Start a thread:', /Start a thread/.test(t))
}

console.log('A console errors:', JSON.stringify(a.errors.slice(0, 6), null, 1))
console.log('B console errors:', JSON.stringify(b.errors.slice(0, 6), null, 1))
console.log('IDS', JSON.stringify({ clubId, thread2, thread3 }))
await browser.close()
