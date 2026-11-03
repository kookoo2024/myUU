import process from 'node:process'

export async function ensureTeacherWorkspace(
  page,
  password = process.env.XYZ_TEST_PASSWORD ?? 'Release-Check-Password-2026',
) {
  await page.waitForSelector('.teacher-auth-screen, .setup-screen', {
    state: 'visible',
    timeout: 20_000,
  })
  if ((await page.locator('.setup-screen').count()) > 0) return

  await page.getByPlaceholder('输入教师密码').fill(password)
  await page.getByRole('button', { name: /登录教师工作台/ }).click()
  await page.waitForSelector('.setup-screen')
}
