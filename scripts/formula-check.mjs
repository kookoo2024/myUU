import { chromium } from 'playwright-core'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { ensureTeacherWorkspace } from './browser-auth.mjs'

const outputDir = path.resolve('artifacts')
await mkdir(outputDir, { recursive: true })

const browser = await chromium.launch({
  executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  headless: true,
})
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
const problems = []
page.on('console', (message) => {
  if (message.type() === 'error' || message.type() === 'warning') {
    problems.push(`${message.type()}: ${message.text()}`)
  }
})
page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`))

await page.goto('http://127.0.0.1:5173', { waitUntil: 'networkidle' })
await ensureTeacherWorkspace(page)
await page.locator('.player-slot--left').click()
await page.locator('.roster-name-item').nth(0).click()
await page.locator('.player-slot--right').click()
await page.locator('.roster-name-item').nth(1).click()
await page.waitForTimeout(4700)

for (let index = 0; index < 2; index += 1) {
  await page.locator('.player-lane--left .answer-option:enabled').first().click()
  await page.locator('.player-lane--right .answer-option:enabled').first().click()
  await page.waitForTimeout(800)
}

await page.waitForTimeout(250)
const formulaCount = await page.locator('.player-lane .katex').count()
const fractionCount = await page.locator('.player-lane .mfrac').count()
if (formulaCount === 0) throw new Error('数学公式没有渲染为 KaTeX')
if (fractionCount === 0) throw new Error('分数没有使用 KaTeX 的分数排版')

await page.screenshot({ path: path.join(outputDir, '10-formula-fraction.png') })
console.log(JSON.stringify({ formulaCount, fractionCount, problems }, null, 2))
await browser.close()
