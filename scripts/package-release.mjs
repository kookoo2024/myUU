import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const root = process.cwd()
const releaseDir = path.join(root, 'release')
const sourceExe = path.join(releaseDir, 'xyz-server.exe')
const assetName = 'xyz-server-windows-amd64.exe'
const assetPath = path.join(releaseDir, assetName)
const version = String(process.env.XYZ_VERSION ?? '').trim().replace(/^v/, '')

if (!/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error(`发布版本号格式不正确：${version || '(空)'}`)
}

await mkdir(releaseDir, { recursive: true })
await copyFile(sourceExe, assetPath)

const binary = await readFile(assetPath)
const info = await stat(assetPath)
const sha256 = createHash('sha256').update(binary).digest('hex')
const manifest = {
  version,
  asset: assetName,
  sha256,
  size: info.size,
  notes: String(process.env.XYZ_RELEASE_NOTES ?? '').trim(),
}

await writeFile(
  path.join(releaseDir, 'update.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
  'utf8',
)
await writeFile(
  path.join(releaseDir, 'SHA256SUMS.txt'),
  `${sha256}  ${assetName}\n`,
  'utf8',
)

console.log(JSON.stringify({
  version,
  asset: assetPath,
  sha256,
  size: info.size,
}, null, 2))
