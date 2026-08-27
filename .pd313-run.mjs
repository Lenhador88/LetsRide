import { chromium } from 'playwright-core'

const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const BASE = 'http://localhost:3000'
const A = { email: 'pd313-a@letsride.dev', password: 'Pd313-walk-Aa1!' }
const B = { email: 'pd313-b@letsride.dev', password: 'Pd313-walk-Aa1!' }

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
  log(`signed in: ${who.email} -> ${new URL(page.url()).pathname}`)
  return { ctx, page, errors }
}

const a = await session(A)
const b = await session(B)

// ---- 1. create a club as A (owner) ----
const clubName = `PD-313 verification club ${Date.now().toString(36)}`
await a.page.goto(`${BASE}/clubs/new`, { waitUntil: 'domcontentloaded' })
await a.page.fill('input[name="name"]', clubName)
await a.page.fill('textarea[name="description"]', 'Fixture for the Discussions->Threads rename check (PD-313).')
const pub = a.page.locator('input[name="is_public"]')
if (await pub.count()) await pub.first().check()
await a.page.click('button[type="submit"]')
await a.page.waitForURL(/\/clubs\/detail\?id=/, { timeout: 30000 })
const clubId = new URL(a.page.url()).searchParams.get('id')
log('CLUB', clubId, clubName)

// ---- 7. copy on the club screen ----
await a.page.waitForTimeout(2500)
const clubText = await a.page.locator('body').innerText()
log('COPY club screen has "Threads":', /\bThreads\b/.test(clubText))
log('COPY club screen has "Start a thread":', /Start a thread/.test(clubText))
log('COPY club screen "discussion" hits:', JSON.stringify(clubText.match(/[Dd]iscussion\w*/g) || []))

// ---- B joins the club ----
await b.page.goto(`${BASE}/clubs/detail?id=${clubId}`, { waitUntil: 'domcontentloaded' })
await b.page.waitForTimeout(2500)
const joinBtn = b.page.locator('button', { hasText: /Join club/ })
if (await joinBtn.count()) {
  await joinBtn.first().click()
  await b.page.waitForTimeout(3000)
  log('B joined club:', await b.page.locator('body').innerText().then(t => /Leave|Member|Joined/i.test(t)))
} else {
  log('B join button NOT FOUND')
}
const bText = await b.page.locator('body').innerText()
log('COPY (B, member) "discussion" hits:', JSON.stringify(bText.match(/[Dd]iscussion\w*/g) || []))

// ---- 1. create a thread as A ----
await a.page.goto(`${BASE}/clubs/detail/threads?id=${clubId}`, { waitUntil: 'domcontentloaded' })
await a.page.waitForTimeout(2000)
const listText = await a.page.locator('body').innerText()
log('COPY threads list text:', JSON.stringify(listText.slice(0, 200)))
log('COPY threads list "discussion" hits:', JSON.stringify(listText.match(/[Dd]iscussion\w*/g) || []))

await a.page.goto(`${BASE}/clubs/detail/threads/new?id=${clubId}`, { waitUntil: 'domcontentloaded' })
await a.page.waitForTimeout(1500)
const newText = await a.page.locator('body').innerText()
log('COPY new-thread screen:', JSON.stringify(newText.replace(/\s+/g, ' ').slice(0, 200)))
await a.page.fill('input[name="title"]', 'PD-313 thread one (A)')
await a.page.click('button[type="submit"]')
await a.page.waitForURL(/\/clubs\/detail\/thread\?id=/, { timeout: 30000 })
const thread1 = new URL(a.page.url()).searchParams.get('id')
log('CHECK1 created thread, redirected to', a.page.url())

// ---- 2. post a message ----
await a.page.waitForTimeout(2000)
const msgText = 'PD-313 message from A'
await a.page.fill('textarea[name="body"], input[name="body"]', msgText)
await a.page.click('button[aria-label="Send"]')
await a.page.waitForTimeout(3500)
let body = await a.page.locator('body').innerText()
log('CHECK2 message visible:', body.includes(msgText))
log('COPY thread screen "discussion" hits:', JSON.stringify(body.match(/[Dd]iscussion\w*/g) || []))

// ---- 3. delete own message (control: delete_own_club_message) ----
await a.page.click('button[aria-label="Message options"]')
await a.page.waitForTimeout(500)
await a.page.click('text=Delete message')
await a.page.waitForTimeout(3500)
body = await a.page.locator('body').innerText()
log('CHECK3 message gone after delete:', !body.includes(msgText))

// ---- 4. delete the thread as its author ----
await a.page.click('button[aria-label="Thread options"]')
await a.page.waitForTimeout(500)
await a.page.click('text=Delete thread')
await a.page.waitForTimeout(3500)
log('CHECK4 after author delete, url:', a.page.url())
const afterDelete = await a.page.locator('body').innerText()
log('CHECK4 list text:', JSON.stringify(afterDelete.replace(/\s+/g, ' ').slice(0, 160)))

// ---- 5. B creates a thread; A (owner) moderates it ----
await b.page.goto(`${BASE}/clubs/detail/threads/new?id=${clubId}`, { waitUntil: 'domcontentloaded' })
await b.page.waitForTimeout(1500)
await b.page.fill('input[name="title"]', 'PD-313 thread by B (for owner moderation)')
await b.page.click('button[type="submit"]')
await b.page.waitForURL(/\/clubs\/detail\/thread\?id=/, { timeout: 30000 })
const thread2 = new URL(b.page.url()).searchParams.get('id')
log('CHECK5 B created thread', thread2)

await a.page.goto(`${BASE}/clubs/detail/thread?id=${thread2}`, { waitUntil: 'domcontentloaded' })
await a.page.waitForTimeout(2500)
const optCount = await a.page.locator('button[aria-label="Thread options"]').count()
log('CHECK5 owner sees Thread options on B\'s thread:', optCount > 0)
if (optCount) {
  await a.page.click('button[aria-label="Thread options"]')
  await a.page.waitForTimeout(500)
  await a.page.click('text=Delete thread')
  await a.page.waitForTimeout(3500)
  const t = await a.page.locator('body').innerText()
  log('CHECK5 after moderate, url:', a.page.url())
  log('CHECK5 banner/text:', JSON.stringify(t.replace(/\s+/g, ' ').slice(0, 200)))
}

// ---- 6. unread dot ----
// A creates thread 3, posts, and has read it (it is open).
await a.page.goto(`${BASE}/clubs/detail/threads/new?id=${clubId}`, { waitUntil: 'domcontentloaded' })
await a.page.waitForTimeout(1500)
await a.page.fill('input[name="title"]', 'PD-313 unread-dot thread')
await a.page.click('button[type="submit"]')
await a.page.waitForURL(/\/clubs\/detail\/thread\?id=/, { timeout: 30000 })
const thread3 = new URL(a.page.url()).searchParams.get('id')
await a.page.waitForTimeout(3000) // let the read watermark land
log('CHECK6 thread3', thread3)

// A goes back to the list -> expect no dot
await a.page.goto(`${BASE}/clubs/detail/threads?id=${clubId}`, { waitUntil: 'domcontentloaded' })
await a.page.waitForTimeout(3000)
const dotBefore = await a.page.locator('a[aria-label*="unread messages"]').count()
log('CHECK6 dots BEFORE B posts (expect 0):', dotBefore)

// B posts in thread3
await b.page.goto(`${BASE}/clubs/detail/thread?id=${thread3}`, { waitUntil: 'domcontentloaded' })
await b.page.waitForTimeout(2500)
await b.page.fill('textarea[name="body"], input[name="body"]', 'PD-313 message from B')
await b.page.click('button[aria-label="Send"]')
await b.page.waitForTimeout(3500)
const bBody = await b.page.locator('body').innerText()
log('CHECK6 B message visible to B:', bBody.includes('PD-313 message from B'))

// A reloads the list -> expect a dot
await a.page.goto(`${BASE}/clubs/detail/threads?id=${clubId}`, { waitUntil: 'domcontentloaded' })
await a.page.waitForTimeout(3500)
const labels = await a.page.locator('a[aria-label]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))
log('CHECK6 list aria-labels AFTER B posts:', JSON.stringify(labels))
const dotAfter = await a.page.locator('a[aria-label*="unread messages"]').count()
log('CHECK6 dots AFTER B posts (expect >=1):', dotAfter)

// A opens the thread, then returns -> expect the dot cleared
await a.page.goto(`${BASE}/clubs/detail/thread?id=${thread3}`, { waitUntil: 'domcontentloaded' })
await a.page.waitForTimeout(3500)
const aBody = await a.page.locator('body').innerText()
log('CHECK6 A sees B message:', aBody.includes('PD-313 message from B'))
await a.page.goto(`${BASE}/clubs/detail/threads?id=${clubId}`, { waitUntil: 'domcontentloaded' })
await a.page.waitForTimeout(3500)
const dotCleared = await a.page.locator('a[aria-label*="unread messages"]').count()
log('CHECK6 dots AFTER A opens it (expect 0):', dotCleared)

// ---- 7. copy sweep on the club screen once populated ----
for (const [name, url] of [
  ['club', `${BASE}/clubs/detail?id=${clubId}`],
  ['threads', `${BASE}/clubs/detail/threads?id=${clubId}`],
  ['thread', `${BASE}/clubs/detail/thread?id=${thread3}`],
  ['threads/new', `${BASE}/clubs/detail/threads/new?id=${clubId}`],
]) {
  await a.page.goto(url, { waitUntil: 'domcontentloaded' })
  await a.page.waitForTimeout(2500)
  const t = await a.page.locator('body').innerText()
  log(`COPY[${name}] discussion hits:`, JSON.stringify(t.match(/[Dd]iscussion\w*/g) || []))
}

console.log('A console errors:', JSON.stringify(a.errors.filter(e => !/favicon|supabase.*upgrade/i.test(e)).slice(0, 8), null, 1))
console.log('B console errors:', JSON.stringify(b.errors.filter(e => !/favicon/i.test(e)).slice(0, 8), null, 1))
console.log('IDS', JSON.stringify({ clubId, thread1, thread2, thread3 }))

await browser.close()
