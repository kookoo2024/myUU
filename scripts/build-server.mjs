import { cp, mkdir, rm } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'

const root = process.cwd()
const distDir = path.join(root, 'dist')
const webDir = path.join(root, 'server', 'web')
const releaseDir = path.join(root, 'release')
const output = path.join(releaseDir, 'xyz-server.exe')
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'

if (!webDir.startsWith(path.join(root, 'server') + path.sep)) {
  throw new Error('拒绝操作工作区之外的前端目录')
}

const run = (command, args, options = {}) => new Promise((resolve, reject) => {
  const child = spawn(command, args, {
    cwd: root,
    stdio: 'inherit',
    ...options,
  })
  child.on('error', reject)
  child.on('exit', (code) => {
    if (code === 0) resolve()
    else reject(new Error(`${command} 退出码 ${code}`))
  })
})

await run(npmCommand, ['run', 'build'], { shell: process.platform === 'win32' })

await rm(webDir, { recursive: true, force: true })
await mkdir(webDir, { recursive: true })
await cp(distDir, webDir, { recursive: true })
await mkdir(releaseDir, { recursive: true })

await run('go', ['build', '-trimpath', '-ldflags=-s -w', '-o', output, './server'])

console.log(`服务端构建完成：${output}`)
