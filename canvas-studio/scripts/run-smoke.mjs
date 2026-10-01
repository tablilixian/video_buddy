/**
 * test:smoke 门禁包装（CV-276 / 结构评审 P0-2）。
 *
 * 运行真正的 `node --test`（TAP 报告原样透传），随后断言：
 *   **本次失败集合 ⊆ tests/baseline-red.json 名单** —— 名单外的任何红都让退出码非 0，
 * 名单内的红数减少则提示收紧名单。
 *
 * 为什么需要它：基线红长期存在（`studio-defaults` 的规格文案断言、`minimax-skill`
 * 的跨 skill 引用检查），此前「红了几条、是不是同一批」靠人肉对数，净增回归会被
 * 淹没。本包装把「无新增红」变成机器可判定，门禁（`check` / 根 `yarn test`）才能
 * 真正接入。
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const workspaceRoot = join(here, '..')
const baselinePath = join(workspaceRoot, 'tests', 'baseline-red.json')

let baselineNames
try {
  baselineNames = new Set(JSON.parse(readFileSync(baselinePath, 'utf8')).failing.map((e) => e.name))
} catch (cause) {
  console.error(`run-smoke: 基线红名单不可读（${baselinePath}）：${cause instanceof Error ? cause.message : String(cause)}`)
  console.error('run-smoke: 没有名单就不存在「新增红」的判定基准 —— 请恢复或重建 tests/baseline-red.json。')
  process.exit(1)
}

const res = spawnSync(process.execPath, ['--test', '--test-reporter=tap', 'tests/*.test.mjs'], {
  cwd: workspaceRoot,
  encoding: 'utf8',
  maxBuffer: 512 * 1024 * 1024,
})
// TAP 原样透传（失败细节都在里面），再叠加门禁判定。
if (res.stdout) process.stdout.write(res.stdout)
if (res.stderr) process.stderr.write(res.stderr)

const failed = [...(res.stdout ?? '').matchAll(/^not ok \d+ - (.+)$/gm)].map((m) => m[1].trim())
const newReds = failed.filter((name) => !baselineNames.has(name))
const failedSet = new Set(failed)
const healed = [...baselineNames].filter((name) => !failedSet.has(name))

console.log(`\nrun-smoke 门禁：失败 ${failed.length} 条，其中基线内 ${failed.length - newReds.length} 条 / 名单外新增 ${newReds.length} 条`)

if (newReds.length > 0) {
  console.error('run-smoke 门禁 ❌ 出现基线名单之外的新增失败 —— 请修复，或（确属新基线时）在 tests/baseline-red.json 显式登记：')
  for (const name of newReds) console.error(`  - ${name}`)
  process.exit(1)
}
if (healed.length > 0) {
  console.log('run-smoke 门禁 ✅ 无新增红。以下基线红已不再失败，请从 tests/baseline-red.json 移除以收紧名单：')
  for (const name of healed) console.log(`  - ${name}`)
}
console.log('run-smoke 门禁 ✅ 失败集合 ⊆ 基线名单')
