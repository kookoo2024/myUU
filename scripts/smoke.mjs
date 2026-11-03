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
  viewport: { width: 1920, height: 1080 },
  hasTouch: true,
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

await page.goto('http://127.0.0.1:5173', { waitUntil: 'networkidle' })
await ensureTeacherWorkspace(page)

// Verify classroom edits survive a reload and are reflected on the setup screen.
await page.getByRole('button', { name: '班级工作区' }).click()
await page.getByLabel('班级名称').fill('高二（7）班 · 自动化测试')
await page.getByLabel('全班名单').fill(
  ['01 周知远', '02 林清和', '03 欧阳子墨', '04 上官若溪'].join('\n'),
)
await page.getByRole('button', { name: '保存工作区' }).click()
assert(
  (await page.locator('.lesson-context').innerText()).includes('高二（7）班 · 自动化测试'),
  '保存班级工作区后，主界面班级名称没有更新',
)
assert(
  (await page.locator('.class-count strong').innerText()) === '4',
  '保存班级工作区后，主界面人数没有更新',
)
await page.reload({ waitUntil: 'networkidle' })
assert(
  (await page.locator('.lesson-context').innerText()).includes('高二（7）班 · 自动化测试'),
  '刷新页面后，班级名称没有持久化',
)
assert(
  (await page.locator('.class-count strong').innerText()) === '4',
  '刷新页面后，班级人数没有持久化',
)

// Add a second class and verify the quick switcher isolates both rosters.
await page.getByRole('button', { name: '班级工作区' }).click()
await page.getByRole('button', { name: '+ 新增' }).click()
await page.getByLabel('班级名称').fill('高一（1）班 · 自动化测试')
await page.getByLabel('全班名单').fill('顾星河\n欧阳子墨\n司马云舟')
await page.getByRole('button', { name: '保存工作区' }).click()
assert(
  (await page.locator('.lesson-context').innerText()).includes('高一（1）班 · 自动化测试'),
  '新增班级后没有自动切换为当前班级',
)
await page.locator('.lesson-context-button').click()
assert(
  (await page.locator('.class-quick-grid > button').count()) === 2,
  '快速班级菜单没有显示全部班级',
)
await page.getByRole('menuitem', { name: /高二（7）班 · 自动化测试/ }).click()
assert(
  (await page.locator('.class-count strong').innerText()) === '4',
  '快速切换班级后，名单人数没有恢复为原班级',
)
await page.locator('.lesson-context-button').click()
await page.getByRole('menuitem', { name: /高一（1）班 · 自动化测试/ }).click()
assert(
  (await page.locator('.class-count strong').innerText()) === '3',
  '再次切换班级后，名单人数没有恢复为原班级',
)
await page.reload({ waitUntil: 'networkidle' })
assert(
  (await page.locator('.lesson-context').innerText()).includes('高一（1）班 · 自动化测试'),
  '刷新页面后，当前班级选择没有持久化',
)

await page.getByRole('button', { name: '班级工作区' }).click()
await page.getByRole('button', { name: '填入示例' }).click()
await page.getByRole('button', { name: '保存工作区' }).click()

// Build a custom pack, apply it to the match setup, and restore the official pack.
await page.getByRole('button', { name: '题库工作台' }).click()
await page.getByRole('button', { name: /新增题目/ }).click()
await page.getByLabel('知识点').fill('函数录入测试')
await page.getByLabel('题干').fill(
  String.raw`已知 $f(x)=\frac{x^2+1}{x-1}$，则 $f(2)$ 的值为`,
)
await page.getByLabel('选项 A 内容').fill(String.raw`$5$`)
await page.getByLabel('选项 B 内容').fill(String.raw`$3$`)
await page.getByLabel('选项 C 内容').fill(String.raw`$\frac{5}{2}$`)
await page.getByLabel('选项 D 内容').fill(String.raw`$1$`)
await page.getByLabel('选项 B 为正确答案').check()
await page.getByRole('button', { name: '保存题目' }).click()
assert(
  (await page.locator('.bank-question-card.is-local').count()) === 1,
  '新增题目后没有生成“我的题”卡片',
)
assert(
  (await page.locator('.bank-question-card.is-local .katex').count()) > 0,
  '新增题目中的公式没有使用 KaTeX 渲染',
)

await page.getByRole('button', { name: '编辑题目：函数录入测试' }).click()
await page.getByLabel('题干').fill(
  String.raw`【已修改】已知 $f(x)=\frac{x^2+1}{x-1}$，则 $f(2)$ 的值为`,
)
await page.getByRole('button', { name: '保存修改' }).click()
assert(
  (await page.locator('.bank-question-card.is-local').innerText()).includes('【已修改】'),
  '编辑题目后主题库没有更新',
)

await page.locator('.bank-question-card:not(.is-local)').first().click()
await page.getByLabel('题包名称').fill('自动化数学题包')
await page.waitForTimeout(120)
await page.getByRole('button', { name: '应用到本场' }).click()
assert(
  (await page.locator('.pack-summary h2').innerText()) === '自动化数学题包',
  '自选题包没有应用到主界面',
)
assert(
  (await page.locator('.pack-license').innerText()) === '自选题包',
  '主界面没有标记自选题包状态',
)
await page.reload({ waitUntil: 'networkidle' })
assert(
  (await page.locator('.pack-summary h2').innerText()) === '自动化数学题包',
  '刷新页面后，自选题包没有持久化',
)
await page.locator('.player-slot--left').click()
await page.locator('.roster-name-item').nth(0).click()
await page.locator('.player-slot--right').click()
await page.locator('.roster-name-item').nth(1).click()
await page.waitForSelector('.duel-stage', { timeout: 10000 })
assert(
  (await page.locator('.player-lane--left .question-panel').innerText()).includes('【已修改】'),
  '自建题没有进入实际课堂比赛',
)
for (let index = 0; index < 2; index += 1) {
  await page.locator('.player-lane--left .answer-option:enabled').first().click()
  await page.locator('.player-lane--right .answer-option:enabled').first().click()
  await page.waitForTimeout(760)
}
await page.waitForSelector('.result-screen', { timeout: 5000 })
await page.getByRole('button', { name: '返回准备' }).click()

await page.getByRole('button', { name: '题库工作台' }).click()
assert(
  (await page.getByLabel('题包名称').inputValue()) === '自动化数学题包',
  '重新打开题库后，题包名称没有自动保留',
)
assert(
  (await page.locator('.bank-question-card.is-selected').count()) === 2,
  '重新打开题库后，已选题目没有自动保留',
)

await page.getByRole('button', { name: '批量导入' }).click()
await page.getByLabel('批量导入内容').fill(
  [
    String.raw`化简 $\frac{2}{4}$ 的结果是`,
    String.raw`$\frac{1}{2}$`,
    '$2$',
    '$4$',
    '$0$',
    'A',
    '分数化简',
    '基础',
  ].join(' | '),
)
await page.getByRole('button', { name: '导入 1 道题' }).click()
assert(
  (await page.locator('.bank-question-card.is-local').count()) === 2,
  '批量导入后没有增加自建题',
)

for (let index = 0; index < 2; index += 1) {
  await page.getByRole('button', { name: /删除题目/ }).first().click()
  await page.getByRole('button', { name: '确认删除' }).click()
}
assert(
  (await page.locator('.bank-question-card.is-local').count()) === 0,
  '删除自建题失败',
)
await page.getByRole('button', { name: '关闭' }).click()
await page.getByRole('button', { name: '恢复官方' }).click()
assert(
  (await page.locator('.pack-summary h2').innerText()) === '数学课前热身',
  '恢复官方题包失败',
)

// Verify that two independent simultaneous touch points are observed.
await page.getByRole('button', { name: '触控 / 声音自检' }).click()
const leftBox = await page.locator('.touch-target--left').boundingBox()
const rightBox = await page.locator('.touch-target--right').boundingBox()
assert(leftBox && rightBox, '触控测试区域未渲染')

const cdp = await context.newCDPSession(page)
await cdp.send('Input.dispatchTouchEvent', {
  type: 'touchStart',
  touchPoints: [
    { x: leftBox.x + leftBox.width / 2, y: leftBox.y + leftBox.height / 2, id: 11 },
    { x: rightBox.x + rightBox.width / 2, y: rightBox.y + rightBox.height / 2, id: 12 },
  ],
})
await page.waitForTimeout(250)
const touchResult = await page.locator('.touch-result strong').innerText()
assert(touchResult.includes('通过'), `双点触控未通过，实际状态：${touchResult}`)
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })

const speechButton = page.getByRole('button', { name: /试读/ })
await speechButton.click()
await page.waitForTimeout(2200)
assert((await page.locator('.speech-check em').count()) === 0, '浏览器语音试读失败')
await page.getByRole('button', { name: '返回赛场' }).click()

// Start a short English match.
await page.locator('.subject-switcher button').nth(0).click()
await page.locator('.segment-group').nth(0).getByRole('button', { name: /4/ }).click()
await page.locator('.player-slot--left').click()
await page.locator('.roster-name-item').nth(0).click()
await page.locator('.player-slot--right').click()
await page.locator('.roster-name-item').nth(1).click()
await page.waitForTimeout(4700)

await page.locator('.player-lane--left .answer-option:enabled').first().click()
await page.locator('.player-lane--right .answer-option:enabled').first().click()
await page.waitForTimeout(900)
await page.waitForFunction(
  () => {
    const timer = document.querySelector('.player-lane--left .timer-inner strong')?.textContent
    return Number(timer) > 0
  },
  { timeout: 7000 },
)

const leftTimer = await page.locator('.player-lane--left .timer-inner strong').innerText()
const rightTimer = await page.locator('.player-lane--right .timer-inner strong').innerText()
assert(Number(leftTimer) > 0 && Number(rightTimer) > 0, '听力结束后双方计时未启动')
await page.screenshot({ path: path.join(outputDir, '07-audio-ready.png') })

// Finish the remaining questions.
for (let index = 0; index < 6; index += 1) {
  const leftAnswer = page.locator('.player-lane--left .answer-option:enabled').first()
  const rightAnswer = page.locator('.player-lane--right .answer-option:enabled').first()
  if ((await leftAnswer.count()) > 0) await leftAnswer.click()
  if ((await rightAnswer.count()) > 0) await rightAnswer.click()
  await page.waitForTimeout(780)
  if ((await page.locator('.result-screen').count()) > 0) break
}
await page.waitForTimeout(1100)
assert((await page.locator('.result-screen').count()) === 1, '完整比赛后没有进入结果页')
await page.screenshot({ path: path.join(outputDir, '08-english-result.png') })

// Verify the compact duel stage fits a common classroom touchscreen.
await page.setViewportSize({ width: 1366, height: 768 })
await page.goto('http://127.0.0.1:5173', { waitUntil: 'networkidle' })
await page.locator('.player-slot--left').click()
const drawerFit = await page.evaluate(() => {
  const drawer = document.querySelector('.roster-drawer')
  const menu = document.querySelector('.class-roster-menu')
  return {
    vertical: document.documentElement.scrollHeight - window.innerHeight,
    horizontal: document.documentElement.scrollWidth - window.innerWidth,
    drawer: drawer ? drawer.scrollHeight - drawer.clientHeight : Number.POSITIVE_INFINITY,
    menu: menu ? menu.scrollHeight - menu.clientHeight : Number.POSITIVE_INFINITY,
  }
})
assert(
  drawerFit.vertical <= 3 &&
    drawerFit.horizontal <= 3 &&
    drawerFit.drawer <= 3 &&
    drawerFit.menu <= 3,
  `1366x768 名单下拉菜单发生裁切：${JSON.stringify(drawerFit)}`,
)
await page.screenshot({ path: path.join(outputDir, '09-roster-1366x768.png') })
await page.locator('.roster-name-item').nth(0).click()
await page.locator('.player-slot--right').click()
await page.locator('.roster-name-item').nth(1).click()
await page.waitForSelector('.duel-stage', { timeout: 10000 })
await page.waitForTimeout(350)
const duelFit = await page.evaluate(() => {
  const lanes = [...document.querySelectorAll('.player-lane')].map((lane) => ({
    vertical: lane.scrollHeight - lane.clientHeight,
  }))
  return {
    vertical: document.documentElement.scrollHeight - window.innerHeight,
    horizontal: document.documentElement.scrollWidth - window.innerWidth,
    lanes,
  }
})
assert(
  duelFit.vertical <= 3 &&
    duelFit.horizontal <= 3 &&
    duelFit.lanes.every((lane) => lane.vertical <= 3),
  `1366x768 PK 界面发生裁切：${JSON.stringify(duelFit)}`,
)
await page.screenshot({ path: path.join(outputDir, '09-duel-1366x768.png') })

// Stress the dense layout: long prompt + image + four long options.
for (let index = 0; index < 3; index += 1) {
  await page.locator('.player-lane--left .answer-option:enabled').first().click()
  await page.locator('.player-lane--right .answer-option:enabled').first().click()
  await page.waitForTimeout(760)
}
const stressLayout = await page.evaluate(() => {
  const panels = [...document.querySelectorAll('.question-panel')]
  const options = [...document.querySelectorAll('.answer-option')]
  return {
    question: panels[0]?.getAttribute('data-question'),
    denseLanes: [...document.querySelectorAll('.player-lane.is-dense')].length,
    contentClipping: panels.map((panel) => {
      const content = panel.querySelector('.question-content')
      if (!content) return Number.POSITIVE_INFINITY
      const panelRect = panel.getBoundingClientRect()
      const contentRect = content.getBoundingClientRect()
      const style = getComputedStyle(panel)
      const paddingTop = Number.parseFloat(style.paddingTop)
      const paddingBottom = Number.parseFloat(style.paddingBottom)
      return Math.max(
        0,
        panelRect.top + paddingTop - contentRect.top,
        contentRect.bottom - (panelRect.bottom - paddingBottom),
      )
    }),
    optionClipping: options.map((option) => {
      const text = option.querySelector('.option-text')
      const letter = option.querySelector('.option-letter')
      if (!text || !letter) return Number.POSITIVE_INFINITY
      const optionRect = option.getBoundingClientRect()
      const textRect = text.getBoundingClientRect()
      const letterRect = letter.getBoundingClientRect()
      const style = getComputedStyle(option)
      const paddingTop = Number.parseFloat(style.paddingTop)
      const paddingBottom = Number.parseFloat(style.paddingBottom)
      return Math.max(
        0,
        optionRect.top + paddingTop - Math.min(textRect.top, letterRect.top),
        Math.max(textRect.bottom, letterRect.bottom) - (optionRect.bottom - paddingBottom),
      )
    }),
    documentVertical: document.documentElement.scrollHeight - window.innerHeight,
    documentHorizontal: document.documentElement.scrollWidth - window.innerWidth,
  }
})
assert(stressLayout.question === 'Q4', `未进入排版压力测试题：${stressLayout.question}`)
assert(stressLayout.denseLanes === 2, '长题干、图片、长选项未启用双栏高密度布局')
assert(
  stressLayout.documentVertical <= 3 &&
    stressLayout.documentHorizontal <= 3 &&
    stressLayout.contentClipping.every((value) => value <= 3) &&
    stressLayout.optionClipping.every((value) => value <= 3),
  `极限排版发生裁切：${JSON.stringify(stressLayout)}`,
)
await page.screenshot({ path: path.join(outputDir, '10-stress-layout-1366x768.png') })

// Check common classroom resolutions for horizontal overflow.
for (const viewport of [
  { width: 1366, height: 768, name: '1366x768' },
  { width: 390, height: 844, name: '390x844' },
  { width: 3840, height: 2160, name: '3840x2160' },
]) {
  await page.goto('http://127.0.0.1:5173', { waitUntil: 'networkidle' })
  await page.setViewportSize({ width: viewport.width, height: viewport.height })
  await page.waitForTimeout(300)
  const overflow = await page.evaluate(() => ({
    horizontal: document.documentElement.scrollWidth > window.innerWidth + 2,
    vertical: document.documentElement.scrollHeight > window.innerHeight + 2,
  }))
  assert(!overflow.horizontal, `${viewport.name} 出现横向溢出`)
  if (viewport.width >= 1101) {
    assert(!overflow.vertical, `${viewport.name} 主界面出现纵向滚动`)
    const clipping = await page.evaluate(() => {
      const check = (selector) => {
        const element = document.querySelector(selector)
        return element ? element.scrollHeight - element.clientHeight : Number.POSITIVE_INFINITY
      }
      return {
        setup: check('.setup-screen'),
        roster: check('.selection-showcase'),
        config: check('.match-config-panel'),
      }
    })
    assert(
      clipping.setup <= 3 && clipping.roster <= 3 && clipping.config <= 3,
      `${viewport.name} 仍有一屏内容被裁切：${JSON.stringify(clipping)}`,
    )
  }
  await page.screenshot({ path: path.join(outputDir, `09-setup-${viewport.name}.png`) })
}

await browser.close()
console.log(
  JSON.stringify(
    {
      simultaneousTouch: 'passed',
      speech: 'passed',
      audioTimers: 'passed',
      fullMatch: 'passed',
      responsive: 'passed',
      desktopNoScroll: 'passed',
      classroomDuelFit: 'passed',
      denseQuestionStress: 'passed',
      consoleProblems: problems,
    },
    null,
    2,
  ),
)
