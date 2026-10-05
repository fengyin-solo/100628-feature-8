/**
 * 调速器统一判定域自测入口：用 esbuild（仓库已有依赖）把 TS 检查脚本打成 ESM 临时包再执行。
 * 用法：npm run check:governor
 */
import { build } from 'esbuild'
import { rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const bundlePath = resolve(here, '.governor-check.bundle.mjs')

const result = await build({
  entryPoints: [resolve(here, 'governor-domain.check.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  alias: { '@': resolve(root, 'src') },
})
writeFileSync(bundlePath, result.outputFiles[0].text)
try {
  await import(pathToFileURL(bundlePath).href)
} finally {
  rmSync(bundlePath, { force: true })
}
