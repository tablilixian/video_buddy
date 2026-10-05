/**
 * REQ-021 检查点断言库 + 场景定义完整性守卫（node:test 直连 lib 纯函数）。
 *
 * 两条纪律（设计文档 §七 D2）：
 * - 正向：构造一份《山谷晨光》15s 跑完后的**理想持久化快照**，全部检查点绿；
 * - 反向变异：把理想快照逐项掰坏（supersededBy / 产物名前缀 / 尺寸越档 / 队列
 *   未清 / 音色漂移 / 残片成片 / 取代链断裂……），对应检查点**必须红** ——
 *   「断言永远绿」的断言等于没有断言。
 *
 * 运行：corepack yarn workspace canvas-studio run test:smoke
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  AUTO_TEST_CHECKPOINTS,
  autoTestCheckpointById,
  runAutoTestCheckpoints,
} from '../lib/auto-test-checkpoints.js'
import { AUTO_TEST_SCENARIOS, scenarioCheckpointErrors } from '../lib/auto-test-scenarios.js'
import { OUTPUT_SIZE } from '../lib/output-size.js'

const IMAGE_TIER = OUTPUT_SIZE['736p'] // 设置默认图片档位
const VIDEO_TIER = OUTPUT_SIZE['480p'] // 设置默认视频档位

let seq = 0
function node(overrides) {
  seq += 1
  return {
    id: `n-${seq}`,
    kind: 'image',
    url: `/canvas-studio/assets/p-1/asset-${seq}`,
    x: 0, y: 0, width: 260, height: 228,
    createdAt: seq,
    origin: 'agent',
    sourceIds: [],
    ...overrides,
  }
}

/** 一份跑完《山谷晨光》15s 后的理想持久化快照（全部事实对齐剧本约束）。 */
function idealSnapshot() {
  const card1 = node({ kind: 'text', toolName: 'submit_storyboard_for_approval', title: '分镜 1 · 晨雾茶园', text: '镜1：晨雾中的高山茶园' })
  const card2 = node({ kind: 'text', toolName: 'submit_storyboard_for_approval', title: '分镜 2 · 骑车下山', text: '镜2：孙女骑车下山送咖啡' })
  const card3 = node({ kind: 'text', toolName: 'submit_storyboard_for_approval', title: '分镜 3 · 黄昏店内', text: '镜3：黄昏店内收束' })
  const sheetGrandpa = node({ toolName: 'character_sheet', filename: 'krea2_char_4view_00001.png', mediaWidth: 1024, mediaHeight: 1024, title: '爷爷四视图' })
  const sheetGirl = node({ toolName: 'character_sheet', filename: 'krea2_char_4view_00002.png', mediaWidth: 1024, mediaHeight: 1024, title: '孙女四视图' })
  const frame1 = node({ toolName: 'image_generate', sourceIds: [card1.id], filename: 'krea2_00010_.png', mediaWidth: IMAGE_TIER.width, mediaHeight: IMAGE_TIER.height })
  const frame2 = node({ toolName: 'image_generate', sourceIds: [card2.id], filename: 'krea2_00011_.png', mediaWidth: IMAGE_TIER.width, mediaHeight: IMAGE_TIER.height })
  const frame3 = node({ toolName: 'image_generate', sourceIds: [card3.id], filename: 'krea2_00012_.png', mediaWidth: IMAGE_TIER.width, mediaHeight: IMAGE_TIER.height })
  const poster = node({ toolName: 'image_generate', filename: 'Qwen_image_2.1_00020.png', mediaWidth: IMAGE_TIER.height, mediaHeight: IMAGE_TIER.width, title: '竖版海报' })
  // skill 默认工具策略（BUG-016）：镜位视频优先 video_composite 多参考 Ref2VA。
  // generationPrompt.sourceUrls 对齐 R001 真实形态 —— 3 张图 + audioRefs 并入的
  // 1 条 mp3（正向快照同时钉住「按扩展名只数图片」的过滤口径）。
  const mirrorPrompt = (mirror, urls) => JSON.stringify({ prompt: `${mirror}：五段式镜位简报`, filenames: urls.map(url => url.split('/').pop()), sourceUrls: urls })
  const video1 = node({
    kind: 'video', toolName: 'video_composite', title: '镜 1', sourceIds: [frame1.id, card1.id],
    mediaWidth: VIDEO_TIER.width, mediaHeight: VIDEO_TIER.height, duration: 5,
    generationPrompt: mirrorPrompt('镜 1', ['/canvas-studio/assets/p-1/m1-frame.png', '/canvas-studio/assets/p-1/m1-role.png', '/canvas-studio/assets/p-1/m1-style.png', '/canvas-studio/assets/p-1/m1-narration.mp3']),
  })
  const video2 = node({
    kind: 'video', toolName: 'video_composite', title: '镜 2', sourceIds: [frame2.id, card2.id],
    mediaWidth: VIDEO_TIER.width, mediaHeight: VIDEO_TIER.height, duration: 5,
    generationPrompt: mirrorPrompt('镜 2', ['/canvas-studio/assets/p-1/m2-frame.png', '/canvas-studio/assets/p-1/m2-role.png', '/canvas-studio/assets/p-1/m2-style.png', '/canvas-studio/assets/p-1/m2-narration.mp3']),
  })
  const video3 = node({
    kind: 'video', toolName: 'video_composite', title: '镜 3', sourceIds: [frame3.id, card3.id],
    mediaWidth: VIDEO_TIER.width, mediaHeight: VIDEO_TIER.height, duration: 5,
    generationPrompt: mirrorPrompt('镜 3', ['/canvas-studio/assets/p-1/m3-frame.png', '/canvas-studio/assets/p-1/m3-role.png', '/canvas-studio/assets/p-1/m3-style.png', '/canvas-studio/assets/p-1/m3-narration.mp3']),
  })
  const voice1 = node({ kind: 'audio', toolName: 'tts_voiceover', lyrics: '晨雾漫过茶园。', generationPrompt: JSON.stringify({ txt_prompt: '晨雾漫过茶园。', refaudio: 'ref-voice-01.png' }) })
  const voice2 = node({ kind: 'audio', toolName: 'tts_voiceover', lyrics: '咖啡香滑下山道。', generationPrompt: JSON.stringify({ txt_prompt: '咖啡香滑下山道。', refaudio: 'ref-voice-01.png' }) })
  const voice3 = node({ kind: 'audio', toolName: 'tts_voiceover', lyrics: '黄昏，两代人守着这家店。', generationPrompt: JSON.stringify({ txt_prompt: '黄昏，两代人守着这家店。', refaudio: 'ref-voice-01.png' }) })
  const film = node({ kind: 'video', toolName: 'compose', sourceIds: [video1.id, video2.id, video3.id], mediaWidth: VIDEO_TIER.width, mediaHeight: VIDEO_TIER.height, duration: 15 })
  const nodes = [card1, card2, card3, sheetGrandpa, sheetGirl, frame1, frame2, frame3, poster, video1, video2, video3, voice1, voice2, voice3, film]
  return {
    project: {
      id: 'p-1',
      name: '效果验证-R001-山谷晨光',
      createdAt: '2026-10-05T10:00:00.000Z',
      updatedAt: '2026-10-05T10:20:00.000Z',
      dir: '/root/projects/效果验证-R001-山谷晨光',
    },
    nodes,
    history: [
      { file: 'a.png', kind: 'image', tool: 'character_sheet', label: '爷爷四视图', createdAt: 1 },
      { file: 'b.png', kind: 'image', tool: 'character_sheet', label: '孙女四视图', createdAt: 2 },
      { file: 'c.png', kind: 'image', tool: 'image_generate', label: '关键帧1', createdAt: 3 },
      { file: 'd.png', kind: 'image', tool: 'image_generate', label: '关键帧2', createdAt: 4 },
      { file: 'e.png', kind: 'image', tool: 'image_generate', label: '关键帧3', createdAt: 5 },
      { file: 'f.png', kind: 'image', tool: 'image_generate', label: '海报', createdAt: 6 },
      { file: 'g.mp4', kind: 'video', tool: 'video_composite', label: '镜1', createdAt: 7 },
      { file: 'h.mp4', kind: 'video', tool: 'video_composite', label: '镜2', createdAt: 8 },
      { file: 'i.mp4', kind: 'video', tool: 'video_composite', label: '镜3', createdAt: 9 },
      { file: 'j.mp4', kind: 'video', tool: 'compose', label: '成片', createdAt: 10 },
      { file: 'k.mp3', kind: 'audio', tool: 'tts_voiceover', label: '旁白', createdAt: 11 },
    ],
    queue: { active: null, waiting: [], resumedJobs: 0 },
    expectedImageResolution: '736p',
    expectedVideoResolution: '480p',
  }
}

const TURN0_IDS = AUTO_TEST_SCENARIOS[0].checkpointGroups.find(group => group.turn === 0).checkpointIds
const TURN1_IDS = AUTO_TEST_SCENARIOS[0].checkpointGroups.find(group => group.turn === 1).checkpointIds

function runOn(snap, turnIndex = 0, ids = TURN0_IDS) {
  const results = runAutoTestCheckpoints(ids, snap, turnIndex)
  return new Map(results.map(entry => [entry.id, entry]))
}

function assertPass(map, id) {
  const entry = map.get(id)
  assert.ok(entry !== undefined, `检查点 ${id} 应被执行`)
  assert.equal(entry.pass, true, `${id} 应绿 —— 证据：${entry.evidence}`)
}

function assertFail(map, id, hint) {
  const entry = map.get(id)
  assert.ok(entry !== undefined, `检查点 ${id} 应被执行`)
  assert.equal(entry.pass, false, `${id} 应红（${hint}）—— 证据：${entry.evidence}`)
}

test('正向：理想快照下全部 turn-0 检查点为绿', () => {
  const map = runOn(idealSnapshot())
  for (const id of TURN0_IDS) assertPass(map, id)
})

test('反向变异：一条视频被 supersededBy → videos-active 必须红（BUG-011 回归断言的反面）', () => {
  const snap = idealSnapshot()
  const victim = snap.nodes.find(entry => entry.toolName === 'video_composite')
  snap.nodes = snap.nodes.map(entry => (entry.id === victim.id ? { ...entry, supersededBy: 'n-new' } : entry))
  assertFail(runOn(snap), 'videos-active', '存在 supersededBy 非空的镜位视频')
})

test('反向变异：分镜卡只有 2 张 → storyboard-cards 红；关键帧漏挂 → keyframes-linked 红', () => {
  const snapA = idealSnapshot()
  snapA.nodes = snapA.nodes.filter(entry => entry.toolName !== 'submit_storyboard_for_approval' || entry.title !== '分镜 3 · 黄昏店内')
  assertFail(runOn(snapA), 'storyboard-cards', '分镜卡 2 张')

  const snapB = idealSnapshot()
  const frame1 = snapB.nodes.find(entry => entry.sourceIds.some(id => id.startsWith('n-')) && entry.filename === 'krea2_00010_.png')
  snapB.nodes = snapB.nodes.map(entry => (entry.id === frame1.id ? { ...entry, sourceIds: [] } : entry))
  assertFail(runOn(snapB), 'keyframes-linked', '分镜1 有关键帧但未挂卡')
})

test('BUG-015：小写 qwen 产物名命中 poster-route-qwen（以后端实际产物名为准，R001 实证）', () => {
  const snap = idealSnapshot()
  // R001 海报终稿（image_fix 产物）的真实形态：小写 q 前缀。/i 语义下大写输入
  //（历史记忆形态）同样必须命中 —— 上面的理想快照本身就用大写 'Qwen_image_2.1_'。
  snap.nodes = snap.nodes.map(entry => (entry.filename === 'Qwen_image_2.1_00020.png'
    ? { ...entry, filename: 'qwen_image_2.1_00060.png' }
    : entry))
  const map = runOn(snap)
  assertPass(map, 'poster-route-qwen')
  assertPass(map, 'concept-route-krea2')
})

test('反向变异：海报改走 Krea2 → poster-route-qwen 红；产物名缺 krea2 → concept-route-krea2 红', () => {
  const snapA = idealSnapshot()
  snapA.nodes = snapA.nodes.map(entry => (entry.filename === 'Qwen_image_2.1_00020.png' ? { ...entry, filename: 'krea2_00099_.png' } : entry))
  const mapA = runOn(snapA)
  assertFail(mapA, 'poster-route-qwen', '没有 Qwen 产物名')
  assertPass(mapA, 'concept-route-krea2') // 顶替的 krea2 产物名不能误伤概念图断言

  const snapB = idealSnapshot()
  // 概念图断言的反面：画布上**所有** krea2_<序号> 产物名都消失（改名成 qwen 系）。
  snapB.nodes = snapB.nodes.map(entry => (entry.filename !== undefined && /^krea2_\d+/.test(entry.filename)
    ? { ...entry, filename: 'Qwen_image_2.1_00090.png' }
    : entry))
  assertFail(runOn(snapB), 'concept-route-krea2', 'krea2 概念图缺失')
})

test('反向变异（BUG-016）：镜位只剩 2 条 → videos-active 红', () => {
  const snap = idealSnapshot()
  snap.nodes = snap.nodes.filter(entry => !(entry.toolName === 'video_composite' && entry.title === '镜 1'))
  assertFail(runOn(snap), 'videos-active', 'composite 镜位只剩 2 条')
})

test('反向变异（BUG-016 加严）：composite 图片参考 <3 → videos-active 红（mp3 不算图片）', () => {
  const snap = idealSnapshot()
  // 摘掉镜 1 的一张图：sourceUrls 总条数仍是 3（2 图 + 1 mp3），必须按扩展名
  // 数出 2 —— 直接数长度会把音频当参考图而漏红。
  const clip1 = snap.nodes.find(entry => entry.toolName === 'video_composite' && entry.title === '镜 1')
  snap.nodes = snap.nodes.map(entry => (entry.id === clip1.id
    ? { ...entry, generationPrompt: JSON.stringify({
        prompt: '镜 1：五段式镜位简报',
        filenames: ['m1-frame.png', 'm1-role.png'],
        sourceUrls: ['/canvas-studio/assets/p-1/m1-frame.png', '/canvas-studio/assets/p-1/m1-role.png', '/canvas-studio/assets/p-1/m1-narration.mp3'],
      }) }
    : entry))
  assertFail(runOn(snap), 'videos-active', '镜 1 图片参考只有 2/3（mp3 不计入）')
})

test('反向变异：视频尺寸越档（写死 1280×720 旧账）→ resolution-tier 红；四视图不参与断言', () => {
  const snapA = idealSnapshot()
  // 理想快照的镜位视频已是 video_composite（BUG-016 后不在档位断言范围——其尺寸
  // 语义待 R002 实证），视频档位由 compose 成片承担。
  const film = snapA.nodes.find(entry => entry.toolName === 'compose')
  snapA.nodes = snapA.nodes.map(entry => (entry.id === film.id ? { ...entry, mediaWidth: 1280, mediaHeight: 720 } : entry))
  assertFail(runOn(snapA), 'resolution-tier', '成片 1280×720 不在 480p 档')

  // 四视图（1024×1024，尺寸跟随端点）与上传素材不进断言范围 —— 不得误红。
  const mapB = runOn(idealSnapshot())
  assertPass(mapB, 'resolution-tier')
})

test('反向变异：队列有等待任务 / 恢复任务 → queue-settled 红', () => {
  const snapA = idealSnapshot()
  snapA.queue = { active: null, waiting: [{ id: 'g1', label: '视频生成', position: 1 }], resumedJobs: 0 }
  assertFail(runOn(snapA), 'queue-settled', '队列未清')

  const snapB = idealSnapshot()
  snapB.queue = { active: null, waiting: [], resumedJobs: 2 }
  assertFail(runOn(snapB), 'queue-settled', '恢复任务未结算')
})

test('反向变异：产物登记缺音频 → history-volume 红', () => {
  const snap = idealSnapshot()
  snap.history = snap.history.filter(entry => entry.kind !== 'audio')
  assertFail(runOn(snap), 'history-volume', 'audio 0/1')
})

test('反向变异：旁白 refaudio 各段不同 → voiceover-consistent 红；instruct_prompt 漂移同样红', () => {
  const snapA = idealSnapshot()
  snapA.nodes = snapA.nodes.map(entry => (entry.toolName === 'tts_voiceover' && entry.lyrics === '咖啡香滑下山道。'
    ? { ...entry, generationPrompt: JSON.stringify({ txt_prompt: entry.lyrics, refaudio: 'ref-voice-02.png' }) }
    : entry))
  assertFail(runOn(snapA), 'voiceover-consistent', '出现两种 refaudio')

  const snapB = idealSnapshot()
  snapB.nodes = snapB.nodes.map((entry, index) => (entry.toolName === 'tts_voiceover'
    ? { ...entry, generationPrompt: JSON.stringify({ txt_prompt: entry.lyrics, instruct_prompt: `音色设计 #${index}` }) }
    : entry))
  assertFail(runOn(snapB), 'voiceover-consistent', 'instruct_prompt 每段各写各的')
})

test('反向变异：成片只剩 1 段来源 → compose-final 红（单镜残片）', () => {
  const snap = idealSnapshot()
  snap.nodes = snap.nodes.map(entry => (entry.toolName === 'compose' ? { ...entry, sourceIds: [entry.sourceIds[0]] } : entry))
  assertFail(runOn(snap), 'compose-final', '来源 1 段 < 3')
})

test('反向变异：项目名不合规 → project-created 红', () => {
  const snap = idealSnapshot()
  snap.project = { ...snap.project, name: '我的咖啡店' }
  assertFail(runOn(snap), 'project-created', '不匹配 效果验证-R# 前缀')
})

test('回合门控：supersede-chain 在第 0 轮不参与，第 1 轮才跑', () => {
  const snap = idealSnapshot()
  const turn0 = runAutoTestCheckpoints(TURN1_IDS, snap, 0)
  assert.ok(!turn0.some(entry => entry.id === 'supersede-chain'), '第 0 轮不应执行取代链断言')
  const map = runOn(snap, 1, TURN1_IDS)
  assertFail(map, 'supersede-chain', '理想快照里没有追加指令产生的取代对')
})

test('第 1 轮正向：追加指令后的取代串链快照全绿（含 supersede-chain）', () => {
  const snap = idealSnapshot()
  // 追加指令（改孙女形象）→ agent 重出四视图（显式 replaces）→ 旧四视图被取代，
  // 下游 generationPrompt 里的旧句柄被改写为新句柄（批F 改写链）。
  const oldSheet = snap.nodes.find(entry => entry.filename === 'krea2_char_4view_00002.png')
  const newSheet = node({ toolName: 'character_sheet', filename: 'krea2_char_4view_00003.png', mediaWidth: 1024, mediaHeight: 1024, title: '孙女四视图 v2', supersedes: [oldSheet.id] })
  // 改写链只换句柄（filenames），composite 镜的 sourceUrls 等其余参数原样保留
  // （整段覆盖会让 videos-active 的图片参考子项假红）。
  const rewriteHandle = (entry) => ({
    ...entry,
    generationPrompt: JSON.stringify({ ...JSON.parse(entry.generationPrompt), filenames: ['krea2_char_4view_00003.png'] }),
  })
  snap.nodes = [
    ...snap.nodes.map(entry => (entry.id === oldSheet.id
      ? { ...entry, supersededBy: newSheet.id }
      : (entry.toolName === 'video_composite' ? rewriteHandle(entry) : entry))),
    newSheet,
  ]
  const map = runOn(snap, 1, TURN1_IDS)
  for (const id of TURN1_IDS) assertPass(map, id)
})

test('反向变异（第 1 轮）：旧句柄仍留在下游 generationPrompt → supersede-chain 红', () => {
  const snap = idealSnapshot()
  const oldSheet = snap.nodes.find(entry => entry.filename === 'krea2_char_4view_00002.png')
  const newSheet = node({ toolName: 'character_sheet', filename: 'krea2_char_4view_00003.png', mediaWidth: 1024, mediaHeight: 1024, title: '孙女四视图 v2' })
  snap.nodes = [
    ...snap.nodes.map(entry => (entry.id === oldSheet.id
      ? { ...entry, supersededBy: newSheet.id }
      // 改写链没跑：镜 2 的下游视频仍引用旧句柄（sourceUrls 等其余参数保留 ——
      // 只有 supersede-chain 该红，videos-active 不得陪绑）。
      : (entry.toolName === 'video_composite' && entry.title === '镜 2'
        ? { ...entry, generationPrompt: JSON.stringify({ ...JSON.parse(entry.generationPrompt), filenames: ['krea2_char_4view_00002.png'] }) }
        : entry))),
    newSheet,
  ]
  assertFail(runOn(snap, 1, TURN1_IDS), 'supersede-chain', '旧句柄残留')
})

test('断言函数抛错折算为 fail（断言库 bug 不炸执行器）', () => {
  const broken = { ...idealSnapshot(), nodes: null }
  const map = runAutoTestCheckpoints(['videos-active'], broken, 0)
  assert.equal(map.length, 1)
  assert.equal(map[0].pass, false)
  assert.match(map[0].evidence, /抛错|cannot|无法|不是/u)
})

test('场景完整性守卫：真实场景零错误；引用未注册 id / 漏配回合都要报错', () => {
  for (const scenario of AUTO_TEST_SCENARIOS) {
    assert.deepEqual(scenarioCheckpointErrors(scenario, AUTO_TEST_CHECKPOINTS), [], '真实场景必须自洽')
  }
  const bogus = { ...AUTO_TEST_SCENARIOS[0], id: 'bogus', checkpointGroups: [{ turn: 0, checkpointIds: ['no-such-checkpoint'] }] }
  const errors = scenarioCheckpointErrors(bogus, AUTO_TEST_CHECKPOINTS)
  assert.ok(errors.some(line => line.includes('no-such-checkpoint')), '未注册 id 必须被抓到')
  const missingTurn = { ...AUTO_TEST_SCENARIOS[0], id: 'missing-turn', checkpointGroups: [] }
  assert.ok(scenarioCheckpointErrors(missingTurn, AUTO_TEST_CHECKPOINTS).length > 0, '空分组必须被抓到')
})

test('注册表契约：id 唯一、appliesFromTurn 非负、按 id 可查', () => {
  const ids = AUTO_TEST_CHECKPOINTS.map(entry => entry.id)
  assert.equal(new Set(ids).size, ids.length, '检查点 id 不允许重复')
  for (const entry of AUTO_TEST_CHECKPOINTS) {
    assert.ok(entry.appliesFromTurn >= 0)
    assert.equal(autoTestCheckpointById(entry.id), entry)
  }
  // 设计文档 §4.5 的 12 条一期检查点必须全数在册。
  assert.equal(AUTO_TEST_CHECKPOINTS.length, 12)
})
