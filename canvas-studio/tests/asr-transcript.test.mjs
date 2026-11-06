/**
 * CV-448：`asr2txt` 行串 → `transcriptPath` 转写 JSON 的形状适配守卫。
 *
 * 为什么单独立测：后端回的是三个**行式字符串**（`(起, 止) 文本` 每行一条），
 * 而唯一消费方 `evidence-grid.ts` 的 `parseTranscript` 要
 * `{segments:[{start,end,text,words:[{t,start,end}]}]}` 且 **words 不允许缺项**。
 * 归组错一个词、丢一个边界词，都会让下游整份拒收（或台词词标签错格）——
 * 这类错靠人眼看样例发现不了，必须钉死：
 *
 *   1. 行解析（容错：整数秒 / 多空格 / 非时间行 / 倒置时间）；
 *   2. **边界词归属**（段边界 == 词起点时必须归下一段，不能整段错位）；
 *   3. 无词句段被丢弃并计数（留着必被 parseTranscript 拒收）；
 *   4. `txt_segment` 缺失时按标点 / 静音自造句段（不丢时间戳）；
 *   5. `txt_word` 缺失时 `doc = null`（调用方只回文本、不落盘）；
 *   6. 落盘产物必须能被 `parseTranscript` 原样吃下（跨模块同源校验）。
 *
 * 从 ../lib/*.js 导入 —— 先 build 再跑。
 * 定向：node --test tests/asr-transcript.test.mjs（全量走 test:smoke）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  asrTranscriptJson, buildAsrTranscript, parseAsrTimedLines, writeAsrTranscript,
} from '../lib/asr-transcript.js'
import { parseTranscript } from '../lib/evidence-grid.js'

/** 后端文档 §asr2txt 的响应样例（逐字）。 */
const TXT_WORD = '(0.0, 0.4) 今天\n(0.4, 0.8) 天气\n(0.8, 1.08) 真\n(1.08, 1.32) 好'
  + '\n(1.32, 1.62) 我们\n(1.62, 1.9) 出去\n(1.9, 2.16) 走走\n(2.16, 2.4) 吧'
const TXT_SEGMENT = '(0.0, 1.32) 今天天气真好\n(1.32, 2.4) 我们出去走走吧'

test('行解析：`(起, 止) 文本` 容忍整数秒与空白，非时间行 / 倒置时间 / 空文本跳过', () => {
  const lines = parseAsrTimedLines(
    '(0.0, 1.32) 今天天气真好\n(2, 3) second\n   (4.5,4.5)   padded   \n'
    + 'VAD 阈值: 0.5\n(9, 1) 倒置\n(1, 2) \n',
  )
  assert.deepEqual(lines, [
    { start: 0, end: 1.32, text: '今天天气真好' },
    { start: 2, end: 3, text: 'second' },
    { start: 4.5, end: 4.5, text: 'padded' },
  ])
})

test('归组：文档样例两段各 4 词，边界词（起点 == 下段起点）必须归下一段', () => {
  const { doc, stats } = buildAsrTranscript(TXT_WORD, TXT_SEGMENT)
  assert.ok(doc, '应产出转写文档')
  assert.deepEqual(stats, { words: 8, segments: 2, dropped: 0 })
  assert.deepEqual(doc.segments.map((s) => s.text), ['今天天气真好', '我们出去走走吧'])
  assert.deepEqual(doc.segments.map((s) => s.words.map((w) => w.t)), [
    ['今天', '天气', '真', '好'],
    ['我们', '出去', '走走', '吧'],
  ])
  // 段区间必须覆盖自己的词（evidence-grid 的「时刻 → 激活词」按区间命中）
  for (const seg of doc.segments) {
    assert.ok(seg.start <= seg.words[0].start && seg.end >= seg.words[seg.words.length - 1].end)
  }
})

test('跨模块同源：落盘形状被 evidence-grid 的 parseTranscript 原样吃下', () => {
  const { doc } = buildAsrTranscript(TXT_WORD, TXT_SEGMENT)
  const parsed = parseTranscript(asrTranscriptJson(doc))
  assert.equal(parsed.segments.length, 2)
  assert.deepEqual(
    parsed.segments.map((s) => ({ text: s.text, words: s.words.map((w) => w.t) })),
    doc.segments.map((s) => ({ text: s.text, words: s.words.map((w) => w.t) })),
  )
  assert.deepEqual(parsed.segments.map((s) => [s.start, s.end]), [[0, 1.32], [1.32, 2.4]])
})

test('归不到词的句段被丢弃并计数（留着必被 parseTranscript 拒收）', () => {
  const { doc, stats } = buildAsrTranscript(TXT_WORD, `${TXT_SEGMENT}\n(5.0, 6.0) （这段没人说话）`)
  assert.ok(doc)
  assert.equal(stats.segments, 2, '无词句段不进文档')
  assert.equal(stats.dropped, 1, '丢弃数要在回执里可见')
})

test('txt_segment 缺失 → 按句读 / 静音间隙自造句段（时间戳不丢）', () => {
  const { doc, stats } = buildAsrTranscript(
    '(0.0, 0.4) Hello\n(0.4, 0.9) world\n(0.9, 1.4) 你好。\n(3.0, 3.4) 下一句\n(4.6, 5.0) 后面',
    '',
  )
  assert.ok(doc, '没有句段行也必须能出文档')
  assert.equal(stats.segments, 3, '句号切一段 + >1s 静音再切一段 + 末尾收口')
  assert.equal(doc.segments[0].text, 'Hello world你好。', '拉丁词拼接补空格，中文紧邻')
  assert.deepEqual(doc.segments.map((s) => s.words.length), [3, 1, 1])
  assert.deepEqual(doc.segments.map((s) => [s.start, s.end]), [[0, 1.4], [3, 3.4], [4.6, 5]])
})

test('txt_word 缺失 → doc = null（调用方只回文本、不落盘）', () => {
  const { doc, stats } = buildAsrTranscript('', TXT_SEGMENT)
  assert.equal(doc, null)
  assert.deepEqual(stats, { words: 0, segments: 0, dropped: 0 })
  // 有句段行但没词同样不落盘 —— 空 words 必被下游拒收
  assert.equal(buildAsrTranscript('   \n', TXT_SEGMENT).doc, null)
})

test('落盘 E2E：写进 transcripts/ 后可被 parseTranscript 读回，且文件名不撞', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cs-asr-'))
  try {
    const { doc } = buildAsrTranscript(TXT_WORD, TXT_SEGMENT)
    const first = await writeAsrTranscript(doc, { root })
    const second = await writeAsrTranscript(doc, { root })
    assert.notEqual(first, second, '同内容两次落盘不得互相覆盖')
    assert.match(first, /transcripts[/\\]asr-.*\.json$/u)
    const parsed = parseTranscript(readFileSync(first, 'utf8'))
    assert.equal(parsed.segments.length, 2)
    assert.equal(parsed.segments[0].words.length, 4)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
