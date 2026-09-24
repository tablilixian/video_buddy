/**
 * CV-155 契约测试：两类文件名的可消费性 + 参考名自愈。
 *
 * 背景（2026-09-11 真实会话定案，见 docs/api-probe/2026-09-11-filename-consumability.md）：
 * Drama 后端有两类文件名，**可消费性完全不同** ——
 *   - 上传句柄 `ref-xxxxxxxx.png`：可作带文件端点入参；
 *   - 后端产物名 `img_01287_.png` / `z-image_00852_.png`：作入参**约 0.1s 内 500**。
 * 而 `analyzeImage`（image2vl / qc_shot 共用）此前直连 callDramaRaw、没有任何自愈，
 * 于是 `qc_shot` 结构性 0 成功。
 *
 * 本文件锁住三条行为：
 *   1. 判据 `isDramaProductName` 认产物名、不误伤上传句柄（纯函数）；
 *   2. `@ref` 引用产物节点时 Host **主动**重传换句柄并回写节点（不等失败）；
 *   3. `analyzeImage` 拿到产物名时**失败自愈**：反查节点 → 重传 → 换名重试一次；
 *      反查不中时抛**原始错误**（不掩盖真因）。
 *
 * 运行：corepack yarn workspace canvas-studio run test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isDramaProductName, looksLikeCanvasNodeId, healReferenceFilename } from '../lib/generate.js'
import { createStudioTools, refCandidatePool } from '../lib/host-tools.js'

// ---------------------------------------------------------------------------
// 1. 判据：纯函数，直连单测
// ---------------------------------------------------------------------------
test('CV-155：isDramaProductName 认产物名（计数器段形态），不误伤上传句柄', () => {
  // 实测出现过的产物名（2026-09-11 会话）——必须全部命中。
  const products = [
    'img_01287_.png',
    'img_01290_.png',
    'z-image_00852_.png',
    'output_00012.mp4',
    'shot_1234.png',
  ]
  for (const name of products) {
    assert.equal(isDramaProductName(name), true, `${name} 应判为产物名`)
  }
  // 上传句柄与本地资产名——必须全部不命中（误判只会多一次上传，但也不该发生）。
  const handles = [
    'ref-40bf8914.png',
    'ref-deadbeef.mp4',
    'bb465e619602.png',
    'a4ed-37ac8d71907c.png',
    'f8c48fa3-b1d0-4b31-b46d-9a4ae40d1aa3.png',
    'b009-4588-ba5b-f68ba66c52ed.png',
    'A.png',
    'raw.png',
  ]
  for (const name of handles) {
    assert.equal(isDramaProductName(name), false, `${name} 不应判为产物名`)
  }
})

// ---------------------------------------------------------------------------
// 2. 打桩：带状态的注册表 + 可编排的 fetch
// ---------------------------------------------------------------------------
function stubRegistry(nodes, dir) {
  let current = nodes.map((node) => ({ ...node }))
  return {
    registry: {
      list: async () => [{ id: 'p1', name: 'P1', dir, createdAt: 1 }],
      getProject: async () => ({ workflow: { mode: 'auto', state: 'idle' } }),
      assetsDir: () => dir,
      readCanvas: async () => ({ version: 4, nodes: current }),
      writeCanvas: async (_projectId, next) => { current = next },
      appendCanvasNode: async () => {},
    },
    nodes: () => current,
  }
}

const EXEC = (cwd) => ({ agent: { session: { header: { cwd } } }, signal: AbortSignal.timeout(5000) })

/** 编排 fetch：按 url 子串匹配路由，respond(第几次命中, 请求体) 返回 { status, json, text }。 */
function stubFetch(routes) {
  const calls = []
  const original = globalThis.fetch
  globalThis.fetch = async (url, init = {}) => {
    const href = String(url)
    let body = null
    if (typeof init.body === 'string') {
      try { body = JSON.parse(init.body) } catch { body = init.body }
    }
    calls.push({ url: href, body })
    const route = routes.find((entry) => href.includes(entry.match))
    let spec = { status: 200, json: {} }
    if (route !== undefined) {
      const hits = calls.filter((call) => call.url.includes(route.match)).length
      spec = route.respond(hits, body)
    }
    return {
      ok: spec.status < 400,
      status: spec.status,
      json: async () => spec.json ?? {},
      text: async () => spec.text ?? '',
      arrayBuffer: async () => new Uint8Array([1, 2, 3]),
    }
  }
  return { calls, restore: () => { globalThis.fetch = original } }
}

/** 一个「生成产物节点」：filename 是后端产物名，url 指向本地落盘资产。 */
function productNode(overrides = {}) {
  return {
    id: 'shot1',
    kind: 'image',
    title: '分镜 1 关键帧',
    url: '/canvas-studio/assets/p1/shot1.png',
    filename: 'img_01287_.png',
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    createdAt: 1,
    origin: 'agent',
    sourceIds: [],
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// 3. @ref 引用产物节点 → Host 主动换句柄（不等失败）
// ---------------------------------------------------------------------------
test('CV-155：@ref 引用产物节点时主动重传换句柄，并回写节点 filename', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-cv155-'))
  try {
    await writeFile(join(dir, 'shot1.png'), Buffer.from([1, 2, 3]))
    const { registry, nodes } = stubRegistry([productNode()], dir)
    const tools = createStudioTools(registry, 3005)
    const vl = tools.find((t) => t.name === 'image2vl')
    assert.ok(vl, 'image2vl 工具应存在')

    const { calls, restore } = stubFetch([
      { match: '/generate/upload', respond: () => ({ status: 200, json: { name: 'ref-cafe1234.png' } }) },
      { match: '/image2vl', respond: () => ({ status: 200, json: { output: '画面描述' } }) },
    ])
    try {
      const res = await vl.execute({ filename: '@ref[分镜 1 关键帧]', prompt: '描述画面' }, EXEC(dir))
      assert.equal(res.text, '画面描述')
      const vlCall = calls.find((call) => call.url.includes('/image2vl'))
      assert.ok(vlCall, '应调用 image2vl')
      assert.equal(vlCall.body.image, 'ref-cafe1234.png', '入参应已是重传后的句柄，而不是产物名')
      assert.equal(nodes()[0].filename, 'ref-cafe1234.png', '节点 filename 应被回写为可用句柄')
    } finally {
      restore()
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// 4. analyzeImage 失败自愈（qc_shot 走同一条路）
// ---------------------------------------------------------------------------
test('CV-155：analyzeImage 拿到产物名 → 500 后自愈换句柄并重试恰好一次', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-cv155-'))
  try {
    await writeFile(join(dir, 'shot1.png'), Buffer.from([1, 2, 3]))
    const { registry, nodes } = stubRegistry([productNode({ filename: 'img_01290_.png' })], dir)
    const tools = createStudioTools(registry, 3005)
    const vl = tools.find((t) => t.name === 'image2vl')

    let vlHits = 0
    const { calls, restore } = stubFetch([
      { match: '/generate/upload', respond: () => ({ status: 200, json: { name: 'ref-deadbeef.png' } }) },
      {
        match: '/image2vl',
        respond: () => {
          vlHits += 1
          // 第一次 = 后端拿产物名当输入，快失败；换句柄后第二次成功。
          return vlHits === 1
            ? { status: 500, text: '' }
            : { status: 200, json: { output: '自愈后描述' } }
        },
      },
    ])
    try {
      const res = await vl.execute({ filename: 'img_01290_.png', prompt: '描述画面' }, EXEC(dir))
      assert.equal(res.text, '自愈后描述')
      const vlCalls = calls.filter((call) => call.url.includes('/image2vl'))
      assert.equal(vlCalls.length, 2, '应重试恰好一次（不自愈循环）')
      assert.equal(vlCalls[0].body.image, 'img_01290_.png', '首次仍是原样透传产物名')
      assert.equal(vlCalls[1].body.image, 'ref-deadbeef.png', '重试应带新句柄')
      assert.equal(nodes()[0].filename, 'ref-deadbeef.png', '自愈应回写节点 filename')
    } finally {
      restore()
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('CV-155：自愈反查不中时抛原始错误（不掩盖真因）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-cv155-'))
  try {
    // 画布上没有这个文件名 → 无法反查 → 必须原样抛错，而不是静默吞掉。
    const { registry } = stubRegistry([productNode({ filename: 'img_01287_.png' })], dir)
    const tools = createStudioTools(registry, 3005)
    const vl = tools.find((t) => t.name === 'image2vl')

    const { calls, restore } = stubFetch([
      { match: '/image2vl', respond: () => ({ status: 500, text: '' }) },
    ])
    try {
      await assert.rejects(
        () => vl.execute({ filename: 'img_99999_.png', prompt: '描述画面' }, EXEC(dir)),
        /生成失败/u,
      )
      assert.equal(
        calls.filter((call) => call.url.includes('/image2vl')).length, 1,
        '反查不中时不应重试',
      )
    } finally {
      restore()
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// 4b. video2vl（2026-09-22 新端点）：与 image2vl 同一条文件名纪律
// ---------------------------------------------------------------------------
/** 一个「生成产物视频节点」：filename 是后端产物名，url 指向本地落盘 mp4。 */
function productVideoNode(overrides = {}) {
  return productNode({
    id: 'clip1',
    kind: 'video',
    title: '分镜 1 · 视频',
    url: '/canvas-studio/assets/p1/clip1.mp4',
    filename: 'MiniMax_H3_ref2va_00020_.mp4',
    ...overrides,
  })
}

test('video2vl：@ref 引用产物视频 → 主动重传换句柄（不让后端先吃一次 500）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-v2vl-'))
  try {
    await writeFile(join(dir, 'clip1.mp4'), Buffer.from([1, 2, 3]))
    const { registry, nodes } = stubRegistry([productVideoNode()], dir)
    const tools = createStudioTools(registry, 3005)
    const v2vl = tools.find((t) => t.name === 'video2vl')
    assert.ok(v2vl, 'video2vl 工具应存在')

    const { calls, restore } = stubFetch([
      { match: '/generate/upload', respond: () => ({ status: 200, json: { name: 'ref-cafe1234.mp4' } }) },
      { match: '/video2vl', respond: () => ({ status: 200, json: { output: '0-3 秒：中景缓推…' } }) },
    ])
    try {
      const res = await v2vl.execute({ video: '@ref[分镜 1 · 视频]', prompt: '按时间轴描述' }, EXEC(dir))
      assert.equal(res.text, '0-3 秒：中景缓推…')
      const vlCall = calls.find((call) => call.url.includes('/video2vl'))
      assert.ok(vlCall, '应调用 video2vl')
      assert.equal(vlCall.body.video, 'ref-cafe1234.mp4', '入参应已是换名后的句柄，而不是产物名')
      assert.equal(vlCall.body.system_prompt.length > 0, true, 'system_prompt 必填（端点 422 拒绝空值）')
      assert.equal(nodes()[0].filename, 'ref-cafe1234.mp4', '节点 filename 应被回写为可用句柄')
    } finally {
      restore()
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('video2vl：拿到产物名 → 500 后自愈换句柄并重试恰好一次', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-v2vl-'))
  try {
    await writeFile(join(dir, 'clip1.mp4'), Buffer.from([1, 2, 3]))
    const { registry, nodes } = stubRegistry([productVideoNode()], dir)
    const tools = createStudioTools(registry, 3005)
    const v2vl = tools.find((t) => t.name === 'video2vl')

    let hits = 0
    const { calls, restore } = stubFetch([
      { match: '/generate/upload', respond: () => ({ status: 200, json: { name: 'ref-deadbeef.mp4' } }) },
      {
        match: '/video2vl',
        respond: () => {
          hits += 1
          // 第一次 = 后端拿产物名当输入，0.1s 快失败（2026-09-22 探针实测形态）；换句柄后成功。
          return hits === 1 ? { status: 500, text: '' } : { status: 200, json: { output: '自愈后分析' } }
        },
      },
    ])
    try {
      const res = await v2vl.execute({ video: 'MiniMax_H3_ref2va_00020_.mp4', prompt: '按时间轴描述' }, EXEC(dir))
      assert.equal(res.text, '自愈后分析')
      const vlCalls = calls.filter((call) => call.url.includes('/video2vl'))
      assert.equal(vlCalls.length, 2, '应重试恰好一次（不自愈循环）')
      assert.equal(vlCalls[0].body.video, 'MiniMax_H3_ref2va_00020_.mp4', '首次仍是原样透传产物名')
      assert.equal(vlCalls[1].body.video, 'ref-deadbeef.mp4', '重试应带新句柄')
      assert.equal(nodes()[0].filename, 'ref-deadbeef.mp4', '自愈应回写节点 filename')
    } finally {
      restore()
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// 5. healReferenceFilename 直连：认 filename，也认本地资产名；认不出返回 null
// ---------------------------------------------------------------------------
test('CV-155：healReferenceFilename 认 filename 与本地资产名，认不出返回 null', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-cv155-'))
  try {
    await writeFile(join(dir, 'shot1.png'), Buffer.from([1, 2, 3]))
    const { registry } = stubRegistry([productNode()], dir)
    const { restore } = stubFetch([
      { match: '/generate/upload', respond: () => ({ status: 200, json: { name: 'ref-aaaabbbb.png' } }) },
    ])
    try {
      // 按 filename 命中
      assert.equal(
        await healReferenceFilename(registry, 'p1', 'img_01287_.png'),
        'ref-aaaabbbb.png',
      )
      // 按本地资产名命中（实测 Agent 会把画布资产文件名当 filename 传）
      assert.equal(
        await healReferenceFilename(registry, 'p1', 'shot1.png'),
        'ref-aaaabbbb.png',
      )
      // 认不出 → null（调用方据此保留原始错误）
      assert.equal(await healReferenceFilename(registry, 'p1', '不存在.png'), null)
    } finally {
      restore()
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// 6. CV-231：@ref 匹配池的准入判据 —— 「能惰性提升的，就必须能被引用到」
// ---------------------------------------------------------------------------
test('CV-231：refCandidatePool 收「有 url 无 filename」的可提升资产', () => {
  // 由来：上传视频不再预上传 Drama 句柄（那是整段视频的远端上传，会把节点与首帧
  // 挡在门外）⇒「有 url 无 filename」成为常态。而匹配池此前只收「已有 filename」
  // 的普通素材，这类节点根本进不了池 —— 表现为 @ref 直接「未找到」，下面那条惰性
  // 提升分支永远走不到。判据必须与兜底分支一致：能提升的，就要能被引用到。
  const node = (id, extra) => ({
    id, kind: 'video', x: 0, y: 0, width: 10, height: 10, createdAt: 1, sourceIds: [], ...extra,
  })
  const pool = refCandidatePool([
    node('v1', { url: '/canvas-studio/assets/p1/abc.mp4', title: '刚上传的片' }),
    node('v2', { filename: 'ref-1234.mp4', title: '已提升' }),
    node('v3', { title: '既无 url 也无句柄' }),
    node('v4', { url: 'https://cdn.example.com/x.mp4' }),
    node('v5', { url: '/canvas-studio/assets/p1/abc.mp4', isReference: true }),
  ])
  const ids = pool.map((entry) => entry.id)

  assert.ok(ids.includes('v1'), '「有 url 无 filename」必须进池 —— 否则惰性提升分支永远走不到')
  assert.ok(ids.includes('v2'), '已有 filename 的照旧进池')
  assert.ok(ids.includes('v5'), '参考托盘节点（isReference）进池')
  assert.ok(!ids.includes('v3'), '既无 url 也无 filename 的节点不进池')
  assert.ok(!ids.includes('v4'), '非项目资产 url 不进池（提升无从下手）')
  assert.ok(ids.indexOf('v5') < ids.indexOf('v1'), '参考托盘优先于普通素材')
})

// ---------------------------------------------------------------------------
// 5. CV-238：裸画布节点 id 当句柄 → 发后端**之前**拦截
//    （2026-09-24 会话事故：模型把资产 URL basename 当 filename 传，21 次调用
//    全部 502，且当时的错误形态让自愈判据失配 ⇒ 盲试 15+ 轮。事前形态校验 + 
//    可行动报错一次教对。）
// ---------------------------------------------------------------------------
test('CV-238：looksLikeCanvasNodeId 认节点 id 形态（裸 id / 带扩展名 / 整条 URL / 大写），不误伤句柄与产物名', () => {
  const nodeIds = [
    '3fec15c4-1324-4538-9042-7d0caf50db74',                                              // 裸节点 id（事故形态）
    '3fec15c4-1324-4538-9042-7d0caf50db74.png',                                          // 资产文件名
    '/canvas-studio/assets/p1/3fec15c4-1324-4538-9042-7d0caf50db74.png',                 // 相对 URL
    'http://127.0.0.1:9345/canvas-studio/assets/p1/58a216e5-7e5d-4db2-b7d2-9e83edc1fc7e.png', // 绝对 URL
    'F8C48FA3-B1D0-4B31-B46D-9A4AE40D1AA3',                                              // 大写
  ]
  for (const value of nodeIds) {
    assert.equal(looksLikeCanvasNodeId(value), true, `${value} 应判为节点 id 形态`)
  }
  const notIds = [
    'ref-40bf8914.png',          // 上传句柄
    'ref-deadbeef.mp4',          // 上传句柄（视频）
    'krea2_00307_.png',          // 产物名（走既有换名/自愈通道，不在此拦）
    'img_01287_.png',            // 产物名（旧前缀）
    'bb465e619602.png',          // 局部 hex 本地名
    'a4ed-37ac8d71907c.png',     // 局部 UUID 段本地名
    'shot1.png',
    'A.png',
  ]
  for (const value of notIds) {
    assert.equal(looksLikeCanvasNodeId(value), false, `${value} 不应判为节点 id`)
  }
})

test('CV-238：video_generate 的 filename 传节点 id → 发后端之前报 CS-USER-002（可行动），零后端调用', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-cv238-'))
  try {
    const { registry } = stubRegistry([], dir)
    const tools = createStudioTools(registry, 3005)
    const vg = tools.find((t) => t.name === 'video_generate')
    assert.ok(vg, 'video_generate 工具应存在')

    const { calls, restore } = stubFetch([])
    try {
      await assert.rejects(
        vg.execute({ prompt: 'x', filename: '3fec15c4-1324-4538-9042-7d0caf50db74' }, EXEC(dir)),
        (err) => err.code === 'CS-USER-002' && err.message.includes('画布节点 id'),
      )
      assert.equal(
        calls.filter((call) => call.url.includes('/generate/')).length,
        0,
        '被形态校验拦下的调用不应触达后端任何生成端点',
      )
    } finally {
      restore()
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
