import { chromium } from 'playwright-core'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'

const baseUrl = process.env.XYZ_RELEASE_URL ?? 'http://127.0.0.1:8787'
const teacherPassword =
  process.env.XYZ_RELEASE_PASSWORD ?? 'Release-Check-Password-2026'
const outputDir = path.resolve('artifacts')
await mkdir(outputDir, { recursive: true })

const browser = await chromium.launch({
  executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  headless: true,
})
const page = await browser.newPage({
  viewport: { width: 1366, height: 768 },
  hasTouch: true,
})
const problems = []
page.on('console', (message) => {
  if (message.type() === 'error' || message.type() === 'warning') {
    problems.push(`${message.type()}: ${message.text()}`)
  }
})
page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`))

await page.goto(baseUrl, { waitUntil: 'networkidle' })
await page.waitForSelector('.teacher-auth-screen')
await page.getByPlaceholder('输入教师密码').fill(teacherPassword)
await page.getByRole('button', { name: /登录教师工作台/ }).click()
await page.waitForSelector('.setup-screen')
await page.waitForSelector('.server-status--online')

const layout = await page.evaluate(() => ({
  vertical: document.documentElement.scrollHeight - window.innerHeight,
  horizontal: document.documentElement.scrollWidth - window.innerWidth,
}))
if (layout.vertical > 3 || layout.horizontal > 3) {
  throw new Error(`发布版主界面出现滚动：${JSON.stringify(layout)}`)
}
if (problems.length > 0) {
  throw new Error(`发布版控制台存在问题：${problems.join(' | ')}`)
}

await page.screenshot({ path: path.join(outputDir, 'release-server-1366x768.png') })

await page.getByRole('button', { name: '打开服务器运维中心' }).click()
await page.waitForSelector('.server-admin-panel')
await page.waitForSelector('.server-admin-live.is-active')
await page.waitForFunction(() => {
  const button = document.querySelector('.server-admin-backup-action > button')
  return button instanceof HTMLButtonElement && !button.disabled
})

const adminLayout = await page.evaluate(() => {
  const panel = document.querySelector('.server-admin-panel')
  if (!(panel instanceof HTMLElement)) return null
  const bounds = panel.getBoundingClientRect()
  return {
    left: bounds.left,
    top: bounds.top,
    right: bounds.right,
    bottom: bounds.bottom,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    documentHorizontal: document.documentElement.scrollWidth - window.innerWidth,
    documentVertical: document.documentElement.scrollHeight - window.innerHeight,
  }
})
if (!adminLayout) {
  throw new Error('运维中心面板没有正常显示')
}
if (
  adminLayout.left < -1 ||
  adminLayout.top < -1 ||
  adminLayout.right > adminLayout.viewportWidth + 1 ||
  adminLayout.bottom > adminLayout.viewportHeight + 1 ||
  adminLayout.documentHorizontal > 3 ||
  adminLayout.documentVertical > 3
) {
  throw new Error(`运维中心在 1366×768 下超出屏幕：${JSON.stringify(adminLayout)}`)
}

const backupRowsBefore = await page.locator('.server-admin-backup-list article').count()
const latestBackupBefore = backupRowsBefore > 0
  ? await page.locator('.server-admin-backup-list article').first().innerText()
  : ''
await page.getByRole('button', { name: /立即备份现在/ }).click()
await page.waitForSelector('.server-admin-notice')
const backupNotice = await page.locator('.server-admin-notice').innerText()
const createdBackupName = backupNotice.replace(/^已生成备份：/, '').trim()
if (!createdBackupName) {
  throw new Error(`手动备份没有返回备份名称：${backupNotice}`)
}
await page.waitForFunction(
  (name) => {
    const first = document.querySelector('.server-admin-backup-list article')
    return first instanceof HTMLElement && first.innerText.includes(name)
  },
  createdBackupName,
)
const backupRowsAfter = await page.locator('.server-admin-backup-list article').count()
const latestBackupAfter = await page.locator('.server-admin-backup-list article').first().innerText()
if (latestBackupAfter === latestBackupBefore || !latestBackupAfter.includes(createdBackupName)) {
  throw new Error(`手动备份后列表首项没有更新：${latestBackupBefore} -> ${latestBackupAfter}`)
}
if (problems.length > 0) {
  throw new Error(`发布版运维中心控制台存在问题：${problems.join(' | ')}`)
}
await page.screenshot({ path: path.join(outputDir, 'release-server-admin-1366x768.png') })

await page.goto(`${baseUrl}/practice`, { waitUntil: 'networkidle' })
await page.waitForSelector('.practice-entry-screen')
await page.waitForSelector('.practice-connection.is-online')
const practiceLayout = await page.evaluate(() => ({
  horizontal: document.documentElement.scrollWidth - window.innerWidth,
}))
if (practiceLayout.horizontal > 3) {
  throw new Error(`发布版学生练习入口出现横向溢出：${JSON.stringify(practiceLayout)}`)
}
if (problems.length > 0) {
  throw new Error(`发布版学生端控制台存在问题：${problems.join(' | ')}`)
}
await page.screenshot({ path: path.join(outputDir, 'release-practice-1366x768.png') })

console.log(JSON.stringify({
  embeddedFrontend: 'passed',
  teacherAuthentication: 'passed',
  sqliteStatus: 'online',
  serverAdmin: 'passed',
  manualBackup: `${backupRowsBefore} -> ${backupRowsAfter}`,
  classroomViewport: '1366x768',
  adminViewport: '1366x768',
  practiceRoute: 'passed',
  consoleProblems: problems,
}, null, 2))
await browser.close()
