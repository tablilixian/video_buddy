/** REQ-034 · B2：`textCard` 轨 → 四态文本卡（subtitle / dataCard / title / bullets）。 */
import type React from 'react'
import { AbsoluteFill, useCurrentFrame } from 'remotion'
import type { TextCardTrack } from '../manifest.js'
import { fadeOpacity } from '../timing.js'
import { useFontFamilyStack } from './font-context.js'

/** `text` 归一化为行数组（subtitle / title / bullets 都按行渲染）。 */
function linesOf(text: string | string[]): string[] {
  return Array.isArray(text) ? text : [text]
}

export const TextCard: React.FC<{ track: TextCardTrack }> = ({ track }) => {
  const frame = useCurrentFrame()
  // R1：字体族来自 `StudioComposition` 的 context（缺省＝随包中文字体），不再硬编码 sans-serif。
  const fontFamily = useFontFamilyStack()
  const duration = Math.max(1, track.durationInFrames)
  const opacity = fadeOpacity(frame, duration)
  const accent = track.accentColor ?? '#4f9cf9'
  const lines = linesOf(track.text)

  if (track.variant === 'subtitle') {
    return (
      <AbsoluteFill style={{ opacity, justifyContent: 'flex-end', alignItems: 'center', padding: 72 }}>
        <div
          style={{
            maxWidth: '86%',
            padding: '18px 32px',
            borderRadius: 14,
            background: 'rgba(0,0,0,0.62)',
            color: '#f4f7fb',
            fontFamily,
            fontSize: 44,
            lineHeight: 1.35,
            textAlign: 'center',
            whiteSpace: 'pre-line',
          }}
        >
          {lines.join('\n')}
        </div>
      </AbsoluteFill>
    )
  }

  if (track.variant === 'title') {
    return (
      <AbsoluteFill style={{ opacity, justifyContent: 'center', alignItems: 'center', background: 'rgba(0,0,0,0.35)' }}>
        <div
          style={{
            fontFamily,
            fontSize: 84,
            fontWeight: 700,
            color: '#e6edf3',
            textAlign: 'center',
            lineHeight: 1.15,
            whiteSpace: 'pre-line',
          }}
        >
          {lines.join('\n')}
        </div>
      </AbsoluteFill>
    )
  }

  if (track.variant === 'dataCard') {
    return (
      <AbsoluteFill style={{ opacity, justifyContent: 'center', alignItems: 'center' }}>
        <div
          style={{
            width: 940,
            padding: '52px 60px',
            borderRadius: 26,
            background: 'linear-gradient(160deg, #161f38, #111726)',
            border: `1px solid ${accent}`,
            fontFamily,
          }}
        >
          <div style={{ fontSize: 40, fontWeight: 700, color: '#e6edf3' }}>{lines.join(' ')}</div>
          <div style={{ height: 2, background: accent, margin: '26px 0 10px' }} />
          {(track.data ?? []).map((row) => (
            <div
              key={`${row.k}-${row.v}`}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'baseline',
                padding: '18px 4px',
                borderBottom: '1px solid rgba(255,255,255,0.08)',
              }}
            >
              <span style={{ fontSize: 34, color: '#9aa7b4' }}>{row.k}</span>
              <span style={{ fontSize: 42, fontWeight: 700, color: accent }}>{row.v}</span>
            </div>
          ))}
        </div>
      </AbsoluteFill>
    )
  }

  return (
    <AbsoluteFill style={{ opacity, justifyContent: 'center', alignItems: 'center' }}>
      <div style={{ fontFamily, width: 900 }}>
        {lines.map((line, index) => (
          <div key={`${index}-${line}`} style={{ display: 'flex', alignItems: 'center', margin: '18px 0' }}>
            <div style={{ width: 18, height: 18, borderRadius: 9, background: accent, marginRight: 24 }} />
            <div style={{ fontSize: 48, color: '#e6edf3' }}>{line}</div>
          </div>
        ))}
      </div>
    </AbsoluteFill>
  )
}
