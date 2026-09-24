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
import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createStudioTools } from '../lib/host-tools.js'

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'src')

/** 剥掉注释再读源码 —— 注释里的示例会把「接线守卫」喂饱。 */
function sourceOf(relative) {
  return readFileSync(join(SRC_DIR, relative), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
}

/** 打桩 fetch：health 放行；POST 生成/上传返回结构化结果；产物 URL 下载返回字节。
 * 后端 0.5.0：视频提交 202 + job_id，状态/结果走 /api/v1/jobs/*（桩按 URL 分流）。 */
function stubFetch(mediaUrl = 'https://media.example/out.png') {
  const calls = []
  const jobId = 'job-test-1'
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
      if (String(url).includes('image2video')) {
        return {
          ok: true,
          status: 202,
          json: async () => ({ job_id: jobId, status: 'pending', status_url: `/api/v1/jobs/${jobId}`, cancel_url: `/api/v1/jobs/${jobId}/cancel`, result_url: `/api/v1/jobs/${jobId}/result` }),
        }
      }
      return { ok: true, json: async () => ({ full_url: mediaUrl, filename: 'gen.png' }) }
    }
    if (String(url).includes(`/api/v1/jobs/${jobId}/result`)) {
      return { ok: true, status: 200, json: async () => ({ prompt_id: jobId, filename: 'gen.mp4', full_url: mediaUrl, duration: 8.5 }) }
    }
    if (String(url).includes(`/api/v1/jobs/${jobId}`)) {
      return { ok: true, status: 200, json: async () => ({ job_id: jobId, status: 'completed', create_time: 1, execution_end_time: 2, execution_error: null }) }
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
  resolveFalApiKey: async () => '', // 阶段 4：fal key 未配置（空串），该 mock 场景不走 fal
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
 * 工具执行上下文（会话 cwd 绑定项目目录）。
 *
 * `concludeTurn` 是 dsh `ToolRunContext` 的**必需**成员：提交审批的工具靠它在
 * 提交那一刻终止 agent 回合（DD-09 的硬停）。打桩必须带上，否则 submit_* 会以
 * `exec.concludeTurn is not a function` 失败 —— 那条报错与审批语义毫无关系。
 * 这里顺便记下调用次数，供「提交即结束回合」的行为断言使用。
 */
let concludeTurnCalls = 0
const EXEC = (cwd) => ({
  agent: { session: { header: { cwd } } },
  signal: new AbortController().signal,
  concludeTurn: () => { concludeTurnCalls += 1 },
})

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

test('DD-09：提交即结束回合 —— confirm 调 concludeTurn，auto 不调（否则放手跑会一步一停）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-gate-'))
  try {
    stubFetch()
    const confirmReg = makeRegistry({ initialWorkflow: { mode: 'confirm', state: 'drafting' }, assetsDir: dir })
    concludeTurnCalls = 0
    await runTool(createStudioTools(confirmReg, 0, cfg), 'submit_storyboard_for_approval', { storyboard: STORYBOARD_MD }, dir)
    assert.equal(concludeTurnCalls, 1, 'confirm 提交后必须结束回合（dsh 的 concludesTurn 机制）')

    const autoReg = makeRegistry({ initialWorkflow: { mode: 'auto', state: 'drafting' }, assetsDir: dir })
    concludeTurnCalls = 0
    await runTool(createStudioTools(autoReg, 0, cfg), 'submit_storyboard_for_approval', { storyboard: STORYBOARD_MD }, dir)
    assert.equal(concludeTurnCalls, 0, 'auto 模式提交不得结束回合 —— 放手跑要一路跑完')
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
      () => runTool(tools, 'video_generate', { prompt: 'x' }, dir),
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
    const result = await runTool(tools, 'video_generate', { prompt: 'x' }, dir)
    assert.ok(result.url, 'generate 应返回产物 url')
    const node = reg._store.nodes.find((n) => n.toolName === 'video_generate')
    assert.ok(node, '批准后 video_generate 应正常落盘节点（端到端放行）')
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
    await runTool(tools, 'video_generate', { prompt: 'x' }, dir)
    assert.ok(reg._store.nodes.some((n) => n.toolName === 'video_generate'), '切到放手跑后应直接放行')
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
    // CV-196：这条用例过去用的是 mode: 'auto' —— 那是**旧行为**（auto 下照样提问）。
    // 现在 auto 走自动应答短路，不再落挂起问题，所以改为逐步确认（提问本来就是它的语义）。
    const reg = makeRegistry({ initialWorkflow: { mode: 'confirm', state: 'drafting' }, assetsDir: dir })
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

test('CV-196：放手跑下 ask_user_choice 不提问、不落卡片、不等待 —— 直接按默认规格回话', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-gate-'))
  try {
    const reg = makeRegistry({ initialWorkflow: { mode: 'auto', state: 'executing' }, assetsDir: dir })
    stubFetch()
    const tools = createStudioTools(reg, 0, cfg)
    const started = Date.now()
    const result = await runTool(tools, 'ask_user_choice', { question: '时长？', options: ['15s', '30s（推荐）'] }, dir)
    const elapsed = Date.now() - started

    // ① 画布上不许弹出用户没打算答的卡片 —— 这是用户唯一看得见的症状。
    assert.equal(reg._store.pendingQuestion, null, 'auto 下不得写入挂起问题（否则画布弹卡片）')
    // ② 不许进轮询。判据取「远小于一次轮询间隔（1500ms）」而不是「小于 10 分钟」：
    //    后者过于宽松，连「等了一轮」都放过。
    assert.ok(elapsed < 500, `auto 下应立即返回，实测 ${elapsed}ms —— 进轮询就说明短路没生效`)
    // ③ 答案必须带着规格回给模型，否则它下一轮还会再问一次。
    assert.match(result.text, /放手跑/u)
    assert.match(result.text, /「30s（推荐）」/u)
    assert.match(result.text, /锁定规格/u)
    assert.match(result.text, /目标时长 30s（兜底）/u)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('CV-196：放手跑下项目预置规格压过「推荐项」—— 弹窗锁的画幅不会被一道提问改掉', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-gate-'))
  try {
    const reg = makeRegistry({ initialWorkflow: { mode: 'auto', state: 'executing' }, assetsDir: dir })
    reg._project.plan = { aspectRatio: '9:16', targetDuration: 15 }
    stubFetch()
    const tools = createStudioTools(reg, 0, cfg)
    const result = await runTool(tools, 'ask_user_choice', { question: '画幅？', options: ['16:9（推荐）', '9:16'] }, dir)
    assert.match(result.text, /画幅 9:16（项目预置）/u, '项目预置是硬约束，必须出现在回给模型的规格里')
    assert.match(result.text, /目标时长 15s（项目预置）/u)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('关键帧提交：confirm 模式下 submit_keyframes_for_approval 把 state 置为 keyframe_review 并提示等待确认', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-gate-'))
  try {
    const reg = makeRegistry({ initialWorkflow: { mode: 'confirm', state: 'executing' }, assetsDir: dir })
    stubFetch()
    const tools = createStudioTools(reg, 0, cfg)
    const result = await runTool(tools, 'submit_keyframes_for_approval', { summary: '8 镜关键帧已出齐' }, dir)
    assert.equal(reg._project.workflow.state, 'keyframe_review', 'confirm 模式提交关键帧后应进入 keyframe_review')
    assert.match(result.text, /确认关键帧/u, '提交后应提示等待用户点击「确认关键帧」')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('关键帧闸门：keyframe_review 下受控工具 video_generate 被拦截（不触达 Drama）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-gate-'))
  try {
    const reg = makeRegistry({ initialWorkflow: { mode: 'confirm', state: 'keyframe_review' }, assetsDir: dir })
    const calls = stubFetch()
    const tools = createStudioTools(reg, 0, cfg)
    await assert.rejects(
      () => runTool(tools, 'video_generate', { prompt: 'x' }, dir),
      /确认关键帧|关键帧/u,
    )
    assert.equal(calls.length, 0, 'keyframe_review 下应在触达 Drama 之前拦截')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('关键帧确认放行：confirm_keyframes 翻成 executing 后，video_generate 真正放行', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-gate-'))
  try {
    const reg = makeRegistry({ initialWorkflow: { mode: 'confirm', state: 'keyframe_review' }, assetsDir: dir })
    const calls = stubFetch()
    const tools = createStudioTools(reg, 0, cfg)
    // 复刻 /workflow POST confirm_keyframes → registry.updateWorkflow({state:'executing'})
    await reg.updateWorkflow('p1', { state: 'executing' })
    assert.equal(reg._project.workflow.state, 'executing')
    const result = await runTool(tools, 'video_generate', { prompt: 'x' }, dir)
    assert.ok(result.url, '确认关键帧后 video_generate 应返回产物 url')
    assert.ok(calls.some((c) => c.method === 'POST'), '确认后应真实触达 Drama 生成端点')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('关键帧提交放行：auto 模式 submit_keyframes_for_approval 为空操作，保持 executing', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-gate-'))
  try {
    const reg = makeRegistry({ initialWorkflow: { mode: 'auto', state: 'executing' }, assetsDir: dir })
    stubFetch()
    const tools = createStudioTools(reg, 0, cfg)
    const result = await runTool(tools, 'submit_keyframes_for_approval', { summary: 'x' }, dir)
    assert.equal(reg._project.workflow.state, 'executing', 'auto 模式提交关键帧应保持 executing 直接放行')
    assert.match(result.text, /放手跑/u)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// CV-051：关键帧「打回重出」
// ---------------------------------------------------------------------------

test('CV-051：keyframe_review 下逐镜 image_generate 本就被门禁拦死（打回必须解状态才动得了）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-gate-'))
  try {
    const reg = makeRegistry({ initialWorkflow: { mode: 'confirm', state: 'keyframe_review' }, assetsDir: dir })
    const calls = stubFetch()
    const tools = createStudioTools(reg, 0, cfg)
    await assert.rejects(
      () => runTool(tools, 'image_generate', { prompt: '重出这一镜' }, dir),
      /关键帧/u,
      '审阅态下 image_generate 属 PRODUCING_TOOLS —— 这正是「打回」不能只发消息的原因',
    )
    assert.equal(calls.length, 0, '拦截必须在触达 Drama 之前')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('CV-051：打回关键帧（reject_keyframes 翻成 executing）后逐镜重出真正放行', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-gate-'))
  try {
    const reg = makeRegistry({ initialWorkflow: { mode: 'confirm', state: 'keyframe_review' }, assetsDir: dir })
    const calls = stubFetch()
    const tools = createStudioTools(reg, 0, cfg)
    // 复刻 /workflow POST reject_keyframes → registry.updateWorkflow({state:'executing'})
    await reg.updateWorkflow('p1', { state: 'executing' })
    assert.equal(reg._project.workflow.state, 'executing')
    const result = await runTool(tools, 'image_generate', { prompt: '重出这一镜' }, dir)
    assert.ok(result.url, '打回后 image_generate 应返回产物 url')
    assert.ok(calls.some((call) => call.method === 'POST'), '打回后应真实触达 Drama 生成端点')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('CV-051 接线守卫：打回关键帧从 UI 按钮一路接到路由动作（缺一环就是「判定对了但没接」）', () => {
  const routes = sourceOf('routes.ts')
  const api = sourceOf('client/api.ts')
  const contracts = sourceOf('client/contracts.ts')
  const index = sourceOf('client/index.ts')
  const frame = sourceOf('client/StudioFrame.tsx')
  const notice = sourceOf('approval-notice.ts')
  const gate = sourceOf('approval-gate.ts')

  assert.match(routes, /body\.action === 'reject_keyframes'/, '路由必须认识 reject_keyframes')
  // 打回与确认同落 executing —— 停在审阅态 agent 一步都动不了。
  assert.match(routes, /'confirm_keyframes'[\s\S]{0,400}?state: 'executing'[\s\S]{0,400}?'reject_keyframes'[\s\S]{0,200}?state: 'executing'/u,
    'reject_keyframes 必须与 confirm_keyframes 一样把 state 置回 executing')
  assert.match(api, /'reject_keyframes'/, 'API 动作联合类型要含 reject_keyframes')
  assert.match(contracts, /rejectKeyframes\(projectId: string, feedback\?: string\): Promise<void>/, 'actions 契约要暴露 rejectKeyframes')
  assert.match(index, /const rejectKeyframes = async/, 'client 要实现 rejectKeyframes')
  assert.match(index, /wakeAgent\(trimmed !== undefined && trimmed\.length > 0\s*\n?\s*\? `关键帧已打回/u, '打回必须带意见唤醒 agent（否则 AI 只会在旧状态里等）')
  assert.match(frame, /onClick=\{handleRejectKeyframes\}/, '确认条上必须有「打回重出」按钮')
  assert.match(frame, /handleRejectKeyframes\(\)/, '按钮必须接到 handler')
  assert.match(frame, /maxLength=\{500\}/, '意见输入框受 500 字上限约束（与分镜驳回同一条交互）')

  // 文案层：等的是两个决策，不能还只说「确认关键帧」。
  assert.match(notice, /keyframes:[\s\S]*?打回重出/u, 'approval-notice 的 keyframes.waiting 要提到打回')
  assert.match(gate, /keyframe_review: '[^']*打回重出/u, '门禁拒绝文案要提到打回重出')
})
