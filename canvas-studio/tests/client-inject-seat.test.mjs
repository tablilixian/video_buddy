/**
 * 0.2.1 客户端座位契约：**顶层 inject 不得传递依赖本包自己提供的 `layout`**。
 *
 * 背景（2026-10-21 实测）：
 * - 桌面 patch 把上游 `ui-layout` 行关掉了，`ctx.layout` 只能由 canvas-studio
 *   在 apply 里 `ctx.reflect.provide('layout', …)` 提供；
 * - `dsh-client-ui-workspace@0.2.1` 的 inject 新增了 `layout`（0.1.1 没有），
 *   `dsh-client-ui-conversation@0.2.1` 又要求 `uiWorkspace`；
 * - 于是「顶层 inject 里写 uiWorkspace / uiConversation」会构成环
 *   studio → uiWorkspace → layout → studio。Cordis 的 fiber 只在 inject 全部
 *   就绪时才执行 apply（cordis `_refresh` / `_checkImpl`），环上互等 ⇒ 谁都进不了
 *   ACTIVE(2) ⇒ `root` 槽不注册 ⇒ 桌面只剩 framed shell 底座。
 *
 * 因此本包顶层 inject 只到「够提供 layout」为止，主插件由 `ctx.inject()` 起子
 * fiber（`STUDIO_CLIENT_INJECT`）。本测试读的是**构建产物**（lib/client.js 的
 * exports.inject）与**真实安装的上游 bundle**（各自 inject 声明），不是源码文本：
 * 谁把 uiWorkspace 加回顶层，这里就变红。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(resolve(ROOT, 'tests/client-inject-seat.test.mjs'))

/** 本包自己提供的服务（座位一）。顶层 inject 的传递闭包不得包含它们。 */
const SELF_PROVIDED = ['layout']

/** 取 `marker = [ "a", "b" ]` 里数组字面量的字符串项（取**最后**一处声明）。 */
function listAfter(source, marker) {
  const flags = marker.flags.includes('g') ? marker.flags : `${marker.flags}g`
  const scan = new RegExp(marker.source, flags)
  let start = -1
  for (const match of source.matchAll(scan)) start = match.index
  if (start === -1) return null
  const open = source.indexOf('[', start)
  const close = source.indexOf(']', open)
  if (open === -1 || close === -1) return null
  return [...source.slice(open, close).matchAll(/"([^"]+)"/g)].map(match => match[1])
}

/** 上游 `@deepseek-ai` 安装目录（从任一客户端导出反推，不硬编码 checkout 路径）。 */
const AI_DIR = resolve(dirname(require.resolve('@deepseek-ai/dsh-client-ui-workspace/client')), '../..')

/**
 * 扫磁盘上的客户端 bundle：service → 提供方包名，包名 → 自己的 inject。
 * 客户端入口优先（client.js / client.browser.js），没有的包退回 index.js。
 * @returns {{providers: Map<string, Set<string>>, injects: Map<string, string[]>}}
 */
function scanUpstream() {
  const providers = new Map()
  const injects = new Map()
  for (const entry of readdirSync(AI_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const libDir = join(AI_DIR, entry.name, 'lib')
    let files
    try { files = readdirSync(libDir) } catch { continue }
    const clientBundles = files.filter(name => /^client.*\.js$/.test(name))
    const picked = clientBundles.length > 0 ? clientBundles : files.filter(name => name === 'index.js')
    let inject = null
    for (const bundle of picked) {
      const source = readFileSync(join(libDir, bundle), 'utf8')
      for (const match of source.matchAll(/(?:provide\(\s*|super\(\s*(?:ctx|context)\s*,\s*)"([A-Za-z][\w.]*)"/g)) {
        if (!providers.has(match[1])) providers.set(match[1], new Set())
        providers.get(match[1]).add(entry.name)
      }
      inject ??= listAfter(source, /inject\s*=\s*\[/g)
    }
    if (inject !== null) injects.set(entry.name, inject)
  }
  return { providers, injects }
}

/**
 * 传递闭包：从一组服务出发，沿「谁提供它 → 那个包的 inject」一路展开。
 * 静态扫描看不到运行时动态命名的命名空间服务（如 `remote.directoryPicker`），
 * 这类名字只当作叶子，不报错。
 * @param names - 起始服务名。
 * @param upstream - {@link scanUpstream} 的结果。
 * @returns 闭包内全部服务名。
 */
function closureOf(names, upstream) {
  const seen = new Set()
  const queue = [...names]
  while (queue.length > 0) {
    const name = queue.pop()
    if (seen.has(name)) continue
    seen.add(name)
    for (const pkg of upstream.providers.get(name) ?? []) {
      for (const next of upstream.injects.get(pkg) ?? []) queue.push(next)
    }
  }
  return seen
}

const upstream = scanUpstream()
const artifact = readFileSync(resolve(ROOT, 'lib/client.js'), 'utf8')

/** 构建产物里的顶层 inject —— 运行时真值，不是源码文本。 */
function builtTopLevelInject() {
  const assigned = artifact.match(/exports\.inject\s*=\s*(\w+)\s*;/)
  assert.ok(assigned !== null, 'lib/client.js 必须导出 inject（loader 用它决定 fiber 何时 apply）')
  const list = listAfter(artifact, new RegExp(`(?:const|let|var)\\s+${assigned[1]}\\s*=\\s*\\[`))
  assert.ok(list !== null, `lib/client.js 里找不到 ${assigned[1]} 的数组字面量`)
  return list
}

test('顶层 inject 的传递闭包不含本包自己提供的服务（layout 环）', () => {
  const topLevel = builtTopLevelInject()
  const closure = closureOf(topLevel, upstream)
  for (const name of SELF_PROVIDED) {
    assert.ok(
      !closure.has(name),
      `顶层 inject [${topLevel.join(', ')}] 传递依赖了本包自己提供的 "${name}"。`
      + ` 桌面 patch 关掉了 ui-layout 行，${name} 只在本包 apply 里提供；`
      + ' 顶层 inject 一旦等它，环上的 fiber 互等、永远不进 ACTIVE(2)，'
      + ' 表现是桌面只剩 framed shell 底座（root 槽不注册）。'
      + ` 需要某个等 ${name} 的服务（uiWorkspace / uiConversation）时，`
      + ' 请放进 STUDIO_CLIENT_INJECT 由 ctx.inject() 子 fiber 去等。',
    )
  }
})

test('顶层 inject 的每个服务在 0.2.1 客户端 roster 里都有提供方（防上游改名/拼错）', () => {
  const topLevel = builtTopLevelInject()
  const missing = topLevel.filter(name => !upstream.providers.has(name))
  assert.deepEqual(
    missing,
    [],
    `顶层 inject 里这些服务在已安装的 @deepseek-ai 客户端 bundle 中找不到提供方：${missing.join(', ')}。`
    + ' 上游改名/删行为会让 fiber 永远 pending（页面空白且 console 无报错）。',
  )
})

test('座位二（STUDIO_CLIENT_INJECT）是顶层超集，且主插件仍在等 ui 服务', () => {
  const topLevel = builtTopLevelInject()
  const studio = listAfter(artifact, /STUDIO_CLIENT_INJECT\s*=\s*\[/)
  assert.ok(studio !== null, 'STUDIO_CLIENT_INJECT 必须仍是构建产物里的字面量数组')
  for (const name of topLevel) assert.ok(studio.includes(name), `座位二必须包含顶层服务 "${name}"`)
  assert.ok(studio.includes('uiWorkspace'), '座位二必须声明 uiWorkspace（项目↔工作区绑定依赖它）')
  assert.ok(studio.includes('uiConversation'), '座位二必须声明 uiConversation（工具产物捕获依赖它）')
})

test('上游 ui-workspace 的 layout 依赖是本座位存在的前提（上游去掉即可简化）', () => {
  // 这不是回归断言，而是**契约提醒**：ui-workspace 不再依赖 layout 时，座位一可以
  // 并回主插件；届时本测试变红，按提示复核后删掉座位一即可。
  const workspaceInject = upstream.injects.get('dsh-client-ui-workspace') ?? []
  assert.ok(
    workspaceInject.includes('layout'),
    '本版本 ui-workspace 已不再 inject layout —— layout 座位可以并回主插件，请复核后简化。',
  )
})
