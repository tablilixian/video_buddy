/**
 * CV-216 `ask_user_choice` 结果解析（`question-result.ts`）+ 客户端降级接线守卫。
 *
 * ## 两个真实缺陷，各自钉一条
 *
 * 1. **层级读错**：真实事件把文本藏在 `message.content[0].content[0].text`
 *    （`tool-result` 包一层），旧实现直接遍历外层找 `type === 'text'` ⇒ 恒匹配不到
 *    ⇒ 所有点选卡片底部恒显示兜底的「已结算」，连用户真正答完后的文案也是坏的。
 * 2. **判据缺位**：画布上的卡片由客户端照 `tool/call` 独立建出，与 Host「到底问没问」
 *    互不知情 ⇒ 放手跑下照样弹出无人可答的卡片（用户实测截图）。
 *
 * 所以本文件守三件事：① 解析层读得对（含畸形输入不炸）；② 放手跑标记能识别、
 * 且**不误判**中段复述；③ 生成侧与消费侧靠**同一个常量**咬合 —— 端到端那条断言
 * 是这里最有价值的一条：任何一侧改措辞都会红。
 *
 * 运行：corepack yarn workspace canvas-studio run test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  SETTLED_NOTE,
  autoAnswerSummary,
  extractResultNote,
} from '../lib/question-result.js'
import {
  AUTO_ANSWER_MARKER,
  autoAnswerFor,
  resolveStudioDefaults,
} from '../lib/studio-defaults.js'

/** 剥块注释与整行注释（本仓统一理由：叮嘱会长在注释里，而注释不该算接线）。 */
function readSource(rel) {
  return readFileSync(new URL(rel, import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
}

/**
 * 2026-09-20 会话转录的真实 `message.content` 快照（原样抄自
 * `session-eca7901d-…/session.jsonl.zstd` seq 1086）。**保留旧快照而不是用
 * `autoAnswerFor` 现场生成**，是为了顺带守住「重放一台旧会话也能正确渲染」。
 */
const REAL_TOOL_RESULT_CONTENT = [{
  type: 'tool-result',
  toolCallId: 'call_580331036fb14e779e58d785',
  content: [{
    type: 'text',
    text: '（放手跑模式）本回合不等待用户作答，「成片想要什么形态？（总时长 30s，两人对白篇幅较长，单镜上限仅 15s）」已直接按默认值取 「多镜头叙事短片（推荐）」。\n'
      + '本次制作的锁定规格：画幅 16:9（项目预置） · 目标时长 30s（项目预置） · 建议 3 镜 · 图片分辨率 736p（设置页） · 视频分辨率 480p（设置页）。\n'
      + '规格与上面这个选项冲突时**以锁定规格为准**。不要再向用户提出任何问题（画幅 / 时长 / 镜头数 / 分辨率都已定，其余要素按剧本原话自行决定），一路跑到产出最终结果；需要用户知道的事写进最终回复。',
  }],
  isError: false,
}]

// ── 一、解析层：读得对 ─────────────────────────────────────────────────────

test('extractResultNote：读得到 tool-result 那一层里的文本（旧实现恒失败的地方）', () => {
  const note = extractResultNote(REAL_TOOL_RESULT_CONTENT)
  assert.ok(note.startsWith(AUTO_ANSWER_MARKER), '必须读到真实文本，而不是兜底文案')
  assert.notEqual(note, SETTLED_NOTE, '这条正是旧实现的病：恒回退「已结算」')
  assert.match(note, /多镜头叙事短片（推荐）/, '答案文本应完整保留')
})

test('extractResultNote：扁平形状（无 tool-result 包装）同样可读', () => {
  const flat = [{ type: 'text', text: '用户的选择：9:16 竖屏' }]
  assert.equal(extractResultNote(flat), '用户的选择：9:16 竖屏')
})

test('extractResultNote：畸形输入一律回退兜底，不抛异常', () => {
  for (const bad of [undefined, null, 'abc', 42, [], [null, 7], [{ type: 'text' }], [{ type: 'text', text: '' }]]) {
    assert.equal(extractResultNote(bad), SETTLED_NOTE, `${String(bad)} 应回退兜底`)
  }
})

test('extractResultNote：自引用结构不会无限递归', () => {
  const selfRef = [{ type: 'tool-result', content: [] }]
  selfRef[0].content.push(selfRef[0])
  assert.equal(extractResultNote(selfRef), SETTLED_NOTE)
})

// ── 二、放手跑标记：认得准 ─────────────────────────────────────────────────

test('autoAnswerSummary：转录快照（旧会话）也能识别为放手跑自动应答', () => {
  const summary = autoAnswerSummary(extractResultNote(REAL_TOOL_RESULT_CONTENT))
  assert.ok(summary !== null, '放手跑自动应答必须被识别')
  assert.match(summary, /未提问/, '窄条文案要说清「本回合没问」')
  assert.match(summary, /多镜头叙事短片/, '要带上取了哪个默认值')
  assert.ok(!summary.includes('（推荐）'), '展示用的括号后缀应剥掉，避免杂讯')
  assert.ok(summary.length < 60, '窄条必须是一行 —— 500 字原文会撑爆对话区')
})

test('autoAnswerSummary：用户真正作答的文本不得被判成自动应答', () => {
  assert.equal(autoAnswerSummary('用户的选择：16:9 横屏'), null)
  assert.equal(autoAnswerSummary(SETTLED_NOTE), null)
  assert.equal(autoAnswerSummary(''), null)
})

test('autoAnswerSummary：模型在中段复述标记不算数（必须是首句前缀）', () => {
  assert.equal(
    autoAnswerSummary('我刚才以为这是（放手跑模式），所以没问你。'),
    null,
    '不是前缀就不能算 —— 否则模型转述一句话就能把真卡片降级掉',
  )
})

// ── 三、生成侧 ↔ 消费侧：同一个常量咬合 ────────────────────────────────────

test('端到端：autoAnswerFor 的输出必须能被 autoAnswerSummary 识别（改措辞即红）', () => {
  const defaults = resolveStudioDefaults({ plan: { aspectRatio: '16:9', targetDuration: 30 } })
  const answer = autoAnswerFor({
    mode: 'auto',
    question: '成片想要什么形态？',
    options: ['多镜头叙事短片（推荐）', '单镜精品短片'],
    defaults,
  })
  assert.ok(answer !== null, 'auto 下必须短路给出答案')
  const summary = autoAnswerSummary(answer)
  assert.ok(summary !== null, '生成侧与消费侧的契约断了：改 autoAnswerFor 措辞后请同步 question-result')
  assert.match(summary, /多镜头叙事短片/)

  // confirm 下不短路 ⇒ 永远是真正的提问卡片，不该被降级。
  const confirmAnswer = autoAnswerFor({
    mode: 'confirm', question: '成片想要什么形态？', options: ['多镜头叙事短片（推荐）'], defaults,
  })
  assert.equal(confirmAnswer, null)
})

test('生成侧：首句必须用 AUTO_ANSWER_MARKER 常量拼，不得硬编码字面量', () => {
  const src = readSource('../src/studio-defaults.ts')
  const body = src.slice(src.indexOf('export function autoAnswerFor'))
  assert.ok(body.includes('AUTO_ANSWER_MARKER'), 'autoAnswerFor 必须用常量拼首句')
  assert.ok(
    !body.includes('（放手跑模式）'),
    '不得在 autoAnswerFor 里硬编码标记字面量 —— 那样常量与真实输出会脱钩，消费侧静默失灵',
  )
})

test('消费侧：客户端必须从 question-result 引入判定，不得自己解析一遍', () => {
  const src = readSource('../src/client/question-capture.tsx')
  assert.match(src, /from '\.\.\/question-result\.js'/, '必须从共享模块引入判定')
  assert.ok(src.includes('autoAnswerSummary'), '必须用 autoAnswerSummary 判定')
  assert.ok(src.includes('extractResultNote'), '必须用 extractResultNote 取文本')
  assert.ok(
    !/data\.answer/.test(src),
    'CV-216 删掉的 answer 死字段不得复活（它只会写 null 从无读取）',
  )
  // 逐条钉住「算 / 翻 / 画」三件事 —— 只查标识符存在太松：把翻牌那行删掉，
  // 标识符仍在，卡片照旧可交互，而那正是这次要修的 bug。
  for (const [needle, why] of [
    ['autoAnswered: false', 'start 必须初始化该字段（否则 state 形状缺键）'],
    ['autoAnswered: true', 'update 读到标记必须真的翻牌 —— 只算不翻 = 卡片照旧弹出'],
    ['data.autoAnswered', '渲染必须照它分叉'],
    ['AutoAnsweredNote', '放手跑下必须走降级窄条渲染，而不是照常渲染选项 chips'],
  ]) {
    assert.ok(src.includes(needle), `缺少 \`${needle}\`：${why}`)
  }
})

// ── 四、skill 层：豁免必须写在强制框架之前 ──────────────────────────────────

test('clarification.md：放手跑短路必须排在「开始策划前用 ask_user_choice」之前', () => {
  const raw = readFileSync(
    new URL('../skills/canvas-studio-creation/references/clarification.md', import.meta.url), 'utf8',
  )
  const shortCircuitAt = raw.indexOf('放手跑（auto）下本文件')
  const hardCommandAt = raw.indexOf('开始策划前用 **ask_user_choice 工具**确认')
  assert.ok(shortCircuitAt >= 0, '必须有放手跑整节作废的显式声明')
  assert.ok(hardCommandAt >= 0, '硬命令仍应在（它是 confirm 模式的主路径）')
  assert.ok(
    shortCircuitAt < hardCommandAt,
    '豁免写在强制框架之后等于没写 —— 实测模型就是照着后面的硬命令提问的',
  )
})
