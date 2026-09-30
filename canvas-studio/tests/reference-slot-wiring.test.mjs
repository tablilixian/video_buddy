/**
 * REQ-003 Step 1 接线守卫：判定/纯函数对了但**没接上**，行为与"没做"完全一样。
 *
 * 这是仓库里被反复记过账的失败模式（CV-176 / CV-177：「判定对了但忘了接，行为与
 * 没做完全一样」）。Step 1 里有三处**必须接上**、而纯函数测试照不到的线：
 *
 *   1. 抽屉真的渲染了编辑区（而不是把旧只读块留在那儿）；
 *   2. 编辑区**只**通过 `withReferenceNames` 写回（不许自己拼 JSON —— 归一化规则
 *      与"三类拒绝"都在那个函数里）；
 *   3. 新增参考**先解析句柄再写**（不许把候选的 ref 直接当句柄写进参数 ——
 *      那正是 CV-155 的 500）。
 *
 * 源码级字符串断言，不做 AST（与 host-boundary.test.mjs 同款手法：够用、改坏了会红）。
 *
 * 运行：corepack yarn test:smoke（纯读源码，不需要 build）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const read = async (relative) => readFile(new URL(`../${relative}`, import.meta.url), 'utf8')

test('REQ-003 接线：详情抽屉渲染参考编辑区，且不在槽位表里的工具保留只读展示', async () => {
  const source = await read('src/client/canvas/NodeDetailDrawer.tsx')
  assert.match(source, /import \{ ReferenceSlotEditor \} from '\.\/ReferenceSlotEditor\.js'/, '必须引入编辑区组件')
  assert.match(source, /<ReferenceSlotEditor/, '必须在 JSX 里真的渲染它')
  // 非槽位工具的回退：referenceSlotOf(node) !== null ? 编辑区 : 原只读块
  assert.match(source, /referenceSlotOf\(node\) !== null \? \(/, '必须用 referenceSlotOf 决定出不出编辑区')
  assert.match(source, /csDetailRefThumbs/, '不在槽位表里的工具必须保留原只读展示（不许"以前看得到现在看不到"）')
  // 两个可选依赖必须透传（否则编辑区只能看不能改）
  assert.match(source, /libraryAssets/, '资产库来源必须透传给编辑区')
  assert.match(source, /onResolveRefs/, '解析回调必须透传给编辑区')
})

test('REQ-003 接线：编辑区只经 withReferenceNames 写回，且新增参考先解析句柄', async () => {
  const source = await read('src/client/canvas/ReferenceSlotEditor.tsx')
  assert.match(source, /withReferenceNames\(/, '必须用纯函数归一化写回')
  assert.match(source, /onUpdateNode\(node\.id, \{ generationPrompt: raw \}\)/, '写回必须走 onUpdateNode 的 generationPrompt')
  assert.equal(/JSON\.stringify\(\{ \.\.\./.test(source), false, '不许在组件里自己拼参数 JSON（归一化与拒绝规则都在纯函数里）')
  assert.match(source, /await onResolveRefs\(refs\)/, '新增/替换必须先解析句柄')
  // 解析失败要逐项说出来，而不是静默丢弃
  assert.match(source, /failures\.push/, '逐项失败必须被收集并展示')
  assert.match(source, /item\.handle/, '写回的必须是解析后的 handle，而不是候选 ref')
})

test('REQ-003 接线：StudioFrame 提供画布节点之外的资产库来源与解析实现', async () => {
  const source = await read('src/client/StudioFrame.tsx')
  assert.match(source, /libraryAssets=\{libraryAssets\}/, '必须把 store 里的资产库条目传下去')
  assert.match(source, /resolveStudioRefs\(projectId, refs\)/, '解析必须走 client api（不许在 UI 里裸 fetch）')
  const api = await read('src/client/api.ts')
  assert.match(api, /'\/canvas-studio\/resolve-refs'/, 'api 必须打这条端点')
})

test('REQ-003 接线：解析端点逐项 try/catch，且工具侧与路由侧共用同一份解析实现', async () => {
  const routes = await read('src/routes.ts')
  assert.match(routes, /ROUTE_RESOLVE_REFS = '\/canvas-studio\/resolve-refs'/, '路由常量必须存在')
  assert.match(routes, /resolveRefFilenames\(registry, projectId, \[ref\], library\)/, '必须复用既有解析链')
  // 逐项失败不整批失败：循环体内必须有 try/catch
  const handler = routes.slice(routes.indexOf('ROUTE_RESOLVE_REFS, handler'))
  const loop = handler.slice(handler.indexOf('for (const ref of'), handler.indexOf('sendJson(res, 200, { items })'))
  assert.match(loop, /try \{/, '逐项解析必须包在 try 里')
  assert.match(loop, /catch \(cause\)/, '逐项解析必须有 catch')
  assert.match(loop, /items\.push\(\{ ref, error/, '失败项要作为 error 项返回，而不是抛出整批')

  // 抽取后的共用：host-tools 不再自带实现，而是从新模块取（并继续转出纯函数给既有测试）。
  const hostTools = await read('src/host-tools.ts')
  assert.match(hostTools, /from '\.\/reference-resolve\.js'/, 'host-tools 必须从抽取后的模块取解析实现')
  assert.equal(/async function resolveRefFilenames\(/.test(hostTools), false, 'host-tools 不许再保留第二份实现')
  assert.match(hostTools, /export \{ refCandidatePool \} from '\.\/reference-resolve\.js'/, '既有测试从 host-tools 取 refCandidatePool，必须保持转出')
})
