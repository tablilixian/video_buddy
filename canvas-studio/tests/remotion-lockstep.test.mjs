/**
 * REQ-034 · 二期前置 P-03：**Remotion 全家锁版一致性**断言（纯读 package.json，秒级）。
 *
 * 为什么必须有这条：`remotion` / `@remotion/media` / `@remotion/web-renderer` /
 * `@remotion/bundler` 之间是**内部 API 强耦合**（同一版本的 `Composition` 类型、
 * `renderMediaOnWeb` 参数、bundle 产物格式）。只要有一个包漂了版本，症状是运行期
 * 才炸（"某个 export 不存在" / 编码参数不认识），而且报错完全不指向版本。
 *
 * 判据三条：
 *   1. 所有 `remotion` / `@remotion/*` 声明**版本完全相同**；
 *   2. 一律**精确锁版**（禁 `^` / `~` / `latest` / 通配）；
 *   3. 核心 `remotion` 必须在册。
 *
 * ⚠️ 已知缺口（不在本断言里掩盖）：`scripts/remotion-verify/render-headless.mjs`
 * 直接 `import('@remotion/renderer')`，但 package.json **没有**声明它 —— 目前靠
 * `@remotion/bundler` 的传递依赖"恰好能解析"。这是二期 P-01 的待办（需在普通终端
 * `yarn add --dev --exact @remotion/renderer@<同版本>`），本机 agent 沙箱装不进包，
 * 故此处只断言"已声明的必须一致"，不假装它已被声明。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const workspaceRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

function declaredRemotionPackages() {
  const pkg = JSON.parse(readFileSync(join(workspaceRoot, 'package.json'), 'utf8'))
  const all = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) }
  return Object.entries(all).filter(([name]) => name === 'remotion' || name.startsWith('@remotion/'))
}

test('remotion 全家：版本完全一致（内部 API 强耦合，漂一个就运行期炸）', () => {
  const declared = declaredRemotionPackages()
  assert.ok(declared.length >= 3, `至少应有 remotion + media + web-renderer，实际 ${declared.length} 个`)
  const versions = new Set(declared.map(([, version]) => version))
  assert.equal(
    versions.size,
    1,
    `版本不一致：${declared.map(([name, version]) => `${name}@${version}`).join(', ')}`,
  )
})

test('remotion 全家：精确锁版（禁 ^ / ~ / latest / 通配）', () => {
  for (const [name, version] of declaredRemotionPackages()) {
    assert.match(
      version,
      /^\d+\.\d+\.\d+$/,
      `${name} 的版本 "${version}" 不是精确版本号 —— Remotion 内部 API 按版本变，必须 --exact 锁死`,
    )
  }
})

test('remotion 核心包必须在册（渲染入口依赖它）', () => {
  const names = declaredRemotionPackages().map(([name]) => name)
  assert.ok(names.includes('remotion'), '`remotion` 必须在 dependencies 里（组件层直接 import）')
  assert.ok(names.includes('@remotion/web-renderer'), 'CSR 渲染器必须在册（route B 的唯一渲染实现）')
})
