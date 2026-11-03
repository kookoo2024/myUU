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
const page = await browser.newPage({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
  hasTouch: true,
  isMobile: false,
})

const messages = []
page.on('console', (message) => {
  if (message.type() === 'error' || message.type() === 'warning') {
    messages.push(`${message.type()}: ${message.text()}`)
  }
})
page.on('pageerror', (error) => messages.push(`pageerror: ${error.message}`))

async function fillEditorSample() {
  await page.getByRole('button', { name: /新增题目/ }).click()
  await page.getByLabel('知识点').fill('函数与分数')
  await page.getByLabel('题干').fill(
    String.raw`已知函数 $f(x)=\frac{x^2+1}{x-1}$，若 $f(2)=m$，则 $m+\frac{1}{m}$ 的值为`,
  )
  await page.getByLabel('选项 A 内容').fill(String.raw`$\frac{26}{5}$`)
  await page.getByLabel('选项 B 内容').fill(String.raw`$\frac{5}{26}$`)
  await page.getByLabel('选项 C 内容').fill(String.raw`$\sqrt{5}$`)
  await page.getByLabel('选项 D 内容').fill(String.raw`$\frac{1}{5}$`)
}

async function fillImportSample() {
  await page.getByRole('button', { name: '批量导入' }).click()
  await page.getByLabel('批量导入内容').fill(
    [
      String.raw`已知 $x^2=4$，则 $x$ 的值为`,
      '$2$',
      '$-2$',
      String.raw`$\pm 2$`,
      '$4$',
      'C',
      '一元二次方程',
      '基础',
    ].join(' | '),
  )
}

await page.goto('http://127.0.0.1:5173', { waitUntil: 'networkidle' })
await ensureTeacherWorkspace(page)
await page.screenshot({ path: path.join(outputDir, '01-setup.png'), fullPage: true })

await page.getByRole('button', { name: '班级工作区' }).click()
await page.screenshot({ path: path.join(outputDir, '01a-class-manager.png') })
await page.getByRole('button', { name: '关闭' }).click()
await page.locator('.lesson-context-button').click()
await page.waitForTimeout(240)
await page.screenshot({ path: path.join(outputDir, '01a2-class-quick-switch.png') })
await page.keyboard.press('Escape')

await page.getByRole('button', { name: '题库工作台' }).click()
await page.locator('.bank-question-card').nth(0).click()
await page.locator('.bank-question-card').nth(1).click()
await page.screenshot({ path: path.join(outputDir, '01c-question-bank.png') })
await fillEditorSample()
await page.screenshot({ path: path.join(outputDir, '01d-question-editor.png') })
await page.locator('.question-editor-close').click()
await fillImportSample()
await page.screenshot({ path: path.join(outputDir, '01e-question-import.png') })
await page.locator('.question-import-close').click()
await page.getByRole('button', { name: '关闭' }).click()

await page.setViewportSize({ width: 1366, height: 768 })
await page.reload({ waitUntil: 'networkidle' })
await page.getByRole('button', { name: '班级工作区' }).click()
const managerFit = await page.evaluate(() => {
  const panel = document.querySelector('.class-manager-panel')
  const body = document.querySelector('.class-manager-body')
  const preview = document.querySelector('.class-manager-preview')
  const roster = document.querySelector('.manager-preview-grid')
  return {
    documentVertical: document.documentElement.scrollHeight - window.innerHeight,
    documentHorizontal: document.documentElement.scrollWidth - window.innerWidth,
    panelVertical: panel ? panel.scrollHeight - panel.clientHeight : Number.POSITIVE_INFINITY,
    bodyVertical: body ? body.scrollHeight - body.clientHeight : Number.POSITIVE_INFINITY,
    previewVertical: preview
      ? preview.scrollHeight - preview.clientHeight
      : Number.POSITIVE_INFINITY,
    rosterVertical: roster
      ? roster.scrollHeight - roster.clientHeight
      : Number.POSITIVE_INFINITY,
  }
})
if (
  managerFit.documentVertical > 3 ||
  managerFit.documentHorizontal > 3 ||
  managerFit.panelVertical > 3 ||
  managerFit.bodyVertical > 3 ||
  managerFit.previewVertical > 3 ||
  managerFit.rosterVertical > 3
) {
  throw new Error(`1366x768 班级管理面板发生裁切：${JSON.stringify(managerFit)}`)
}
await page.screenshot({ path: path.join(outputDir, '01a-class-manager-1366x768.png') })
await page.getByRole('button', { name: '关闭' }).click()
await page.getByRole('button', { name: '题库工作台' }).click()
const bankFit = await page.evaluate(() => {
  const workbench = document.querySelector('.resource-workbench')
  const body = document.querySelector('.resource-body')
  const cards = document.querySelector('.resource-question-grid')
  const builder = document.querySelector('.resource-pack-builder')
  return {
    documentVertical: document.documentElement.scrollHeight - window.innerHeight,
    documentHorizontal: document.documentElement.scrollWidth - window.innerWidth,
    workbenchVertical: workbench
      ? workbench.scrollHeight - workbench.clientHeight
      : Number.POSITIVE_INFINITY,
    bodyVertical: body ? body.scrollHeight - body.clientHeight : Number.POSITIVE_INFINITY,
    cardsVertical: cards ? cards.scrollHeight - cards.clientHeight : Number.POSITIVE_INFINITY,
    builderVertical: builder
      ? builder.scrollHeight - builder.clientHeight
      : Number.POSITIVE_INFINITY,
  }
})
if (
  bankFit.documentVertical > 3 ||
  bankFit.documentHorizontal > 3 ||
  bankFit.workbenchVertical > 3 ||
  bankFit.bodyVertical > 3 ||
  bankFit.cardsVertical > 3 ||
  bankFit.builderVertical > 3
) {
  throw new Error(`1366x768 题库工作台发生裁切：${JSON.stringify(bankFit)}`)
}
await page.screenshot({ path: path.join(outputDir, '01c-question-bank-1366x768.png') })
await fillEditorSample()
const editorFit = await page.evaluate(() => {
  const panel = document.querySelector('.question-editor-panel')
  const body = document.querySelector('.question-editor-body')
  const form = document.querySelector('.question-editor-form')
  const preview = document.querySelector('.question-editor-preview')
  return {
    documentVertical: document.documentElement.scrollHeight - window.innerHeight,
    documentHorizontal: document.documentElement.scrollWidth - window.innerWidth,
    panelVertical: panel ? panel.scrollHeight - panel.clientHeight : Number.POSITIVE_INFINITY,
    bodyVertical: body ? body.scrollHeight - body.clientHeight : Number.POSITIVE_INFINITY,
    formVertical: form ? form.scrollHeight - form.clientHeight : Number.POSITIVE_INFINITY,
    previewVertical: preview
      ? preview.scrollHeight - preview.clientHeight
      : Number.POSITIVE_INFINITY,
  }
})
if (
  editorFit.documentVertical > 3 ||
  editorFit.documentHorizontal > 3 ||
  editorFit.panelVertical > 3 ||
  editorFit.bodyVertical > 3 ||
  editorFit.formVertical > 3 ||
  editorFit.previewVertical > 3
) {
  throw new Error(`1366x768 题目录入面板发生裁切：${JSON.stringify(editorFit)}`)
}
await page.screenshot({ path: path.join(outputDir, '01d-question-editor-1366x768.png') })
await page.locator('.question-editor-close').click()
await fillImportSample()
const importFit = await page.evaluate(() => {
  const panel = document.querySelector('.question-import-panel')
  const body = document.querySelector('.question-import-body')
  const main = document.querySelector('.question-import-main')
  const preview = document.querySelector('.question-import-preview')
  return {
    documentVertical: document.documentElement.scrollHeight - window.innerHeight,
    documentHorizontal: document.documentElement.scrollWidth - window.innerWidth,
    panelVertical: panel ? panel.scrollHeight - panel.clientHeight : Number.POSITIVE_INFINITY,
    bodyVertical: body ? body.scrollHeight - body.clientHeight : Number.POSITIVE_INFINITY,
    mainVertical: main ? main.scrollHeight - main.clientHeight : Number.POSITIVE_INFINITY,
    previewVertical: preview
      ? preview.scrollHeight - preview.clientHeight
      : Number.POSITIVE_INFINITY,
  }
})
if (
  importFit.documentVertical > 3 ||
  importFit.documentHorizontal > 3 ||
  importFit.panelVertical > 3 ||
  importFit.bodyVertical > 3 ||
  importFit.mainVertical > 3 ||
  importFit.previewVertical > 3
) {
  throw new Error(`1366x768 批量导入面板发生裁切：${JSON.stringify(importFit)}`)
}
await page.screenshot({ path: path.join(outputDir, '01e-question-import-1366x768.png') })
await page.locator('.question-import-close').click()
await page.getByRole('button', { name: '关闭' }).click()
await page.setViewportSize({ width: 1920, height: 1080 })
await page.reload({ waitUntil: 'networkidle' })

await page.locator('.player-slot--left').click()
await page.screenshot({ path: path.join(outputDir, '01b-roster-dropdown.png') })
await page.locator('.roster-name-item').nth(0).click()
await page.locator('.player-slot--right').click()
await page.locator('.roster-name-item').nth(1).click()

for (const value of ['10', '5', '3', 'GO!']) {
  await page.waitForFunction(
    (expected) => document.querySelector('.countdown-number')?.textContent?.trim() === expected,
    value,
  )
  const suffix =
    value === '10' ? '10' : value === '5' ? '5' : value === '3' ? '3' : 'go'
  await page.screenshot({
    path: path.join(outputDir, `02-countdown-${suffix}.png`),
    animations: 'disabled',
  })
}

await page.waitForSelector('.duel-stage')
await page.waitForTimeout(500)
await page.screenshot({ path: path.join(outputDir, '03-duel-start.png') })

for (const [index, name] of [
  [2, 'long-question-2'],
  [3, 'image-question'],
  [4, 'stress-question'],
]) {
  const leftAnswer = page.locator('.player-lane--left .answer-option:enabled').first()
  const rightAnswer = page.locator('.player-lane--right .answer-option:enabled').first()
  if ((await leftAnswer.count()) > 0) await leftAnswer.click()
  if ((await rightAnswer.count()) > 0) await rightAnswer.click()
  await page.waitForTimeout(760)
  await page.screenshot({ path: path.join(outputDir, `11-${name}.png`) })
}

for (let index = 0; index < 6; index += 1) {
  const leftAnswer = page.locator('.player-lane--left .answer-option:enabled').first()
  const rightAnswer = page.locator('.player-lane--right .answer-option:enabled').first()
  if ((await leftAnswer.count()) > 0) await leftAnswer.click()
  if ((await rightAnswer.count()) > 0) await rightAnswer.click()
  await page.waitForTimeout(760)
}

await page.waitForTimeout(1050)
await page.screenshot({ path: path.join(outputDir, '04-result.png'), fullPage: true })

await page.goto('http://127.0.0.1:5173', { waitUntil: 'networkidle' })
await page.locator('.subject-switcher button').nth(0).click()
await page.locator('.player-slot--left').click()
await page.locator('.roster-name-item').nth(0).click()
await page.locator('.player-slot--right').click()
await page.locator('.roster-name-item').nth(1).click()
await page.waitForTimeout(4700)
await page.locator('.player-lane--left .answer-option:enabled').first().click()
await page.waitForTimeout(880)
await page.screenshot({ path: path.join(outputDir, '05-audio-wait.png') })

await page.goto('http://127.0.0.1:5173', { waitUntil: 'networkidle' })
await page.getByRole('button', { name: '触控 / 声音自检' }).click()
await page.screenshot({ path: path.join(outputDir, '06-diagnostics.png') })

console.log(JSON.stringify({ messages }, null, 2))
await browser.close()
