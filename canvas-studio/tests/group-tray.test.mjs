/**
 * CV-177：托盘（素材组）交互相与几何的**接线**守卫。
 *
 * 几何与排版本身在 tests/canvas-view.test.mjs 里直测纯函数。这一份查的是另一件事
 * ——**有没有接上**。理由是本仓反复出现过的两类静默失效：
 *
 *   ① 判定写好了、纯函数测过了，但没有任何调用方（approval-gate 那次的教训：
 *      「判定对了但没接 = 等于没做」）。托盘这一批尤其危险：groupBoxOf 改了、
 *      测试也绿，而 host-tools 或 store 里还留着旧的那份几何计算，于是同一张
 *      托盘在「生成时建组」与「手动建组」两条路径上是两个高度。
 *   ② 样式写好了、类名对不上。抓取带是**跨层几何契约**（CSS 的 24px 等于
 *      canvas-view 的 GROUP_HEAD_HEIGHT），漂移的表现只是「带子被成员压住
 *      一点」，不报错、不警告。
 *
 * 全部是读源码文本的静态检查，不需要先 build，也不启浏览器。
 * 运行：corepack yarn workspace canvas-studio test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { GROUP_HEAD_HEIGHT, GROUP_PADDING, singleMemberGroupOf, tidyGroupLayout } from '../lib/canvas-view.js'

const readSource = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8')

/**
 * 比对**代码**而不是注释：本批的否定断言（「不得再自己算组框」「不得再有
 * boundsOf」）恰好是注释里最容易出现的写法，不剥注释就会因为一句正确的说明
 * 而误报。只剥块注释与整行注释，不做行内剥除 —— `https://` 里的 `//` 会长在
 * 行中间，行内剥除会把真代码一起吃掉。
 */
const codeOnly = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')

const STYLES_SRC = readSource('../src/client/styles.ts')
const STORE_SRC = readSource('../src/client/project-store.ts')
const SURFACE_SRC = readSource('../src/client/canvas/CanvasSurface.tsx')
const NODE_SRC = readSource('../src/client/canvas/CanvasNode.tsx')
const MENU_SRC = readSource('../src/client/canvas/CanvasContextMenu.tsx')
const FRAME_SRC = readSource('../src/client/StudioFrame.tsx')
const GENERATE_SRC = readSource('../src/generate.ts')

const STORE_CODE = codeOnly(STORE_SRC)
const SURFACE_CODE = codeOnly(SURFACE_SRC)
const NODE_CODE = codeOnly(NODE_SRC)
const MENU_CODE = codeOnly(MENU_SRC)
const FRAME_CODE = codeOnly(FRAME_SRC)
const GENERATE_CODE = codeOnly(GENERATE_SRC)

/** 取某条 CSS 规则的规则体（选择器必须整条匹配，同 visual-tokens 的 ruleBody）。 */
const ruleBody = (src, selector) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const found = new RegExp(`(?:^|[,\\n])[ \\t]*${escaped}[ \\t]*\\{`).exec(src)
  if (found === null) return ''
  const body = src.slice(found.index + found[0].length)
  return body.slice(0, body.indexOf('\n}'))
}

test('CV-177 契约：抓取带高度 CSS 与几何常量必须一致（跨层硬契约）', () => {
  const head = ruleBody(STYLES_SRC, '.csGroupHead')
  assert.ok(head.length > 0, '.csGroupHead 规则必须存在 —— 抓取带没样式，托盘又只剩那圈边环')
  const height = /(?:^|\n)\s*height:\s*(\d+)px/.exec(head)
  assert.ok(height !== null, '.csGroupHead 必须显式写死高度（不许 auto —— 塌了就没有抓取区）')
  assert.equal(
    Number(height[1]), GROUP_HEAD_HEIGHT,
    `styles.ts 的抓取带高度（${height[1]}px）必须等于 canvas-view 的 GROUP_HEAD_HEIGHT（${GROUP_HEAD_HEIGHT}）`
    + ' —— 漂移的表现只是「带子被成员压住一点」，不报错',
  )
  // 抓取带必须整宽、固定高：flex: 0 0 auto 是「不被成员挤压」的唯一保证。
  assert.match(head, /flex:\s*0 0 auto/, '抓取带不得参与伸缩 —— 被压扁就等于没有抓取区')
  assert.match(head, /box-sizing:\s*border-box/, '抓取带高度要含内边距（否则实际高度 > 契约值）')
})

test('CV-177 契约：托盘几何只有一份实现 —— 两处调用方都改调 groupBoxOf', () => {
  // Host：生成时自动编组。
  assert.match(
    GENERATE_CODE, /import \{ groupBoxOf \} from '\.\/canvas-view\.js'/,
    'generate.ts 必须从 canvas-view 取托盘几何',
  )
  assert.match(GENERATE_CODE, /const box = groupBoxOf\(members\)/, 'attachShotGroup 必须调 groupBoxOf')
  assert.ok(
    !/GROUP_PADDING/.test(GENERATE_CODE),
    'generate.ts 不得再自己定义内边距常量 —— 那是几何的第二份实现',
  )
  // client：手动编组 + 整理 + 载入规范化。
  assert.match(
    STORE_CODE, /import \{ groupBoxOf, normalizeGroupBoxes, tidyGroupLayout \} from '\.\.\/canvas-view\.js'/,
    'project-store.ts 必须从 canvas-view 取这三件事',
  )
  assert.match(STORE_CODE, /const box = groupBoxOf\(members\)/, 'groupSelected 必须调 groupBoxOf')
  assert.ok(
    !/bounds\s*\.\s*x\s*-\s*12/.test(STORE_CODE),
    'project-store 不得再手算 -12 / +24 —— 那是几何的第二份实现（加抓取带时它不会跟着变）',
  )
})

test('CV-177：载入清洗必须规范化老托盘几何（否则抓取带会压住成员）', () => {
  // setNodes 是读盘唯一入口；不在这里补抓取带空间，旧文档一打开就是
  // 「头部带盖住图片顶部 24px」——而且只有老项目会这样，最容易被当成
  // 「某些项目显示不对」而不是「几何没迁移」。
  assert.match(
    STORE_CODE, /normalizeGroupBoxes\(clean\)/,
    'setNodes 必须对载入节点跑 normalizeGroupBoxes',
  )
  assert.ok(
    !/export function boundsOf/.test(STORE_CODE),
    'boundsOf 已无调用方（groupSelected 改走 groupBoxOf），不得留下死代码',
  )
})

test('CV-177：单成员托盘的拖动归一化真的接在手势上（不是只写了纯函数）', () => {
  // ① 判定来自 canvas-view（唯一实现）。
  assert.match(
    SURFACE_CODE, /singleMemberGroupOf\(nodesRef\.current, node\)/,
    'CanvasSurface 必须用 canvas-view 的 singleMemberGroupOf 判定代理',
  )
  // ② 代理真的写进手势，且**只在 roster 就是它自己时**（多选整队拖动有自己的通道）。
  assert.match(SURFACE_CODE, /roster\.length === 1 && proxy !== undefined/, '代理只对单节点拖动生效')
  assert.match(SURFACE_CODE, /moveProxyId: proxy\.id/, '手势必须记下代理托盘 id')
  // ③ pointermove 真的移动代理而不是成员 —— 否则「判定对了但没接」。
  assert.match(SURFACE_CODE, /const moveId = current\.moveProxyId \?\? current\.nodeId/, '移动目标必须优先取代理')
  assert.match(SURFACE_CODE, /onMoveNode\(moveId, snapped\.x, snapped\.y\)/, '实际移动的必须是归一化后的目标')
})

test('CV-177：「整理托盘」从菜单到 store 的接线完整（三段都要在）', () => {
  // 菜单项：托盘的专属命令，且不放开到别的节点类型。
  assert.match(MENU_CODE, /onTidyGroup\(id: string\): void/, '右键菜单必须声明 onTidyGroup')
  assert.match(
    MENU_CODE, /node\.kind === 'group' && item\('整理托盘'/,
    '「整理托盘」必须只对托盘开放（别的节点没有成员可整理）',
  )
  // Frame 接线到 store action。
  assert.match(FRAME_CODE, /onTidyGroup=\{id => \{[\s\S]{0,120}?actions\.tidyGroup\(projectId, id\)/, 'StudioFrame 必须把命令接到 store')
  // store：接口 + 实现 + 走纯函数 + 可撤销。
  assert.match(STORE_CODE, /tidyGroup: \(draft: ProjectStoreState, projectId: string, groupId: string\) => void/, 'store 接口必须声明 tidyGroup')
  assert.match(STORE_CODE, /tidyGroup: \(draft, projectId, groupId\) => \{/, 'store 必须有 tidyGroup 实现')
  assert.match(STORE_CODE, /const layout = tidyGroupLayout\(group, members\)/, '排版必须走纯函数 tidyGroupLayout')
  const impl = STORE_SRC.slice(STORE_SRC.indexOf('tidyGroup: (draft, projectId, groupId)'))
  const body = impl.slice(0, impl.indexOf('\n      autoArrange'))
  assert.match(body, /snapshotHistory/, '整理必须先压 undo 快照（手工摆位被抹平要能退回）')
  assert.match(body, /layout\.box !== null/, '整理后托盘必须落新盒子（否则框只涨不缩的老问题还在）')
})

test('CV-177：托盘渲染必须带抓取带与成员数', () => {
  assert.match(NODE_CODE, /className="csNodeGroup"/, 'CanvasNode 必须渲染托盘容器')
  assert.match(NODE_CODE, /className="csGroupHead"/, '托盘必须有抓取带 —— 没有它就又只剩边环可抓')
  assert.match(NODE_CODE, /groupCount \?\? 0\) > 0 && <span className="csGroupCount"/, '抓取带必须报成员数')
  // 成员数由画布层派生后传入（组件是展示件，不自己遍历节点表）。
  assert.match(NODE_CODE, /groupCount\?: number/, 'CanvasNode 必须通过 groupCount 入参接收成员数')
  assert.match(SURFACE_CODE, /const groupCounts = useMemo/, 'CanvasSurface 必须派生成员数表')
  assert.match(
    SURFACE_CODE, /node\.kind === 'group' \? \{ groupCount: groupCounts\.get\(node\.id\) \?\? 0 \} : \{\}/,
    '成员数只对托盘节点传（其它节点不必为此多算一份子节点表）',
  )
})

test('CV-177 反向自证：这些纯函数真的存在且行为可复现', () => {
  // 上面前几条读的都是「源码里有没有这个词」。如果 import 名字写错、函数没导出，
  // 静态断言会全绿而运行时一调用就炸 —— 这里做一次真实的调用握手。
  const tray = { id: 'g', kind: 'group', x: 1000, y: 1000, width: 300, height: 600, createdAt: 1, sourceIds: [] }
  const member = {
    id: 'a', kind: 'image', url: '/assets/a.png', x: 1000 + GROUP_PADDING,
    y: 1000 + GROUP_PADDING + GROUP_HEAD_HEIGHT, width: 270, height: 528, createdAt: 2, sourceIds: [], parentId: 'g',
  }
  assert.equal(singleMemberGroupOf([tray, member], member)?.id, 'g')
  const layout = tidyGroupLayout(tray, [member])
  assert.deepEqual(layout.positions.get('a'), { x: member.x, y: member.y })
  assert.equal(layout.box.y, member.y - GROUP_PADDING - GROUP_HEAD_HEIGHT)
})
