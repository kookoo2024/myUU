import { chromium } from 'playwright-core'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const root = process.cwd()
const tempDir = await mkdtemp(path.join(tmpdir(), 'xyz-sync-'))
const executable = path.join(tempDir, 'xyz-test-server.exe')
const dataDir = path.join(tempDir, 'data')
const teacherPassword = 'Sync-Test-Password-2026'

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

const run = (command, args) => new Promise((resolve, reject) => {
  const child = spawn(command, args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  child.on('error', reject)
  child.on('exit', (code) => {
    if (code === 0) resolve()
    else reject(new Error(`${command} 退出码 ${code}`))
  })
})

async function waitForHealth(url, timeoutMs = 15000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('临时服务端未能在规定时间内启动')
}

async function loginTeacherApi() {
  const response = await fetch('http://127.0.0.1:8787/api/auth/login', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ password: teacherPassword }),
  })
  assert(response.ok, `API 教师登录失败：${response.status}`)
  const setCookie = response.headers.getSetCookie?.()[0] ??
    response.headers.get('set-cookie')
  assert(setCookie, 'API 教师登录没有返回会话 Cookie')
  return setCookie.split(';')[0]
}

async function loginTeacherPage(page) {
  await page.waitForSelector('.teacher-auth-screen')
  await page.getByPlaceholder('输入教师密码').fill(teacherPassword)
  await page.getByRole('button', { name: /登录教师工作台/ }).click()
  await page.waitForSelector('.setup-screen')
  await page.waitForSelector('.server-status--online')
}

await run('go', ['build', '-o', executable, './server'])
const server = spawn(executable, [], {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    XYZ_ADDR: '127.0.0.1:8787',
    XYZ_DATA_DIR: dataDir,
    XYZ_ADMIN_PASSWORD: teacherPassword,
  },
})

let browser
try {
  await waitForHealth('http://127.0.0.1:8787/api/health')
  const teacherCookie = await loginTeacherApi()
  browser = await chromium.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: true,
  })

  const context = await browser.newContext({
    viewport: { width: 1366, height: 768 },
    hasTouch: true,
  })
  const page = await context.newPage()
  await page.goto('http://127.0.0.1:5173', { waitUntil: 'networkidle' })
  await loginTeacherPage(page)

  await page.getByRole('button', { name: '班级工作区' }).click()
  await page.getByLabel('班级名称').fill('SQLite 同步测试班')
  await page.getByLabel('全班名单').fill('江屿\n欧阳子墨\n上官若溪')
  await page.getByRole('button', { name: '保存工作区' }).click()

  await page.getByRole('button', { name: '班级工作区' }).click()
  await page.getByRole('button', { name: '+ 新增' }).click()
  await page.getByLabel('班级名称').fill('SQLite 同步二班')
  await page.getByLabel('全班名单').fill('顾星河\n司马云舟')
  await page.getByRole('button', { name: '保存工作区' }).click()

  await page.getByRole('button', { name: '题库工作台' }).click()
  await page.getByRole('button', { name: /新增题目/ }).click()
  await page.getByLabel('知识点').fill('服务端同步测试')
  await page.getByLabel('题干').fill(String.raw`已知 $\frac{1}{2}+\frac{1}{2}=$`)
  await page.getByLabel('选项 A 内容').fill('$0$')
  await page.getByLabel('选项 B 内容').fill('$1$')
  await page.getByLabel('选项 C 内容').fill('$2$')
  await page.getByLabel('选项 D 内容').fill('$3$')
  await page.getByLabel('选项 B 为正确答案').check()
  await page.getByRole('button', { name: '保存题目' }).click()
  await page.waitForTimeout(700)

  const bootstrap = await fetch('http://127.0.0.1:8787/api/bootstrap', {
    headers: { Cookie: teacherCookie },
  }).then((response) => response.json())
  assert(bootstrap.hasData, '服务端没有收到同步数据')
  assert(bootstrap.classroom?.name === 'SQLite 同步二班', '当前班级没有写入 SQLite')
  assert(
    bootstrap.classroomDirectory?.classrooms?.length === 2 &&
      bootstrap.classroomDirectory?.activeClassId === bootstrap.classroom?.id,
    '多班级工作区没有正确写入 SQLite',
  )
  assert(bootstrap.questions?.length === 1, '自建题没有写入 SQLite')
  assert(
    bootstrap.packDrafts?.math?.questionIds?.length === 1,
    '题包草稿没有写入 SQLite',
  )

  const freshContext = await browser.newContext({
    viewport: { width: 1366, height: 768 },
    hasTouch: true,
  })
  const freshPage = await freshContext.newPage()
  await freshPage.goto('http://127.0.0.1:5173', { waitUntil: 'networkidle' })
  await loginTeacherPage(freshPage)
  assert(
    (await freshPage.locator('.lesson-context').innerText()).includes('SQLite 同步二班'),
    '新的浏览器缓存没有从 SQLite 恢复当前班级',
  )
  await freshPage.locator('.lesson-context-button').click()
  assert(
    (await freshPage.locator('.class-quick-grid > button').count()) === 2,
    '新的浏览器缓存没有从 SQLite 恢复全部班级',
  )
  await freshPage.keyboard.press('Escape')
  await freshPage.getByRole('button', { name: '题库工作台' }).click()
  assert(
    (await freshPage.locator('.bank-question-card.is-local').count()) === 1,
    '新的浏览器缓存没有从 SQLite 恢复自建题',
  )

  await freshPage.setViewportSize({ width: 390, height: 844 })
  await freshPage.goto('http://127.0.0.1:5173/practice', { waitUntil: 'networkidle' })
  await freshPage.waitForSelector('.practice-entry-screen')
  await freshPage.getByLabel('选择学生').selectOption({ index: 1 })
  await freshPage.locator('.practice-choice-group').first().getByRole('button').first().click()
  await freshPage.getByRole('button', { name: /开始答题/ }).click()
  await freshPage.waitForSelector('.practice-session-screen')
  for (let index = 0; index < 4; index += 1) {
    await freshPage.locator('.practice-option:not(:disabled)').first().click()
    await freshPage.locator('.practice-next-button:not(:disabled)').click()
  }
  await freshPage.waitForSelector('.practice-result-screen', { timeout: 10000 })
  await freshPage.waitForTimeout(600)

  const practiceAttempts = await fetch(
    `http://127.0.0.1:8787/api/practice-attempts?classId=${encodeURIComponent(bootstrap.classroom.id)}`,
    { headers: { Cookie: teacherCookie } },
  ).then((response) => response.json())
  assert(practiceAttempts.length === 1, '手机练习成绩没有写入 SQLite')
  assert(
    practiceAttempts[0].studentName === '顾星河' && practiceAttempts[0].questionCount === 4,
    'SQLite 中的练习记录内容不正确',
  )

  // A failed POST stays queued, appears in teacher records, then catches up.
  let blockPracticeSubmit = true
  await freshPage.route('**/api/practice-attempts', async (route) => {
    if (blockPracticeSubmit && route.request().method() === 'POST') {
      await route.abort('failed')
      return
    }
    await route.continue()
  })
  await freshPage.goto('http://127.0.0.1:5173/practice', { waitUntil: 'networkidle' })
  await freshPage.waitForSelector('.practice-entry-screen')
  await freshPage.getByLabel('选择学生').selectOption({ index: 2 })
  await freshPage.locator('.practice-choice-group').first().getByRole('button').first().click()
  await freshPage.getByRole('button', { name: /开始答题/ }).click()
  await freshPage.waitForSelector('.practice-session-screen')
  for (let index = 0; index < 4; index += 1) {
    await freshPage.locator('.practice-option:not(:disabled)').first().click()
    await freshPage.locator('.practice-next-button:not(:disabled)').click()
  }
  await freshPage.waitForSelector('.practice-result-screen', { timeout: 10000 })
  await freshPage.waitForTimeout(300)

  const offlineQueue = await freshPage.evaluate(() => {
    const attempts = JSON.parse(
      window.localStorage.getItem('xyz-practice-attempts-v1') ?? '[]',
    )
    const synced = new Set(
      JSON.parse(window.localStorage.getItem('xyz-practice-attempt-sync-v1') ?? '[]'),
    )
    return attempts.filter((attempt) => !synced.has(attempt.id)).length
  })
  assert(offlineQueue === 1, '提交失败后没有把成绩加入待补交队列')

  await freshPage.setViewportSize({ width: 1366, height: 768 })
  await freshPage.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' })
  await freshPage.waitForSelector('.setup-screen')
  await freshPage.getByRole('button', { name: '练习记录' }).click()
  await freshPage.waitForSelector('.practice-record-card')
  assert(
    (await freshPage.locator('.practice-record-card').count()) === 2,
    '教师端没有合并 SQLite 与待补交成绩',
  )
  assert(
    (await freshPage.locator('.practice-records-source').innerText()).includes('待补交'),
    '教师端没有标明待补交成绩',
  )

  blockPracticeSubmit = false
  await freshPage.evaluate(() => {
    window.dispatchEvent(new Event('online'))
  })
  await freshPage.waitForFunction(() => {
    const source = document.querySelector('.practice-records-source')?.textContent ?? ''
    return (
      document.querySelectorAll('.practice-record-card').length === 2 &&
      source.includes('SQLite') &&
      !source.includes('待补交')
    )
  })
  assert(
    (await freshPage.locator('.practice-record-card').count()) === 2,
    '成绩补交后教师端记录数量不正确',
  )
  assert(
    (await freshPage.locator('.practice-records-source').innerText()).includes('SQLite'),
    '成绩补交后教师端没有回到 SQLite 实时记录',
  )
  const catchesUpAttempts = await fetch(
    `http://127.0.0.1:8787/api/practice-attempts?classId=${encodeURIComponent(bootstrap.classroom.id)}`,
    { headers: { Cookie: teacherCookie } },
  ).then((response) => response.json())
  assert(catchesUpAttempts.length === 2, '自动补交后 SQLite 记录数量不正确')

  console.log(JSON.stringify({
    serverApi: 'passed',
    classroomDirectorySync: 'passed',
    questionSync: 'passed',
    packDraftSync: 'passed',
    freshCacheHydration: 'passed',
    practiceAttemptSync: 'passed',
    offlineAttemptQueue: 'passed',
    teacherRecordMerge: 'passed',
    offlineAttemptCatchUp: 'passed',
  }, null, 2))
} finally {
  await browser?.close()
  server.kill()
  await Promise.race([
    new Promise((resolve) => server.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ])
  await rm(tempDir, { recursive: true, force: true, maxRetries: 6, retryDelay: 250 })
}
