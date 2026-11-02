/**
 * C2 证据网格测试（REQ-036，CV-398）—— 纯函数双向变异 + 真 ffmpeg E2E。
 *
 * E2E 用 lavfi 合成「红3s+蓝3s+绿3s」样本：切点机器可判（3.0 / 6.0s），断言页数、
 * 格数、cutPoints 与 verify_teardown 同源函数一致、产物落证据目录。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildGridFilterChain,
  generateEvidenceGrid,
  labelOfWord,
  passCellTimes,
  paginateCellTimes,
  parseShowinfoTimes,
  parseTranscript,
  plannedCellTimes,
  sanitizeDrawtextLabel,
  wordAt,
} from '../lib/evidence-grid.js'
import { bundledGridFontFile } from '../lib/evidence-grid.js'
import {
  colorDistances,
  extractFrameColors,
  findSwitchPoints,
  TEARDOWN_SAMPLE_FPS,
} from '../lib/teardown-verify.js'

function cleanupDir(dir) {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    /* 受管 shell 可能拦测试临时目录清理 —— 断言已完，清理尽力而为 */
  }
}

function resolveSystemFfmpeg() {
  for (const dir of (process.env.PATH ?? '').split(':')) {
    if (dir === '') continue
    const candidate = join(dir, 'ffmpeg')
    if (existsSync(candidate)) return candidate
  }
  return null
}

// ───────────────── 纯函数：采样计划展开 ─────────────────

test('C2：passCellTimes 下标乘法展开（含 interval 边界与片尾截断）', () => {
  // 0–2s interval 0.5 → 0, 0.5, 1, 1.5, 2（end 含）
  assert.deepEqual(passCellTimes({ start: 0, end: 2, interval: 0.5 }, 9), [0, 0.5, 1, 1.5, 2])
  // 片尾截断：end 超片长按片长截
  assert.deepEqual(passCellTimes({ start: 8, end: 99, interval: 1 }, 9), [8, 9])
  // 浮点累积不漂移：0.1×10 仍到 1.0
  assert.deepEqual(passCellTimes({ start: 0, end: 1, interval: 0.1 }, 9).at(-1), 1)
})

test('C2：passCellTimes 非法段显式报错（反向变异）', () => {
  assert.throws(() => passCellTimes({ start: 2, end: 1, interval: 1 }, 9), /非法/)
  assert.throws(() => passCellTimes({ start: 0, end: 2, interval: 0 }, 9), /非法/)
  assert.throws(() => passCellTimes({ start: 0, end: 2, interval: 0.001 }, 9), /上限/)
})

test('C2：plannedCellTimes 跨段去重升序', () => {
  const planned = plannedCellTimes([
    { start: 0, end: 2, interval: 1 },
    { start: 1, end: 3, interval: 0.5 },
  ], 9)
  assert.deepEqual(planned, [0, 1, 1.5, 2, 2.5, 3])
  assert.throws(() => plannedCellTimes([], 9), /不能为空/)
})

// ───────────────── 纯函数：分页 ─────────────────

test('C2：paginateCellTimes 14 格 4×3 → 2 页（12+2），行列坐标与页时间范围', () => {
  const times = Array.from({ length: 14 }, (_, i) => i)
  const { cells, pages } = paginateCellTimes(times, 4, 3)
  assert.equal(pages.length, 2)
  assert.equal(pages[0].cellCount, 12)
  assert.equal(pages[1].cellCount, 2)
  assert.deepEqual([pages[0].fromSec, pages[0].toSec], [0, 11])
  assert.deepEqual([pages[1].fromSec, pages[1].toSec], [12, 13])
  const last = cells[13]
  assert.equal(last.page, 1)
  assert.equal(last.row, 0)
  assert.equal(last.col, 1)
  const cell6 = cells[6]
  assert.deepEqual([cell6.page, cell6.row, cell6.col], [0, 1, 2])
})

// ───────────────── 纯函数：转写解析与词标签 ─────────────────

const TRANSCRIPT_JSON = JSON.stringify({
  duration: 9,
  language: 'zh',
  segments: [
    {
      id: 0,
      start: 0.0,
      end: 3.2,
      text: '家人们谁懂啊这个价格真的离谱',
      words: [
        { t: '家', start: 0.0, end: 0.2 },
        { t: '们', start: 0.2, end: 0.4 },
        { t: '谁', start: 0.4, end: 0.6 },
        { t: '懂', start: 0.6, end: 0.8 },
        { t: '啊', start: 0.8, end: 1.0 },
        { t: '这', start: 1.0, end: 1.2 },
        { t: '个', start: 1.2, end: 1.4 },
        { t: '价', start: 1.4, end: 1.6 },
        { t: '格', start: 1.6, end: 1.8 },
        { t: '真', start: 1.8, end: 2.0 },
        { t: '的', start: 2.0, end: 2.2 },
        { t: '离', start: 2.2, end: 2.4 },
        { t: '谱', start: 2.4, end: 2.6 },
      ],
    },
  ],
})

test('C2：parseTranscript 形状校验（缺 segments / 缺 words / 非 JSON 显式报错）', () => {
  const transcript = parseTranscript(TRANSCRIPT_JSON)
  assert.equal(transcript.segments.length, 1)
  assert.equal(transcript.segments[0].words.length, 13)
  assert.throws(() => parseTranscript('not-json'), /JSON/)
  assert.throws(() => parseTranscript('{"segments":[]}'), /segments/)
  assert.throws(() => parseTranscript('{"segments":[{"start":0,"end":1,"text":"x"}]}'), /words/)
  assert.throws(() => parseTranscript('{"segments":[{"words":[{"t":"a","start":0}]}]}'), /t\/start\/end/)
})

test('C2：wordAt 首个词窗口命中 + 前 8 字上下文；间隙返回 null', () => {
  const transcript = parseTranscript(TRANSCRIPT_JSON)
  const hit = wordAt(transcript, 1.5)
  assert.equal(hit.word, '价')
  assert.equal(hit.prefix, '家们谁懂啊这个') // 词在 index 7，前面只有 7 个 token（≤8 取满）
  assert.deepEqual(hit.window, { start: 1.4, end: 1.6 })
  assert.equal(labelOfWord(hit), '家们谁懂啊这个【价】')
  assert.equal(wordAt(transcript, 2.7), null) // 词尾之后、段尾之前的间隙
  assert.equal(wordAt(transcript, 5), null)
})

test('C2：sanitizeDrawtextLabel 清洗 filtergraph 元字符（防两层转义打架）', () => {
  assert.equal(sanitizeDrawtextLabel("a'b:c,d%[e](f)"), 'a’b：c，d％『e』（f）')
  assert.equal(sanitizeDrawtextLabel('back\\slash\nnew'), 'backslash new')
  assert.equal(sanitizeDrawtextLabel('纯中文标签'), '纯中文标签')
})

// ───────────────── 纯函数：滤镜链与 showinfo ─────────────────

test('C2：buildGridFilterChain argv 形态（select/showinfo/drawtext/drawbox/tile 顺序）', () => {
  const chain = buildGridFilterChain({
    interval: 1, start: 0, end: 9, cellPx: 480, columns: 4, rows: 3,
    stripPx: 92, fontFile: '/fonts/x.ttf',
    labels: [{ text: '前文【词】', from: 1.4, to: 1.6 }],
    cutMarks: [3, 6],
  })
  // ⚠️ 不能按 ',' split 断言顺序 —— select/enable 引号内含逗号。用 indexOf 顺序断言。
  const at = (needle) => chain.indexOf(needle)
  assert.ok(at("select='(isnan(prev_selected_t)+gte(t,prev_selected_t+1))*between(t,0,9)'") === 0, 'select 表达式保实测 PTS')
  assert.ok(chain.includes('showinfo'), 'showinfo 回读实测时刻')
  assert.ok(at('showinfo') < at('scale=480:-2') && at('scale=480:-2') < at('pad=iw:ih+92:0:0:black'), 'scale → pad 顺序')
  assert.ok(chain.includes("text='%{pts\\:hms}'"), '实测 PTS 时间戳')
  assert.ok(chain.includes(":enable='gte(t,1.4)*lt(t,1.6)'"), '词标签半开窗口')
  assert.ok(chain.includes('drawbox=x=0:y=0:w=iw:h=ih:color=red:thickness=8'), '切点描边（字号 30 → 粗 8）')
  assert.ok(chain.includes('tile=4x3:margin=4:padding=4:color=black'), '网格拼图')
  assert.ok(at('drawbox') < at('tile='), '描边在拼图前')
})

test('C2：parseShowinfoTimes 从 stderr 抽实测帧 PTS', () => {
  const stderr = [
    '[Parsed_showinfo_1 @ 0x...] n:   0 pts:      0 pts_time:0',
    '[Parsed_showinfo_1 @ 0x...] n:   1 pts: 24576 pts_time:1.033',
    'frame=   12 fps=0.0 q=-1.0 size=...',
  ].join('\n')
  assert.deepEqual(parseShowinfoTimes(stderr), [0, 1.033])
  assert.deepEqual(parseShowinfoTimes('no showinfo here'), [])
})

// ───────────────── E2E（真 ffmpeg）─────────────────

test('C2 E2E：红蓝绿 3×3s 样本 → 2 页网格 + cutPoints 与 teardown 同源一致（真 ffmpeg）', async () => {
  const ffmpeg = resolveSystemFfmpeg()
  if (ffmpeg === null) {
    console.log('  skip：PATH 上无系统 ffmpeg')
    return
  }
  const dir = mkdtempSync(join(tmpdir(), 'evidence-grid-'))
  const root = mkdtempSync(join(tmpdir(), 'evidence-root-'))
  try {
    const videoPath = join(dir, 'three-color.mp4')
    execFileSync(ffmpeg, [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'color=c=red:size=128x96:rate=10:duration=3',
      '-f', 'lavfi', '-i', 'color=c=blue:size=128x96:rate=10:duration=3',
      '-f', 'lavfi', '-i', 'color=c=green:size=128x96:rate=10:duration=3',
      '-filter_complex', '[0:v][1:v][2:v]concat=n=3:v=1,format=yuv420p',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-y', videoPath,
    ], { timeout: 60_000 })

    const result = await generateEvidenceGrid({
      videoPath,
      passes: [{ start: 0, end: 9, interval: 0.5 }], // 19 格 → 2 页（18+1）
      root,
      ffmpegPath: ffmpeg,
    })
    // 10fps 源最后一帧 pts=8.9 —— 9.0 tick 无实测帧，如实 18 格（「实测帧 PTS」口径）。
    assert.equal(result.cellCount, 18)
    assert.equal(result.pages.length, 2)
    assert.equal(result.files.length, 2)
    assert.ok(result.files[0].includes('evidence-grid-01-0.0-5.5s.jpg'), `页文件带页码与时间范围（首页 12 格 0–5.5s），实得 ${result.files[0]}`)
    assert.ok(result.files[1].includes('evidence-grid-02-6.0-8.5s.jpg'), `末页带残页时间范围，实得 ${result.files[1]}`)
    for (const file of result.files) {
      assert.ok(existsSync(join(result.dir, file)), `页图应落盘：${file}`)
    }
    // 结构化清单：每格实测时刻 + 页/行/列
    const manifest = JSON.parse(readFileSync(join(result.dir, result.manifestFile), 'utf8'))
    assert.equal(manifest.cells.length, 18)
    assert.equal(manifest.cells[0].timestampSec, 0)
    assert.equal(manifest.cells[10].page, 0)
    assert.equal(manifest.cells[17].page, 1)
    assert.ok(manifest.cells.every((c) => c.timestampSec < 9), '格时刻全部来自实测帧 PTS')
    assert.equal(manifest.key, result.key)
    // cutPoints 与 teardown-verify 同源一致（同一检测函数）
    const expected = findSwitchPoints(
      colorDistances(await extractFrameColors(videoPath, TEARDOWN_SAMPLE_FPS, ffmpeg)),
      TEARDOWN_SAMPLE_FPS,
    ).map((s) => Math.round(s.timeSec * 100) / 100)
    assert.deepEqual(result.cutPoints, expected)
    assert.ok(result.cutPoints.length >= 2, `红→蓝→绿应有 ≥2 处切换，实得 ${JSON.stringify(result.cutPoints)}`)
    assert.ok(result.cutPoints.some((c) => Math.abs(c - 3) <= 0.5), `切换应 ≈3.0s，实得 ${JSON.stringify(result.cutPoints)}`)
    assert.ok(result.cutPoints.some((c) => Math.abs(c - 6) <= 0.5), `切换应 ≈6.0s，实得 ${JSON.stringify(result.cutPoints)}`)
  } finally {
    cleanupDir(dir)
    cleanupDir(root)
  }
})

test('C2 E2E：转写词标签进结构化清单 + markCuts=false 出纯时间戳网格（真 ffmpeg）', async () => {
  const ffmpeg = resolveSystemFfmpeg()
  if (ffmpeg === null) {
    console.log('  skip：PATH 上无系统 ffmpeg')
    return
  }
  const dir = mkdtempSync(join(tmpdir(), 'evidence-grid-'))
  const root = mkdtempSync(join(tmpdir(), 'evidence-root-'))
  try {
    const videoPath = join(dir, 'three-color.mp4')
    execFileSync(ffmpeg, [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'color=c=red:size=128x96:rate=10:duration=3',
      '-f', 'lavfi', '-i', 'color=c=blue:size=128x96:rate=10:duration=3',
      '-filter_complex', '[0:v][1:v]concat=n=2:v=1,format=yuv420p',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-y', videoPath,
    ], { timeout: 60_000 })
    const transcriptPath = join(dir, 'transcript.json')
    writeFileSync(transcriptPath, TRANSCRIPT_JSON)

    const withTranscript = await generateEvidenceGrid({
      videoPath,
      passes: [{ start: 0, end: 3, interval: 0.5 }],
      transcriptPath,
      root,
      ffmpegPath: ffmpeg,
    })
    const manifest = JSON.parse(readFileSync(join(withTranscript.dir, withTranscript.manifestFile), 'utf8'))
    const labeled = manifest.cells.filter((c) => typeof c.label === 'string')
    assert.ok(labeled.length >= 5, `0–2.6s 内的格应带词标签，实得 ${JSON.stringify(manifest.cells)}`)
    assert.ok(labeled[0].label.includes('【'), `标签应为「前文【词】」形态，实得 ${labeled[0].label}`)

    const noCuts = await generateEvidenceGrid({
      videoPath,
      passes: [{ start: 0, end: 3, interval: 1 }],
      markCuts: false,
      root,
      ffmpegPath: ffmpeg,
    })
    assert.deepEqual(noCuts.cutPoints, [], 'markCuts=false 不做切点扫描')
  } finally {
    cleanupDir(dir)
    cleanupDir(root)
  }
})

test('C2：字体缺失 / 视频不存在显式报错', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'evidence-grid-'))
  const root = mkdtempSync(join(tmpdir(), 'evidence-root-'))
  try {
    const videoPath = join(dir, 'missing.mp4')
    await assert.rejects(
      generateEvidenceGrid({ videoPath, root }),
      /不存在/,
    )
    writeFileSync(videoPath, Buffer.alloc(16))
    await assert.rejects(
      generateEvidenceGrid({ videoPath, root, fontFile: join(dir, 'no-such-font.ttf') }),
      /字体缺失/,
    )
  } finally {
    cleanupDir(dir)
    cleanupDir(root)
  }
})

test('C2：随包 drawtext 字体在位（assets/fonts/noto-sans-sc-regular.ttf）', () => {
  assert.ok(existsSync(bundledGridFontFile()), `drawtext 字体必须随包：${bundledGridFontFile()}`)
})
