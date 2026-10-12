/**
 * CV-305（评审 SB-01 + SB-06）· 落地执行体 `storyboard-land.ts` 的**行为级**守卫。
 *
 * 为什么这个文件必须存在：落地是本仓唯一「不可撤销」的写操作（契约为单向终点），
 * 而它此前是 `routes.ts` 里的私有函数、**零路由级测试** —— 判「做对了没有」只能靠
 * 字符串断言，而字符串断言看不见「顺序」与「幂等」。这里改为直接驱动真实执行体：
 * 真 storyboard.json（临时目录）+ 内存画布 + 假 workflow，验证四件事：
 *
 * 1. **WAL 顺序**：写画布那一刻，盘上的 `landed` 必须已经存在（料先于画布落盘）。
 * 2. **幂等**：重试不重复 append；同一份料永远只落一套节点。
 * 3. **续做**：缺画布补画布、缺状态补状态；画布已就绪时**一个节点都不动**。
 * 4. **零痕迹**：校验不过时什么都不写（`landed` 仍为 null、画布空、状态不动）。
 *
 * 运行：node --test tests/storyboard-land-resume.test.mjs （cwd = canvas-studio）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { landStoryboard } from '../lib/storyboard-land.js'
import { loadStoryboard, saveStoryboard } from '../lib/storyboard-store.js'
import { createStoryboard, emptyStoryboardSections } from '../lib/contracts/storyboard.js'
import { archive } from '../lib/storyboard-history.js'
import { SEED_ANCHOR_TOOL, SEED_SHOT_TOOL, hasSeedAnchor } from '../lib/contracts/canvas.js'

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'src')

/** 剥掉注释再读源码 —— 注释里的示例会把「接线守卫」喂饱。 */
function sourceOf(relative) {
  return readFileSync(join(SRC_DIR, relative), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
}

/** 一份能过 `validateForSeed` 的最小故事板（1 scene / 1 shot / 1 token）。 */
function passableSections() {
  return {
    ...emptyStoryboardSections(),
    '02_visual': { tokens: [{ k: '色调', v: '冷调' }] },
    '04_storyboard': {
      scenes: [
        {
          id: 'S1',
          title: '开场',
          shots: [
            { id: 'S1-1', duration: 5, frames: 120, camera: '缓慢推进', visual: '空走廊', audio: '滴水', backup: false },
          ],
        },
      ],
    },
  }
}

function storyboardDoc(projectId = 'p1') {
  return createStoryboard({
    projectId,
    title: '测试片',
    meta: { genre: '悬疑', targetDuration: 30, aspect: '16:9' },
    sections: passableSections(),
  })
}

/**
 * 假 registry（落地执行体需要的全部六个面）。`options` 是**活对象** ——
 * 用例可以在过程中翻转 `failCanvasWrite` 来复刻「第一次写失败、重试成功」。
 */
function makeRegistry(dir, options = {}) {
  const project = {
    id: 'p1',
    name: 'P1',
    createdAt: '1',
    updatedAt: '1',
    workflow: { mode: 'confirm', state: 'storyboarding' },
  }
  const canvas = { version: 3, nodes: [], assets: [] }
  const log = []
  let canvasWrites = 0
  let reads = 0
  let storyboardAtCanvasWrite = null
  const EXTRA = { id: 'extra-node', kind: 'text', title: '别处写的节点', x: 0, y: 0, width: 10, height: 10, createdAt: 1 }
  // 复刻「并发下别人已经把锚点写进画布」：身份稳定的锚点是幂等探测的唯一判据。
  const FOREIGN_ANCHOR = {
    id: 'foreign-anchor',
    kind: 'text',
    toolName: SEED_ANCHOR_TOOL,
    title: '别处落的锚点',
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    createdAt: 1,
  }

  const injected = { extra: false, anchor: false, mutated: false }

  return {
    storyboardFile: (id) => join(dir, `${id}.json`),
    readCanvas: async () => {
      reads += 1
      // 复刻「落地窗口内别处写了画布」：**真的**写进存储（不是只在返回值里），
      // 否则「有没有重复 append」只能看执行体自己的返回值，看不出画布实况。
      if (reads > 1) {
        if (options.extraNodeAfterFirstRead === true && !injected.extra) {
          injected.extra = true
          canvas.nodes.push(EXTRA)
        }
        if (options.anchorAfterFirstRead === true && !injected.anchor) {
          injected.anchor = true
          canvas.nodes.push(FOREIGN_ANCHOR)
        }
      }
      // 复刻「落地事务窗口内 agent 改写了活副本」（评审 SB-06）：改的是**盘上的**
      // storyboard.json —— 执行体在「读 → 校验」之后才会重读它。
      if (options.sectionsMutatedAfterLoad === true && !injected.mutated) {
        injected.mutated = true
        const file = join(dir, 'p1.json')
        const parsed = JSON.parse(readFileSync(file, 'utf8'))
        parsed.sections['00_creative'] = { brief: '落地过程中被 agent 改了' }
        writeFileSync(file, `${JSON.stringify(parsed, null, 2)}\n`)
      }
      return structuredClone(canvas)
    },
    writeCanvas: async (id, nodes, _view, assets) => {
      log.push('canvas')
      canvasWrites += 1
      // WAL 顺序的硬证据：写画布**那一刻**盘上的 storyboard 是什么样。
      storyboardAtCanvasWrite = JSON.parse(readFileSync(join(dir, `${id}.json`), 'utf8'))
      if (options.failCanvasWrite === true) throw new Error('模拟画布写失败')
      canvas.nodes = [...nodes]
      if (assets !== undefined) canvas.assets = [...assets]
    },
    updateWorkflow: async (id, patch) => {
      log.push('state')
      project.workflow = { ...project.workflow, ...patch }
      return project
    },
    getProject: async () => project,
    // ── 观测面 ──
    _canvas: canvas,
    _project: project,
    _log: log,
    _options: options,
    _writes: () => canvasWrites,
    _atCanvasWrite: () => storyboardAtCanvasWrite,
  }
}

/** 从一个目录起一套 registry + 一份可落地的故事板。 */
async function setup(options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'cs-land-'))
  const reg = makeRegistry(dir, options)
  return { dir, reg }
}

/** 数某类 toolName 的节点个数。 */
function countNodes(reg, toolName) {
  return reg._canvas.nodes.filter((node) => node.toolName === toolName).length
}

test('CV-305 首落：画布出锚点+分镜卡、状态进 executing、landed 与 bindings 落盘', async () => {
  const { dir, reg } = await setup()
  try {
    await saveStoryboard(reg, 'p1', storyboardDoc())
    const result = await landStoryboard(reg, 'p1')

    assert.equal(result.resumed, false, '首落不是续做')
    assert.equal(result.shots, 1)
    assert.equal(result.version, 'live', '落活副本记 live')
    assert.equal(countNodes(reg, SEED_ANCHOR_TOOL), 1, '锚点应恰好一个')
    assert.equal(countNodes(reg, SEED_SHOT_TOOL), 1, '一张分镜卡')
    assert.equal(reg._project.workflow.state, 'executing', '状态必须推到制作中')

    const doc = (await loadStoryboard(reg, 'p1')).document
    assert.ok(doc.landed, 'landed 必须落盘')
    assert.equal(doc.landed.sourceVersion, 'live')
    assert.ok(doc.versions.history.some((v) => v.label === '落地前固化'), '落活副本应补「落地前固化」checkpoint')

    // bindings 是回写通道的锚：必须逐个指向画布上**真实存在**的节点。
    const ids = new Set(reg._canvas.nodes.map((n) => n.id))
    const assetIds = new Set(reg._canvas.assets.map((a) => a.id))
    const entries = Object.entries(doc.bindings)
    assert.ok(entries.length > 0, 'bindings 不该为空')
    for (const [sbRef, binding] of entries) {
      if (binding.canvasNodeId !== undefined) {
        assert.ok(ids.has(binding.canvasNodeId), `bindings[${sbRef}] 的 canvasNodeId 必须指向画布上的真实节点`)
      }
      if (binding.canvasAssetId !== undefined) {
        assert.ok(assetIds.has(binding.canvasAssetId), `bindings[${sbRef}] 的 canvasAssetId 必须指向画布上的真实资产`)
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('CV-305 WAL 顺序：写画布那一刻，盘上的 landed 已经存在（料先于画布）', async () => {
  const { dir, reg } = await setup()
  try {
    await saveStoryboard(reg, 'p1', storyboardDoc())
    await landStoryboard(reg, 'p1')

    const atWrite = reg._atCanvasWrite()
    assert.ok(atWrite !== null, '写画布应被观测到')
    assert.ok(atWrite.landed !== null, 'WAL：写画布前 landed 必须已落盘（换顺序即变红）')
    assert.equal(atWrite.landed.sourceVersion, 'live')
    assert.ok(atWrite.landed.sections['04_storyboard'].scenes.length > 0, 'landed 里必须带着这次落地的全量料')
    // 顺序日志：画布 → 状态（画布没写成就不会出现状态那一步）。
    assert.deepEqual(reg._log, ['canvas', 'state'])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('CV-305 幂等：已彻底完成后再次落地被拒，画布零改动（单向终点不变）', async () => {
  const { dir, reg } = await setup()
  try {
    await saveStoryboard(reg, 'p1', storyboardDoc())
    await landStoryboard(reg, 'p1')
    const before = reg._canvas.nodes.map((n) => n.id).sort()
    const writesBefore = reg._writes()

    await assert.rejects(() => landStoryboard(reg, 'p1'), /已落地/u)
    assert.deepEqual(reg._canvas.nodes.map((n) => n.id).sort(), before, '拒绝路径不得动画布')
    assert.equal(reg._writes(), writesBefore, '拒绝路径不得再写画布')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('CV-305 续做·缺画布：补画布且只落一套节点，bindings 与画布同源', async () => {
  const { dir, reg } = await setup()
  try {
    // 复刻「首落死在写画布那一步」：landed 已写、画布还空着。
    const doc = storyboardDoc()
    await saveStoryboard(reg, 'p1', {
      ...doc,
      landed: { at: 1, sourceVersion: 'live', sections: doc.sections },
    })

    const result = await landStoryboard(reg, 'p1')
    assert.equal(result.resumed, true, '应走续做分支')
    assert.equal(result.version, 'live', '续做沿用 landed.sourceVersion')
    assert.equal(countNodes(reg, SEED_ANCHOR_TOOL), 1, '锚点必须只有 1 个（不许重复 append）')
    assert.equal(countNodes(reg, SEED_SHOT_TOOL), 1)
    assert.equal(reg._project.workflow.state, 'executing')

    const after = (await loadStoryboard(reg, 'p1')).document
    const ids = new Set(reg._canvas.nodes.map((n) => n.id))
    for (const [sbRef, binding] of Object.entries(after.bindings)) {
      if (binding.canvasNodeId !== undefined) {
        assert.ok(ids.has(binding.canvasNodeId), `续做重铸计划后 bindings[${sbRef}] 必须指向本次写进画布的节点`)
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('CV-305 续做·只缺状态：画布一个节点都不动，不再调 writeCanvas', async () => {
  const { dir, reg } = await setup()
  try {
    await saveStoryboard(reg, 'p1', storyboardDoc())
    await landStoryboard(reg, 'p1')
    const nodesBefore = reg._canvas.nodes.map((n) => n.id).sort()
    const writesAfterFirst = reg._writes()

    // 复刻「画布成功、推状态失败」：把状态拨回 storyboarding。
    reg._project.workflow.state = 'storyboarding'
    const result = await landStoryboard(reg, 'p1')

    assert.equal(result.resumed, true)
    assert.deepEqual(reg._canvas.nodes.map((n) => n.id).sort(), nodesBefore, '续做只缺状态时画布必须零追加')
    assert.equal(reg._writes(), writesAfterFirst, '画布已就绪 ⇒ 不该再走 writeCanvas')
    assert.equal(reg._project.workflow.state, 'executing', '缺的那一步（状态）必须被补上')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('CV-305 首落画布写失败 → 重试即续做，不留下重复节点（原「永久锁死」死角已消）', async () => {
  const { dir, reg } = await setup({ failCanvasWrite: true })
  try {
    await saveStoryboard(reg, 'p1', storyboardDoc())
    await assert.rejects(() => landStoryboard(reg, 'p1'), /模拟画布写失败/u)

    // 失败后：料已锁死（WAL 的代价与收益），画布仍空，状态未动。
    const afterFail = (await loadStoryboard(reg, 'p1')).document
    assert.ok(afterFail.landed, 'landed 必须已写（这正是重试能自愈的前提）')
    assert.equal(reg._canvas.nodes.length, 0)
    assert.equal(reg._project.workflow.state, 'storyboarding')

    // 放开故障后重试：走续做，只补画布那一步。
    reg._options.failCanvasWrite = false
    const result = await landStoryboard(reg, 'p1')
    assert.equal(result.resumed, true)
    assert.equal(countNodes(reg, SEED_ANCHOR_TOOL), 1, '重试不得重复 append 一整套节点')
    assert.equal(countNodes(reg, SEED_SHOT_TOOL), 1)
    assert.equal(reg._project.workflow.state, 'executing')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('CV-305 校验不过：拒绝且零痕迹（landed 仍 null、画布空、状态不动）', async () => {
  const { dir, reg } = await setup()
  try {
    // 空故事板：缺 §02 token、缺 §04 scene ⇒ 有 blocker。
    await saveStoryboard(reg, 'p1', {
      ...storyboardDoc(),
      sections: emptyStoryboardSections(),
    })
    await assert.rejects(() => landStoryboard(reg, 'p1'), /未补齐/u)

    const after = (await loadStoryboard(reg, 'p1')).document
    assert.equal(after.landed, null, '校验不过不得写 landed（否则项目被误冻）')
    assert.equal(reg._canvas.nodes.length, 0, '校验不过不得碰画布')
    assert.equal(reg._project.workflow.state, 'storyboarding', '校验不过不得推状态')
    assert.equal(reg._log.length, 0, '一次写操作都不该发生')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('CV-305 落指定历史版本：landed 记该版本号，且不再补 checkpoint', async () => {
  const { dir, reg } = await setup()
  try {
    const doc = storyboardDoc()
    const edited = { ...doc, sections: { ...doc.sections, '00_creative': { brief: '第二版创意' } } }
    const versions = archive(doc.versions, edited.sections, { kind: 'manual', label: '第二版' })
    await saveStoryboard(reg, 'p1', { ...edited, versions })
    const historyBefore = versions.history.length

    const result = await landStoryboard(reg, 'p1', 'v2')
    assert.equal(result.version, 'v2')
    const after = (await loadStoryboard(reg, 'p1')).document
    assert.equal(after.landed.sourceVersion, 'v2')
    assert.equal(after.versions.history.length, historyBefore, '落历史版本不再补 checkpoint（那条本来就在 history 里）')
    const anchor = reg._canvas.nodes.find((n) => n.toolName === SEED_ANCHOR_TOOL)
    assert.match(anchor.title, /v2/u, '锚点标题要标明落的是哪一版')

    // 落不存在的版本：拒绝且零痕迹（用干净目录 —— 上面那份已落地，会先撞「已落地」分支）。
    const dir2 = await mkdtemp(join(tmpdir(), 'cs-land-'))
    try {
      const reg2 = makeRegistry(dir2, {})
      await saveStoryboard(reg2, 'p1', storyboardDoc())
      await assert.rejects(() => landStoryboard(reg2, 'p1', 'v99'), /没有这个版本/u)
      assert.equal(reg2._canvas.nodes.length, 0, '选版失败不得碰画布')
      assert.equal(reg2._project.workflow.state, 'storyboarding')
    } finally {
      await rm(dir2, { recursive: true, force: true })
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('CV-305 写前重读：落地窗口内别处写进画布的节点不被覆盖丢掉', async () => {
  const { dir, reg } = await setup({ extraNodeAfterFirstRead: true })
  try {
    await saveStoryboard(reg, 'p1', storyboardDoc())
    await landStoryboard(reg, 'p1')
    assert.ok(
      reg._canvas.nodes.some((n) => n.id === 'extra-node'),
      '以入口快照为基底覆盖写会丢掉这个节点 —— 必须写前重读',
    )
    assert.equal(countNodes(reg, SEED_ANCHOR_TOOL), 1)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('CV-305 并发探测：写前重读发现锚点已出现 ⇒ 不重复 append（幂等探测是最后一道闸）', async () => {
  const { dir, reg } = await setup({ anchorAfterFirstRead: true })
  try {
    // 入口读时画布还空着，但真正要写的那一刻别处已经落了地（锚点出现）。
    const doc = storyboardDoc()
    await saveStoryboard(reg, 'p1', { ...doc, landed: { at: 1, sourceVersion: 'live', sections: doc.sections } })
    const result = await landStoryboard(reg, 'p1')

    assert.equal(result.resumed, true)
    assert.equal(countNodes(reg, SEED_ANCHOR_TOOL), 1, '锚点只该有外来那一个 —— 再 append 一次就是 2 个')
    assert.equal(countNodes(reg, SEED_SHOT_TOOL), 0, '不得追加第二套分镜卡')
    assert.equal(reg._project.workflow.state, 'executing', '状态仍应补齐（那是缺的那一步）')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('CV-305 bindings 自愈：反查表被清空后，续做按画布实况重建（回写通道不永久断链）', async () => {
  const { dir, reg } = await setup()
  try {
    await saveStoryboard(reg, 'p1', storyboardDoc())
    await landStoryboard(reg, 'p1')
    const filled = (await loadStoryboard(reg, 'p1')).document
    assert.ok(Object.keys(filled.bindings).length > 0, '首落应写入 bindings')

    // 复刻「bindings 丢了」：手工清空 + 把状态拨回（构造一个「落了一半」的态）。
    const { saveStoryboard: save } = await import('../lib/storyboard-store.js')
    await save(reg, 'p1', { ...filled, bindings: {} })
    reg._project.workflow.state = 'storyboarding'

    await landStoryboard(reg, 'p1')
    const healed = (await loadStoryboard(reg, 'p1')).document
    const ids = new Set(reg._canvas.nodes.map((n) => n.id))
    const entries = Object.entries(healed.bindings)
    assert.ok(entries.length > 0, 'bindings 必须被重建')
    for (const [sbRef, binding] of entries) {
      if (binding.canvasNodeId !== undefined) {
        assert.ok(ids.has(binding.canvasNodeId), `自愈后 bindings[${sbRef}] 必须指向画布上真实存在的节点`)
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// 评审 SB-06（TOCTOU）：落地事务窗口内活副本被改 ⇒ 停手，而不是落一份过时的料
// ---------------------------------------------------------------------------

test('CV-305 TOCTOU：落活副本时活副本在窗口内被改 ⇒ 拒绝且零痕迹', async () => {
  const { dir, reg } = await setup({ sectionsMutatedAfterLoad: true })
  try {
    await saveStoryboard(reg, 'p1', storyboardDoc())
    await assert.rejects(() => landStoryboard(reg, 'p1'), /落地过程中被修改/u)

    const after = (await loadStoryboard(reg, 'p1')).document
    assert.equal(after.landed, null, '复核不过不得写 landed')
    assert.equal(reg._canvas.nodes.length, 0, '复核不过不得碰画布')
    assert.equal(reg._project.workflow.state, 'storyboarding')
    assert.equal(reg._log.length, 0, '一次写操作都不该发生')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// 接线守卫：服务端能「续做」还不够 —— UI 必须放行，否则整件事不可达
// ---------------------------------------------------------------------------

test('CV-305 接线守卫：「已落地但没落完」时落地按钮必须可点（服务端能续、UI 禁用 = 白做）', () => {
  const frame = sourceOf('client/StudioFrame.tsx')

  assert.match(
    frame,
    /const sbLandedHalfway = sbVersions\?\.landed != null && workflow\?\.state !== 'executing'/u,
    '「落了一半」的判据＝landed 已写 ∧ state 未进 executing（两处都取自客户端已有状态，不额外发请求）',
  )
  assert.match(
    frame,
    /disabled=\{landing \|\| \(sbLanded && !sbLandedHalfway\)\}/u,
    '禁用条件必须排除「落了一半」——否则续做在界面上根本点不到',
  )
  assert.doesNotMatch(
    frame,
    /disabled=\{landing \|\| sbLanded\}/u,
    '旧写法（landed 即禁用）会让「落了一半」的死局复现',
  )
  // 「落了一半」时不给「关闭」：画布还空着，关掉正是「流程断了」的观感（CV-296 的初衷）。
  assert.match(frame, /\{workflow\?\.state !== 'storyboarding' && \(/u, '关闭按钮的条件只看 state')
  assert.doesNotMatch(frame, /state !== 'storyboarding' \|\| sbLanded/u, '不得再把 sbLanded 混进关闭条件')
})
