/**
 * `list_library_assets` / `add_to_library` 两个工具的行为守卫（P1-2，2026-10-26）。
 *
 * ## 为什么要这两个工具
 *
 * 资产库早就有 `voice`（音色）分类、UI tab、卡片试听，**agent 侧却一个 `library_*`
 * 工具都没有** —— 于是「先造一条中性音色锚，存进库，之后每段 `refaudio` 引用它」
 * 这条最有效的音色一致性流程，在 agent 手里是断的：它列不出音色 id，也存不进音色。
 *
 * 这一份守四件事：
 *  ① `add_to_library` 真的把媒体**拷进库目录**（不是只写一行元数据），音频节点的
 *     `kind` 被识别为 audio（`hasAudio` 才不会骗人）；
 *  ② 返回的 `refHandle` 是 `lib:<id>` 形态 —— 这是 `refaudio` 唯一认的库句柄；
 *  ③ `list_library_assets` 的分类过滤 / 关键词搜索 / limit 截断都如实反映（截断时
 *     `truncated=true`，不然模型以为那就是全部）；
 *  ④ 拒收路径说人话：视频节点不入库、同名冲突、节点不存在，都要指回可行动作。
 *
 * 走真实 `ProjectRegistry` + 真实 `AssetLibrary`（临时目录），不 mock 存储 ——
 * 「拷了没拷」「写没写进索引」正是要验的东西。
 *
 * 运行：corepack yarn workspace canvas-studio run test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AssetLibrary } from '../lib/asset-library.js'
import { createStudioTools } from '../lib/host-tools.js'
import { ProjectRegistry } from '../lib/projects.js'

/** 工具 execute 的最小上下文（与其它工具测试同一形态）。 */
const EXEC = (cwd) => ({ agent: { session: { header: { cwd } } }, signal: AbortSignal.timeout(15000) })

/**
 * 建一个临时工作区：一个项目 + 两个音频节点（各自有真文件）+ 一个视频节点。
 * 音频文件内容是假的（库只做字节拷贝与 SHA-256，不解码），但**必须真实存在**——
 * `collectNodeMediaSources` 会 stat 源文件，缺了就是 CS-LIB-003。
 */
async function makeWorkspace() {
  const dir = await mkdtemp(join(tmpdir(), 'cs-lib-tools-'))
  const registry = new ProjectRegistry(dir)
  const project = await registry.create('库工具测试')
  const assetsDir = registry.assetsDir(project.id)
  await mkdir(assetsDir, { recursive: true })
  const audioUrl = (file) => `/canvas-studio/assets/${project.id}/${file}`
  await writeFile(join(assetsDir, 'vox_a.mp3'), 'AUDIO-A')
  await writeFile(join(assetsDir, 'vox_b.mp3'), 'AUDIO-B')
  // ⚠️ `origin` / `sourceIds` 不能省：`isStudioCanvasNode` 少一个字段就**静默丢弃**该节点
  // ⇒ 后面会以 CS-LIB-003「源画布节点不存在」的形式失败，看起来像取数逻辑的 bug。
  const base = { x: 0, y: 0, width: 220, height: 80, createdAt: 1, origin: 'agent', sourceIds: [] }
  await registry.appendCanvasNode(project.id, { ...base, id: 'aud_1', kind: 'audio', url: audioUrl('vox_a.mp3'), title: '配音 A' })
  await registry.appendCanvasNode(project.id, { ...base, id: 'aud_2', kind: 'audio', url: audioUrl('vox_b.mp3'), title: '配音 B' })
  await registry.appendCanvasNode(project.id, { ...base, id: 'vid_1', kind: 'video', url: audioUrl('clip.mp4'), title: '镜头' })
  const libraryRoot = join(dir, 'lib-root')
  const library = new AssetLibrary(libraryRoot)
  const tools = createStudioTools(registry, 3005, undefined, library)
  const pick = (name) => {
    const tool = tools.find((entry) => entry.name === name)
    assert.ok(tool !== undefined, `${name} 工具应已注册`)
    return tool
  }
  return { dir, registry, project, library, libraryRoot, assetsDir, add: pick('add_to_library'), list: pick('list_library_assets') }
}

test('add_to_library：音频节点存成音色，媒体真拷进库目录，refHandle 是 lib:<id>', async () => {
  const ctx = await makeWorkspace()
  try {
    const result = await ctx.add.execute({
      nodeId: 'aud_1',
      category: 'voice',
      name: '音色锚 · 女主',
      description: '32 岁女性，低沉克制，普通话',
      tags: ['女主', '低沉'],
    }, EXEC(ctx.project.dir))

    assert.equal(result.category, 'voice')
    assert.equal(result.categoryLabel, '音色')
    assert.equal(result.refHandle, `lib:${result.id}`, 'refHandle 必须是 lib:<id>（refaudio 唯一认的库句柄）')
    assert.equal(result.mediaCount, 1, '音频媒体必须拷进库（0 = 只写了元数据）')
    assert.match(result.note, /refaudio: "lib:/u, 'note 要写清以后怎么当 refaudio 用')

    // 磁盘上真有文件（不是只在索引里记一笔）
    const files = await readdir(join(ctx.libraryRoot, 'library', result.id))
    assert.deepEqual(files, ['m_0.mp3'])

    // 索引里也真有这一条，且分类/标签落地
    const stored = await ctx.library.list({ category: 'voice' })
    assert.equal(stored.length, 1)
    assert.equal(stored[0].name, '音色锚 · 女主')
    assert.deepEqual(stored[0].tags, ['女主', '低沉'])
    assert.equal(stored[0].media[0].kind, 'audio', 'kind 必须是 audio，否则 hasAudio 会骗人')
    assert.equal(stored[0].anchors[0].nodeId, 'aud_1', '要留溯源锚点')
  } finally {
    await rm(ctx.dir, { recursive: true, force: true })
  }
})

test('list_library_assets：清单带 lib 句柄与 hasAudio，分类/关键词/limit 都如实生效', async () => {
  const ctx = await makeWorkspace()
  try {
    await ctx.add.execute({ nodeId: 'aud_1', category: 'voice', name: '音色锚 · 女主' }, EXEC(ctx.project.dir))
    await ctx.add.execute({ nodeId: 'aud_2', category: 'voice', name: '音色锚 · 旁白员', tags: ['旁白'] }, EXEC(ctx.project.dir))

    const all = await ctx.list.execute({}, EXEC(ctx.project.dir))
    assert.equal(all.total, 2)
    assert.equal(all.truncated, false)
    assert.equal(all.assets.length, 2)
    assert.ok(all.assets.every((asset) => asset.refHandle.startsWith('lib:')), '每条都要给 lib 句柄')
    assert.ok(all.assets.every((asset) => asset.hasAudio === true), '音色条目必须标记含音频')
    assert.ok(all.assets.every((asset) => asset.categoryLabel === '音色'))

    // 关键词过滤（走 q，覆盖 name/aliases/tags/description）
    const searched = await ctx.list.execute({ q: '旁白' }, EXEC(ctx.project.dir))
    assert.equal(searched.total, 1)
    assert.equal(searched.assets[0].name, '音色锚 · 旁白员')

    // 分类过滤到没有的分类 → 空清单（不能把全部条目当结果回给模型）
    const other = await ctx.list.execute({ category: 'character' }, EXEC(ctx.project.dir))
    assert.deepEqual(other, { total: 0, truncated: false, assets: [] })

    // limit 截断必须显式说明（否则模型以为那就是全部）
    const limited = await ctx.list.execute({ limit: 1 }, EXEC(ctx.project.dir))
    assert.equal(limited.total, 2)
    assert.equal(limited.truncated, true)
    assert.equal(limited.assets.length, 1)
  } finally {
    await rm(ctx.dir, { recursive: true, force: true })
  }
})

test('拒收：视频节点不入库、同名冲突要指路、节点不存在报源侧失败', async () => {
  const ctx = await makeWorkspace()
  try {
    await assert.rejects(
      () => ctx.add.execute({ nodeId: 'vid_1', category: 'scene', name: '某场景' }, EXEC(ctx.project.dir)),
      /视频不支持加入资产库/u,
    )
    await ctx.add.execute({ nodeId: 'aud_1', category: 'voice', name: '重复名' }, EXEC(ctx.project.dir))
    await assert.rejects(
      () => ctx.add.execute({ nodeId: 'aud_2', category: 'voice', name: '重复名' }, EXEC(ctx.project.dir)),
      /已有同名资产/u,
    )
    await assert.rejects(
      () => ctx.add.execute({ nodeId: 'ghost', category: 'voice', name: '不存在的节点' }, EXEC(ctx.project.dir)),
      /源画布节点不存在|加入资产库失败/u,
    )
  } finally {
    await rm(ctx.dir, { recursive: true, force: true })
  }
})
