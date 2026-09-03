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
import { formatRefToken, parseRefTokens } from '../lib/reference-token.js'
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
function stubToolRegistry(nodes, dir = '/tmp/cs-proj') {
  return {
    list: async () => [{ id: 'p1', name: 'P1', dir, createdAt: 1 }],
    getProject: async () => ({ workflow: { mode: 'auto', state: 'idle' } }),
    assetsDir: () => dir,
    readCanvas: async () => ({ version: 3, nodes }),
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
