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
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
  hasTouch: true,
  isMobile: true,
})
const page = await context.newPage()
const problems = []

page.on('console', (message) => {
  if (message.type() === 'error' || message.type() === 'warning') {
    problems.push(`${message.type()}: ${message.text()}`)
  }
})
page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`))

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

async function checkNoHorizontalOverflow(label) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  )
  assert(overflow <= 3, `${label} 出现横向溢出：${overflow}px`)
}

async function chooseStudent(nameIndex = 1) {
  await page.getByLabel('选择学生').selectOption({ index: nameIndex })
}

async function finishQuestions(mode) {
  let heardSpeech = false
  for (let index = 0; index < 20; index += 1) {
    if ((await page.locator('.practice-result-screen').count()) > 0) break
    const speechButton = page.locator('.practice-speech-button:not(:disabled)')
    if ((await speechButton.count()) > 0) {
      heardSpeech = true
      await speechButton.click()
      await page.waitForFunction(
        () => {
          const option = document.querySelector('.practice-option')
          return option instanceof HTMLButtonElement && !option.disabled
        },
        { timeout: 10000 },
      )
    }
    const option = page.locator('.practice-option:not(:disabled)').first()
    await option.waitFor({ state: 'visible', timeout: 8000 })
    await option.click()
    const next = page.locator('.practice-next-button:not(:disabled)')
    await next.waitFor({ state: 'visible', timeout: 5000 })
    const label = await next.innerText()
    await next.click()
    if (label.includes('完成并查看结果')) break
    if (mode === 'practice') await page.waitForTimeout(100)
  }
  await page.waitForSelector('.practice-result-screen', { timeout: 10000 })
  return heardSpeech
}

await page.goto('http://127.0.0.1:5173/practice', { waitUntil: 'networkidle' })
await page.waitForSelector('.practice-entry-screen')
await checkNoHorizontalOverflow('手机练习入口')
await page.screenshot({ path: path.join(outputDir, '12-practice-entry-390x844.png') })

await chooseStudent()
await page.locator('.practice-choice-group').first().getByRole('button').first().click()
await page.getByRole('button', { name: /开始答题/ }).click()
await page.waitForSelector('.practice-session-screen')
await checkNoHorizontalOverflow('手机练习答题页')
assert(
  (await page.locator('.practice-question-card .katex').count()) > 0,
  '手机数学练习题没有渲染 KaTeX 公式',
)
await page.screenshot({ path: path.join(outputDir, '12-practice-question-390x844.png') })
await finishQuestions('practice')
await checkNoHorizontalOverflow('手机练习结果页')
await page.screenshot({
  path: path.join(outputDir, '12-practice-result-390x844.png'),
  fullPage: true,
})

const localAttemptCount = await page.evaluate(() => {
  const saved = window.localStorage.getItem('xyz-practice-attempts-v1')
  return saved ? JSON.parse(saved).length : 0
})
assert(localAttemptCount >= 1, '练习完成后没有保存本机记录')

// English practice must include a listening question and start its timer after speech.
await page.getByRole('button', { name: '重新选择' }).click()
await page.getByRole('button', { name: /英语/ }).click()
await page.getByRole('button', { name: /开始答题/ }).click()
await page.waitForSelector('.practice-session-screen')
const englishHeardSpeech = await finishQuestions('practice')
assert(englishHeardSpeech, '英语练习没有进入听力题播放流程')

// Test mode must hide correctness until the result page and still submit normally.
await page.getByRole('button', { name: '重新选择' }).click()
await page.getByRole('button', { name: /测试/ }).click()
await page.getByRole('button', { name: /开始答题/ }).click()
await page.waitForSelector('.practice-session-screen')
await finishQuestions('test')
assert(
  (await page.locator('.practice-review-card').count()) === 1,
  '测试模式交卷后没有显示答题回看',
)

await page.setViewportSize({ width: 1366, height: 768 })
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' })
await ensureTeacherWorkspace(page)
await page.getByRole('button', { name: '练习记录' }).click()
await page.waitForSelector('.practice-records-panel')
await page.waitForTimeout(500)
assert(
  (await page.locator('.practice-record-card').count()) >= 1,
  '教师端没有读取到本机练习记录',
)
await page.screenshot({ path: path.join(outputDir, '12-practice-records-1366x768.png') })
await page.getByRole('button', { name: '关闭' }).click()

await page.goto('http://127.0.0.1:5173/practice', { waitUntil: 'networkidle' })
await page.setViewportSize({ width: 1366, height: 768 })
await page.waitForSelector('.practice-entry-screen')
await checkNoHorizontalOverflow('桌面练习入口')
await page.screenshot({ path: path.join(outputDir, '12-practice-entry-1366x768.png') })

console.log(JSON.stringify({
  mobileEntry: 'passed',
  practiceMode: 'passed',
  testMode: 'passed',
  localAttemptPersistence: 'passed',
  teacherRecords: 'passed',
  formulaRendering: 'passed',
  consoleProblems: problems,
}, null, 2))

await browser.close()
