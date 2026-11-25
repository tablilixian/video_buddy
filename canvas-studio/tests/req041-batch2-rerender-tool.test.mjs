/**
 * REQ-041 第 2 批 · `rerender_segment` 工具的**收参边界**（行为断言）。
 *
 * 单段重渲是本批唯一新增的产品面，它的可用性前提是「目标段唯一确定」：
 * 定位参数含糊 / manifest 不在盘上 / 段表对不齐 / 质量档拼错 —— 这四种都必须在
 * **动手渲之前**拒收，否则会渲出一段「看起来正常」的旧片（或错位的隔壁段）。
 *
 * 反向变异：把「两个定位参数同给」的检查删掉 ⇒ ①红；把 manifest 读取包一层
 * try/catch 静默返回空 ⇒ ③红。
 *
 * 注意：本工具在 `STORYBOARD_GATED_TOOLS` 里（与 render_composition 同口径），
 * 所以除第一条用例外，其余用例都把故事板闸关掉 —— 这条用例本身就是在测那道闸。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createStudioTools } from '../lib/host-tools.js'

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
  h3Model: () => 'h3',
  bgmModel: () => 'music',
  visionModel: () => 'vl',
  renderHost: () => 'auto',
}

function harness() {
  const root = mkdtempSync(join(tmpdir(), 'cs-rerender-tool-'))
  const dir = join(root, 'p1')
  mkdirSync(join(dir, 'assets'), { recursive: true })
  const project = {
    id: 'p1',
    name: 'P1',
    dir,
    createdAt: '1',
    updatedAt: '1',
    // auto：审批门（approvalGateMessage）直接放行，专测本工具自己的收参
    workflow: { mode: 'auto', state: 'executing' },
  }
  const registry = {
    list: async () => [project],
    getProject: async () => project,
    readCanvas: async () => ({ version: 1, nodes: [], assets: [] }),
    projectDir: () => dir,
    assetsDir: () => join(dir, 'assets'),
    storyboardFile: (id) => join(dir, `${id}.storyboard.json`),
    updateWorkflow: async () => project,
    writeCanvas: async () => {},
  }
  return {
    dir,
    registry,
    tools: createStudioTools(registry, 0, cfg),
    dispose: () => rmSync(root, { recursive: true, force: true }),
  }
}

const EXEC = (cwd) => ({
  agent: { session: { header: { cwd } } },
  signal: new AbortController().signal,
  concludeTurn: () => {},
})

async function call(tools, name, cwd, args = {}) {
  const tool = tools.find((candidate) => candidate.name === name)
  if (!tool) throw new Error(`tool not found: ${name}`)
  return tool.execute(args, EXEC(cwd)).then(() => null, (cause) => cause)
}

const messageOf = (error) => String(error?.message ?? error ?? '')

function withStoryboardGate(value, body) {
  const saved = process.env.CANVAS_STUDIO_ENFORCE_STORYBOARD_LANDED
  if (value === null) delete process.env.CANVAS_STUDIO_ENFORCE_STORYBOARD_LANDED
  else process.env.CANVAS_STUDIO_ENFORCE_STORYBOARD_LANDED = value
  return Promise.resolve()
    .then(body)
    .finally(() => {
      if (saved === undefined) delete process.env.CANVAS_STUDIO_ENFORCE_STORYBOARD_LANDED
      else process.env.CANVAS_STUDIO_ENFORCE_STORYBOARD_LANDED = saved
    })
}

/** 一份两段、段表对齐、能切出段的 manifest。 */
function seededManifest(dir) {
  const manifest = {
    meta: {
      fps: 30,
      durationInFrames: 400,
      width: 1920,
      height: 1080,
      segments: [
        { id: 's1', startFrame: 0, frames: 200 },
        { id: 's2', startFrame: 200, frames: 200 },
      ],
    },
    audio: { voiceOver: [{ src: '/canvas-studio/assets/p1/v1.mp3', startFrame: 10 }] },
    tracks: [],
  }
  mkdirSync(join(dir, 'build'), { recursive: true })
  writeFileSync(join(dir, 'build', 'manifest.json'), JSON.stringify(manifest))
  return manifest
}

test('故事板未落地 ⇒ 单段重渲与 render_composition 同口径被拦（不许偷偷出片）', async () => {
  await withStoryboardGate(null, async () => {
    const h = harness()
    try {
      const error = await call(h.tools, 'rerender_segment', h.dir, { segmentId: 's1' })
      assert.ok(error, '未落地必须拒收')
      assert.match(messageOf(error), /还没有落地故事板|故事板/u)
    } finally {
      h.dispose()
    }
  })
})

test('定位参数：两个都给 / 都不给都拒收（目标段必须唯一确定）', async () => {
  await withStoryboardGate('0', async () => {
    const h = harness()
    try {
      const both = await call(h.tools, 'rerender_segment', h.dir, { shotNodeId: 'n1', segmentId: 's1' })
      assert.match(messageOf(both), /二选一/u)

      const neither = await call(h.tools, 'rerender_segment', h.dir, {})
      assert.match(messageOf(neither), /必须给/u)
    } finally {
      h.dispose()
    }
  })
})

test('manifest 不在盘上 ⇒ 明确指向落盘工具，不静默渲旧片', async () => {
  await withStoryboardGate('0', async () => {
    const h = harness()
    try {
      const error = await call(h.tools, 'rerender_segment', h.dir, { segmentId: 's1' })
      assert.match(messageOf(error), /build\/manifest\.json/u)
      assert.match(messageOf(error), /scaffold_manifest|patch_spec_section/u,
        '拒收必须给下一步，不能只说「读不到」')
    } finally {
      h.dispose()
    }
  })
})

test('段不存在 ⇒ 拒收并列出可用的段（禁止猜一段去渲）', async () => {
  await withStoryboardGate('0', async () => {
    const h = harness()
    try {
      seededManifest(h.dir)
      const error = await call(h.tools, 'rerender_segment', h.dir, { segmentId: 's9' })
      assert.match(messageOf(error), /s9/u)
      assert.match(messageOf(error), /spec:s1/u, '必须把现有段名列出来')
    } finally {
      h.dispose()
    }
  })
})

test('quality 拼错 ⇒ 拒收（不许静默降级成 standard）', async () => {
  await withStoryboardGate('0', async () => {
    const h = harness()
    try {
      seededManifest(h.dir)
      const error = await call(h.tools, 'rerender_segment', h.dir, { segmentId: 's1', quality: 'hd' })
      // 两层都拒：框架按 `parameters.quality.enum` 先拦（agent 通道），
      // 工具内还有一道同形守卫（与 render_composition 一致，挡住绕过 schema 的直调）。
      assert.match(messageOf(error), /must be one of|quality 非法/u)
    } finally {
      h.dispose()
    }
  })
})

test('shotNodeId 指向没有段指针的卡 ⇒ 拒收（与 patch_spec_section 同一判据）', async () => {
  await withStoryboardGate('0', async () => {
    const h = harness()
    try {
      seededManifest(h.dir)
      h.registry.readCanvas = async () => ({
        version: 1,
        assets: [],
        nodes: [{ id: 'card1', kind: 'text', title: '分镜卡', x: 0, y: 0, width: 1, height: 1, createdAt: 1, origin: 'agent' }],
      })
      const error = await call(h.tools, 'rerender_segment', h.dir, { shotNodeId: 'card1' })
      assert.match(messageOf(error), /段指针|segmentRef/u)
    } finally {
      h.dispose()
    }
  })
})
