/**
 * P7 工作流门禁（HITL：逐步确认 / 放手跑 + 确认继续 / 打回重做）端到端冒烟测试。
 *
 * 目标：验证「由谁控制、能否正常工作」——闸门的事实源是项目 workflow.state，
 * 门禁在 host-tools.runGeneration（Host 侧硬拦截），状态翻转由 /workflow 路由
 * 委托 registry.updateWorkflow 完成，客户端按钮/模式切换只负责触发这些 action。
 *
 * 用假 registry（实现 tools 调用的接口）共享于工具执行与状态翻转之间，复刻
 * 真实单进程内「route 与 tool 共用同一 registry 实例」的语义；Drama 用 stubFetch
 * 打桩，产物下载/写盘走临时目录。
 *
 * 运行：corepack yarn workspace canvas-studio test:smoke
 *   或单独：node --test tests/workflow-gate.test.mjs （cwd = canvas-studio）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStudioTools } from '../lib/host-tools.js'

/** 打桩 fetch：health 放行；POST 生成/上传返回结构化结果；产物 URL 下载返回字节。 */
function stubFetch(mediaUrl = 'https://media.example/out.png') {
  const calls = []
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).includes('/api/v1/health')) {
      return { ok: true, status: 200, json: async () => ({ status: 'ok' }), text: async () => '' }
    }
    let body = null
    if (typeof init.body === 'string') {
      try { body = JSON.parse(init.body) } catch { body = init.body }
    }
    calls.push({ url: String(url), method: init.method ?? 'GET', body })
    if (init.method === 'POST') {
      if (String(url).includes('/upload')) return { ok: true, json: async () => ({ filename: 'ref.png' }) }
      return { ok: true, json: async () => ({ full_url: mediaUrl, filename: 'gen.png' }) }
    }
    if (String(url) === mediaUrl) return { ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]) }
    return { ok: false, status: 404 }
  }
  return calls
}

/** 可变的假 ProjectRegistry：tools 读取/翻转的工作流状态共享于同一实例。 */
function makeRegistry({ initialWorkflow, nodes = [], assetsDir }) {
  const project = {
    id: 'p1',
    name: 'P1',
    dir: assetsDir,
    createdAt: '1',
    updatedAt: '1',
    workflow: { mode: 'confirm', state: 'drafting', ...initialWorkflow },
  }
  const store = { nodes: [...nodes], pendingQuestion: null }
  return {
    list: async () => [project],
    getProject: async () => project,
    updateWorkflow: async (id, patch) => {
      project.workflow = { ...project.workflow, ...patch }
      return project
    },
    readCanvas: async () => ({ version: 3, nodes: store.nodes }),
    writeCanvas: async (id, ns) => { store.nodes = [...ns] },
    appendCanvasNode: async (id, node) => { store.nodes.push(node) },
    setPendingQuestion: async (id, q) => { store.pendingQuestion = q },
    answerPendingQuestion: async (id, value) => {
      if (!store.pendingQuestion) throw new Error('当前没有待回答的问题')
      store.pendingQuestion = { ...store.pendingQuestion, answer: value.trim() }
    },
    assetsDir: () => assetsDir,
    _project: project,
    _store: store,
  }
}

const cfg = {
  dramaApiBase: () => 'http://localhost:9999',
  maxVideoSeconds: () => 15,
  resolveDramaApiKey: async () => 'fake',
  defaultAspectRatio: () => '16:9',
  workflowMode: () => 'confirm',
  hitlStoryboard: () => true,
  hitlKeyframe: () => false,
  autoRetry: () => true,
  maxParallel: () => 2,
  assetDir: () => '',
  autoSave: () => true,
  autoSaveInterval: () => 30,
}

const EXEC = (cwd) => ({ agent: { session: { header: { cwd } } }, signal: new AbortController().signal })

async function runTool(tools, name, args, cwd) {
  const tool = tools.find((t) => t.name === name)
  if (!tool) throw new Error(`tool not found: ${name}`)
  return tool.execute(args, EXEC(cwd))
}

const STORYBOARD_MD = `| 镜号 | 景别 | 镜头运动 | 时长 | 画面描述 | 声音 |
| --- | --- | --- | --- | --- | --- |
| 1 | 远景 | 缓慢推进 | 5s | 村庄全貌 | 鸟鸣 |`

test('闸门：confirm+drafting 下，受控工具 video_generate 被硬拦截（不触达 Drama）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-gate-'))
  try {
    const reg = makeRegistry({ initialWorkflow: { mode: 'confirm', state: 'drafting' }, assetsDir: dir })
    const calls = stubFetch()
    const tools = createStudioTools(reg, 0, cfg)
    await assert.rejects(
      () => runTool(tools, 'video_generate', { prompt: 'x' }, dir),
      /submit_storyboard_for_approval|逐步确认|批准/u,
    )
    assert.equal(calls.length, 0, '闸门应在触达 Drama 之前拦截，fetch 调用数应为 0')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('放行边界：confirm+drafting 下，非受控工具 image_generate 不被闸门拦截（概念图可用）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-gate-'))
  try {
    const reg = makeRegistry({ initialWorkflow: { mode: 'confirm', state: 'drafting' }, assetsDir: dir })
    const calls = stubFetch()
    const tools = createStudioTools(reg, 0, cfg)
    await runTool(tools, 'image_generate', { prompt: '概念图' }, dir)
    const node = reg._store.nodes.find((n) => n.toolName === 'image_generate')
    assert.ok(node, 'image_generate 应正常落盘一个画布节点')
    assert.ok(calls.some((c) => c.method === 'POST'), '非受控工具应正常触达 Drama 生成端点')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('提交门禁：confirm 模式下 submit_storyboard_for_approval 把 state 置为 awaiting_approval 并落分镜卡', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-gate-'))
  try {
    const reg = makeRegistry({ initialWorkflow: { mode: 'confirm', state: 'drafting' }, assetsDir: dir })
    stubFetch()
    const tools = createStudioTools(reg, 0, cfg)
    const result = await runTool(tools, 'submit_storyboard_for_approval', { storyboard: STORYBOARD_MD, summary: '测试' }, dir)
    assert.equal(reg._project.workflow.state, 'awaiting_approval', 'confirm 模式提交后应进入 awaiting_approval')
    assert.match(result.text, /本回合到此结束/u, '提交后应提示回合结束、等待批准')
    assert.ok(reg._store.nodes.some((n) => n.toolName === 'submit_storyboard_for_approval'), '应落分镜卡节点')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('再次闸门：awaiting_approval 仍不等于 executing，受控工具继续被拦截', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-gate-'))
  try {
    const reg = makeRegistry({ initialWorkflow: { mode: 'confirm', state: 'awaiting_approval' }, assetsDir: dir })
    const calls = stubFetch()
    const tools = createStudioTools(reg, 0, cfg)
    await assert.rejects(
      () => runTool(tools, 'storyboard_generate', { prompt: 'x' }, dir),
      /等待用户批准|批准/u,
    )
    assert.equal(calls.length, 0, 'awaiting_approval 下仍不应触达 Drama')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('确认继续：approve 把 state 翻成 executing 后，受控工具真正放行并落盘节点', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-gate-'))
  try {
    const reg = makeRegistry({ initialWorkflow: { mode: 'confirm', state: 'awaiting_approval' }, assetsDir: dir })
    const calls = stubFetch()
    const tools = createStudioTools(reg, 0, cfg)
    // 这一步复刻 /workflow POST approve → registry.updateWorkflow({state:'executing'})
    await reg.updateWorkflow('p1', { state: 'executing' })
    assert.equal(reg._project.workflow.state, 'executing')
    const result = await runTool(tools, 'storyboard_generate', { prompt: 'x' }, dir)
    assert.ok(result.url, 'generate 应返回产物 url')
    const node = reg._store.nodes.find((n) => n.toolName === 'storyboard_generate')
    assert.ok(node, '批准后 storyboard_generate 应正常落盘节点（端到端放行）')
    assert.ok(calls.some((c) => c.method === 'POST'), '放行后应真实触达 Drama 生成端点')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('打回重做：reject 把 state 翻回 drafting，受控工具重新被拦截（需重新提交/批准）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-gate-'))
  try {
    const reg = makeRegistry({ initialWorkflow: { mode: 'confirm', state: 'executing' }, assetsDir: dir })
    const calls = stubFetch()
    const tools = createStudioTools(reg, 0, cfg)
    await reg.updateWorkflow('p1', { state: 'drafting' }) // 复刻 reject
    assert.equal(reg._project.workflow.state, 'drafting')
    await assert.rejects(() => runTool(tools, 'video_generate', { prompt: 'x' }, dir))
    assert.equal(calls.length, 0, '打回后闸门应重新关闭')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('放手跑覆盖：awaiting_approval 下切到 auto 模式应解除等待（state→executing），受控工具放行', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-gate-'))
  try {
    const reg = makeRegistry({ initialWorkflow: { mode: 'confirm', state: 'awaiting_approval' }, assetsDir: dir })
    const calls = stubFetch()
    const tools = createStudioTools(reg, 0, cfg)
    // 复刻 /workflow POST setMode=auto（routes：awaiting_approval + auto → executing）
    await reg.updateWorkflow('p1', { mode: 'auto', state: 'executing' })
    assert.equal(reg._project.workflow.state, 'executing')
    await runTool(tools, 'storyboard_generate', { prompt: 'x' }, dir)
    assert.ok(reg._store.nodes.some((n) => n.toolName === 'storyboard_generate'), '切到放手跑后应直接放行')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('放手跑全开：auto 模式 + submit 直接把 state 置为 executing，无需等待批准', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-gate-'))
  try {
    const reg = makeRegistry({ initialWorkflow: { mode: 'auto', state: 'drafting' }, assetsDir: dir })
    stubFetch()
    const tools = createStudioTools(reg, 0, cfg)
    const result = await runTool(tools, 'submit_storyboard_for_approval', { storyboard: STORYBOARD_MD }, dir)
    assert.equal(reg._project.workflow.state, 'executing', 'auto 模式提交应直接进入 executing')
    assert.match(result.text, /放手跑/u)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('点选澄清：ask_user_choice 落挂起问题，answerPendingQuestion 写入答案（Host 工具轮询据此回传）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-gate-'))
  try {
    const reg = makeRegistry({ initialWorkflow: { mode: 'auto', state: 'executing' }, assetsDir: dir })
    stubFetch()
    const tools = createStudioTools(reg, 0, cfg)
    await runTool(tools, 'ask_user_choice', { question: '时长？', options: ['15s', '30s（推荐）'] }, dir)
    assert.ok(reg._store.pendingQuestion, '应写入挂起问题')
    assert.equal(reg._store.pendingQuestion.options.length, 2)
    await reg.answerPendingQuestion('p1', '30s（推荐）')
    assert.equal(reg._store.pendingQuestion.answer, '30s（推荐）', '答案应被记录，供工具轮询读到后回传模型')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
