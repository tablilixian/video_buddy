/**
 * 落地前后门禁（2026-10-22 真机事故）回归守卫。
 *
 * ## 事故
 *
 * 项目「生成一段苹果手机广告」：`write_storyboard` 落盘（`landed:null`，工具结果明说
 * 「等用户点确认落地」）→ 同一回合里 agent 继续跑。带 `shotRefs` 的 `image_generate`
 * 被硬闸正确拦下（「分镜卡未找到」），agent 转而 `cat canvas.json` 自查，然后**改传
 * `storyboardRef:"S1-Sh1"` 成功**，连出两张逐镜效果图。
 *
 * 根因是判据缝隙而非模型没读懂 skill：
 * - `shotBound` 只认 `shotRefs`，`storyboardRef` 的 shot id 形态不进判据；
 * - `SKILL.md` 当时明文教模型「凡出关键帧必传 `storyboardRef=<shot id>`」——
 *   被拦后按 skill 指示换通道，**必然**绕过。
 *
 * ## 本文件守什么
 *
 * 1. **旁路已封**：落地前 shot id 形态的 `storyboardRef` 与 `shotRefs` 同等被拦，
 *    且拦截发生在触达后端之前（零成本、零副作用）。
 * 2. **样张通道没被误伤**：`storyboardRef='look'` 落地前照常放行。
 * 3. **落地后不产生双份真相**：shot id 回写降级为附注，`refImage` 不被改写。
 * 4. **软预算**：落地前不绑镜出图每周期 ≤3 张，超限报 `CS-USER-ERR`；答复后重置。
 * 5. **回合卫生**：`awaitingLanding` 在阻断项清零时真的 `concludeTurn()`。
 *
 * 全部用例**驱动真实工具**（`lib/host-tools.js` + 假 registry），不做「源码里有这行
 * 字」的软断言 —— 门禁的价值是拦得住。反向变异验证过：把 `shotBound` 还原成只认
 * `shotNodeIds`，用例 ① 立即变红。
 *
 * 运行：corepack yarn test:smoke（需先 build）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStudioTools } from '../lib/host-tools.js'
import { createStoryboard, emptyStoryboardSections } from '../lib/contracts/storyboard.js'
import { LOOK_BUDGET_PER_CYCLE, resetLookBudget } from '../lib/look-budget.js'

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

/** 打桩 fetch：只保留生成 + 产物下载两条路径，够跑通 `image_generate`。 */
function stubFetch(mediaUrl = 'https://media.example/out.png') {
  const calls = []
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).includes('/api/v1/health')) {
      return { ok: true, status: 200, json: async () => ({ status: 'ok' }), text: async () => '' }
    }
    calls.push({ url: String(url), method: init.method ?? 'GET' })
    if (init.method === 'POST') {
      return { ok: true, json: async () => ({ full_url: mediaUrl, filename: 'gen.png' }) }
    }
    if (String(url) === mediaUrl) return { ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]) }
    return { ok: false, status: 404 }
  }
  return calls
}

/** 假 registry：`getProject` + `storyboardFile` + 画布读写（与 workflow-gate 同款）。 */
function makeRegistry({ workflow, dir }) {
  const project = {
    id: 'p1',
    name: 'P1',
    dir,
    createdAt: '1',
    updatedAt: '1',
    workflow: { mode: 'confirm', state: 'storyboarding', ...workflow },
  }
  const store = { nodes: [] }
  return {
    list: async () => [project],
    getProject: async () => project,
    updateWorkflow: async (id, patch) => {
      project.workflow = { ...project.workflow, ...patch }
      return project
    },
    storyboardFile: (id) => join(dir, `${id}.storyboard.json`),
    readCanvas: async () => ({ version: 3, nodes: store.nodes }),
    writeCanvas: async (id, ns) => { store.nodes = [...ns] },
    appendCanvasNode: async (id, node) => { store.nodes.push(node) },
    assetsDir: () => dir,
    _project: project,
    _store: store,
  }
}

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

/** 落地前（或落地后）的 storyboard.json：`landed` 决定「是否已落到画布」。 */
function storyboardDoc({ landed }) {
  const doc = createStoryboard({
    projectId: 'p1',
    title: '《一分钟》',
    meta: { genre: '产品广告', targetDuration: 30, aspect: '16:9' },
    now: 1,
    sections: {
      ...emptyStoryboardSections(),
      '00_creative': { brief: '苹果手机的一分钟广告' },
      '02_visual': { tokens: [{ k: '色彩', v: '黑白极简' }, { k: '光', v: '单侧硬光' }] },
      '04_storyboard': {
        scenes: [{
          id: 'S1',
          title: '开场',
          shots: [{
            id: 'S1-Sh1',
            duration: 3,
            frames: 72,
            camera: 'Push in',
            visual: '手机静置于石面',
            audio: '环境声',
            promptEn: 'a phone on stone',
            backup: false,
          }],
        }],
      },
    },
  })
  // `landed` = 已落到画布（落地闸写的快照）；null = 还在拍摄定稿阶段。
  return { ...doc, landed }
}

async function harness({ workflow, landed = null, seed = true }, body) {
  const dir = await mkdtemp(join(tmpdir(), 'cs-landgate-'))
  try {
    const registry = makeRegistry({ workflow, dir })
    if (seed) {
      await writeFile(
        registry.storyboardFile('p1'),
        `${JSON.stringify(storyboardDoc({ landed }), null, 2)}\n`,
        'utf8',
      )
    }
    resetLookBudget('p1')
    const tools = createStudioTools(registry, 0, cfg)
    await body({ dir, registry, tools })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

const LANDED = { at: 1, sourceVersion: 'live', sections: {} }

test('① 落地前 storyboardRef 传 shot id = 绑镜：被门禁拦下，且不触达后端', async () => {
  await harness({ workflow: { mode: 'confirm', state: 'storyboarding' } }, async ({ dir, tools }) => {
    const calls = stubFetch()
    await assert.rejects(
      () => runTool(tools, 'image_generate', { prompt: '逐镜效果图', storyboardRef: 'S1-Sh1' }, dir),
      /拍摄定稿|落地/u,
      'shot id 形态的 storyboardRef 必须与 shotRefs 同等被拦——否则就是本次事故的绕道',
    )
    assert.equal(calls.length, 0, '拦截必须在触达 Drama 之前（拦在生成之后等于没拦）')
  })
})

test('② 样张通道没被误伤：落地前 storyboardRef=look 照常出图并回写 §02', async () => {
  await harness({ workflow: { mode: 'confirm', state: 'storyboarding' } }, async ({ dir, registry, tools }) => {
    stubFetch()
    const result = await runTool(tools, 'image_generate', { prompt: '基调样张', storyboardRef: 'look' }, dir)
    assert.ok(result.url, '样张是澄清期的合法产出，不能被门禁挡')
    const doc = JSON.parse(await readFile(registry.storyboardFile('p1'), 'utf8'))
    assert.ok(doc.sections['02_visual'].lookRef, '样张必须挂到 §02 的 lookRef（用户要在覆盖层看到）')
  })
})

test('③ 落地后 storyboardRef 传 shot id：生成照常，但不改写 refImage（单一真相源在画布）', async () => {
  await harness({ workflow: { mode: 'confirm', state: 'executing' }, landed: LANDED }, async ({ dir, registry, tools }) => {
    stubFetch()
    const result = await runTool(tools, 'image_generate', { prompt: '关键帧', storyboardRef: 'S1-Sh1' }, dir)
    assert.ok(result.url, '落地后不该再拦生成')
    const doc = JSON.parse(await readFile(registry.storyboardFile('p1'), 'utf8'))
    const shot = doc.sections['04_storyboard'].scenes[0].shots[0]
    assert.equal(shot.refImage, undefined,
      '落地后 refImage 不再回写：分镜卡已按落地那一刻的定稿铸成，改写会让覆盖层与画布失配')
    assert.match((result.warnings ?? []).join(' '), /不再回写/u,
      '降级必须说出来（走 warnings 附注），否则 agent 以为挂上了')
  })
})

test('④ 落地前的 shotRefs 拒绝文案不得指路到已下线的「提交分镜」', async () => {
  await harness({ workflow: { mode: 'confirm', state: 'storyboarding' } }, async ({ dir, tools }) => {
    stubFetch()
    const error = await runTool(tools, 'image_generate', { prompt: 'x', shotRefs: ['S1-Sh1'] }, dir)
      .then(() => null, (cause) => cause)
    assert.ok(error, '落地前没有分镜卡，shotRefs 必须报错')
    const text = String(error.message ?? error)
    assert.doesNotMatch(text, /提交分镜/u,
      'REQ-022 后没有「提交分镜」工具：文案指向它，agent 会去查一个不存在的东西然后换参数绕道')
    assert.match(text, /确认落地/u, '必须把「等用户落地」说成唯一出路')
  })
})

test('⑤ 软预算：落地前不绑镜出图每周期封顶，超限报可操作错误', async () => {
  await harness({ workflow: { mode: 'confirm', state: 'storyboarding' } }, async ({ dir, tools }) => {
    stubFetch()
    for (let i = 0; i < LOOK_BUDGET_PER_CYCLE; i += 1) {
      await runTool(tools, 'image_generate', { prompt: `样张 ${String(i + 1)}` }, dir)
    }
    await assert.rejects(
      () => runTool(tools, 'image_generate', { prompt: '再出一张' }, dir),
      /ask_user_choice/u,
      '超预算时必须要求先问用户，否则「裸出十几张逐镜构图图」仍是敞开的',
    )
  })
})

test('⑥ 软预算可解锁：用户答复（resetLookBudget）后重新计周期', async () => {
  await harness({ workflow: { mode: 'confirm', state: 'storyboarding' } }, async ({ dir, tools }) => {
    stubFetch()
    for (let i = 0; i < LOOK_BUDGET_PER_CYCLE; i += 1) {
      await runTool(tools, 'image_generate', { prompt: `样张 ${String(i + 1)}` }, dir)
    }
    resetLookBudget('p1')
    const result = await runTool(tools, 'image_generate', { prompt: '用户同意了' }, dir)
    assert.ok(result.url, '用户点头后必须能继续出图——预算是软约束，不是禁令')
  })
})

test('⑦ 预算只管落地前：落地后关键帧出图不受影响', async () => {
  await harness({ workflow: { mode: 'confirm', state: 'executing' }, landed: LANDED }, async ({ dir, tools }) => {
    stubFetch()
    for (let i = 0; i < LOOK_BUDGET_PER_CYCLE + 2; i += 1) {
      await runTool(tools, 'image_generate', { prompt: `关键帧 ${String(i + 1)}` }, dir)
    }
  })
})

const READY_WRITE = {
  title: '《一分钟》',
  meta: JSON.stringify({ genre: '产品广告', targetDuration: 30, aspect: '16:9' }),
  visual: JSON.stringify({ tokens: [{ k: '色彩', v: '黑白极简' }] }),
  storyboard: JSON.stringify({
    scenes: [{
      id: 'S1',
      title: '开场',
      shots: [{
        id: 'S1-Sh1', duration: 3, frames: 72, camera: 'Push in',
        visual: '手机静置于石面', audio: '环境声', promptEn: 'a phone on stone', backup: false,
      }],
    }],
  }),
}

test('⑧ 收尾笔 awaitingLanding=true 且阻断项清零 → 真的结束回合', async () => {
  concludeTurnCalls = 0
  await harness({ workflow: { mode: 'confirm', state: 'storyboarding' } }, async ({ dir, tools }) => {
    const result = await runTool(tools, 'write_storyboard', { ...READY_WRITE, awaitingLanding: true }, dir)
    assert.equal(concludeTurnCalls, 1, '收尾笔必须硬停——「提示词停不住」已两次真机复现')
    assert.match(String(result.text ?? ''), /本回合到此结束/u)
  })
})

test('⑨ 中间笔不传 awaitingLanding：不结束回合（否则会把自己没写的节砍在半路）', async () => {
  concludeTurnCalls = 0
  await harness({ workflow: { mode: 'confirm', state: 'storyboarding' } }, async ({ dir, tools }) => {
    await runTool(tools, 'write_storyboard', { title: '《一分钟》' }, dir)
    assert.equal(concludeTurnCalls, 0, '分次写的中间笔不能 conclude')
  })
})

test('⑩ 有阻断项时 awaitingLanding 无效：不能带着缺项把回合交出去', async () => {
  concludeTurnCalls = 0
  await harness({ workflow: { mode: 'confirm', state: 'storyboarding' }, seed: false }, async ({ dir, tools }) => {
    const result = await runTool(tools, 'write_storyboard', { title: '《一分钟》', awaitingLanding: true }, dir)
    assert.equal(concludeTurnCalls, 0, '阻断项未清零时 concludeTurn 会让用户审一份不能落地的稿')
    assert.match(String(result.text ?? ''), /阻断项/u)
  })
})
