/**
 * REQ-001 Step 3：全局资产库的 system prompt 小节（方案 §6.2「prompt-section」清单）。
 *
 * 这是验收②b 的**事前指引通道**：agent 要能把「女主」「雨夜巷弄」翻译成逐字可用
 * 的 `@ref[lib:<id>]`，前提是小节真的注入进了 system prompt。锁住六条：
 *   1. 库为空 → 空串（不给模型看空标题）；
 *   2. 正文形状：小节标题、逐字引用指引、`id=lib:<id>`、分类标签、别名、媒体标注；
 *   3. 花括号清洗：用户输入里的 `{{x}}` 会被 renderPrompt 当变量解析，必须转全角；
 *   4. 截断：只列前 200 条 + 明确的「其余走 list_references」提示；
 *   5. 稳定序：四分类枚举序，分类内 updatedAt 倒序（与资产库页同序）；
 *   6. 注册：小节名 / 顺序 152 / 同步返回 string / `agent/created` 预热 / disposer。
 * 读库失败保留旧缓存（坏库降级为旧清单，而不是空串或抛错）。
 *
 * 运行：corepack yarn workspace canvas-studio build && corepack yarn workspace canvas-studio test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AssetLibrary } from '../lib/asset-library.js'
import {
  ASSET_LIBRARY_SECTION_NAME,
  ASSET_LIBRARY_SECTION_ORDER,
  MAX_LIBRARY_PROMPT_ENTRIES,
  cachedAssetLibrarySectionText,
  librarySectionText,
  refreshAssetLibraryPromptCache,
  registerAssetLibraryPrompt,
} from '../lib/asset-library-prompt.js'

/** 一条完整形状的库资产（纯函数入参，不需要真的落盘）。 */
function makeAsset(overrides = {}) {
  return {
    id: 'asset-1',
    schema: 1,
    category: 'character',
    name: '女主',
    aliases: [],
    description: '',
    tags: [],
    media: [],
    anchors: [],
    lockedPrompt: '',
    usage: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

test('REQ-001 prompt：小节常量（名字空间 + 顺序 + 截断上限）', () => {
  assert.equal(ASSET_LIBRARY_SECTION_NAME, 'canvas-studio:asset-library')
  assert.equal(ASSET_LIBRARY_SECTION_ORDER, 152, '150 skill 路由 / 151 项目预置已占，本段取 152')
  assert.equal(MAX_LIBRARY_PROMPT_ENTRIES, 200)
})

test('REQ-001 prompt：库为空 → 空串（不注入空标题）', () => {
  assert.equal(librarySectionText([]), '')
})

test('REQ-001 prompt：正文含小节标题、逐字引用指引、id=lib:<id>、分类标签与别名', () => {
  const text = librarySectionText([
    makeAsset({
      id: 'aaaa-1111',
      category: 'character',
      name: '女主',
      aliases: ['Luna', '黑长直'],
      description: '黑色短发',
      media: [{ file: 'm_0.png', kind: 'image' }],
    }),
    makeAsset({
      id: 'bbbb-2222',
      category: 'prop',
      name: '怀表',
      updatedAt: 2,
    }),
  ])

  assert.match(text, /^## 全局资产库（跨项目）/u, '必须是可识别的 prompt 小节标题')
  assert.match(text, /@ref\[lib:<id>\]/u, '必须给出逐字引用写法')
  assert.match(text, /裸 `lib:<id>`/u, '必须提示裸句柄形态')
  assert.match(text, /不得改写、翻译或截断 id/u, '必须显式禁止改写 id')
  assert.match(text, /list_references/u, '截断时的兜底查询通道要写出来')

  assert.match(text, /- \[角色\] 女主（别名：Luna、黑长直） id=lib:aaaa-1111 — 黑色短发/u)
  assert.match(text, /- \[物件\] 怀表 id=lib:bbbb-2222/u)
  assert.match(text, /（无媒体，不能作文件引用）/u, '无媒体条目要标注，避免被当文件引用')
})

test('REQ-001 prompt：{{ }} 花括号转全角（renderPrompt 不认未知变量）', () => {
  const text = librarySectionText([
    makeAsset({ id: 'c-1', name: '{{用户名}}', aliases: ['a{{b}}c'], description: 'd{{e}}f' }),
  ])
  assert.ok(!text.includes('{{'), `不得出现 {{：${text}`)
  assert.ok(!text.includes('}}'), `不得出现 }}：${text}`)
  assert.match(text, /｛｛用户名｝｝/u)
  assert.match(text, /a｛｛b｝｝c/u)
  assert.match(text, /d｛｛e｝｝f/u)
})

test('REQ-001 prompt：超过 200 条截断，并写明其余走 list_references', () => {
  const assets = Array.from({ length: 201 }, (_, index) => makeAsset({
    id: `asset-${index}`,
    name: index === 0 ? '这条应被截断' : `资产${index}`,
    updatedAt: 1000 + index,
  }))
  const text = librarySectionText(assets)
  const lines = text.split('\n').filter((line) => line.startsWith('- ['))
  assert.equal(lines.length, MAX_LIBRARY_PROMPT_ENTRIES, `应只列 ${MAX_LIBRARY_PROMPT_ENTRIES} 行，实得 ${lines.length}`)
  assert.match(text, /（共 201 条，仅列前 200 条；其余用 list_references 查询 library 字段。）/u)
  assert.match(text, /- \[角色\] 资产200 /u, '截断应保序：第一条是 updatedAt 最大的那条')
  assert.ok(!text.includes('这条应被截断'), '被截掉的那条不该出现')
})

test('REQ-001 prompt：稳定序 = 四分类枚举序，分类内 updatedAt 倒序', () => {
  const text = librarySectionText([
    makeAsset({ id: 'g', category: 'group', name: '群像A', updatedAt: 5 }),
    makeAsset({ id: 'c1', category: 'character', name: '角色A', updatedAt: 1 }),
    makeAsset({ id: 's', category: 'scene', name: '场景A', updatedAt: 9 }),
    makeAsset({ id: 'c2', category: 'character', name: '角色B', updatedAt: 3 }),
    makeAsset({ id: 'p', category: 'prop', name: '物件A', updatedAt: 7 }),
  ])
  const order = text.split('\n')
    .filter((line) => line.startsWith('- ['))
    .map((line) => line.match(/^- \[([^\]]+)\]/u)[1])
  assert.deepEqual(order, ['角色', '角色', '场景', '物件', '群像'], '分类按枚举序，分类内按 updatedAt 倒序')
  assert.ok(text.indexOf('角色B') < text.indexOf('角色A'), '分类内 updatedAt 倒序')
})

test('REQ-001 prompt：refresh 缓存桥接（读库失败保留旧清单，空库清空缓存）', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cs-libprompt-'))
  try {
    const library = new AssetLibrary(root)

    // ① 非空库 → true 且缓存有正文。
    await mkdir(join(root, 'sources'), { recursive: true })
    await writeFile(join(root, 'sources', 'front.png'), Buffer.from('png'))
    await library.create({
      category: 'character',
      name: '女主',
      media: [{ sourcePath: join(root, 'sources', 'front.png') }],
    })
    assert.equal(await refreshAssetLibraryPromptCache(library), true)
    const cached = cachedAssetLibrarySectionText()
    assert.match(cached, /^## 全局资产库（跨项目）/u)
    assert.match(cached, /id=lib:/u)

    // ② 坏库（读档抛错）→ false，**旧缓存原样保留**（降级为旧清单而非空串/抛错）。
    const broken = { list: async () => { throw new Error('库文档损坏') } }
    assert.equal(await refreshAssetLibraryPromptCache(broken), false)
    assert.equal(cachedAssetLibrarySectionText(), cached, '坏库不得清空已缓存的清单')

    // ③ 空库 → false 且缓存清空。
    const emptyRoot = await mkdtemp(join(tmpdir(), 'cs-libprompt-empty-'))
    try {
      assert.equal(await refreshAssetLibraryPromptCache(new AssetLibrary(emptyRoot)), false)
      assert.equal(cachedAssetLibrarySectionText(), '')
    } finally {
      await rm(emptyRoot, { recursive: true, force: true })
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('REQ-001 prompt：注册小节 + agent/created 预热 + disposer', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cs-libprompt-reg-'))
  try {
    const library = new AssetLibrary(root)
    await mkdir(join(root, 'sources'), { recursive: true })
    await writeFile(join(root, 'sources', 'front.png'), Buffer.from('png'))
    await library.create({
      category: 'scene',
      name: '雨夜巷弄',
      aliases: ['巷子'],
      media: [{ sourcePath: join(root, 'sources', 'front.png') }],
    })
    // 模块级缓存是共享的：注册前先显式预热，避免受前面用例影响。
    assert.equal(await refreshAssetLibraryPromptCache(library), true)

    const sections = []
    const listeners = []
    const disposed = { section: false, listener: false }
    const ctx = {
      systemPrompt: {
        section: (section) => {
          sections.push(section)
          return () => { disposed.section = true }
        },
      },
      on: (event, listener) => {
        listeners.push({ event, listener })
        return () => { disposed.listener = true }
      },
    }

    const dispose = registerAssetLibraryPrompt(ctx, library)
    assert.equal(sections.length, 1, '应注册一个小节')
    assert.equal(sections[0].name, ASSET_LIBRARY_SECTION_NAME)
    assert.equal(sections[0].order, ASSET_LIBRARY_SECTION_ORDER)
    assert.equal(typeof sections[0].text, 'function', 'text 必须是同步函数（上游 PromptSection 不允许 Promise）')
    const text = sections[0].text({})
    assert.equal(typeof text, 'string', 'text() 必须同步返回 string')
    assert.match(text, /## 全局资产库（跨项目）/u)
    assert.match(text, /雨夜巷弄/u)

    assert.equal(listeners.length, 1, '应挂一个 agent/created 预热监听')
    assert.equal(listeners[0].event, 'agent/created')
    assert.equal(typeof listeners[0].listener, 'function')

    dispose()
    assert.equal(disposed.section, true, 'disposer 应注销小节')
    assert.equal(disposed.listener, true, 'disposer 应注销事件监听')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
