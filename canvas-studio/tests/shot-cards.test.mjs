/**
 * CV-050：分镜卡**按镜号对齐**（打回重提不再堆积同名卡）。
 *
 * 症状（用户实测）：打回后 AI 重新提交分镜，`buildShotCards` 无脑追加整套新卡、
 * 旧卡原地不动 → 打回两次画布上三套同名分镜卡；更坏的是下游关键帧的
 * `shotRefs` 按标题匹配会命中**第一张（旧的）**卡，产物连到早已作废的卡上。
 *
 * 覆盖三层：
 * 1. `shotCardNumberOf` 解析（镜号的唯一读取口径）；
 * 2. `mergeShotCards` 纯函数语义（复用 id/位置、只换文案、旧卡保留、新卡避让）；
 * 3. 端到端：真的调两次 `submit_storyboard_for_approval`，看画布卡数不膨胀。
 *
 * 直连 Host 侧编译产物 lib/host-tools.js。运行：
 *   corepack yarn workspace canvas-studio test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStudioTools, mergeShotCards, parseStoryboardShots, shotCardNumberOf, STORYBOARD_PARSE_HINT } from '../lib/host-tools.js'

/** 造一张已落盘的分镜卡（模拟上一轮提交的产物）。 */
function card(id, no, x, y, text = `【镜 ${no}】`) {
  return {
    id,
    kind: 'text',
    title: `分镜 ${no} · 特写`,
    text,
    x,
    y,
    width: 360,
    height: 220,
    createdAt: 1000 + no,
    toolName: 'submit_storyboard_for_approval',
    origin: 'agent',
    sourceIds: [],
    operationType: 'storyboard',
  }
}

/** 分镜表一行：镜号 / 景别 / 镜头运动 / 时长 / 画面 / 声音。 */
function row(no, duration = '5s', visual = '画面') {
  return [String(no), '特写', '推', duration, visual, '环境音']
}

// ---------------------------------------------------------------------------
// 1. 镜号解析
// ---------------------------------------------------------------------------

test('shotCardNumberOf：只认「分镜 N」前缀，问号/空值一律 undefined', () => {
  assert.equal(shotCardNumberOf('分镜 3 · 特写'), 3)
  assert.equal(shotCardNumberOf('分镜 10'), 10)
  assert.equal(shotCardNumberOf('分镜10'), 10)
  assert.equal(shotCardNumberOf('  分镜 2 · 远景  '), 2)
  assert.equal(shotCardNumberOf('分镜 ?'), undefined, '解析不出镜号时不许猜 0')
  assert.equal(shotCardNumberOf('分镜'), undefined)
  assert.equal(shotCardNumberOf('随手记的东西'), undefined)
  assert.equal(shotCardNumberOf(undefined), undefined)
})

// ---------------------------------------------------------------------------
// 2. mergeShotCards 纯函数
// ---------------------------------------------------------------------------

test('首次提交：全部新建，按 3 列批内网格落点，声明时长落卡', () => {
  const merge = mergeShotCards([], [], [row(1), row(2), row(3), row(4, '6s')], (() => {
    let n = 0
    return () => `new-${n += 1}`
  })())

  assert.equal(merge.created.length, 4)
  assert.equal(merge.updated.length, 0)
  assert.equal(merge.cards.length, 4)
  assert.equal(merge.next.length, 4, '写盘数组 = 既有 + 新卡')
  // 批内网格：3 列 × 400 步距，第 4 张换行（360 宽 + 40 间隙 / 220 高 + 40）
  assert.deepEqual(
    merge.created.map((node) => [node.x, node.y]),
    [[40, 40], [440, 40], [840, 40], [40, 300]],
  )
  assert.equal(merge.created[0].declaredDuration, 5)
  assert.equal(merge.created[0].declaredFrames, 5 * 24)
  assert.equal(merge.created[3].declaredDuration, 6)
  assert.equal(merge.created[0].title, '分镜 1 · 特写')
})

test('重提：同镜号复用 id 与位置只换文案；新镜号新建；消失的旧镜号保留不动', () => {
  const brief = { id: 'brief', kind: 'text', title: '创意', x: 0, y: 0, width: 360, height: 280, createdAt: 1, toolName: 'write_brief', origin: 'agent', sourceIds: [] }
  const existing = [brief, card('c1', 1, 420, 0), card('c2', 2, 820, 0), card('c9', 9, 40, 300)]
  const mint = (() => { let n = 0; return () => `new-${n += 1}` })()

  // 镜 2 的文案改了；镜 9 从新表里消失；多出镜 3。
  const merge = mergeShotCards(existing, ['brief'], [row(1), row(2, '5s', '改了画面'), row(3)], mint)

  assert.equal(merge.updated.length, 2, '镜 1 / 镜 2 应复用')
  assert.deepEqual(merge.updated.map((node) => node.id), ['c1', 'c2'])
  assert.equal(merge.created.length, 1, '只有镜 3 是新卡')
  assert.equal(merge.created[0].title, '分镜 3 · 特写')

  const byId = new Map(merge.next.map((node) => [node.id, node]))
  // 复用 = id 与位置**逐字节不动**
  assert.equal(byId.get('c1').x, 420)
  assert.equal(byId.get('c1').y, 0)
  assert.equal(byId.get('c2').x, 820)
  assert.equal(byId.get('c2').y, 0)
  assert.match(byId.get('c2').text, /改了画面/u, '只换文案')
  assert.equal(byId.get('c9').x, 40, '旧镜号卡原地保留（不静默删，避免下游断链）')
  assert.equal(byId.get('c9').y, 300)
  // 新卡不许追加在末尾以外制造重复 id
  assert.equal(merge.next.length, existing.length + 1)
  assert.equal(new Set(merge.next.map((node) => node.id)).size, merge.next.length)
  // 血缘随本轮 sourceIds 走（新卡）
  assert.deepEqual(merge.created[0].sourceIds, ['brief'])
})

test('重提：新表该行没写时长时，旧卡上的声明时长必须被清掉（不是留旧值）', () => {
  const old = { ...card('c1', 1, 40, 40), declaredDuration: 8, declaredFrames: 192 }
  const merge = mergeShotCards([old], [], [row(1, '—')], () => 'x')

  assert.equal(merge.updated.length, 1)
  assert.equal(merge.updated[0].declaredDuration, undefined, '旧值不会自己消失')
  assert.equal(merge.updated[0].declaredFrames, undefined)
  assert.equal(merge.updated[0].id, 'c1')
})

test('重提：同一镜号在一张表里出现两次，只复用一次，第二行新建', () => {
  const merge = mergeShotCards([card('c1', 1, 40, 40)], [], [row(1), row(1)], () => 'dup')
  assert.equal(merge.updated.length, 1)
  assert.equal(merge.created.length, 1, '一张旧卡不能同时代表两行')
  assert.equal(merge.created[0].id, 'dup')
})

test('新卡落点避开被占的格子（不压在已有节点上）', () => {
  const brief = { id: 'brief', kind: 'text', title: '创意', x: 0, y: 0, width: 360, height: 280, createdAt: 1, toolName: 'write_brief', origin: 'agent', sourceIds: [] }
  // 让基础落点确定在创意右侧 (420, 0)，再把一个无关节点**精确摆在 index 1 的格位**
  // (820, 0) —— 旧实现「按 index 直接落格」会把新卡直接压在它身上。
  const blocker = { id: 'b', kind: 'sticky', title: '便签', x: 820, y: 0, width: 360, height: 220, createdAt: 1, origin: 'user', sourceIds: [] }
  const merge = mergeShotCards([brief, blocker], ['brief'], [row(1), row(2)], () => 'fresh')

  assert.equal(merge.created.length, 2)
  assert.deepEqual([merge.created[0].x, merge.created[0].y], [420, 0])
  assert.deepEqual([merge.created[1].x, merge.created[1].y], [1220, 0], '应跳过被占的 (820, 0)')

  const overlaps = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
  for (const node of merge.created) {
    assert.equal(overlaps(node, blocker), false, '新卡不许压在既有节点上')
  }
  assert.equal(overlaps(merge.created[0], merge.created[1]), false, '同批新卡之间也不许重叠')
})

test('非分镜卡的同名标题不会被误认（只认 toolName = submit_storyboard_for_approval）', () => {
  const impostor = { ...card('x1', 1, 40, 40), toolName: 'write_script' }
  const merge = mergeShotCards([impostor], [], [row(1)], () => 'fresh')
  assert.equal(merge.updated.length, 0)
  assert.equal(merge.created.length, 1, '标题像分镜卡也不算数')
})

// ---------------------------------------------------------------------------
// 3. 端到端：连提两次
// ---------------------------------------------------------------------------

function stubHealthFetch() {
  globalThis.fetch = async (url) => {
    if (String(url).includes('/api/v1/health')) {
      return { ok: true, status: 200, json: async () => ({ status: 'ok' }), text: async () => '' }
    }
    return { ok: false, status: 404, text: async () => '' }
  }
}

function makeRegistry(assetsDir) {
  const project = { id: 'p1', name: 'P1', dir: assetsDir, createdAt: '1', updatedAt: '1', workflow: { mode: 'confirm', state: 'drafting' } }
  const store = { nodes: [] }
  return {
    list: async () => [project],
    getProject: async () => project,
    updateWorkflow: async (id, patch) => { project.workflow = { ...project.workflow, ...patch }; return project },
    readCanvas: async () => ({ version: 3, nodes: store.nodes }),
    writeCanvas: async (id, nodes) => { store.nodes = [...nodes] },
    appendCanvasNode: async (id, node) => { store.nodes.push(node) },
    assetsDir: () => assetsDir,
    _store: store,
  }
}

const cfg = {
  dramaApiBase: () => 'http://localhost:9999',
  maxVideoSeconds: () => 15,
  resolveDramaApiKey: async () => 'fake',
  resolveFalApiKey: async () => '',
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

const EXEC = (cwd) => ({
  agent: { session: { header: { cwd } } },
  signal: new AbortController().signal,
  concludeTurn: () => {},
})

function storyboardMd(rows) {
  return [
    '| 镜号 | 景别 | 镜头运动 | 时长 | 画面描述 | 声音 |',
    '| --- | --- | --- | --- | --- | --- |',
    ...rows.map((cells) => `| ${cells.join(' | ')} |`),
  ].join('\n')
}

function shotCardsOf(nodes) {
  return nodes.filter((node) => node.toolName === 'submit_storyboard_for_approval')
}

test('端到端：打回两次重提分镜，画布上仍然是「每镜一张」而不是三套同名卡', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-shotcards-'))
  try {
    const reg = makeRegistry(dir)
    stubHealthFetch()
    const tools = createStudioTools(reg, 0, cfg)
    const submit = tools.find((tool) => tool.name === 'submit_storyboard_for_approval')

    await submit.execute({ storyboard: storyboardMd([row(1), row(2)]), summary: '第 1 版' }, EXEC(dir))
    const first = shotCardsOf(reg._store.nodes)
    assert.equal(first.length, 2)
    const positions = new Map(first.map((node) => [node.title, [node.id, node.x, node.y]]))

    // 第 2 次提交（= 被打回后的修改版）：镜 1/2 保留 + 多出镜 3
    await submit.execute({ storyboard: storyboardMd([row(1), row(2, '5s', '第二版画面'), row(3)]), summary: '第 2 版' }, EXEC(dir))
    let cards = shotCardsOf(reg._store.nodes)
    assert.equal(cards.length, 3, '重提不许膨胀出第二套同名卡')
    assert.equal(new Set(cards.map((node) => node.title)).size, 3)

    // 第 3 次提交（再打回一次）：仍是 3 张，且镜 1/2 的 id 与位置从未变过
    await submit.execute({ storyboard: storyboardMd([row(1), row(2, '5s', '第三版画面'), row(3)]), summary: '第 3 版' }, EXEC(dir))
    cards = shotCardsOf(reg._store.nodes)
    assert.equal(cards.length, 3, '再打回一次还是 3 张（旧实现会到 6 张）')

    for (const node of cards) {
      const before = positions.get(node.title)
      if (before === undefined) continue
      assert.equal(node.id, before[0], `${node.title} 的 id 应复用`)
      assert.equal(node.x, before[1], `${node.title} 的 x 应原地不动`)
      assert.equal(node.y, before[2], `${node.title} 的 y 应原地不动`)
    }
    assert.match(cards.find((node) => node.title.startsWith('分镜 2'))?.text ?? '', /第三版画面/u)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// 4. BUG-008：解析失败防堆卡 + 工具描述纪律
// ---------------------------------------------------------------------------

test('BUG-008：画布已有分镜卡时重提解析不出表格 → 报错引导重试，不再追加整表卡', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-shotcards-'))
  try {
    const reg = makeRegistry(dir)
    stubHealthFetch()
    const tools = createStudioTools(reg, 0, cfg)
    const submit = tools.find((tool) => tool.name === 'submit_storyboard_for_approval')

    await submit.execute({ storyboard: storyboardMd([row(1), row(2)]), summary: 'v1' }, EXEC(dir))
    const before = [...reg._store.nodes]
    const stateBefore = (await reg.getProject()).workflow.state
    assert.equal(shotCardsOf(before).length, 2)

    let concluded = false
    const exec = { ...EXEC(dir), concludeTurn: () => { concluded = true } }
    await assert.rejects(
      submit.execute({ storyboard: '把第二镜改成少女抬头微笑，其余镜头保持不变。' }, exec),
      (err) => {
        assert.equal(err.code, 'CS-USER-ERR')
        assert.match(err.message, /不再追加整表节点/u)
        assert.match(err.message, new RegExp(STORYBOARD_PARSE_HINT.slice(0, 12)), '报错正文携带 6 列格式引导')
        return true
      },
    )
    assert.deepEqual(reg._store.nodes, before, '画布一张卡都不许多')
    assert.equal((await reg.getProject()).workflow.state, stateBefore, '抛错不许改 workflow 状态')
    assert.equal(concluded, false, '抛错不许结束回合（模型要同回合重试）')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('BUG-008 回归：空画布首次提交解析失败，仍走整表单节点回退（不抛错）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cs-shotcards-'))
  try {
    const reg = makeRegistry(dir)
    stubHealthFetch()
    const tools = createStudioTools(reg, 0, cfg)
    const submit = tools.find((tool) => tool.name === 'submit_storyboard_for_approval')

    const result = await submit.execute({ storyboard: '分镜就一个镜头：少女看信。', summary: '单表' }, EXEC(dir))
    assert.match(result.text, /整表单节点/u)
    assert.match(result.text, /6 列/u, '降级提示也带格式引导')
    const nodes = reg._store.nodes
    assert.equal(nodes.length, 1)
    assert.equal(nodes[0].toolName, 'submit_storyboard_for_approval')
    assert.equal(shotCardNumberOf(nodes[0].title), undefined, '整表回退节点没有镜号')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('BUG-008：工具描述声明「修改分镜 = 重提完整表」纪律（源码级断言）', () => {
  const dir = '/tmp/cs-shotcards-desc-unused'
  const tools = createStudioTools(makeRegistry(dir), 0, cfg)
  const submit = tools.find((tool) => tool.name === 'submit_storyboard_for_approval')
  assert.match(submit.description, /重新提交完整分镜表/u)
  assert.match(submit.description, /原地更新/u)
  assert.match(submit.description, /不会更新画布上的分镜卡/u, '点名反模式：只改对话或剧本节点无效')
})

// ---------------------------------------------------------------------------
// A-8（2026-10-03）：镜号整格校验 —— 策略笔记行整表拒绝（指名道姓），
// 范围镜号「1/2/3/6」不再被 /​\d+/ 子串匹配读成镜 1 覆写真分镜卡。
// ---------------------------------------------------------------------------
test('A-8：parseStoryboardShots 对非法镜号整表拒绝（含可行动出路）', () => {
  const good = '| 镜号 | 景别 | 镜头运动 | 时长 | 画面描述 | 声音 |\n| --- | --- | --- | --- | --- | --- |\n| 1 | 远景 | 推进 | 5s | 村庄 | 鸟鸣 |'
  const strategyRow = '| 镜：生成路径·参考组合 | — | — | — | 视频生成策略 | — |'
  assert.throws(
    () => parseStoryboardShots(`${good}\n${strategyRow}`),
    (error) => {
      assert.match(error.message, /镜：生成路径·参考组合/)
      assert.match(error.message, /不是合法镜号/)
      assert.match(error.message, /写在表格外正文/)
      assert.match(error.message, /完整分镜表/)
      return true
    },
    '策略笔记行必须整表拒绝并指名道姓',
  )
})

test('A-8：范围镜号「1/2/3/6」被拒（不再读成镜 1 覆写真卡）', () => {
  const good = '| 镜号 | 景别 | 镜头运动 | 时长 | 画面描述 | 声音 |\n| --- | --- | --- | --- | --- | --- |\n| 1 | 远景 | 推进 | 5s | 村庄 | 鸟鸣 |'
  const rangeRow = '| 1/2/3/6 | 关键帧 i2v | — | — | video_generate 单首帧 | — |'
  assert.throws(
    () => parseStoryboardShots(`${good}\n${rangeRow}`),
    /1\/2\/3\/6/,
    '范围写法不得通过解析（否则 mergeShotCards 会按镜 1 原地覆写真分镜）',
  )
})

test('A-8：合法镜号变体全部放行（1 / 01 / 第1镜 / 1.）', () => {
  const row = (no) => `| 镜号 | 景别 | 镜头运动 | 时长 | 画面描述 | 声音 |\n| --- | --- | --- | --- | --- | --- |\n| ${no} | 远景 | 推进 | 5s | 村庄 | 鸟鸣 |`
  for (const no of ['1', '01', '第1镜', '1.', ' 1 ']) {
    assert.equal(parseStoryboardShots(row(no)).length, 1, `「${no}」应放行`)
  }
})
