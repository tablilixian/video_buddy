/**
 * P3 媒体生成的冒烟测试：重点覆盖节点级重试（retryOf）语义 —— 结果写回
 * 原节点（保留 id/位置/血缘），而不是追加新节点（plan §7.8 标准 2）。
 *
 * 直连 Host 侧编译产物 lib/generate.js；fetch 打桩避开真实 Drama Backend，
 * 产物下载/写盘走临时目录。运行：corepack yarn workspace canvas-studio test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateAsset, clampDuration } from '../lib/generate.js'
import { createStudioTools } from '../lib/host-tools.js'

/** 打桩 fetch：参考图下载 / 上传 / 生成 / 产物下载。 */
function stubFetch(mediaUrl = 'https://media.example/out.png') {
  const calls = []
  globalThis.fetch = async (url, init = {}) => {
    // P10 health 探针前置：所有 Drama 请求前会探测一次，桩里直接放行。
    if (String(url).includes('/api/v1/health')) {
      return { ok: true, status: 200, json: async () => ({ status: 'ok' }), text: async () => '' }
    }
    let body = null
    if (typeof init.body === 'string') {
      try { body = JSON.parse(init.body) } catch { body = init.body }
    }
    calls.push({ url: String(url), method: init.method ?? 'GET', body })
    const text = String(url)
    if (init.method === 'POST') {
      if (text.includes('/upload')) {
        return { ok: true, json: async () => ({ filename: 'ref.png' }) }
      }
      return { ok: true, json: async () => ({ full_url: mediaUrl }) }
    }
    if (text === mediaUrl) {
      return { ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]) }
    }
    if (text === 'https://ref.example/a.png') {
      return { ok: true, arrayBuffer: async () => new Uint8Array([9, 9]) }
    }
    return { ok: false, status: 404 }
  }
  return calls
}

/** 项目注册表打桩：读到的既有文档（v3 形态）+ 记录写盘。 */
function stubRegistry(initialNodes, assetsDir) {
  const writes = []
  return {
    list: async () => [{ id: 'p1', name: 'P1', dir: assetsDir, createdAt: 1 }],
    assetsDir: () => assetsDir,
    readCanvas: async () => ({ version: 3, nodes: initialNodes }),
    writeCanvas: async (projectId, nodes) => { writes.push({ projectId, nodes: [...nodes] }) },
    appendCanvasNode: async (projectId, node) => { writes.push({ projectId, nodes: [node] }) },
    getWrites: () => writes,
  }
}

const REF_URL = 'https://ref.example/a.png'

test('retryOf：结果写回原节点，不追加新节点', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-generate-'))
  try {
    const prior = [{
      id: 'n1',
      kind: 'image',
      url: '/canvas-studio/assets/p1/old.png',
      title: '旧图',
      x: 40,
      y: 40,
      width: 260,
      height: 180,
      createdAt: 1000,
      origin: 'agent',
      sourceIds: ['seed-image'],
      operationType: 'image-to-image',
      generationPrompt: '{"prompt":"旧提示","filename":"ref.png"}',
      error: '生成失败: HTTP 500',
    }]
    const registry = stubRegistry(prior, dir)
    const calls = stubFetch()

    const result = await generateAsset(registry, 'image_generate', 'p1', {
      prompt: '新提示',
      filename: 'ref.png',
      retryOf: 'n1',
    })

    assert.equal(calls.length, 2) // 生成 / 产物下载（无参考图下载/上传步骤）
    const writes = registry.getWrites()
    assert.equal(writes.length, 1)
    const saved = writes[0].nodes
    assert.equal(saved.length, 1, 'retryOf 不追加新节点')
    const updated = saved[0]
    assert.equal(updated.id, 'n1', '保留原节点 id')
    assert.equal(updated.x, 40)
    assert.equal(updated.y, 40)
    assert.equal(updated.sourceIds[0], 'seed-image', '保留血缘')
    assert.equal(updated.title, '旧图', '保留标题')
    assert.equal(updated.error, undefined, '重试成功清除错误标记')
    assert.equal(updated.operationType, 'image-to-image')
    assert.equal(updated.generationPrompt, '{"prompt":"新提示","filename":"ref.png"}')
    assert.ok(updated.url.startsWith('/canvas-studio/assets/p1/'), '新产物同源相对 URL')
    assert.ok(result.url.startsWith('/canvas-studio/assets/p1/'))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('retryOf：目标节点不存在时报错且不写盘', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-generate-'))
  try {
    const registry = stubRegistry([], dir)
    stubFetch()
    await assert.rejects(
      generateAsset(registry, 'image_generate', 'p1', { prompt: 'x', retryOf: 'ghost' }),
      /重试目标节点不存在/,
    )
    assert.equal(registry.getWrites().length, 0)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('血缘自动反查：filename 命中素材节点时自动补 sourceIds（不依赖 sourceUrls），与 URL 反查去重合并', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-generate-'))
  try {
    const prior = [{
      id: 'src1',
      kind: 'image',
      url: '/canvas-studio/assets/p1/src.png',
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      createdAt: 1,
      origin: 'manual',
      sourceIds: [],
      filename: 'ref.png',
    }]
    const registry = stubRegistry(prior, dir)
    stubFetch()

    // agent 没填 sourceUrls，仅凭 filename 也应还原血缘；同时填了相同的
    // sourceUrls 时两者应去重为一条边。
    await generateAsset(registry, 'image_generate', 'p1', {
      prompt: '一只猫',
      filename: 'ref.png',
      sourceUrls: ['/canvas-studio/assets/p1/src.png'],
    })

    const saved = registry.getWrites()[0].nodes[0]
    assert.deepEqual(saved.sourceIds, ['src1'], 'filename 反查 + URL 反查去重合并')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('CV-031 视频继承分镜卡：video_generate 漏传 shotRefs 时自动并入关键帧所属分镜卡', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-generate-'))
  try {
    // 分镜卡（submit_storyboard_for_approval 拆卡产物）+ 已连卡的关键帧。
    const prior = [
      {
        id: 'card1',
        kind: 'text',
        title: '分镜 2 · 特写',
        x: 0,
        y: 0,
        width: 360,
        height: 220,
        createdAt: 1,
        origin: 'agent',
        sourceIds: [],
        toolName: 'submit_storyboard_for_approval',
        operationType: 'storyboard',
      },
      {
        id: 'kf1',
        kind: 'image',
        url: '/canvas-studio/assets/p1/kf.png',
        x: 400,
        y: 0,
        width: 480,
        height: 270,
        createdAt: 2,
        origin: 'agent',
        sourceIds: ['card1'],
        filename: 'kf-drama.png',
        toolName: 'image_generate',
        operationType: 'image-to-image',
      },
    ]
    const registry = stubRegistry(prior, dir)
    stubFetch()

    // 模型只传了 filename（关键帧），漏传 shotRefs —— 视频仍应同时连关键帧
    // 与分镜卡；关键帧挂在非分镜卡上游（如创意节点）时不扩散。
    await generateAsset(registry, 'video_generate', 'p1', {
      prompt: '镜头推进',
      filename: 'kf-drama.png',
      duration: 5,
    })

    const saved = registry.getWrites()[0].nodes[0]
    assert.deepEqual(saved.sourceIds, ['kf1', 'card1'], '关键帧 + 自动继承的分镜卡')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('普通生成：追加新节点并带 generationPrompt', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-generate-'))
  try {
    const registry = stubRegistry([], dir)
    stubFetch()
    await generateAsset(registry, 'image_generate', 'p1', { prompt: '一只猫' })
    const writes = registry.getWrites()
    assert.equal(writes.length, 1)
    const node = writes[0].nodes[0]
    assert.equal(node.kind, 'image')
    assert.equal(node.generationPrompt, '{"prompt":"一只猫"}')
    assert.equal(node.origin, 'agent')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
test('clampDuration：钳制到 [1,15]，默认值生效', () => {
  assert.equal(clampDuration(undefined, 5), 5)
  assert.equal(clampDuration(undefined, 10), 10)
  assert.equal(clampDuration(8, 10), 8)
  assert.equal(clampDuration(30, 10), 15)
  assert.equal(clampDuration(0.4, 10), 1)
})

test('video_composite 双图走首尾帧插值（fl2va）端点，时长被钳制', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-generate-'))
  try {
    const calls = stubFetch('https://media.example/out.mp4')
    const registry = stubRegistry([], dir)
    await generateAsset(registry, 'video_composite', 'p1', {
      prompt: 'x',
      aspectRatio: '16:9',
      duration: 30,
      filenames: ['a.png', 'b.png'],
    })
    const gen = calls.find((call) => call.url.includes('/generate/'))
    assert.ok(gen.url.includes('image2videofl2va'), `期望 fl2va 端点，实际 ${gen.url}`)
    const node = registry.getWrites()[0].nodes[0]
    assert.equal(node.duration, 15)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('api.md 契约：video_generate → image2videofl2va 首帧模式（image1=filename、aspect/megapixels、整数时长）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-generate-'))
  try {
    const calls = stubFetch('https://media.example/out.mp4')
    await generateAsset(stubRegistry([], dir), 'video_generate', 'p1', {
      prompt: 'p', aspectRatio: '16:9', duration: 8.6, filename: 'bg.png',
    })
    const gen = calls.find((call) => call.url.includes('image2videofl2va'))
    assert.ok(gen, '缺少 image2videofl2va 调用')
    assert.equal(gen.body.prompt, 'p')
    assert.equal(gen.body.aspect, '16:9')
    assert.equal(gen.body.megapixels, 0.4)
    assert.equal(gen.body.image1, 'bg.png')
    assert.equal(gen.body.duration, 9) // clampDuration(8.6,5)→9
    assert.equal(gen.body.image2, undefined) // 未提供尾帧
    assert.equal(gen.body.background, undefined) // 不再走 msr
    assert.equal(gen.body.width, undefined)
    assert.equal(gen.body.fps, undefined)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('api.md 契约：video_generate 无 filename → image2videofl2va 文生视频（无 image1/image2）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-generate-'))
  try {
    const calls = stubFetch('https://media.example/out.mp4')
    await generateAsset(stubRegistry([], dir), 'video_generate', 'p1', {
      prompt: 'p', aspectRatio: '9:16', duration: 5,
    })
    const gen = calls.find((call) => call.url.includes('image2videofl2va'))
    assert.ok(gen, '缺少 image2videofl2va 调用')
    assert.equal(gen.body.aspect, '9:16')
    assert.equal(gen.body.image1, undefined)
    assert.equal(gen.body.image2, undefined)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('api.md 契约：video_composite 双图 → image2videofl2va 请求体（aspect/megapixels/首尾帧）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-generate-'))
  try {
    const calls = stubFetch('https://media.example/out.mp4')
    await generateAsset(stubRegistry([], dir), 'video_composite', 'p1', {
      prompt: 'p', aspectRatio: '9:16', duration: 6, filenames: ['a.png', 'b.png'],
    })
    const gen = calls.find((call) => call.url.includes('image2videofl2va'))
    assert.ok(gen, '缺少 image2videofl2va 调用')
    assert.equal(gen.body.aspect, '9:16')
    assert.equal(gen.body.megapixels, 0.4)
    assert.equal(gen.body.duration, 6)
    assert.equal(gen.body.image1, 'a.png')
    assert.equal(gen.body.image2, 'b.png')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('api.md 契约：video_composite 多图 → image2videoref2va（image1..imageN、aspect/megapixels）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-generate-'))
  try {
    const calls = stubFetch('https://media.example/out.mp4')
    await generateAsset(stubRegistry([], dir), 'video_composite', 'p1', {
      prompt: 'p', aspectRatio: '16:9', duration: 10, filenames: ['a.png', 'b.png', 'c.png'],
    })
    const gen = calls.find((call) => call.url.includes('image2videoref2va'))
    assert.ok(gen, '缺少 image2videoref2va 调用')
    assert.equal(gen.body.aspect, '16:9')
    assert.equal(gen.body.megapixels, 0.4)
    assert.equal(gen.body.duration, 10)
    assert.equal(gen.body.image1, 'a.png')
    assert.equal(gen.body.image2, 'b.png')
    assert.equal(gen.body.image3, 'c.png')
    assert.equal(gen.body.images, undefined) // 不再走 mkr 的 images[]/frame_index
    assert.equal(gen.body.fps, undefined)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('api.md 契约：上传表单文件名唯一且不含空格括号（避免后端去重后缀破坏下游）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-generate-'))
  try {
    const calls = stubFetch('https://media.example/out.png')
    await generateAsset(stubRegistry([], dir), 'image_generate', 'p1', { prompt: 'x' })
    // image_generate 无参考图不上传；直接走 uploadImage 需要参考图下载路径。
    const { uploadImage } = await import('../lib/generate.js')
    const filename = await uploadImage('https://ref.example/a.png')
    assert.match(filename, /^[\w.\-]+$/u, `文件名含不安全字符: ${filename}`)
    assert.ok(!calls.some((call) => String(call.url).includes('image2videomsr')))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('P8.1 契约：uploadLocalImage 落盘返回同源 URL + Drama filename', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-upload-'))
  try {
    const calls = stubFetch('https://media.example/out.png')
    const { uploadLocalImage } = await import('../lib/generate.js')
    const dataBase64 = Buffer.from([1, 2, 3, 4, 5]).toString('base64')
    const result = await uploadLocalImage(stubRegistry([], dir), 'p1', 'photo.png', dataBase64)
    // 返回结构：同源相对 URL + Drama 服务器文件名。
    assert.match(result.url, /^\/canvas-studio\/assets\/p1\/[\w.\-]+\.png$/u, `URL 非同源相对路径: ${result.url}`)
    assert.equal(result.filename, 'ref.png', `filename 应来自 Drama uploadimage: ${result.filename}`)
    // 发起了一次 Drama 上传（uploadimage），用于拿 filename。
    assert.ok(calls.some((call) => String(call.url).includes('/upload')), '未发起 Drama uploadimage 上传')
    // 本地写盘：assets 目录存在该文件。
    const { readdir } = await import('node:fs/promises')
    const files = await readdir(dir)
    assert.ok(files.some((file) => file.endsWith('.png')), `assets 未写盘: ${files.join(',')}`)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('P8.1 端到端：真实 PNG 字节经 bytesToBase64 编码后落盘字节完全一致', async () => {
  // 验收 bug 回归：PNG magic（0x89 0x50 0x4E 0x47 0x0D 0x0A 0x1A 0x0A）+ 高位字节
  // 经过「client bytesToBase64 → Host uploadLocalImage base64 解码 → 写盘」后，
  // 落盘字节必须与原始字节 1:1 一致。否则 <img> 会因 PNG 头错位触发 onerror。
  const PNG_LIKE = Buffer.from([
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
    0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
    0xEA, 0x80, 0x81, 0x82, 0x83, 0xFE, 0xFF, 0xC0,
    0xA0, 0xB0, 0x90, 0xFF,
  ])
  const { bytesToBase64 } = await import('../lib/encoding.js')
  const { uploadLocalImage } = await import('../lib/generate.js')
  const { readFile } = await import('node:fs/promises')
  const dir = await mkdtemp(join(tmpdir(), 'cs-png-roundtrip-'))
  try {
    stubFetch('https://media.example/out.png')
    const dataBase64 = bytesToBase64(new Uint8Array(PNG_LIKE))
    const { url } = await uploadLocalImage(stubRegistry([], dir), 'p1', 'photo.png', dataBase64)
    const file = url.split('/').pop()
    const onDisk = await readFile(join(dir, file))
    assert.equal(onDisk.length, PNG_LIKE.length, '落盘字节数不一致')
    for (let i = 0; i < PNG_LIKE.length; i += 1) {
      assert.equal(onDisk[i], PNG_LIKE[i], `第 ${i} 字节不一致`)
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('P8.2 契约：image_generate 多参考（3 张）→ image2image 端点映射 image1~image3', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-imgref-'))
  try {
    const calls = stubFetch('https://media.example/out.png')
    await generateAsset(stubRegistry([], dir), 'image_generate', 'p1', {
      prompt: '融合三张参考图',
      aspectRatio: '1:1',
      filenames: ['r1.png', 'r2.png', 'r3.png'],
    })
    const gen = calls.find((call) => call.url.includes('image2image'))
    assert.ok(gen, '缺少 image2image 调用')
    assert.equal(gen.body.prompt, '融合三张参考图')
    assert.equal(gen.body.image1, 'r1.png')
    assert.equal(gen.body.image2, 'r2.png')
    assert.equal(gen.body.image3, 'r3.png')
    assert.ok(gen.body.width > 0 && gen.body.height > 0, '缺少尺寸参数')
    // 多参考走图生图，绝对不应落入文生图端点。
    assert.ok(!calls.some((call) => call.url.includes('txt2image')), '多参考误走 txt2image')
    // 单 filename 仍兼容：应与 filenames 互斥回退。
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('P8.2 契约：image_generate filenames 超过 3 张只取前 3 张', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-imgref2-'))
  try {
    const calls = stubFetch('https://media.example/out.png')
    await generateAsset(stubRegistry([], dir), 'image_generate', 'p1', {
      prompt: 'p',
      filenames: ['a.png', 'b.png', 'c.png', 'd.png', 'e.png'],
    })
    const gen = calls.find((call) => call.url.includes('image2image'))
    assert.ok(gen, '缺少 image2image 调用')
    assert.equal(gen.body.image1, 'a.png')
    assert.equal(gen.body.image2, 'b.png')
    assert.equal(gen.body.image3, 'c.png')
    assert.equal(gen.body.image4, undefined, '超出 3 张应被截断')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('P8.2 契约：image_generate 单 filename 仍走 image2image（image1），不触发 txt2image', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-imgref3-'))
  try {
    const calls = stubFetch('https://media.example/out.png')
    await generateAsset(stubRegistry([], dir), 'image_generate', 'p1', {
      prompt: 'p',
      filename: 'solo.png',
    })
    const gen = calls.find((call) => call.url.includes('image2image'))
    assert.ok(gen, '单 filename 应走 image2image')
    assert.equal(gen.body.image1, 'solo.png')
    assert.equal(gen.body.image2, undefined)
    assert.ok(!calls.some((call) => call.url.includes('txt2image')))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('P8.3 契约：storyboard_split 调 splitegrid 并按 gridnum 推导行列，拆出 N 个本地单镜节点', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-split-'))
  try {
    const splitUrls = [
      'http://view.example/s1.png',
      'http://view.example/s2.png',
      'http://view.example/s3.png',
      'http://view.example/s4.png',
    ]
    const calls = []
    globalThis.fetch = async (url, init = {}) => {
      const text = String(url)
      if (text.includes('/api/v1/health')) {
        return { ok: true, status: 200, json: async () => ({ status: 'ok' }), text: async () => '' }
      }
      if (init?.method === 'POST' && text.includes('image2splitegrid')) {
        let body = null
        if (typeof init.body === 'string') body = JSON.parse(init.body)
        calls.push({ url: text, body })
        return { ok: true, json: async () => ({ images: splitUrls.map((u, i) => ({ filename: `sp_${i}.png`, url: u })), total_count: splitUrls.length }) }
      }
      if (text.startsWith('http://view.example/')) {
        return { ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]) }
      }
      return { ok: false, status: 404 }
    }

    const registry = stubRegistry([], dir)
    const { splitStoryboard } = await import('../lib/generate.js')
    const result = await splitStoryboard(registry, 'p1', { filename: 'grid.png', gridnum: 4 }, undefined)

    assert.equal(result.count, 4, '应拆出 4 张单镜')
    const gen = calls.find((call) => call.url.includes('image2splitegrid'))
    assert.ok(gen, '缺少 image2splitegrid 调用')
    assert.equal(gen.body.row, 2, 'gridnum=4 → row=2')
    assert.equal(gen.body.column, 2, 'gridnum=4 → column=2')
    assert.equal(gen.body.image, 'grid.png')

    const writes = registry.getWrites()
    assert.equal(writes.length, 4, '应追加 4 个单镜节点')
    for (const w of writes) {
      const node = w.nodes[0]
      assert.equal(node.kind, 'image')
      assert.equal(node.operationType, 'storyboard-split')
      assert.ok(node.url.startsWith('/canvas-studio/assets/p1/'), `非本地 URL: ${node.url}`)
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('P8.3 契约：storyboard_split gridnum 推导 6→2×3、9→3×3', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-split2-'))
  try {
    async function runSplit(gridnum) {
      const calls = []
      globalThis.fetch = async (url, init = {}) => {
        const text = String(url)
        if (text.includes('/api/v1/health')) {
          return { ok: true, status: 200, json: async () => ({ status: 'ok' }), text: async () => '' }
        }
        if (init?.method === 'POST' && text.includes('image2splitegrid')) {
          let body = null
          if (typeof init.body === 'string') body = JSON.parse(init.body)
          calls.push({ url: text, body })
          const n = gridnum
          return { ok: true, json: async () => ({ images: Array.from({ length: n }, (_, i) => ({ filename: `sp_${i}.png`, url: `http://view.example/s${i}.png` })), total_count: n }) }
        }
        if (text.startsWith('http://view.example/')) return { ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]) }
        return { ok: false, status: 404 }
      }
      const registry = stubRegistry([], dir)
      const { splitStoryboard } = await import('../lib/generate.js')
      const result = await splitStoryboard(registry, 'p1', { filename: 'grid.png', gridnum }, undefined)
      return { result, calls }
    }

    const six = await runSplit(6)
    const sixGen = six.calls.find((call) => call.url.includes('image2splitegrid'))
    assert.equal(sixGen.body.row, 2, 'gridnum=6 → row=2')
    assert.equal(sixGen.body.column, 3, 'gridnum=6 → column=3')
    assert.equal(six.result.count, 6)

    const nine = await runSplit(9)
    const nineGen = nine.calls.find((call) => call.url.includes('image2splitegrid'))
    assert.equal(nineGen.body.row, 3, 'gridnum=9 → row=3')
    assert.equal(nineGen.body.column, 3, 'gridnum=9 → column=3')
    assert.equal(nine.result.count, 9)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

/** 工具执行上下文（会话 cwd 绑定项目目录）。 */
const EXEC = (cwd) => ({ agent: { session: { header: { cwd } } }, signal: AbortSignal.timeout(5000) })

test('落点策略：新节点排在其血缘来源节点的右侧（y 对齐来源，无来源回退网格）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-place-'))
  try {
    const prior = [{
      id: 'src1',
      kind: 'image',
      url: '/canvas-studio/assets/p1/src.png',
      x: 40,
      y: 40,
      width: 260,
      height: 180,
      createdAt: 1,
      origin: 'manual',
      sourceIds: [],
      filename: 'ref.png',
    }]
    const registry = stubRegistry(prior, dir)
    stubFetch()

    // 有来源（filename 反查命中）：新节点应排在来源右缘 + 间距，y 对齐来源。
    await generateAsset(registry, 'image_generate', 'p1', { prompt: 'x', filename: 'ref.png' })
    const placed = registry.getWrites()[0].nodes[0]
    assert.ok(placed.x >= 40 + 260 + 60, `来源右侧落位（实际 x=${placed.x}）`)
    assert.equal(placed.y, 40, 'y 对齐来源节点')
    // CV-028：画布框为预览尺寸，真实分辨率只入 mediaWidth/mediaHeight。
    assert.equal(placed.width, 480, '显示框 = 预览尺寸（16:9 → 480）')
    assert.equal(placed.height, 270, '显示框 = 预览尺寸（16:9 → 270）')
    assert.equal(placed.mediaWidth, 1280, 'mediaWidth 保留真实分辨率')
    assert.equal(placed.mediaHeight, 720, 'mediaHeight 保留真实分辨率')

    // 无来源：回退网格空位（既有 1 个无 filename 节点 → index=1 → 第二格）。
    const registryEmpty = stubRegistry([{ ...prior[0], filename: undefined }], dir)
    stubFetch()
    await generateAsset(registryEmpty, 'image_generate', 'p1', { prompt: 'y' })
    const grid = registryEmpty.getWrites()[0].nodes[0]
    assert.equal(grid.x, 40 + 300, '无来源回退网格（第二列）')
    assert.equal(grid.y, 40)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('创意血缘：submit_storyboard_for_approval / write_script 自动挂接创意节点并右移落位', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-brief-'))
  try {
    const briefNode = {
      id: 'brief1',
      kind: 'text',
      title: '创意',
      text: '生成一段三元牛奶的广告视频，10秒钟',
      x: 40,
      y: 40,
      width: 360,
      height: 200,
      createdAt: 1,
      origin: 'manual',
      sourceIds: [],
      toolName: 'user_brief',
    }
    const writes = []
    const registry = {
      list: async () => [{ id: 'p1', name: 'P1', dir, createdAt: '1', updatedAt: '1' }],
      getProject: async () => ({ id: 'p1', workflow: { mode: 'confirm', state: 'drafting' } }),
      readCanvas: async () => ({ version: 3, nodes: [briefNode] }),
      updateWorkflow: async (projectId, patch) => ({ id: projectId, workflow: { mode: 'confirm', ...patch } }),
      appendCanvasNode: async (_projectId, node) => { writes.push(node) },
    }
    const exec = { agent: { session: { header: { cwd: dir } } }, signal: AbortSignal.timeout(5000) }
    const tools = createStudioTools(registry, 3000)

    const submit = tools.find((tool) => tool.name === 'submit_storyboard_for_approval')
    await submit.execute({ storyboard: '|镜号|景别|', summary: '1 镜' }, exec)
    assert.equal(writes.length, 1)
    assert.deepEqual(writes[0].sourceIds, ['brief1'], '分镜表自动挂接创意血缘')
    assert.ok(writes[0].x >= 40 + 360 + 60, `分镜表排在创意右侧（实际 x=${writes[0].x}）`)

    const script = tools.find((tool) => tool.name === 'write_script')
    await script.execute({ script: '广告词…' }, exec)
    assert.equal(writes.length, 2)
    assert.deepEqual(writes[1].sourceIds, ['brief1'], '文案自动挂接创意血缘')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('分镜拆分：submit_storyboard_for_approval 把逐镜表格拆为独立节点（血缘指向创意，按行排列）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-shots-'))
  try {
    const briefNode = {
      id: 'brief1',
      kind: 'text',
      title: '创意',
      text: '生成一段三元牛奶的广告视频，10秒钟',
      x: 40,
      y: 40,
      width: 360,
      height: 200,
      createdAt: 1,
      origin: 'manual',
      sourceIds: [],
      toolName: 'user_brief',
    }
    const writes = []
    const registry = {
      list: async () => [{ id: 'p1', name: 'P1', dir, createdAt: '1', updatedAt: '1' }],
      getProject: async () => ({ id: 'p1', workflow: { mode: 'confirm', state: 'drafting' } }),
      readCanvas: async () => ({ version: 3, nodes: [briefNode] }),
      updateWorkflow: async (projectId, patch) => ({ id: projectId, workflow: { mode: 'confirm', ...patch } }),
      writeCanvas: async (_projectId, nodes) => {
        writes.push(...nodes.filter((node) => node.toolName === 'submit_storyboard_for_approval'))
      },
      appendCanvasNode: async () => { throw new Error('拆分路径不应走 appendCanvasNode') },
    }
    const storyboard = [
      '| 镜号 | 景别 | 镜头运动 | 时长 | 画面描述 | 声音 |',
      '| --- | --- | --- | --- | --- | --- |',
      '| 1 | 特写 | 固定 | 5s | 牛奶静置桌面 | 环境音 |',
      '| 2 | 中景 | 缓慢推进 | 5s | 牧场奶牛 | 鸟鸣 |',
    ].join('\n')
    const exec = { agent: { session: { header: { cwd: dir } } }, signal: AbortSignal.timeout(5000) }
    const tools = createStudioTools(registry, 3000)
    const submit = tools.find((tool) => tool.name === 'submit_storyboard_for_approval')
    await submit.execute({ storyboard, summary: '2 镜' }, exec)

    assert.equal(writes.length, 2, '两镜拆为两个节点')
    assert.deepEqual(writes[0].sourceIds, ['brief1'], '每镜血缘指向创意')
    assert.deepEqual(writes[1].sourceIds, ['brief1'])
    assert.equal(writes[0].title, '分镜 1 · 特写')
    assert.equal(writes[1].title, '分镜 2 · 中景')
    assert.match(writes[0].text, /【镜 1】特写 · 固定 · 5s/)
    assert.match(writes[0].text, /画面：牛奶静置桌面/)
    assert.match(writes[0].text, /声音：环境音/)
    assert.equal(writes[1].x - writes[0].x, 400, '同排横向等距排列')
    assert.equal(writes[0].y, writes[1].y)
    assert.ok(writes[0].x >= 40 + 360 + 60, '整排排在创意右侧')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('shotRefs：关键帧自动关联分镜卡（镜号解析、血缘合并、右侧落位；未知引用报错）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-shotref-'))
  try {
    const prior = [
      {
        id: 'shot1',
        kind: 'text',
        title: '分镜 1 · 特写',
        text: '【镜 1】特写 · 固定 · 5s',
        x: 460,
        y: 40,
        width: 360,
        height: 220,
        createdAt: 1,
        origin: 'agent',
        sourceIds: ['brief1'],
        toolName: 'submit_storyboard_for_approval',
        operationType: 'storyboard',
      },
      {
        id: 'shot2',
        kind: 'text',
        title: '分镜 2 · 中景',
        text: '【镜 2】中景',
        x: 860,
        y: 40,
        width: 360,
        height: 220,
        createdAt: 2,
        origin: 'agent',
        sourceIds: ['brief1'],
        toolName: 'submit_storyboard_for_approval',
        operationType: 'storyboard',
      },
    ]
    const registry = stubRegistry(prior, dir)
    // P7 门禁读工作流：放手跑状态直接放行。
    registry.getProject = async () => ({ id: 'p1', workflow: { mode: 'auto', state: 'executing' } })
    stubFetch()
    const tools = createStudioTools(registry, 3000)
    const imgGen = tools.find((tool) => tool.name === 'image_generate')

    // 镜号简写「分镜 1」应解析为 shot1（不误命中 分镜 10）。
    await imgGen.execute({ prompt: '镜1关键帧', shotRefs: ['分镜 1'] }, EXEC(dir))
    const saved = registry.getWrites()[0].nodes[0]
    assert.ok(saved.sourceIds.includes('shot1'), '血缘并入分镜卡')
    assert.ok(saved.x >= 460 + 360 + 60, `排在分镜卡右侧（实际 x=${saved.x}）`)
    assert.equal(saved.y, 40, 'y 对齐分镜卡')

    // 未知引用给出可操作报错。
    await assert.rejects(
      imgGen.execute({ prompt: 'x', shotRefs: ['分镜 9'] }, EXEC(dir)),
      /未找到/,
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('放手跑模式：提交分镜同样逐镜拆卡落画布，结果列出卡片清单', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-auto-'))
  try {
    const writes = []
    const registry = {
      list: async () => [{ id: 'p1', name: 'P1', dir, createdAt: '1', updatedAt: '1' }],
      getProject: async () => ({ id: 'p1', workflow: { mode: 'auto', state: 'idle' } }),
      readCanvas: async () => ({ version: 3, nodes: [] }),
      updateWorkflow: async (projectId, patch) => ({ id: projectId, workflow: { mode: 'auto', ...patch } }),
      writeCanvas: async (_projectId, nodes) => {
        writes.push(...nodes.filter((node) => node.toolName === 'submit_storyboard_for_approval'))
      },
    }
    const storyboard = [
      '| 镜号 | 景别 | 镜头运动 | 时长 | 画面描述 | 声音 |',
      '| --- | --- | --- | --- | --- | --- |',
      '| 1 | 特写 | 固定 | 5s | 牛奶静置桌面 | 环境音 |',
      '| 2 | 中景 | 缓慢推进 | 5s | 牧场奶牛 | 鸟鸣 |',
    ].join('\n')
    const tools = createStudioTools(registry, 3000)
    const submit = tools.find((tool) => tool.name === 'submit_storyboard_for_approval')
    const result = await submit.execute({ storyboard }, EXEC(dir))

    assert.equal(writes.length, 2, '放手跑模式同样拆卡落画布')
    assert.match(result.text, /放手跑模式/)
    assert.match(result.text, /分镜 1 · 特写（id=/, '结果列出卡片标题与 id')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
