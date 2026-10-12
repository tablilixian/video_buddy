/**
 * CV-303（REQ-022 评审 SB-02）**接线守卫**：按钮承诺的版本必须一路传到 Host 的选版逻辑。
 *
 * 病灶是仓库里反复记过账的那一类 —— **判定/链路都对了，只漏接一环，行为与没做完全一样**：
 * `handleLand` 调 `landStoryboard(projectId)` 时漏了 `sbVersion`，于是「落地 v3」实际落的
 * 是**活副本**：静默投错料，而且落地后 `assertNotLanded` 单向冻结、不可撤销 —— 偏偏发生在
 * 用户最谨慎的那条路径上（回看 → 对比 → 选版 → 落地）。
 *
 * 每一段单看都是对的（客户端封装形参齐、api 会带 body、路由会选版），所以任何「单段测试」
 * 都照不到它；只有把**四段**串起来断言，断在哪一段都变红。四个断言与四个链路环节一一对应，
 * 反向变异验证过（删掉 handleLand 的实参 / 改坏 api 的条件体 → 对应用例变红）。
 *
 * 手法与 `reference-slot-wiring.test.mjs`、`workflow-gate.test.mjs` 的接线断言同款：
 * 读源码、剥注释、字符串断言 —— 够用，且改坏了会红。
 *
 * 运行：corepack yarn test:smoke（纯读源码，不需要 build）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'src')

/** 剥掉注释再读源码 —— 注释里的示例会把接线守卫喂饱。 */
function sourceOf(relative) {
  return readFileSync(join(SRC_DIR, relative), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
}

test('CV-303 ①：覆盖层「落地 vN」按钮必须把选中版本传下去', () => {
  const frame = sourceOf('client/StudioFrame.tsx')
  assert.match(frame, /landStoryboard\(projectId, sbVersion\)/,
    'handleLand 必须把 sbVersion 一起传下去 —— 漏传时落的是活副本（本批修的就是这条）')
  assert.equal(/landStoryboard\(projectId\)/.test(frame), false,
    '不许再有「只传 projectId」的落地调用（那等于悄悄落活副本）')
  // 两侧配对：按钮**承诺**了什么，调用就必须**兑现**什么。文案改了这条要跟着改。
  assert.match(frame, /落地 \$\{sbVersion\}/,
    '按钮必须仍然承诺「落地 <版本>」（承诺与兑现成对；只剩一边就是错的）')
})

test('CV-303 ②：客户端封装的 version 形参必须真的透传（不许收下就扔）', () => {
  const index = sourceOf('client/index.ts')
  assert.match(index, /landStoryboard = async \([\s\S]{0,120}?version\?: string/,
    'client 封装必须接受可选版本号')
  assert.match(index, /requestStoryboardLand\(projectId, version\)/,
    '形参收下了就必须交给 api —— 「签名有、实参没传」正是 CV-176/177 记过的账')
})

test('CV-303 ③：api 层必须把 version 放进请求体（省略时才落活副本）', () => {
  const api = sourceOf('client/api.ts')
  assert.match(api, /version === undefined \? \{ projectId \} : \{ projectId, version \}/,
    'body 必须按 version 有无分流：给了版本就带上，没给才是落活副本')
})

test('CV-303 ④：路由把版本透传给落地执行体，执行体按版本号取快照、取不到即显式报错', () => {
  const routes = sourceOf('routes.ts')
  assert.match(routes, /landStoryboard\(registry, projectId, asText\(record\.version\)\)/,
    '路由必须把请求里的 version 交给落地执行体')
  // CV-305：落地执行体从 routes.ts 的私有函数抽成了 storyboard-land.ts（唯一实现点，
  // 可直接注入假 registry），选版断言随之迁移到新家；行为级验证（取不到版本时拒绝
  // 且零痕迹）见 tests/storyboard-land-resume.test.mjs 的「落指定历史版本」一条。
  const land = sourceOf('storyboard-land.ts')
  assert.match(land, /sourceVersion === undefined \? undefined : versionById\(document\.versions, sourceVersion\)/,
    '必须真的按版本号去 history 里取那一条')
  assert.match(land, /source === undefined \? document\.sections : source\.snapshot/,
    '给了版本就落**该版本快照**；落活副本只在缺省路径上发生')
  assert.match(land, /没有这个版本/,
    '版本号不存在必须显式报错，绝不许静默回落活副本（那又是一次静默投错料）')
})
