/**
 * 故事板强约束 **L3 · auto 模式自动落地** 的行为级守卫。
 *
 * 病史（会话 #5，2026-10-25）：187.6 分钟、219 步、`render_composition` **0 次** ——
 * 3 小时一次都没渲染，却已经在出图、量像素，用户 @36min 当场质问「故事板完成了吗？
 * 就开始设计图片？」。根因不是模型不听话，而是**门禁放行与承诺不一致**：
 *   - `screenplay.md` 第 6 条与 `awaitingLanding` 的注释都向 agent 承诺
 *     「auto 模式写完故事板由 Host 自动落地」；
 *   - 实现不存在；
 *   - 而 `approval-gate` 的 `mode !== 'confirm' → return null` 对 auto 全放行。
 * 三者叠加 ⇒ auto 模式下**未落地的故事板照常出片**，且没有任何一处会报错。
 *
 * 这个文件钉四件事，任何一件退化都会让上面那条链重新潜伏：
 *   1. auto + 收尾信号 + 阻断项清零 ⇒ **真的落地**（画布出现分镜卡、状态进 executing）；
 *   2. auto + 阻断项非空 ⇒ **不落**（「先完善再落地」，别把半成品浇进画布）；
 *   3. auto + 阻断项清零但**没给收尾信号** ⇒ 不落 —— `blockers` 只答「能不能落」，
 *      不答「写完没有」；只看它会写在 §04 那一笔就落地，§03/§05 再也写不进去；
 *   4. confirm 模式行为不变（落地仍由用户点按钮），开关可一键退回旧行为。
 *
 * 手法与 `storyboard-stage-gate.test.mjs` / `storyboard-land-resume.test.mjs` 同款：
 * 驱动**真实工具**（`lib/host-tools.js`）+ 假 registry（同时满足工具与落地执行体的接口），
 * 不写字符串级软断言。
 *
 * 运行：node --test tests/storyboard-auto-land.test.mjs（需先 build）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStudioTools } from '../lib/host-tools.js'
import { SEED_ANCHOR_TOOL, SEED_SHOT_TOOL } from '../lib/contracts/canvas.js'
import { loadStoryboard } from '../lib/storyboard-store.js'

const cfg = {
  dramaApiBase: () => 'http://localhost:9999',
  maxVideoSeconds: () => 15,
  resolveDramaApiKey: async () => 'fake',
  resolveFalApiKey: async () => '',
  defaultAspectRatio: () => '16:9',
  defaultVideoProvider: () => 'drama',
  workflowMode: () => 'confirm',
  hitlStoryboard: () => true,
  hitlKeyframe: () => false,
  autoRetry: () => true,
  maxParallel: () => 2,
  assetDir: () => '',
  autoSave: () => true,
  autoSaveInterval: () => 30,
}

/**
 * 假 registry：同时满足 `createStudioTools`（list/getProject/storyboardFile）与
 * `landStoryboard`（readCanvas/writeCanvas/updateWorkflow）两个面。
 * `failCanvasWrite` 用来复刻「故事板已落盘、投影写画布失败」这条半截路径。
 */
function makeRegistry(dir, options = {}) {
  const project = {
    id: 'p1',
    name: 'P1',
    dir,
    createdAt: '1',
    updatedAt: '1',
    workflow: { mode: options.mode ?? 'auto', state: 'storyboarding' },
  }
  const canvas = { version: 1, nodes: [], assets: [] }
  return {
    list: async () => [project],
    getProject: async () => project,
    storyboardFile: (id) => join(dir, `${id}.storyboard.json`),
    readCanvas: async () => structuredClone(canvas),
    writeCanvas: async (_id, nodes, _view, assets) => {
      if (options.failCanvasWrite === true) throw new Error('模拟画布写失败')
      canvas.nodes = [...nodes]
      if (assets !== undefined) canvas.assets = [...assets]
    },
    updateWorkflow: async (_id, patch) => {
      project.workflow = { ...project.workflow, ...patch }
      return project
    },
    _canvas: canvas,
    _project: project,
  }
}

const EXEC = (cwd) => ({
  agent: { session: { header: { cwd } } },
  signal: new AbortController().signal,
  concludeTurn: () => {},
})

async function runTool(tools, name, args, cwd) {
  const tool = tools.find((t) => t.name === name)
  if (!tool) throw new Error(`tool not found: ${name}`)
  return tool.execute(args, EXEC(cwd))
}

/** 能过 `validateForSeed` 的完整一笔（1 token / 1 scene / 1 shot）。 */
const PASSABLE_WRITE = {
  title: '《雨夜来信》',
  meta: JSON.stringify({ genre: '民国悬疑', targetDuration: 30, aspect: '16:9' }),
  visual: JSON.stringify({ tokens: [{ k: '色彩', v: '冷调青灰' }] }),
  storyboard: JSON.stringify({
    scenes: [{
      id: 'S1',
      title: '开场',
      shots: [{
        id: 'S1-Sh1',
        duration: 5,
        frames: 120,
        camera: '缓慢推进',
        visual: '空走廊，尽头一扇门',
        audio: '滴水声',
        promptEn: 'a dark corridor, slow push in',
        backup: false,
      }],
    }],
  }),
  awaitingLanding: true,
}

/** 只有 title + meta —— 阻断项必然非空（缺 §02 token / §04 scene）。 */
const BLOCKED_WRITE = {
  title: '《雨夜来信》',
  meta: JSON.stringify({ genre: '民国悬疑', targetDuration: 30, aspect: '16:9' }),
  awaitingLanding: true,
}

async function harness(mode, options, body) {
  const dir = await mkdtemp(join(tmpdir(), 'cs-autoland-'))
  try {
    const registry = makeRegistry(dir, { mode, ...options })
    await body({ dir, registry, tools: createStudioTools(registry, 0, cfg) })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

const countNodes = (registry, toolName) =>
  registry._canvas.nodes.filter((node) => node.toolName === toolName).length

test('L3 ①：auto + 收尾信号 + 阻断项清零 ⇒ 真的落地（画布出分镜卡、状态进 executing）', async () => {
  await harness('auto', {}, async ({ dir, registry, tools }) => {
    const result = await runTool(tools, 'write_storyboard', PASSABLE_WRITE, dir)

    assert.match(result.text, /已自动落地/u, 'auto 模式必须真的调落地，而不是只承诺')
    assert.equal(countNodes(registry, SEED_ANCHOR_TOOL), 1, '画布应恰好一个种子锚点')
    assert.equal(countNodes(registry, SEED_SHOT_TOOL), 1, '画布应出现 1 张分镜卡')
    assert.equal(registry._project.workflow.state, 'executing', '落地后状态必须推 execating')

    const doc = (await loadStoryboard(registry, 'p1')).document
    assert.ok(doc.landed !== null, 'landed 必须落盘（否则产线工具的门禁仍会拦）')
  })
})

test('L3 ②：auto + 阻断项非空 ⇒ 不落（先完善再落地，别浇半成品）', async () => {
  await harness('auto', {}, async ({ dir, registry, tools }) => {
    const result = await runTool(tools, 'write_storyboard', BLOCKED_WRITE, dir)

    assert.doesNotMatch(result.text, /已自动落地/u, '有阻断项时不许落地')
    assert.match(result.text, /阻断项/u, '必须把阻断项报出来，让 agent 知道要补什么')
    assert.equal(countNodes(registry, SEED_ANCHOR_TOOL), 0, '画布不许出现锚点')
    assert.equal(registry._project.workflow.state, 'storyboarding', '状态不许被推走')

    const doc = (await loadStoryboard(registry, 'p1')).document
    assert.equal(doc.landed, null, 'landed 必须仍为 null')
  })
})

test('L3 ③：auto + 阻断项清零但没给收尾信号 ⇒ 不落（防在 §04 那一笔就浇死画布）', async () => {
  await harness('auto', {}, async ({ dir, registry, tools }) => {
    const { awaitingLanding: _omit, ...midWrite } = PASSABLE_WRITE
    const result = await runTool(tools, 'write_storyboard', midWrite, dir)

    assert.doesNotMatch(result.text, /已自动落地/u,
      'blockers 只答「能不能落」不答「写完没有」：写完 §04 时 blockers 已清零，此时落地会让 §03/§05 再也写不进去')
    assert.equal(countNodes(registry, SEED_SHOT_TOOL), 0, '画布必须还是空的')
    assert.match(result.text, /收尾/u, '必须告诉 agent 差一个收尾信号，否则它会卡在「为什么没落地」')
  })
})

test('L3 ④：confirm 模式行为不变 —— 收尾信号只结束回合，落地仍由用户点按钮', async () => {
  await harness('confirm', {}, async ({ dir, registry, tools }) => {
    const result = await runTool(tools, 'write_storyboard', PASSABLE_WRITE, dir)

    assert.doesNotMatch(result.text, /已自动落地/u, 'confirm 模式不许自动落地（用户没点就是没确认）')
    assert.equal(countNodes(registry, SEED_SHOT_TOOL), 0, '画布必须还是空的')
    assert.match(result.text, /确认落地/u, '必须把「谁去点按钮」说清楚')
    assert.equal(registry._project.workflow.state, 'storyboarding')
  })
})

test('L3 ⑤：开关关闭 ⇒ 退回旧行为（便于上线后一键回滚）', async () => {
  const saved = process.env.CANVAS_STUDIO_AUTO_LAND_STORYBOARD
  process.env.CANVAS_STUDIO_AUTO_LAND_STORYBOARD = '0'
  try {
    await harness('auto', {}, async ({ dir, registry, tools }) => {
      const result = await runTool(tools, 'write_storyboard', PASSABLE_WRITE, dir)
      assert.doesNotMatch(result.text, /已自动落地/u, '开关为 0 时不许落地')
      assert.equal(countNodes(registry, SEED_SHOT_TOOL), 0)
    })
  } finally {
    if (saved === undefined) delete process.env.CANVAS_STUDIO_AUTO_LAND_STORYBOARD
    else process.env.CANVAS_STUDIO_AUTO_LAND_STORYBOARD = saved
  }
})

test('L3 ⑥：画布写失败不吞错 —— 故事板已存、落地失败要说出来且指向重试入口', async () => {
  await harness('auto', { failCanvasWrite: true }, async ({ dir, registry, tools }) => {
    const result = await runTool(tools, 'write_storyboard', PASSABLE_WRITE, dir)

    assert.match(result.text, /已保存/u, '故事板那一步是成功的，必须如实说')
    assert.match(result.text, /自动落地失败/u, '落地失败不许静默（吞掉就等于回到「承诺但不做」）')
    assert.match(result.text, /确认落地/u, '必须给出真的走得通的重试入口')
    assert.doesNotMatch(result.text, /已自动落地/u, '失败时不许报成功')
    assert.equal(countNodes(registry, SEED_SHOT_TOOL), 0, '画布未变更')
  })
})

test('L3 ⑦：落地后重写被阶段守卫拦下 ⇒ 连调两次不会重复铸节点', async () => {
  await harness('auto', {}, async ({ dir, registry, tools }) => {
    await runTool(tools, 'write_storyboard', PASSABLE_WRITE, dir)
    assert.equal(countNodes(registry, SEED_SHOT_TOOL), 1)

    await assert.rejects(
      () => runTool(tools, 'write_storyboard', PASSABLE_WRITE, dir),
      /拍摄定稿|整体重写/u,
      '落地即单向终点：第二次整体重写必须被阶段守卫拒',
    )
    assert.equal(countNodes(registry, SEED_SHOT_TOOL), 1, '分镜卡不能被重复铸一份')
  })
})
