/**
 * D-08（2026-11-24）：配音绑镜 —— `tts_voiceover` 收 `shotRefs`。
 *
 * ## 抓的是什么 bug
 *
 * 「历程视图一行一镜」落地后真实项目取证（圣经故事 / 35 节点 / 4 镜）：4 条
 * `tts_voiceover` 的 `sourceIds` **全是空数组** ⇒ 判不到镜 ⇒ 配音全部留在「音频」
 * 节，镜行里永远缺配音格。查代码，根因不在模型漏参，而是**工具结构上无法表达**：
 * `tts_narration.lines[]` 只有 `text`，`tts_voiceover` 只有 `sourceUrls` /
 * `sourceNodeIds`（要调用方自己拼出卡节点 id 才能绑镜）。与此同时
 * `image_generate` / `video_generate` / `video_composite` 都早就有 `shotRefs`，
 * 走 `resolveShotRefs` 一条通道 —— 配音缺的就是这一格。
 *
 * ## 这一份守六件事
 *
 *  ① **契约面**：`tts_voiceover` 的参数表里真的出现 `shotRefs`（模型看不见就永远不传）；
 *  ② **解析真的接线**：「分镜 2」这种写法经 `resolveShotRefs` 落到**卡片节点 id** 上，
 *     而不是把原字符串塞进 sourceIds；
 *  ③ **落卡血缘**：新音频节点的 `sourceIds` 含该卡，且**进得了该镜的行**（布局侧消费验证）；
 *  ④ **不静默丢**：解析不到的镜号必须报错（静默丢会让同一个缺陷以「查不出原因」复现）；
 *  ⑤ **重配合并**：`replaces` + `shotRefs` 把卡**并进**既有血缘，不覆盖旧的参考链；
 *  ⑥ **声明落盘但不污染请求**：`generationPrompt.shotNodeIds` 记下绑镜声明，
 *     请求体里不得出现该字段（后端没有它）。
 *
 * 直连 Host 侧编译产物 lib/*.js。运行：corepack yarn workspace canvas-studio test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStudioTools } from '../lib/host-tools.js'
import { ProjectRegistry } from '../lib/projects.js'
import { computeWaterfallLayout } from '../lib/canvas-waterfall.js'

// 本文件只验「绑镜 → 血缘 → 落行」，故事板落地门属另一道闸（storyboard-gate.test.mjs），
// 其余生产路径测试同样用这个开关隔离（filename-consumability / generate / quality-check）。
process.env.CANVAS_STUDIO_ENFORCE_STORYBOARD_LANDED = '0'

/** 生成任务四段式桩：create 202 → poll → download 票据 → 签名地址字节；顺手记下请求体。 */
function stubSpeechFetch(sink) {
  globalThis.fetch = async (url, init = {}) => {
    const text = String(url)
    if (text.includes('/api/v1/health')) {
      return { ok: true, status: 200, json: async () => ({ status: 'ok' }), text: async () => '' }
    }
    if (init.method === 'POST' && /\/v1\/generations(\?|$)/u.test(text)) {
      sink.push(String(init.body ?? ''))
      return {
        ok: true,
        status: 202,
        json: async () => ({
          id: 'cccccccc-cccc-4ccc-8ccc-000000000001', operation: 'txt2speech', status: 'queued',
          version: 1, progress: 0, billing_status: 'held', terminal: false, outputs: [], error: null,
        }),
      }
    }
    if (text.includes('/poll')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: 'cccccccc-cccc-4ccc-8ccc-000000000001', operation: 'txt2speech', status: 'succeeded',
          version: 2, progress: 100, billing_status: 'committed', terminal: true, result_status: 'ready',
          outputs: [{
            ordinal: 0, type: 'audio', mime_type: 'audio/mpeg',
            content_url: '/v1/generations/x/content/0', download_url: '/v1/generations/x/download/0',
          }],
          error: null,
        }),
      }
    }
    if (text.includes('/download/')) {
      const bytes = Buffer.from([1, 2, 3, 4])
      return {
        ok: true,
        status: 200,
        json: async () => ({
          url: 'https://blob.example.test/signed/0', headers: {}, expires_at: '2026-11-24T09:00:00Z',
          size_bytes: bytes.length,
          checksum_sha256: '9f64a747e1b97f131fabb6b447296c9b6f0201e79fb3c5356e6c77e89b6a806a',
        }),
      }
    }
    if (text.startsWith('https://blob.example.test/signed/')) {
      return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]), text: async () => '' }
    }
    // 音色锚重传（`tts_narration` 的 first-line 策略会 promote 第一段产物）：
    // presign → PUT 直传 → complete 三段。少了这几条，多段旁白在第二段就挂。
    if (init.method === 'POST' && text.includes('/v1/assets/presign')) {
      return {
        ok: true,
        status: 201,
        json: async () => ({
          asset: { id: 'dddddddd-dddd-4ddd-8ddd-000000000001', type: 'audio', status: 'pending', filename: 'ref-0000.mp3' },
          upload_url: 'https://blob.example.test/put/anchor-1',
          headers: { 'content-type': 'audio/mpeg' },
        }),
      }
    }
    if (init.method === 'PUT' && text.startsWith('https://blob.example.test/put/')) {
      return { ok: true, status: 200, text: async () => '' }
    }
    if (init.method === 'POST' && text.includes('/v1/assets/complete')) {
      return { ok: true, status: 200, json: async () => ({ id: 'dddddddd-dddd-4ddd-8ddd-000000000001', status: 'ready', type: 'audio' }) }
    }
    return { ok: false, status: 404, text: async () => '' }
  }
}

/** 工作区 + 注册表 + 两张分镜卡（镜 1 / 镜 2）。 */
async function makeWorkspace(prefix) {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  const registry = new ProjectRegistry(dir)
  const project = await registry.create('配音绑镜')
  await mkdir(registry.assetsDir(project.id), { recursive: true })
  const cards = [1, 2].map(no => ({
    id: `card-${no}`,
    kind: 'text',
    title: `分镜 ${no} · 特写`,
    text: `镜 ${no} 正文`,
    x: 0,
    y: no * 200,
    width: 360,
    height: 220,
    createdAt: 1000 + no,
    toolName: 'submit_storyboard_for_approval',
    origin: 'agent',
    sourceIds: [],
    operationType: 'storyboard',
  }))
  await registry.writeCanvas(project.id, [...cards])
  const tools = createStudioTools(registry, 3005)
  const voice = tools.find(tool => tool.name === 'tts_voiceover')
  assert.ok(voice, 'tts_voiceover 必须已注册')
  const narration = tools.find(tool => tool.name === 'tts_narration')
  assert.ok(narration, 'tts_narration 必须已注册')
  return { dir, registry, project, voice, narration, cards }
}

/** 工具执行上下文（`exec.agent.session.header.cwd` 决定项目归属）。 */
const EXEC = cwd => ({ agent: { session: { header: { cwd } } }, signal: AbortSignal.timeout(15000) })

// ---------------------------------------------------------------------------
// ① 契约面：参数表里必须有 shotRefs
// ---------------------------------------------------------------------------

test('D-08 契约：tts_voiceover 暴露 shotRefs（与出图/出片同一条绑镜通道）', async () => {
  const ws = await makeWorkspace('cs-voice-bind-schema-')
  try {
    const param = ws.voice.parameters.properties.shotRefs
    assert.ok(param, 'tts_voiceover 必须声明 shotRefs —— 否则模型没有任何合法入参可表达「这句属于哪一镜」')
    assert.equal(param.type, 'array', 'shotRefs 是数组（可同时声明多个镜，与 image_generate 一致）')
    assert.match(String(param.description), /分镜/u, '参数说明必须写清可传「分镜 N」这类写法')
    assert.match(String(ws.voice.description), /shotRefs/u, '工具描述必须提醒模型传 —— 只加参数不写描述，模型仍然不会用')
  } finally {
    await rm(ws.dir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// ②③ 端到端：解析 → sourceIds → 落进该镜的行
// ---------------------------------------------------------------------------

test('D-08 端到端：「分镜 2」解析成卡节点 id 写进 sourceIds，配音落进镜 2 那一行', async () => {
  const ws = await makeWorkspace('cs-voice-bind-ok-')
  try {
    const sink = []
    stubSpeechFetch(sink)
    const res = await ws.voice.execute(
      { text: '洪水来了，四十昼夜的雨。', shotRefs: ['分镜 2'] },
      EXEC(ws.project.dir),
    )
    const doc = await ws.registry.readCanvas(ws.project.id)
    const node = doc.nodes.find(candidate => candidate.id === res.nodeId)
    assert.ok(node, '配音节点必须真在画布上')
    assert.equal(node.kind, 'audio')
    assert.ok(node.sourceIds.includes('card-2'),
      `sourceIds 必须含被绑的分镜卡（解析后的节点 id），实际：${JSON.stringify(node.sourceIds)}`)
    assert.ok(!node.sourceIds.includes('分镜 2'), '不许把「分镜 2」原串塞进血缘 —— 血缘只存节点 id')

    // 布局侧消费验证：这条配音真的进得了镜 2 的行（而不是留在「音频」节）。
    const layout = computeWaterfallLayout(doc.nodes)
    const tray = layout.trays.find(entry => entry.shot === 2)
    assert.ok(tray, '镜 2 必须成行')
    assert.ok(tray.nodeIds.includes(res.nodeId), '绑了镜的配音必须进该镜的行')
    assert.ok(!layout.sections.some(section => section.stage === 'audio'),
      '绑镜配音不得再落进「音频」节（这正是 D-08 的病灶）')
  } finally {
    await rm(ws.dir, { recursive: true, force: true })
  }
})

test('D-08 并集：shotRefs 与 sourceNodeIds 合并且去重，幽灵 id 不进血缘', async () => {
  const ws = await makeWorkspace('cs-voice-bind-union-')
  try {
    stubSpeechFetch([])
    const res = await ws.voice.execute(
      { text: '水势浩大。', shotRefs: ['分镜 1', 'card-1'], sourceNodeIds: ['card-1', 'ghost-id'] },
      EXEC(ws.project.dir),
    )
    const node = (await ws.registry.readCanvas(ws.project.id)).nodes.find(entry => entry.id === res.nodeId)
    assert.deepEqual(node.sourceIds, ['card-1'],
      '同一张卡经两条通道声明只留一份；指向已不存在节点的 id 不许进血缘')
  } finally {
    await rm(ws.dir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// ④ 不静默丢
// ---------------------------------------------------------------------------

test('D-08 解析失败必须报错（不许静默丢绑镜）', async () => {
  const ws = await makeWorkspace('cs-voice-bind-miss-')
  try {
    stubSpeechFetch([])
    await assert.rejects(
      () => ws.voice.execute({ text: '方舟被水抬起。', shotRefs: ['分镜 9'] }, EXEC(ws.project.dir)),
      /分镜卡「分镜 9」未找到/u,
      '写错的镜号必须在 execute 内抛错 —— 静默丢绑镜会让配音默默回到「音频」节，无人能查',
    )
    const doc = await ws.registry.readCanvas(ws.project.id)
    assert.equal(doc.nodes.length, 2, '被拒的调用不得留下音频节点（拒收先于落卡）')
  } finally {
    await rm(ws.dir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// ⑤ 重配合并
// ---------------------------------------------------------------------------

test('D-08 重配：replaces + shotRefs 把卡并进既有血缘，不覆盖旧的参考链', async () => {
  const ws = await makeWorkspace('cs-voice-bind-retry-')
  try {
    stubSpeechFetch([])
    const kf = {
      id: 'kf-1', kind: 'image', title: '关键帧', url: `/canvas-studio/assets/${ws.project.id}/kf.png`,
      x: 400, y: 0, width: 260, height: 146, createdAt: 900, origin: 'agent', sourceIds: ['card-1'],
    }
    const oldVoice = {
      id: 'voice-old', kind: 'audio', title: '配音', url: `/canvas-studio/assets/${ws.project.id}/old.mp3`,
      x: 700, y: 0, width: 480, height: 168, createdAt: 950, origin: 'agent',
      toolName: 'tts_voiceover', sourceIds: ['kf-1'], lyrics: '旧词',
    }
    const doc = await ws.registry.readCanvas(ws.project.id)
    await ws.registry.writeCanvas(ws.project.id, [...doc.nodes, kf, oldVoice])

    await ws.voice.execute(
      { text: '新词。', replaces: 'voice-old', shotRefs: ['分镜 1'] },
      EXEC(ws.project.dir),
    )
    const after = await ws.registry.readCanvas(ws.project.id)
    const node = after.nodes.find(entry => entry.id === 'voice-old')
    assert.ok(node, 'replaces 必须原地重写，不许堆新卡')
    assert.equal(after.nodes.length, 4, '不新增节点')
    assert.deepEqual([...node.sourceIds].sort(), ['card-1', 'kf-1'],
      '显式绑镜并入既有血缘（旧的 kf-1 不许被覆盖掉 —— 覆盖会莫名断掉画布上已有的连线）')
    assert.equal(node.lyrics, '新词。', '文本同步重写')
  } finally {
    await rm(ws.dir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// ⑥ 声明落盘 / 请求体不被污染
// ---------------------------------------------------------------------------

test('D-08 声明落盘：generationPrompt.shotNodeIds 记下绑镜，请求体里没有该字段', async () => {
  const ws = await makeWorkspace('cs-voice-bind-prompt-')
  try {
    const sink = []
    stubSpeechFetch(sink)
    const res = await ws.voice.execute(
      { text: '晨雾漫过茶园。', shotRefs: ['分镜 1'] },
      EXEC(ws.project.dir),
    )
    const node = (await ws.registry.readCanvas(ws.project.id)).nodes.find(entry => entry.id === res.nodeId)
    const declared = JSON.parse(node.generationPrompt)
    assert.deepEqual(declared.shotNodeIds, ['card-1'], '绑镜声明随节点落盘（与出图 / 出片同口径，供审计与重放）')
    assert.equal(declared.prompt, '晨雾漫过茶园。', '合成文本仍在 prompt 位（没被声明挤掉）')

    assert.equal(sink.length, 1, '应恰好发起一次生成请求')
    assert.ok(sink[0].includes('晨雾漫过茶园。'), '合成文本必须照原样进请求体')
    assert.ok(!sink[0].includes('shotNodeIds'),
      'shotNodeIds 是宿主侧血缘声明，**不许**进请求体（后端 txt2speech 没有这个字段）')
  } finally {
    await rm(ws.dir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// ⑦ 多段旁白：tts_narration 的 lines[].shotRef（逐句绑镜）
// ---------------------------------------------------------------------------

test('D-08b 契约：tts_narration 的 lines[] 暴露 shotRef（逐句绑镜的唯一入口）', async () => {
  const ws = await makeWorkspace('cs-narr-bind-schema-')
  try {
    const item = ws.narration.parameters.properties.lines.items.properties
    const param = item.shotRef
    assert.ok(param, 'lines[].shotRef 必须声明 —— 此前 lines[] 只有 text，多段旁白结构上无法表达「这句属于哪一镜」')
    assert.equal(param.type, 'string', '逐句绑镜用单值（一句话只属于一镜；一句要跨两镜就该拆成两句）')
    assert.match(String(param.description), /分镜/u, '参数说明必须写清可传「分镜 N」这类写法')
    assert.match(String(ws.narration.description), /shotRef/u, '工具描述必须提醒模型逐句传 —— 只加参数不写描述，模型仍然不会用')
  } finally {
    await rm(ws.dir, { recursive: true, force: true })
  }
})

test('D-08b 端到端：多段旁白逐句各绑自己那一镜，分别落进镜 1 / 镜 2 的行', async () => {
  const ws = await makeWorkspace('cs-narr-bind-ok-')
  try {
    const sink = []
    stubSpeechFetch(sink)
    const res = await ws.narration.execute({
      lines: [
        { text: '洪水来了，四十昼夜的雨。', shotRef: '分镜 1' },
        { text: '水势浩大，方舟被水抬起。', shotRef: '分镜 2' },
      ],
      fps: 30,
    }, EXEC(ws.project.dir))

    assert.equal(res.clips.length, 2, '两段旁白应各落一张音频卡')
    const doc = await ws.registry.readCanvas(ws.project.id)
    const nodeOf = id => doc.nodes.find(entry => entry.id === id)
    const [first, second] = res.clips
    assert.deepEqual(nodeOf(first.nodeId).sourceIds, ['card-1'], '第 1 段只绑镜 1 的卡')
    assert.deepEqual(nodeOf(second.nodeId).sourceIds, ['card-2'],
      '第 2 段必须绑镜 2 —— 整批共用第一个 ref 是这里最容易出、也最难看出来的错')
    assert.deepEqual(JSON.parse(nodeOf(second.nodeId).generationPrompt).shotNodeIds, ['card-2'],
      '绑镜声明逐段落盘（不是只记第一段的）')

    // 布局侧消费：两段各进自己那一行（此前全部堆在「音频」节）。
    const layout = computeWaterfallLayout(doc.nodes)
    const trayOf = shotNo => layout.trays.find(entry => entry.shot === shotNo)
    assert.ok(trayOf(1).nodeIds.includes(first.nodeId), '第 1 段配音进镜 1 的行')
    assert.ok(trayOf(2).nodeIds.includes(second.nodeId), '第 2 段配音进镜 2 的行')
    assert.ok(!trayOf(2).nodeIds.includes(first.nodeId), '第 1 段不许串到镜 2 的行里')
    assert.ok(!layout.sections.some(section => section.stage === 'audio'), '绑了镜的旁白不再落「音频」节')

    assert.equal(sink.length, 2, '两段 = 两次合成请求')
    assert.ok(!sink.some(body => body.includes('shotNodeIds')), 'shotNodeIds 是宿主侧声明，不许进请求体')
  } finally {
    await rm(ws.dir, { recursive: true, force: true })
  }
})

test('D-08b 部分绑镜：没写 shotRef 的段落保持无血缘（整片通铺旁白照旧）', async () => {
  const ws = await makeWorkspace('cs-narr-bind-mixed-')
  try {
    stubSpeechFetch([])
    const res = await ws.narration.execute({
      lines: [
        { text: '镜内旁白。', shotRef: '分镜 1' },
        { text: '片尾通铺旁白。' },
      ],
      fps: 30,
    }, EXEC(ws.project.dir))
    const doc = await ws.registry.readCanvas(ws.project.id)
    const nodeOf = id => doc.nodes.find(entry => entry.id === id)
    assert.deepEqual(nodeOf(res.clips[0].nodeId).sourceIds, ['card-1'])
    assert.deepEqual(nodeOf(res.clips[1].nodeId).sourceIds, [],
      '没写 shotRef 的段落不许被顺手绑上别人的镜')
  } finally {
    await rm(ws.dir, { recursive: true, force: true })
  }
})

test('D-08b 整批先校验：某段镜号写错时一段都不合成（不烧额度）', async () => {
  const ws = await makeWorkspace('cs-narr-bind-early-')
  try {
    const sink = []
    stubSpeechFetch(sink)
    await assert.rejects(
      () => ws.narration.execute({
        lines: [{ text: '一', shotRef: '分镜 1' }, { text: '二', shotRef: '分镜 9' }],
        fps: 30,
      }, EXEC(ws.project.dir)),
      /分镜卡「分镜 9」未找到/u,
      '写错的镜号必须报错（静默丢会让多段旁白默默回到「音频」节）',
    )
    assert.equal(sink.length, 0,
      '整批 ref 必须在任何一段合成之前校验完 —— 否则第 1 段已落卡、额度已花，才发现第 2 段写错')
    const doc = await ws.registry.readCanvas(ws.project.id)
    assert.equal(doc.nodes.length, 2, '被拒的调用不得留下音频节点')
  } finally {
    await rm(ws.dir, { recursive: true, force: true })
  }
})
