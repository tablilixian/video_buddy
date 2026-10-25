/**
 * 故事板强约束 **L1 · 单一放行点** 的守卫：任何产出类工具在「故事板未落地」时都不可能成功执行。
 *
 * 病史（会话 #5，2026-10-25）：187.6 分钟里 `render_composition` **0 次**，却在出图量像素；
 * 用户 @36 分钟质问「故事板完成了吗？就开始设计图片？」。三份判据互相放水 ——
 * `approval-gate` 的 `mode !== 'confirm' → 放行` 让 auto 全开、`state` 判据不看 `landed`。
 *
 * 这里钉三件事：
 *   1. **矩阵**：9 个产出工具 × {未落地, 已落地} × {confirm, auto} —— 未落地一律拦，
 *      已落地一律放行（**与 mode 无关**，这是 L1 的全部价值）；
 *   2. **名单对账**：`STORYBOARD_GATED_TOOLS` 必须 = `FORMAL_TOOLS` + `write_script`。
 *      两表分居两个模块（`FORMAL_TOOLS` 还要给 keyframe_review 分支用），所以必须
 *      同时 import 两处对账 —— 在单模块里自证会漏掉「新工具只加了一边」；
 *   3. **单一事实源**：`state` 故意改回 `storyboarding`，只要 `landed` 存在就仍放行。
 *
 * 运行：node --test tests/storyboard-gate.test.mjs（需先 build）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStudioTools } from '../lib/host-tools.js'
import { landStoryboard } from '../lib/storyboard-land.js'
import { saveStoryboard } from '../lib/storyboard-store.js'
import { STORYBOARD_GATED_TOOLS } from '../lib/storyboard-gate.js'
import { createStoryboard, emptyStoryboardSections } from '../lib/contracts/storyboard.js'

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

/** 受影响产线工具名（与被测名单分开写死，防「照抄名单」让测试永远绿）。 */
const PRODUCTION_TOOLS = [
  'video_generate',
  'video_composite',
  'compose_video',
  'extract_last_frame',
  'qc_shot',
  'music_generation',
  'tts_voiceover',
  'render_composition',
  'write_script',
]

function makeRegistry(dir, mode) {
  const project = {
    id: 'p1',
    name: 'P1',
    dir,
    createdAt: '1',
    updatedAt: '1',
    workflow: { mode, state: 'storyboarding' },
  }
  const canvas = { version: 1, nodes: [], assets: [] }
  return {
    list: async () => [project],
    getProject: async () => project,
    storyboardFile: (id) => join(dir, `${id}.storyboard.json`),
    readCanvas: async () => structuredClone(canvas),
    writeCanvas: async (_id, nodes, _view, assets) => {
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

async function call(tools, name, cwd, args = {}) {
  const tool = tools.find((t) => t.name === name)
  if (!tool) throw new Error(`tool not found: ${name}`)
  return tool.execute(args, EXEC(cwd)).then(() => null, (cause) => cause)
}

const isGateError = (error) => error !== null && /还没有落地故事板/u.test(String(error.message ?? error))

function passableDoc() {
  return createStoryboard({
    projectId: 'p1',
    title: '测试片',
    meta: { genre: '悬疑', targetDuration: 30, aspect: '16:9' },
    sections: {
      ...emptyStoryboardSections(),
      '02_visual': { tokens: [{ k: '色调', v: '冷调' }] },
      '04_storyboard': {
        scenes: [{
          id: 'S1',
          title: '开场',
          shots: [{ id: 'S1-Sh1', duration: 5, frames: 120, camera: '推进', visual: '走廊', audio: '滴水', backup: false }],
        }],
      },
    },
  })
}

async function harness(mode, body) {
  const dir = await mkdtemp(join(tmpdir(), 'cs-sbgate2-'))
  try {
    const registry = makeRegistry(dir, mode)
    await body({ dir, registry, tools: createStudioTools(registry, 0, cfg) })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('L1 ①：名单对账 —— STORYBOARD_GATED_TOOLS 必须等于 FORMAL_TOOLS + write_script', async () => {
  // 两表分居两个模块（`FORMAL_TOOLS` 还要给 keyframe_review 分支用），必须同时 import 两处。
  const { FORMAL_TOOLS } = await import('../lib/approval-gate.js')
  assert.deepEqual(
    [...STORYBOARD_GATED_TOOLS].filter((name) => name !== 'write_script').sort(),
    [...FORMAL_TOOLS].sort(),
    'gate 名单必须覆盖全部 FORMAL_TOOLS（新工具只加了一边就会红）',
  )
  assert.ok(STORYBOARD_GATED_TOOLS.has('write_script'),
    'write_script 必须挂 gate（它在阶段一写文案会在画布上留副本）')
  // 再与测试里**独立手写**的清单对一遍：防止两张表被同一次改动一起改错（对账变自证）。
  assert.deepEqual(
    [...STORYBOARD_GATED_TOOLS].sort(),
    [...PRODUCTION_TOOLS].sort(),
    '新增产出工具必须同时进本名单与 tests 里的独立清单',
  )
})

test('L1 ②：未落地 × confirm ⇒ 9 个产出工具全拦（CS-STORY-001）', async () => {
  await harness('confirm', async ({ dir, tools }) => {
    for (const name of PRODUCTION_TOOLS) {
      const error = await call(tools, name, dir)
      assert.ok(isGateError(error), `${name} 在未落地时必须被 gate 拦下（实际：${String(error?.message ?? '放行')}）`)
    }
  })
})

test('L1 ③：未落地 × auto ⇒ 仍然全拦（这是 L1 的全部意义：与 mode 无关）', async () => {
  await harness('auto', async ({ dir, tools }) => {
    for (const name of PRODUCTION_TOOLS) {
      const error = await call(tools, name, dir)
      assert.ok(isGateError(error), `${name} 在 auto 模式下同样必须被拦 —— 旧判据正是在这里放水的`)
    }
  })
})

test('L1 ④：已落地 ⇒ 全部放行（不再报 gate 错，允许它们各自失败在别的原因上）', async () => {
  await harness('confirm', async ({ dir, registry, tools }) => {
    await saveStoryboard(registry, 'p1', passableDoc())
    await landStoryboard(registry, 'p1')
    assert.ok(registry._project.workflow.state === 'executing')

    for (const name of PRODUCTION_TOOLS) {
      const error = await call(tools, name, dir)
      assert.equal(isGateError(error), false,
        `${name} 已落地后不该再被 gate 拦（实际：${String(error?.message ?? '放行')}）`)
    }
  })
})

test('L1 ⑤：state 是派生显示 —— 手工改回 storyboarding 只要 landed 仍在就放行', async () => {
  await harness('confirm', async ({ dir, registry, tools }) => {
    await saveStoryboard(registry, 'p1', passableDoc())
    await landStoryboard(registry, 'p1')
    // 复刻「历史数据不一致 / 迁移写坏」：landed 在，state 退回 storyboarding
    await registry.updateWorkflow('p1', { state: 'storyboarding' })

    const error = await call(tools, 'render_composition', dir)
    assert.equal(isGateError(error), false,
      '放行只认 landed：state 写坏了不该把门关掉（自愈只修显示、不当后门）')
  })
})

test('L1 ⑥：故事板文件损坏 ⇒ 报「读不出来」而不是沉默放行', async () => {
  await harness('confirm', async ({ dir, registry, tools }) => {
    await writeFile(join(dir, 'p1.storyboard.json'), '{ 这不是 JSON', 'utf8')
    const error = await call(tools, 'render_composition', dir)
    assert.ok(error, '损坏时不能放行')
    assert.match(String(error.message ?? error), /读不出来|无法确认/u,
      '损坏必须说清「读不出来」，而不是让 agent 以为只是没写')
    void registry
  })
})

test('L1 ⑦：开关关闭 ⇒ 全部放行（上线后一键回滚到旧行为）', async () => {
  const saved = process.env.CANVAS_STUDIO_ENFORCE_STORYBOARD_LANDED
  process.env.CANVAS_STUDIO_ENFORCE_STORYBOARD_LANDED = '0'
  try {
    await harness('auto', async ({ dir, tools }) => {
      for (const name of PRODUCTION_TOOLS) {
        const error = await call(tools, name, dir)
        assert.equal(isGateError(error), false, `${name} 在开关关闭时不该被 gate 拦`)
      }
    })
  } finally {
    if (saved === undefined) delete process.env.CANVAS_STUDIO_ENFORCE_STORYBOARD_LANDED
    else process.env.CANVAS_STUDIO_ENFORCE_STORYBOARD_LANDED = saved
  }
})
