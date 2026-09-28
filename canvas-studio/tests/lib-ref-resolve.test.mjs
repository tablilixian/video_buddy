/**
 * REQ-001 Step 3：`lib:` 引用链路（方案 §6.2「lib-ref-resolve」清单）。
 *
 * 背景：`@ref[lib:<id>]` / 裸 `lib:<id>` 不是画布节点，落进 `findNodeByRef` 只会
 * 误报「找不到引用」。因此 host-tools 在画布匹配池之前先走资产库三段式
 * （§3.4 / §8-D）：
 *   1. 解析：`library.require(id)` —— 未知 id → CS-LIB-001；
 *   2. 物化：`materializeLibraryMedia` 把 `library/<id>/<file>` 拷进当前项目
 *      `assets/`（contentHash / 确定性名 `lib-<assetId>-<file>` 两档去重）；
 *   3. promote：既有 `promoteAssetFile` 注册 Drama 句柄 + reference-manifest 记账；
 *   成功后 fire-and-forget 回写 `usage`（测试必须轮询等待）。
 *
 * 锁住七条行为（对齐 §6.2）：
 *   1. `@ref[lib:<id>]` 三段式：物化落盘 + generate 走参考图 + manifest 记账；
 *   2. 裸 `lib:<id>`（不带 @ref）同样解析（否则原样穿透后端吃 500）；
 *   3. 未知 id → CS-LIB-001（不是 CS-USER-001「找不到引用」）；
 *   4. 纯元数据资产 → CS-USER-ERR，文案含资产名（教模型补媒体而不是报 500）；
 *   5. 跨项目引用：各项目各落一份物化拷贝，usage 记两个项目；同项目重复解析
 *      **不产生第二份拷贝**（确定性名幂等）；
 *   6. 库媒体文件缺失 → CS-LIB-003（宁可拒绝，也不产出悬空引用）；
 *   7. `list_references` 透出 `library` 字段并渲染成 `@ref[lib:…]` 写法指引。
 *
 * 运行：corepack yarn workspace canvas-studio build && corepack yarn workspace canvas-studio test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AssetLibrary } from '../lib/asset-library.js'
import { createStudioTools } from '../lib/host-tools.js'
import { resetDramaProbeCache } from '../lib/generate.js'

const EXEC = (cwd) => ({ agent: { session: { header: { cwd } } }, signal: AbortSignal.timeout(20000) })

/** 轮询等待异步回写（usage 由 fire-and-forget 触发，完成时机不确定）。 */
async function waitFor(predicate, label, timeoutMs = 5000) {
  const start = Date.now()
  for (;;) {
    const value = await predicate()
    if (value) return value
    if (Date.now() - start > timeoutMs) throw new Error(`timeout waiting for ${label}`)
    await new Promise((resolve) => { setTimeout(resolve, 20) })
  }
}

/**
 * Drama Backend fetch 打桩（按 URL 分流）：health → 探针；generate/upload → 上传
 * 句柄；其余（image2image / 产物下载）→ `{full_url}` + 字节。
 */
function stubLibFetch() {
  const calls = []
  const original = globalThis.fetch
  let seq = 0
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url)
    let body = null
    if (typeof init.body === 'string') {
      try { body = JSON.parse(init.body) } catch { body = init.body }
    }
    calls.push({ url: target, method: init.method ?? 'GET', body })
    const json = async () => {
      if (target.includes('/api/v1/health')) return { status: 'ok' }
      if (target.includes('/api/v1/generate/upload')) return { name: `ref-lib${seq++}.png` }
      return { full_url: 'https://media.example/out.png' }
    }
    return {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json,
      text: async () => '',
      arrayBuffer: async () => new Uint8Array([1, 2, 3]),
    }
  }
  return { calls, restore: () => { globalThis.fetch = original } }
}

/** 两个项目（各一个独立 assetsDir）+ 一个共享库：一条带媒体、一条纯元数据。 */
async function makeFixture() {
  const root = await mkdtemp(join(tmpdir(), 'cs-libref-'))
  const libRoot = join(root, 'library-root')
  const sourceDir = join(root, 'sources')
  const dirA = join(root, 'proj-a')
  const dirB = join(root, 'proj-b')
  await mkdir(libRoot, { recursive: true })
  await mkdir(sourceDir, { recursive: true })
  const sourcePath = join(sourceDir, 'front.png')
  await writeFile(sourcePath, Buffer.from('library-png-bytes'))

  const library = new AssetLibrary(libRoot)
  const asset = await library.create({
    category: 'character',
    name: '女主',
    aliases: ['Luna'],
    description: '黑色短发，米色风衣',
    media: [{ sourcePath, label: '正视图' }],
  })
  const bare = await library.create({ category: 'prop', name: '怀表' })

  const projects = [
    { id: 'p1', name: 'A', dir: dirA, createdAt: 1 },
    { id: 'p2', name: 'B', dir: dirB, createdAt: 2 },
  ]
  const canvases = { p1: { version: 4, nodes: [] }, p2: { version: 4, nodes: [] } }
  const assets = { p1: join(dirA, 'assets'), p2: join(dirB, 'assets') }
  const registry = {
    list: async () => projects,
    getProject: async (id) => projects.find((entry) => entry.id === id) ?? null,
    assetsDir: (id) => assets[id],
    readCanvas: async (id) => canvases[id] ?? { version: 4, nodes: [] },
    writeCanvas: async (id, nodes) => { canvases[id] = { version: 4, nodes } },
    appendCanvasNode: async () => {},
    upsertAsset: async () => {},
    releaseAssetNodes: async () => {},
  }
  return { root, libRoot, assets, dirA, dirB, library, asset, bare, registry }
}

async function cleanup(fixture) {
  await rm(fixture.root, { recursive: true, force: true })
}

// ---------------------------------------------------------------------------
// 1/2. 三段式解析（@ref 形态与裸 lib: 形态）
// ---------------------------------------------------------------------------
test('REQ-001：@ref[lib:<id>] 走解析→物化→promote 三段式，并记账 manifest 与 usage', async () => {
  const fixture = await makeFixture()
  try {
    const tools = createStudioTools(fixture.registry, 3005, undefined, fixture.library)
    const imgGen = tools.find((tool) => tool.name === 'image_generate')
    assert.ok(imgGen, 'image_generate 工具应存在')

    resetDramaProbeCache()
    const { calls, restore } = stubLibFetch()
    try {
      const result = await imgGen.execute(
        { prompt: '测试', filename: `@ref[lib:${fixture.asset.id}]` },
        EXEC(fixture.dirA),
      )
      assert.ok(result.url.startsWith('/canvas-studio/assets/'), '产物应为同源相对 URL')

      // ① 生成请求真的把物化出来的文件当参考图传给了后端。
      const genCall = calls.find((entry) => entry.body && entry.body.image1 !== undefined)
      assert.ok(genCall, '应有一次携带 image1 的生成请求')
      assert.match(genCall.body.image1, /^ref-lib\d+\.png$/u, '参考图应是上传后拿到的 Drama 句柄')

      // ② 物化：库文件被拷进当前项目 assets/，确定性名 lib-<assetId>-<file>。
      const files = await readdir(fixture.assets.p1)
      const materialized = `lib-${fixture.asset.id}-m_0.png`
      assert.ok(files.includes(materialized), `assets/ 应含物化文件 ${materialized}，实得 ${files.join(', ')}`)
      assert.equal(
        await readFile(join(fixture.assets.p1, materialized), 'utf8'),
        'library-png-bytes',
        '物化文件内容必须逐字节等于库媒体',
      )

      // ③ promote 记账：句柄 → 本地资产的映射落盘（heal 自愈的反查源）。
      const manifest = JSON.parse(await readFile(join(fixture.assets.p1, 'reference-manifest.json'), 'utf8'))
      assert.equal(manifest.handles[genCall.body.image1], materialized, 'reference-manifest 应记录句柄→物化文件')

      // ④ usage 回写是 fire-and-forget，必须轮询。
      const used = await waitFor(
        async () => (await fixture.library.require(fixture.asset.id)).usage.some((entry) => entry.projectId === 'p1'),
        'usage 回写到 p1',
      )
      assert.ok(used, 'usage 应回写 p1')
    } finally {
      restore()
    }
  } finally {
    await cleanup(fixture)
  }
})

test('REQ-001：裸 lib:<id>（不带 @ref）同样解析（不原样穿透后端）', async () => {
  const fixture = await makeFixture()
  try {
    const tools = createStudioTools(fixture.registry, 3005, undefined, fixture.library)
    const imgGen = tools.find((tool) => tool.name === 'image_generate')
    resetDramaProbeCache()
    const { calls, restore } = stubLibFetch()
    try {
      await imgGen.execute({ prompt: '测试', filename: `lib:${fixture.asset.id}` }, EXEC(fixture.dirA))
      const genCall = calls.find((entry) => entry.body && entry.body.image1 !== undefined)
      assert.ok(genCall, '应有一次携带 image1 的生成请求')
      assert.notEqual(genCall.body.image1, `lib:${fixture.asset.id}`, '裸 lib: 句柄不能原样透传给后端')
      const files = await readdir(fixture.assets.p1)
      assert.ok(files.includes(`lib-${fixture.asset.id}-m_0.png`), '裸句柄也应完成物化')
    } finally {
      restore()
    }
  } finally {
    await cleanup(fixture)
  }
})

// ---------------------------------------------------------------------------
// 3/4. 错误码
// ---------------------------------------------------------------------------
test('REQ-001：未知库 id → CS-LIB-001（不再落到画布池的「找不到引用」）', async () => {
  const fixture = await makeFixture()
  try {
    const tools = createStudioTools(fixture.registry, 3005, undefined, fixture.library)
    const imgGen = tools.find((tool) => tool.name === 'image_generate')
    resetDramaProbeCache()
    const { restore } = stubLibFetch()
    try {
      await assert.rejects(
        imgGen.execute({ prompt: '测试', filename: '@ref[lib:00000000-0000-0000-0000-000000000000]' }, EXEC(fixture.dirA)),
        (error) => error.code === 'CS-LIB-001',
        '未知库资产应报 CS-LIB-001',
      )
    } finally {
      restore()
    }
  } finally {
    await cleanup(fixture)
  }
})

test('REQ-001：纯元数据资产不能作文件引用 → CS-USER-ERR 且文案含资产名', async () => {
  const fixture = await makeFixture()
  try {
    const tools = createStudioTools(fixture.registry, 3005, undefined, fixture.library)
    const imgGen = tools.find((tool) => tool.name === 'image_generate')
    resetDramaProbeCache()
    const { restore } = stubLibFetch()
    try {
      await assert.rejects(
        imgGen.execute({ prompt: '测试', filename: `@ref[lib:${fixture.bare.id}]` }, EXEC(fixture.dirA)),
        (error) => {
          assert.equal(error.code, 'CS-USER-ERR')
          assert.match(error.message, /怀表/u, '报错必须带资产名，便于模型自己修')
          assert.doesNotMatch(error.message, /\/Users\/|assets-library\.json/u, '用户可见文案不许带路径')
          return true
        },
        '无媒体资产应报 CS-USER-ERR',
      )
    } finally {
      restore()
    }
  } finally {
    await cleanup(fixture)
  }
})

test('REQ-001：库媒体文件缺失 → CS-LIB-003', async () => {
  const fixture = await makeFixture()
  try {
    await rm(join(fixture.libRoot, 'library', fixture.asset.id, 'm_0.png'), { force: true })
    const tools = createStudioTools(fixture.registry, 3005, undefined, fixture.library)
    const imgGen = tools.find((tool) => tool.name === 'image_generate')
    resetDramaProbeCache()
    const { restore } = stubLibFetch()
    try {
      await assert.rejects(
        imgGen.execute({ prompt: '测试', filename: `@ref[lib:${fixture.asset.id}]` }, EXEC(fixture.dirA)),
        (error) => error.code === 'CS-LIB-003',
        '库媒体缺失应报 CS-LIB-003',
      )
      const files = await readdir(fixture.assets.p1).catch(() => [])
      assert.equal(files.filter((file) => file.startsWith('lib-')).length, 0, '失败不应留下半截物化文件')
    } finally {
      restore()
    }
  } finally {
    await cleanup(fixture)
  }
})

// ---------------------------------------------------------------------------
// 5. 跨项目 + 幂等去重
// ---------------------------------------------------------------------------
test('REQ-001：跨项目引用各落各的 assets/，usage 记两个项目；同项目重复解析不产生第二份拷贝', async () => {
  const fixture = await makeFixture()
  try {
    const tools = createStudioTools(fixture.registry, 3005, undefined, fixture.library)
    const imgGen = tools.find((tool) => tool.name === 'image_generate')
    resetDramaProbeCache()
    const { restore } = stubLibFetch()
    try {
      const ref = `@ref[lib:${fixture.asset.id}]`
      // 同项目连解两次（幂等）→ 跨项目解一次。
      await imgGen.execute({ prompt: '测试', filename: ref }, EXEC(fixture.dirA))
      await imgGen.execute({ prompt: '测试', filename: ref }, EXEC(fixture.dirA))
      await imgGen.execute({ prompt: '测试', filename: ref }, EXEC(fixture.dirB))

      const filesP1 = await readdir(fixture.assets.p1)
      const filesP2 = await readdir(fixture.assets.p2)
      const libFilesP1 = filesP1.filter((file) => file.startsWith('lib-'))
      const libFilesP2 = filesP2.filter((file) => file.startsWith('lib-'))
      assert.equal(libFilesP1.length, 1, `p1 重复解析应只有 1 份拷贝，实得 ${libFilesP1.join(', ')}`)
      assert.equal(libFilesP2.length, 1, 'p2 应有自己的一份拷贝')
      assert.deepEqual(libFilesP1, libFilesP2, '确定性名与项目无关，两份拷贝同名')
      assert.equal(
        await readFile(join(fixture.assets.p1, libFilesP1[0]), 'utf8'),
        await readFile(join(fixture.assets.p2, libFilesP2[0]), 'utf8'),
        '两份拷贝字节一致',
      )

      const usage = await waitFor(
        async () => {
          const current = await fixture.library.require(fixture.asset.id)
          const p1 = current.usage.some((entry) => entry.projectId === 'p1')
          const p2 = current.usage.some((entry) => entry.projectId === 'p2')
          return p1 && p2 ? current.usage : null
        },
        'usage 同时记 p1 与 p2',
      )
      assert.equal(usage.filter((entry) => entry.projectId === 'p1').length, 1, 'usage 幂等：同项目不重复追加')
    } finally {
      restore()
    }
  } finally {
    await cleanup(fixture)
  }
})

// ---------------------------------------------------------------------------
// 7. list_references 透出 library 字段
// ---------------------------------------------------------------------------
test('REQ-001：list_references 返回 library 字段并渲染 @ref[lib:…] 写法指引', async () => {
  const fixture = await makeFixture()
  try {
    const tools = createStudioTools(fixture.registry, 3005, undefined, fixture.library)
    const listRef = tools.find((tool) => tool.name === 'list_references')
    assert.ok(listRef, 'list_references 工具应存在')

    const res = await listRef.execute({}, EXEC(fixture.dirA))
    assert.ok(Array.isArray(res.library), 'list_references 应返回 library 字段')
    assert.equal(res.library.length, 2, '库内两条资产都应列出')

    const entry = res.library.find((item) => item.id === `lib:${fixture.asset.id}`)
    assert.ok(entry, '应含带 lib: 前缀的 id')
    assert.equal(entry.category, '角色')
    assert.equal(entry.name, '女主')
    assert.deepEqual(entry.aliases, ['Luna'])
    assert.equal(entry.media, 1)
    const bareEntry = res.library.find((item) => item.id === `lib:${fixture.bare.id}`)
    assert.equal(bareEntry.media, 0, '无媒体条目媒体数为 0')

    const blocks = listRef.output.render({}, res)
    const text = blocks[0].text
    assert.match(text, /全局资产库（2，跨项目可引用）/u, '应渲染全局资产库小节')
    assert.match(text, /@ref\[lib:<id>\]/u, '应给出可直接粘贴的 @ref 写法')
    assert.match(text, new RegExp(`id=lib:${fixture.asset.id}`, 'u'), '每条应带可引用的 id=lib:<id>')
    assert.match(text, /裸 `lib:<id>`/u, '应提示裸句柄形态')
    assert.match(text, /无媒体（不可作文件引用）/u, '无媒体条目要显式标注')
  } finally {
    await cleanup(fixture)
  }
})
