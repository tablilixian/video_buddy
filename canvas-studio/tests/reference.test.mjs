/**
 * P9 参考图闭环契约测试：覆盖「上传素材 → 在聊天里用起来」的完整链路。
 *
 * 1. @ref token 解析（formatRefToken / parseRefTokens）—— 纯函数，对话内引用句柄。
 * 2. 持久化往返（ProjectRegistry 真实落盘）—— filename / isReference / referenceRole
 *    / referenceStrength 在写入后再读出必须原样保留（修复「上传成功却丢 filename」）。
 * 3. list_references —— Host 工具返回结构（title/url/filename/role/strength）与渲染。
 * 4. @ref 自动解析 —— image_generate 的 filename 传 `@ref[显示名]` 时，Host 自动
 *    解析成对应 Drama 文件名（直接修复「上传了聊天用不了」的原始诉求）。
 *
 * 运行：corepack yarn workspace canvas-studio run test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { findNodeByRef, formatRefToken, parseRefTokens, sanitizeTitle, uniqueTitle } from '../lib/reference-token.js'
import {
  buildAssetHandles, buildLibraryAssetHandles, filterAssetHandles, filterLibraryAssets,
  findAssetByChipText, findAssetByHandle, truncateLabel,
} from '../lib/reference-handle.js'
import { libraryMediaUrl } from '../lib/contracts/asset-library.js'
import { ProjectRegistry } from '../lib/projects.js'
import { createStudioTools } from '../lib/host-tools.js'

// ---------------------------------------------------------------------------
// 1. @ref token 解析
// ---------------------------------------------------------------------------
test('formatRefToken：显示名 → @ref[显示名]', () => {
  assert.equal(formatRefToken('角色A'), '@ref[角色A]')
  assert.equal(formatRefToken('风格/构图'), '@ref[风格/构图]')
})

test('CR-031：formatRefToken 拒绝含 [ / ] 的标题（避免生成坏 token 错配）', () => {
  assert.throws(() => formatRefToken('标题]带右括号'), /\[ 或 \]/u)
  assert.throws(() => formatRefToken('标题[带左括号'), /\[ 或 \]/u)
  assert.throws(() => formatRefToken('两[]边'), /\[ 或 \]/u)
})

test('CR-031：parseRefTokens 单条消息 token 数量有上限', () => {
  const many = Array.from({ length: 200 }, (_, i) => `@ref[参考${i}]`).join(' ')
  const tokens = parseRefTokens(many)
  assert.equal(tokens.length, 64, '超过上限的 token 应被截断（防超长输入消耗）')
})

test('parseRefTokens：抽取所有 @ref[显示名]，去重且保序', () => {
  assert.deepEqual(
    parseRefTokens('用 @ref[角色A] 和 @ref[风格B] 生成分镜'),
    ['角色A', '风格B'],
  )
  assert.deepEqual(parseRefTokens('没有引用的纯文本'), [])
  assert.deepEqual(
    parseRefTokens('@ref[A] @ref[A] @ref[B]'),
    ['A', 'B'],
  )
  assert.deepEqual(parseRefTokens('@ref[带]号] 这种异常也只取到首个 ]'), ['带'])
})

// ---------------------------------------------------------------------------
// 1a. CV-114：句柄 = node id（title 兜底）
// ---------------------------------------------------------------------------
test('findNodeByRef：id 精确命中优先于标题，标题命中作兜底', () => {
  const nodes = [
    { id: 'n1', title: '角色A' },
    { id: 'n2', title: '角色B' },
  ]
  assert.equal(findNodeByRef(nodes, 'n2')?.id, 'n2', 'id 应优先命中')
  assert.equal(findNodeByRef(nodes, '角色A')?.id, 'n1', '标题应兜底命中（历史/手输兼容）')
  assert.equal(findNodeByRef(nodes, ' 角色A ')?.id, 'n1', '首尾空白应忽略')
  assert.equal(findNodeByRef(nodes, '不存在'), undefined, '未命中返回 undefined')
  assert.equal(findNodeByRef(nodes, '   '), undefined, '空句柄不参与匹配')
})

test('findNodeByRef：标题撞名时取首个，且 id 永不与标题混淆', () => {
  const nodes = [
    { id: 'a', title: '同名' },
    { id: 'b', title: '同名' },
  ]
  assert.equal(findNodeByRef(nodes, '同名')?.id, 'a', '同标题取创建顺序首个')
  // 真实风险：某节点标题恰好等于另一个节点的 id —— id 必须赢。
  const tricky = [
    { id: 'x1', title: 'y2' },
    { id: 'y2', title: 'x1' },
  ]
  assert.equal(findNodeByRef(tricky, 'y2')?.id, 'y2', 'id 命中优先于同名标题')
})

// ---------------------------------------------------------------------------
// 1b. CV-114：素材短句柄（chip 文案 img-01 / vid-01）
// ---------------------------------------------------------------------------
test('buildAssetHandles：收 image/video/audio，按类型分别编号，文本节点不进表', () => {
  const node = (id, kind, title = '', extra = {}) => ({
    id,
    kind,
    title,
    url: `/assets/${id}.png`,
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    createdAt: 1,
    origin: 'manual',
    sourceIds: [],
    ...extra,
  })
  const handles = buildAssetHandles([
    node('i1', 'image', '主角正面'),
    node('t1', 'text', '便利贴'),
    node('v1', 'video', '镜头一'),
    node('i2', 'image', '主角侧面'),
    node('v2', 'video', '镜头二'),
    node('a1', 'audio', '主题曲', { url: '/assets/a1.mp3', duration: 96 }),
    node('s1', 'sticky', '便签'),
    node('a2', 'audio', 'BGM 片段', { url: '/assets/a2.mp3' }),
  ])
  assert.deepEqual(handles.map((h) => h.handle), ['img-01', 'vid-01', 'img-02', 'vid-02', 'aud-01', 'aud-02'])
  assert.deepEqual(handles.map((h) => h.nodeId), ['i1', 'v1', 'i2', 'v2', 'a1', 'a2'], '文本/便签不进表')
  assert.equal(handles[0].title, '主角正面')
  assert.equal(handles[0].kind, 'image')
  assert.equal(handles[0].url, '/assets/i1.png')
  assert.equal(handles[4].kind, 'audio', '音频进表后 kind 为 audio')
  assert.equal(handles[4].duration, 96, '音频时长透传给 hover 卡徽标')
  assert.equal(handles[5].duration, undefined, '未知时长不挂字段（exactOptionalPropertyTypes）')
})

test('findAssetByHandle：大小写不敏感、容错前导 @；filterAssetHandles 按句柄/标题/类型过滤', () => {
  const handles = [
    { nodeId: 'i1', handle: 'img-01', kind: 'image', title: '主角正面', url: null },
    { nodeId: 'v1', handle: 'vid-01', kind: 'video', title: '镜头一', url: null },
    { nodeId: 'a1', handle: 'aud-01', kind: 'audio', title: '主题曲', url: null },
  ]
  assert.equal(findAssetByHandle(handles, 'img-01')?.nodeId, 'i1')
  assert.equal(findAssetByHandle(handles, '@IMG-01')?.nodeId, 'i1', 'chip 文案带 @ 前缀也能反查')
  assert.equal(findAssetByHandle(handles, 'vid-99'), undefined)
  assert.equal(filterAssetHandles(handles, '').length, 3, '空 query 返回全部')
  assert.equal(filterAssetHandles(handles, 'vid').length, 1)
  assert.equal(filterAssetHandles(handles, '主角').length, 1, '标题也可搜')
  assert.equal(filterAssetHandles(handles, '音频').length, 1, '中文类型可搜（kind 是英文 audio）')
  assert.equal(filterAssetHandles(handles, 'audio').length, 1, '英文类型仍可搜')
})

test('findAssetByChipText：句柄 / nodeId / 标题 / 文件 basename 四路兜底', () => {
  const handles = [
    { nodeId: 'i1', handle: 'img-01', kind: 'image', title: '主角正面', url: 'http://h/temp/i1.png' },
    { nodeId: 'v1', handle: 'vid-01', kind: 'video', title: '', url: 'http://h/temp/镜头一.mp4?x=1' },
    { nodeId: 'a1', handle: 'aud-01', kind: 'audio', title: '主题曲', url: 'http://h/temp/主题曲.mp3' },
  ]
  assert.equal(findAssetByChipText(handles, 'img-01')?.nodeId, 'i1', '自家短句柄')
  assert.equal(findAssetByChipText(handles, 'aud-01')?.nodeId, 'a1', '音频短句柄同样能反查')
  assert.equal(findAssetByChipText(handles, '主题曲.mp3')?.nodeId, 'a1', '音频文件 basename')
  assert.equal(findAssetByChipText(handles, '@IMG-01')?.nodeId, 'i1', '带 @ 前缀')
  assert.equal(findAssetByChipText(handles, 'i1')?.nodeId, 'i1', 'nodeId（@ref[id] 原样粘贴）')
  assert.equal(findAssetByChipText(handles, '主角正面')?.nodeId, 'i1', '节点标题')
  // 上游 @ 文件源的 chip label 是文件名（可带路径），靠 url 末段命中画布素材。
  assert.equal(findAssetByChipText(handles, 'i1.png')?.nodeId, 'i1', '文件 basename')
  assert.equal(findAssetByChipText(handles, '@/Users/wl/tmp/i1.png')?.nodeId, 'i1', '带路径的文件名')
  assert.equal(findAssetByChipText(handles, '镜头一')?.nodeId, 'v1', 'basename 去扩展名 + 查询串')
  assert.equal(findAssetByChipText(handles, '不存在.png'), undefined)
  // 已发送气泡：上游把 chip 显示名的前导 @ 剥掉，只剩 ref[<id>]（title 里才是完整原文）
  assert.equal(findAssetByChipText(handles, 'ref[i1]')?.nodeId, 'i1', '气泡 chip：ref[id] 无 @')
  assert.equal(findAssetByChipText(handles, '@ref[I1]')?.nodeId, 'i1', '气泡 chip title：@ref[id]')
  assert.equal(findAssetByChipText(handles, 'ref[不存在]'), undefined)
  assert.equal(findAssetByChipText(handles, '   '), undefined)
})

test('truncateLabel：超长截断加省略号，按码点切不切坏字符', () => {
  assert.equal(truncateLabel('短标题'), '短标题')
  assert.equal(truncateLabel('主角站在走廊尽头的中景镜头', 6), '主角站在走…')
  assert.equal(truncateLabel('abcdefgh', 4), 'abc…')
})

// ---------------------------------------------------------------------------
// 1b. 上传标题唯一化（剪贴板粘贴 File.name 恒为 image.png 的去重）
// ---------------------------------------------------------------------------
test('sanitizeTitle：空名兜底 + 去除 [ ]（CR-031）', () => {
  assert.equal(sanitizeTitle('image.png'), 'image.png')
  assert.equal(sanitizeTitle(''), '本地素材')
  assert.equal(sanitizeTitle('   '), '本地素材')
  assert.equal(sanitizeTitle('图[1]'), '图1')
})

test('uniqueTitle：重名追加序号，同批次连续去重且回写 used', () => {
  const used = new Set()
  assert.equal(uniqueTitle('image.png', used), 'image.png')
  assert.equal(uniqueTitle('image.png', used), 'image 2.png')
  assert.equal(uniqueTitle('image.png', used), 'image 3.png')
  // 已占用标题会保留：后续批次再传同名也不会撞已有节点
  assert.equal(uniqueTitle('image.png', used), 'image 4.png')
})

test('uniqueTitle：无扩展名与多扩展名都能正确插序号', () => {
  const used = new Set(['本地素材'])
  assert.equal(uniqueTitle('', used), '本地素材 2')
  const used2 = new Set(['a.b.png'])
  assert.equal(uniqueTitle('a.b.png', used2), 'a.b 2.png')
  const used3 = new Set(['noext'])
  assert.equal(uniqueTitle('noext', used3), 'noext 2')
})

test('uniqueTitle：以项目已有节点标题为基线去重（跨批次不撞名）', () => {
  const used = new Set(['image.png', '创意', '旧图.png'])
  assert.equal(uniqueTitle('image.png', used), 'image 2.png')
  assert.equal(uniqueTitle('新图.png', used), '新图.png')
})

// ---------------------------------------------------------------------------
// 2. 持久化往返（真实 ProjectRegistry）
// ---------------------------------------------------------------------------
test('ProjectRegistry：参考图字段（filename/isReference/referenceRole/referenceStrength）往返保留', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-ref-'))
  try {
    const registry = new ProjectRegistry(dir)
    const project = await registry.create('参考闭环测试')
    const referenceNode = {
      id: 'ref1',
      kind: 'image',
      title: '角色A',
      url: '/canvas-studio/assets/ref1.png',
      filename: 'drama-abc.png',
      isReference: true,
      referenceRole: 'character',
      referenceStrength: 0.8,
      x: 10,
      y: 10,
      width: 200,
      height: 140,
      createdAt: 1000,
      origin: 'manual',
      sourceIds: [],
    }
    await registry.writeCanvas(project.id, [referenceNode])
    const read = await registry.readCanvas(project.id)
    assert.equal(read.nodes.length, 1, '节点数应为 1')
    const node = read.nodes[0]
    assert.equal(node.filename, 'drama-abc.png', 'filename 应保留')
    assert.equal(node.isReference, true, 'isReference 应保留')
    assert.equal(node.referenceRole, 'character', 'referenceRole 应保留')
    assert.equal(node.referenceStrength, 0.8, 'referenceStrength 应保留')
    assert.equal(node.title, '角色A')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// 工具测试用的注册表打桩
// ---------------------------------------------------------------------------
function stubToolRegistry(nodes, dir = '/tmp/cs-proj', extra = {}) {
  return {
    list: async () => [{ id: 'p1', name: 'P1', dir, createdAt: 1 }],
    getProject: async () => ({ workflow: { mode: 'auto', state: 'idle' } }),
    assetsDir: () => dir,
    readCanvas: async () => ({ version: 4, nodes, ...extra }),
    writeCanvas: async () => {},
    appendCanvasNode: async () => {},
  }
}

function makeReferenceNode(overrides = {}) {
  return {
    id: 'n1',
    kind: 'image',
    title: '角色A',
    url: 'https://x/a.png',
    filename: 'A.png',
    isReference: true,
    referenceRole: 'character',
    referenceStrength: 0.8,
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    createdAt: 1,
    origin: 'manual',
    sourceIds: [],
    ...overrides,
  }
}

const EXEC = (cwd) => ({ agent: { session: { header: { cwd } } }, signal: AbortSignal.timeout(5000) })

// ---------------------------------------------------------------------------
// 3. list_references
// ---------------------------------------------------------------------------
test('list_references：只列出标记为参考的图，结构含 filename/role/strength', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-ref-'))
  try {
    const nodes = [
      makeReferenceNode(),
      makeReferenceNode({ id: 'n2', title: '普通图', isReference: false, filename: undefined }),
    ]
    const registry = stubToolRegistry(nodes, dir)
    const tools = createStudioTools(registry, 3005)
    const listRef = tools.find((t) => t.name === 'list_references')
    assert.ok(listRef, 'list_references 工具应存在')

    const res = await listRef.execute({}, EXEC(dir))
    assert.equal(res.references.length, 1, '只应返回 1 个参考')
    const ref = res.references[0]
    assert.equal(ref.title, '角色A')
    assert.equal(ref.url, 'https://x/a.png')
    assert.equal(ref.filename, 'A.png')
    assert.equal(ref.role, 'character')
    assert.equal(ref.strength, 0.8)

    const blocks = listRef.output.render({}, res)
    assert.equal(blocks.length, 1)
    assert.match(blocks[0].text, /角色A/)
    assert.match(blocks[0].text, /A\.png/)
    assert.match(blocks[0].text, /\[character\]/)
    assert.match(blocks[0].text, /强度 0\.8/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// 4. @ref 自动解析（image_generate 把 @ref[显示名] → Drama 文件名）
// ---------------------------------------------------------------------------
function stubFetchCapture() {
  const calls = []
  const original = globalThis.fetch
  globalThis.fetch = async (url, init = {}) => {
    let body = null
    if (typeof init.body === 'string') {
      try { body = JSON.parse(init.body) } catch { body = init.body }
    }
    calls.push({ url: String(url), method: init.method ?? 'GET', body })
    return {
      ok: true,
      status: 200,
      json: async () => ({ full_url: 'https://media.example/out.png' }),
      arrayBuffer: async () => new Uint8Array([1, 2, 3]),
      text: async () => '',
    }
  }
  return { calls, restore: () => { globalThis.fetch = original } }
}

test('image_generate：@ref[显示名] 自动解析为 Drama 文件名；普通文件名原样透传；未知引用报错', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-ref-'))
  try {
    const registry = stubToolRegistry([makeReferenceNode()], dir)
    const tools = createStudioTools(registry, 3005)
    const imgGen = tools.find((t) => t.name === 'image_generate')
    assert.ok(imgGen, 'image_generate 工具应存在')

    // (a) @ref 解析
    {
      const { calls, restore } = stubFetchCapture()
      try {
        const result = await imgGen.execute({ prompt: '测试', filename: '@ref[角色A]' }, EXEC(dir))
        const genCall = calls.find((c) => c.body && c.body.image1 !== undefined)
        assert.ok(genCall, '应有一次携带 image1 的生成请求')
        assert.equal(genCall.body.image1, 'A.png', '@ref[角色A] 应解析为 Drama 文件名 A.png')
        assert.ok(result.url.startsWith('/canvas-studio/assets/'), '产物应为同源相对 URL')
      } finally {
        restore()
      }
    }

    // (b) 普通文件名原样透传（无 @ref 时不应误解析）
    {
      const { calls, restore } = stubFetchCapture()
      try {
        await imgGen.execute({ prompt: '测试', filename: 'raw.png' }, EXEC(dir))
        const genCall = calls.find((c) => c.body && c.body.image1 !== undefined)
        assert.equal(genCall.body.image1, 'raw.png', '普通文件名应原样透传')
      } finally {
        restore()
      }
    }

    // (c) 未知 @ref 报错且给出可操作提示
    {
      const { restore } = stubFetchCapture()
      try {
        await assert.rejects(
          imgGen.execute({ prompt: '测试', filename: '@ref[不存在]' }, EXEC(dir)),
          /未找到/,
          '未知参考应报错',
        )
      } finally {
        restore()
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('CV-114：@ref[nodeId] 解析为 Drama 文件名（改名/重名不再失效）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-ref-id-'))
  try {
    // 两个同名节点：句柄走 id 时精确命中 n2，走标题则会连错对象。
    const registry = stubToolRegistry([
      makeReferenceNode({ id: 'n1', title: '同名', filename: 'one.png' }),
      makeReferenceNode({ id: 'n2', title: '同名', filename: 'two.png' }),
    ], dir)
    const tools = createStudioTools(registry, 3005)
    const imgGen = tools.find((t) => t.name === 'image_generate')
    const { calls, restore } = stubFetchCapture()
    try {
      await imgGen.execute({ prompt: '测试', filename: '@ref[n2]' }, EXEC(dir))
      const genCall = calls.find((c) => c.body && c.body.image1 !== undefined)
      assert.equal(genCall.body.image1, 'two.png', '@ref[nodeId] 应精确到 id 对应节点')
    } finally {
      restore()
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// 5. C2：list_references 输出一致性资产卡（跨镜头锚点的权威来源）
// ---------------------------------------------------------------------------
test('list_references：返回 assets（lockedPrompt + 锚点分图 filename）并渲染成文本', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-ref-asset-'))
  try {
    const nodes = [
      makeReferenceNode({ id: 'anchor-1', title: '正面特写', filename: 'front.png', assetId: 'asset-1' }),
      makeReferenceNode({ id: 'anchor-2', title: '全身', filename: 'full.png', assetId: 'asset-1' }),
      makeReferenceNode(),
    ]
    const registry = stubToolRegistry(nodes, dir, {
      assets: [{
        id: 'asset-1',
        name: '女主',
        role: 'character',
        anchorNodeIds: ['anchor-1', 'anchor-2', 'missing-node'],
        lockedPrompt: '[SAME CHARACTER: 女性，黑色短发，米色风衣] [SAME LIGHT: 冷蓝主光]',
        negativePrompt: '不更换服装',
        createdAt: 1,
      }],
    })
    const tools = createStudioTools(registry, 3005)
    const listRef = tools.find((t) => t.name === 'list_references')
    const res = await listRef.execute({}, EXEC(dir))

    assert.equal(res.assets.length, 1)
    const asset = res.assets[0]
    assert.equal(asset.id, 'asset-1')
    assert.equal(asset.name, '女主')
    assert.equal(asset.role, 'character')
    assert.match(asset.lockedPrompt, /SAME CHARACTER/, 'lockedPrompt 应原样透出（逐字节复用）')
    assert.equal(asset.negativePrompt, '不更换服装')
    // 锚点节点 id → 可直接填进 filenames 的 Drama filename；找不到的节点跳过。
    assert.deepEqual(asset.anchors.map((p) => p.filename), ['front.png', 'full.png'])
    assert.equal(asset.anchors.length, 2, '缺失节点应被跳过而非产出空洞')
    // 归属资产卡的参考图带 assetId，便于反查
    assert.equal(res.references.find((r) => r.title === '正面特写').assetId, 'asset-1')

    const blocks = listRef.output.render({}, res)
    assert.match(blocks[0].text, /一致性资产卡/)
    assert.match(blocks[0].text, /锁定|lockedPrompt|SAME CHARACTER/)
    assert.match(blocks[0].text, /front\.png、full\.png/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('list_references：无资产卡时 assets 为空数组（旧项目不受影响）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-ref-noasset-'))
  try {
    const registry = stubToolRegistry([makeReferenceNode()], dir)
    const tools = createStudioTools(registry, 3005)
    const listRef = tools.find((t) => t.name === 'list_references')
    const res = await listRef.execute({}, EXEC(dir))
    assert.deepEqual(res.assets, [], '无资产卡应返回空数组')
    const blocks = listRef.output.render({}, res)
    assert.doesNotMatch(blocks[0].text, /一致性资产卡/, '无资产卡时不渲染该段')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// REQ-001：`lib:` 句柄视图（Step 3.6）—— 纯函数，host 侧可单测
// ---------------------------------------------------------------------------
test('REQ-001：formatRefToken / parseRefTokens 对 lib: 句柄往返', () => {
  assert.equal(formatRefToken('lib:abc-123'), '@ref[lib:abc-123]')
  assert.deepEqual(parseRefTokens('@ref[lib:abc-123]'), ['lib:abc-123'])
  assert.deepEqual(
    parseRefTokens('用 @ref[lib:aaa] 和 @ref[lib:bbb] 生成'),
    ['lib:aaa', 'lib:bbb'],
    '多条 @ref 逐个抽出',
  )
  // 裸 `lib:<id>` 不是 token：由 resolveRefValue 的裸值分支兜（§8-D）。
  assert.deepEqual(parseRefTokens('请用 lib:xxx 这张图'), [])
})

test('REQ-001：findNodeByRef 不误吞 lib: 句柄（画布匹配池里没有库条目）', () => {
  const nodes = [
    { id: 'n1', title: '角色A' },
    { id: 'lib:whatever', title: '角色A' },
  ]
  assert.equal(findNodeByRef(nodes, 'lib:n1'), undefined, 'lib: 前缀不得命中同名节点 id')
  assert.equal(findNodeByRef(nodes, 'lib:角色A'), undefined, 'lib: 前缀不得命中同名标题')
  assert.equal(findNodeByRef(nodes, 'lib:aaa'), undefined)
  // 非 lib: 句柄行为不变（这条分支是 Step 3 插入点之前就存在的语义）。
  assert.equal(findNodeByRef(nodes, 'n1')?.id, 'n1')
  assert.equal(findNodeByRef(nodes, '角色A')?.id, 'n1')
})

/** 一条完整形状的库资产（`buildLibraryAssetHandles` / `filterLibraryAssets` 入参）。 */
function makeLibraryAsset(overrides = {}) {
  return {
    id: 'lib-asset-1',
    schema: 1,
    category: 'character',
    name: '女主',
    aliases: ['Luna'],
    description: '黑色短发',
    tags: ['主角'],
    media: [{ file: 'm_0.png', kind: 'image' }],
    anchors: [],
    lockedPrompt: '',
    usage: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

test('REQ-001：buildLibraryAssetHandles 产出 lib:<id> 句柄视图（chip 反查零改动即命中）', () => {
  const asset = makeLibraryAsset()
  const handles = buildLibraryAssetHandles([asset])
  assert.equal(handles.length, 1)
  const handle = handles[0]
  assert.equal(handle.nodeId, 'lib:lib-asset-1', '引用身份走 nodeId 字段，@ref 正则无需改造')
  assert.equal(handle.handle, '女主', 'chip 显示名 = 资产名')
  assert.equal(handle.title, '女主')
  assert.equal(handle.kind, 'image')
  assert.equal(handle.url, libraryMediaUrl(asset.id, 'm_0.png'))
  assert.equal(handle.url, '/canvas-studio/library/lib-asset-1/m_0.png')
})

test('REQ-001：buildLibraryAssetHandles 封面优先，只承载 image/video', () => {
  // 封面显式指向某条 → 用那条的 kind。
  const covered = buildLibraryAssetHandles([makeLibraryAsset({
    media: [
      { file: 'm_0.mp4', kind: 'video' },
      { file: 'm_1.png', kind: 'image' },
    ],
    coverFile: 'm_1.png',
  })])
  assert.equal(covered[0].kind, 'image')
  assert.equal(covered[0].url, '/canvas-studio/library/lib-asset-1/m_1.png')

  // 无封面 → 取 media 里首个 image/video（图在前就出图）。
  const imageFirst = buildLibraryAssetHandles([makeLibraryAsset({
    media: [
      { file: 'm_0.png', kind: 'image' },
      { file: 'm_1.mp4', kind: 'video' },
    ],
  })])
  assert.equal(imageFirst[0].kind, 'image')

  // 只有视频 → 出 video 句柄。
  const videoOnly = buildLibraryAssetHandles([makeLibraryAsset({
    media: [{ file: 'm_0.mp4', kind: 'video' }],
  })])
  assert.equal(videoOnly[0].kind, 'video')

  // 纯音频 / 无媒体：不出 hover 表（AssetHandle 类型面就 image/video 两档）。
  const audioOnly = makeLibraryAsset({
    id: 'lib-asset-audio',
    name: '背景音乐',
    media: [{ file: 'm_0.mp3', kind: 'audio' }],
  })
  assert.deepEqual(buildLibraryAssetHandles([audioOnly]), [], '无 image/video 不进 hover 表')
  assert.deepEqual(buildLibraryAssetHandles([makeLibraryAsset({ media: [] })]), [], '无媒体不进 hover 表')

  // 但 @ 菜单仍搜得到（文件引用会由解析侧明确报 CS-USER-ERR）。
  assert.deepEqual(
    filterLibraryAssets([audioOnly], '背景音乐').map((entry) => entry.id),
    ['lib-asset-audio'],
  )
})

test('REQ-001：filterLibraryAssets 按名称/别名/标签/描述/分类中文名过滤', () => {
  const assets = [
    makeLibraryAsset(),
    makeLibraryAsset({
      id: 'lib-asset-2',
      category: 'scene',
      name: '雨夜巷弄',
      aliases: ['巷子'],
      tags: [],
      description: '湿漉漉的霓虹',
      media: [{ file: 'm_0.png', kind: 'image' }],
    }),
  ]

  assert.equal(filterLibraryAssets(assets, '').length, 2, '空 query 返回全部')
  assert.deepEqual(filterLibraryAssets(assets, '女主').map((e) => e.id), ['lib-asset-1'])
  assert.deepEqual(filterLibraryAssets(assets, 'LUNA').map((e) => e.id), ['lib-asset-1'], '大小写不敏感')
  assert.deepEqual(filterLibraryAssets(assets, '巷子').map((e) => e.id), ['lib-asset-2'], '别名命中')
  assert.deepEqual(filterLibraryAssets(assets, '主角').map((e) => e.id), ['lib-asset-1'], '标签命中')
  assert.deepEqual(filterLibraryAssets(assets, '霓虹').map((e) => e.id), ['lib-asset-2'], '描述命中')
  assert.deepEqual(filterLibraryAssets(assets, '场景').map((e) => e.id), ['lib-asset-2'], '分类中文名命中')
  assert.deepEqual(filterLibraryAssets(assets, '角色').map((e) => e.id), ['lib-asset-1'], '分类中文名命中')
  assert.deepEqual(filterLibraryAssets(assets, '不存在的名字'), [])
})

test('REQ-001：findAssetByChipText 对 @ref[lib:…] 与裸 lib:… 命中（chip hover 零改动）', () => {
  const handles = buildLibraryAssetHandles([makeLibraryAsset()])

  const viaRef = findAssetByChipText(handles, '@ref[lib:lib-asset-1]')
  assert.equal(viaRef?.nodeId, 'lib:lib-asset-1', '@ref[lib:…] 走既有正则命中 nodeId')

  const viaBare = findAssetByChipText(handles, 'lib:lib-asset-1')
  assert.equal(viaBare?.nodeId, 'lib:lib-asset-1', '裸 lib:… 走 nodeId 匹配命中')

  const viaName = findAssetByChipText(handles, '女主')
  assert.equal(viaName?.nodeId, 'lib:lib-asset-1', '资产名（title）兜底命中')

  assert.equal(findAssetByChipText(handles, '@ref[lib:nope]'), undefined)
  assert.equal(findAssetByChipText(handles, 'lib:nope'), undefined)
})
