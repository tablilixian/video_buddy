/**
 * #05 词级字幕（karaoke）—— 逐字高亮推进 + measureText 自动换行 + 安全区避让（TTS 真配音）。
 *
 * 对标官方：`captions-tester`。
 *
 * 词级时间戳从哪来（诚实口径）：TTS 后端只回整句 mp3，没有词级时间戳。本片用
 * **离线能量谷对齐**：PCM 10ms 帧 RMS → 语音区起止 + 字间谷值 → 谷值为主边界、
 * 最长无谷段内插一个边界，凑出逐字窗口（见 DECISIONS D13）。精度 ±1–3 帧，
 * 不是真 API 级词级戳——这正是产品缺的能力（§5.2 #5 判 B 的原因）。
 *
 * 要证明的三件事：
 *   1. 高亮推进与音频对齐（±2 帧级）：高亮窗口 = 上面的实测时间戳，纯帧函数；
 *   2. 自动换行是真测出来的：canvas `measureText`（字体就绪后）按最大宽贪心折行，
 *      不写死断点；
 *   3. 底部对齐时间轴：把逐字窗口画成色块 + 播放头，不听音频也能核"哪个字何时亮"。
 */

import React from 'react'
import { AbsoluteFill, useCurrentFrame } from 'remotion'
import { Audio } from '@remotion/media'
import { Badge, BenchFrame, COLORS, FONT_FAMILY, POOL } from './shared.js'

export const meta = {
  id: '05',
  axis: 'caption-word',
  title: '词级字幕（karaoke + 自动换行）',
  reference: 'captions-tester',
  durationInFrames: 300, // 10s @30fps；TTS 3.84s，之后字幕全亮收尾
  expect: { videoCodec: 'h264', audioCodec: 'aac', hasAudio: true, minMotion: true },
  stills: [20, 75, 149],
  assets: ['tts'],
} as const

/** 逐字窗口（帧）：离线能量谷对齐的实测值（_assets/cap05-tts.pcm，见文件头说明）。 */
const CHARS: Array<{ c: string; s: number; e: number }> = [
  { c: '凌', s: 14.7, e: 22.8 },
  { c: '晨', s: 22.8, e: 30.0 },
  { c: '三', s: 30.0, e: 34.5 },
  { c: '点', s: 34.5, e: 44.4 },
  { c: '，', s: 44.4, e: 60.0 },
  { c: '门', s: 60.0, e: 63.6 },
  { c: '外', s: 63.6, e: 71.1 },
  { c: '的', s: 71.1, e: 74.25 },
  { c: '脚', s: 74.25, e: 76.8 },
  { c: '步', s: 76.8, e: 82.5 },
  { c: '声', s: 82.5, e: 88.8 },
  { c: '忽', s: 88.8, e: 93.0 },
  { c: '然', s: 93.0, e: 99.3 },
  { c: '停', s: 99.3, e: 105.6 },
  { c: '了', s: 105.6, e: 108.0 },
  { c: '。', s: 108.0, e: 114.0 },
]

const MAX_LINE_WIDTH = 1280 // 自动换行的最大文本宽（安全区内）

/**
 * measureText 贪心折行（模块级缓存）。同步测量是安全的：entry.tsx 先 await
 * document.fonts.ready 才开始渲帧，字体一定就绪；不用 useEffect+setState ——
 * 帧捕获不会等异步 state（#06 靠 delayRender 挡，这里直接同步算更稳）。
 */
let CACHED_LINES: string[][] | null = null
function wrappedLines(): string[][] {
  if (CACHED_LINES) return CACHED_LINES
  const ctx = document.createElement('canvas').getContext('2d')
  if (!ctx) return []
  ctx.font = `700 120px ${FONT_FAMILY}`
  const rows: string[][] = [[]]
  let width = 0
  for (const { c } of CHARS) {
    const w = ctx.measureText(c).width
    if (width + w > MAX_LINE_WIDTH && rows[rows.length - 1].length > 0) {
      rows.push([])
      width = 0
    }
    rows[rows.length - 1].push(c)
    width += w
  }
  CACHED_LINES = rows
  return rows
}

const charState = (frame: number, i: number): 'done' | 'active' | 'todo' => {
  const { s, e } = CHARS[i]
  if (frame >= e) return 'done'
  if (frame >= s) return 'active'
  return 'todo'
}

export const Composition: React.FC = () => {
  const frame = useCurrentFrame()
  const lines = wrappedLines()

  // 底部对齐时间轴：全句 0–120f 映射到宽度，逐字色块 + 播放头
  const tlX = (f: number) => (f / 120) * 1560

  let charIndex = -1
  return (
    <BenchFrame title="05 · 词级字幕 —— 逐字 karaoke 高亮（TTS 真配音 3.84s）" footer={`frame ${frame} / 299`}>
      {/* 逐字字幕（measureText 自动折行，最多两行 + 安全区内） */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 330,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 26,
        }}
      >
        {lines.map((row, rowIdx) => (
          <div key={rowIdx} style={{ display: 'flex' }}>
            {row.map((c) => {
              charIndex += 1
              const i = charIndex
              const st = charState(frame, i)
              const active = st === 'active'
              const { s, e } = CHARS[i]
              const prog = active ? (frame - s) / Math.max(1, e - s) : 0
              return (
                <div
                  key={`${rowIdx}-${i}`}
                  style={{
                    fontFamily: FONT_FAMILY,
                    fontSize: 120,
                    fontWeight: 700,
                    lineHeight: 1.15,
                    color: st === 'done' ? '#ffffff' : st === 'active' ? COLORS.accent : 'rgba(232,238,252,0.28)',
                    textShadow: active ? `0 ${6 + prog * 10}px ${24 + prog * 26}px rgba(90,210,255,${0.45 + prog * 0.3})` : 'none',
                    transform: active ? `scale(${1 + 0.06 * Math.sin(prog * Math.PI)})` : 'scale(1)',
                    margin: '0 4px',
                  }}
                >
                  {c}
                </div>
              )
            })}
          </div>
        ))}
      </div>

      {/* 对齐时间轴：每字一格（当前字高亮），播放头竖线 */}
      <div style={{ position: 'absolute', left: 180, top: 880, width: 1560 }}>
        <div style={{ display: 'flex', gap: 3, height: 46 }}>
          {CHARS.map(({ c, s, e }, i) => {
            const st = charState(frame, i)
            return (
              <div
                key={i}
                style={{
                  flex: Math.max(0.5, e - s),
                  height: '100%',
                  borderRadius: 6,
                  background: st === 'active' ? COLORS.accent : st === 'done' ? 'rgba(90,210,255,0.42)' : 'rgba(255,255,255,0.10)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontFamily: FONT_FAMILY,
                  fontSize: 24,
                  color: st === 'todo' ? 'rgba(232,238,252,0.4)' : '#04101f',
                  fontWeight: 700,
                }}
              >
                {c}
              </div>
            )
          })}
        </div>
        <div style={{ position: 'relative', height: 30 }}>
          {frame <= 120 ? (
            <div style={{ position: 'absolute', left: tlX(frame), top: 0, width: 4, height: 30, background: COLORS.warn, borderRadius: 2 }} />
          ) : null}
          <div style={{ position: 'absolute', left: 0, top: 6, fontFamily: FONT_FAMILY, fontSize: 21, color: COLORS.dim }}>
            0s
          </div>
          <div style={{ position: 'absolute', left: tlX(60), top: 6, fontFamily: FONT_FAMILY, fontSize: 21, color: COLORS.dim }}>
            2s
          </div>
          <div style={{ position: 'absolute', right: 0, top: 6, fontFamily: FONT_FAMILY, fontSize: 21, color: COLORS.dim }}>
            4s（谷值对齐 ±1–3 帧）
          </div>
        </div>
      </div>

      <div style={{ position: 'absolute', left: 96, top: 150 }}>
        <Badge title="KARAOKE" sub="逐字高亮 · measureText 折行 · 能量谷对齐" />
      </div>

      <div style={{ position: 'absolute', left: 96, right: 96, bottom: 62, height: 8, background: 'rgba(255,255,255,0.14)', borderRadius: 4 }}>
        <div style={{ width: `${(frame / 299) * 100}%`, height: '100%', background: COLORS.accent, borderRadius: 4 }} />
      </div>

      <Audio src={POOL.tts} />
    </BenchFrame>
  )
}
