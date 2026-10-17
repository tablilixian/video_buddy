/** REQ-034 · B2 + 二期 A2/A5：`textCard` 轨 → 四态文本卡（subtitle / dataCard / title / bullets）。 */
import type React from 'react'
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion'
import { resolveAnimatedStyle } from '../animated-style.js'
import type { TextCardTrack } from '../manifest.js'
import { fitTextPolicy } from '../timing.js'
import { useFontFamilyStack } from './font-context.js'

/** `text` 归一化为行数组（subtitle / title / bullets 都按行渲染）。 */
function linesOf(text: string | string[]): string[] {
  return Array.isArray(text) ? text : [text]
}

/**
 * 二期 A5：**只在需要缩字号/重排时才改变文本形态**。
 *
 * 兼容性铁律：老 manifest 的文字排版必须逐像素不变 ⇒ 策略算完若「字号未降、未溢出」，
 * 原样返回作者写的文本（不让策略的贪心换行覆盖浏览器自己的换行）。只有长到装不下时才
 * 换成策略算出的行 —— 那时原文本来就会溢出画布，不存在"更好看的旧结果"可以保留。
 */
function fitOrKeep(
  lines: string[],
  options: { maxWidthPx: number; baseFontPx: number; maxLines: number },
): { text: string; fontSize: number; overflow: boolean } {
  const raw = lines.join('\n')
  const fit = fitTextPolicy(raw, options)
  if (fit.fontPx >= options.baseFontPx && !fit.overflow) {
    return { text: raw, fontSize: options.baseFontPx, overflow: false }
  }
  return { text: fit.lines.join('\n'), fontSize: fit.fontPx, overflow: fit.overflow }
}

export const TextCard: React.FC<{ track: TextCardTrack }> = ({ track }) => {
  const frame = useCurrentFrame()
  const { width: canvasWidth } = useVideoConfig()
  // R1：字体族来自 `StudioComposition` 的 context（缺省＝随包中文字体），不再硬编码 sans-serif。
  const fontFamily = useFontFamilyStack()
  // ⚠️ 逐句字幕卡**不做**首尾淡入淡出（2026-10-16 修）：字幕卡按句首尾相接排布，
  //    两卡各带 6 帧淡入淡出时，接缝处前后两卡的不透明度会同时落到 0（实测 0.00）
  //    ⇒ 每句交界闪一次背景。字幕按硬切切换是常规观感；要渐变过渡请用 `transition` 轨，
  //    或改用 `title` / `dataCard` 形态（它们保留淡入淡出）。
  //    CV-334：这条特例从"组件内写死"收敛为契约能力 —— 等价于 `fadeFrames: 0`，
  //    而模型现在可以显式写 `fadeFrames` 覆盖它（例如让某句带入场淡入）。
  const anim = resolveAnimatedStyle(track, frame, {
    defaultFadeFrames: track.variant === 'subtitle' ? 0 : undefined,
  })
  const accent = track.accentColor ?? '#4f9cf9'
  const lines = linesOf(track.text)
  // 二期 A2：效果统一由 `resolveAnimatedStyle` 折算，这里只展开 —— 不各自解读枚举。
  const textFx: React.CSSProperties = {
    ...(anim.fx.textShadow !== undefined ? { textShadow: anim.fx.textShadow } : {}),
    ...(anim.fx.textStroke !== undefined ? { WebkitTextStroke: anim.fx.textStroke } : {}),
  }
  // CV-334：整卡的位置 / 缩放 / 旋转走 `layerTransform`（铺满层上的位移＝把内容移出画布中心）。
  // 缺省参数下它是恒等串 ⇒ 老写法渲染结果不变。
  const layer: React.CSSProperties = {
    opacity: anim.opacity,
    transform: anim.layerTransform,
    transformOrigin: 'center',
    ...(anim.fx.filter !== undefined ? { filter: anim.fx.filter } : {}),
    ...(anim.fx.maskImage !== undefined ? { maskImage: anim.fx.maskImage } : {}),
  }

  if (track.variant === 'subtitle') {
    // A5：字幕条可用宽度 = 86%（maxWidth）− 左右内边距 32×2；最多 3 行。
    const fitted = fitOrKeep(lines, {
      maxWidthPx: Math.max(200, canvasWidth * 0.86 - 64),
      baseFontPx: 44,
      maxLines: 3,
    })
    return (
      <AbsoluteFill style={{ ...layer, justifyContent: 'flex-end', alignItems: 'center', padding: 72 }}>
        <div
          style={{
            maxWidth: '86%',
            padding: '18px 32px',
            borderRadius: 14,
            background: 'rgba(0,0,0,0.62)',
            color: '#f4f7fb',
            fontFamily,
            fontSize: fitted.fontSize,
            lineHeight: 1.35,
            textAlign: 'center',
            whiteSpace: 'pre-line',
            ...textFx,
          }}
        >
          {fitted.text}
        </div>
      </AbsoluteFill>
    )
  }

  if (track.variant === 'title') {
    // A5：标题可用宽度 = 画布 90%；最多 2 行；字号从 84 起缩。
    const fitted = fitOrKeep(lines, {
      maxWidthPx: Math.max(240, canvasWidth * 0.9),
      baseFontPx: 84,
      maxLines: 2,
    })
    return (
      <AbsoluteFill style={{ ...layer, justifyContent: 'center', alignItems: 'center', background: 'rgba(0,0,0,0.35)' }}>
        <div
          style={{
            fontFamily,
            fontSize: fitted.fontSize,
            fontWeight: 700,
            color: '#e6edf3',
            textAlign: 'center',
            lineHeight: 1.15,
            whiteSpace: 'pre-line',
            ...textFx,
          }}
        >
          {fitted.text}
        </div>
      </AbsoluteFill>
    )
  }

  if (track.variant === 'dataCard') {
    return (
      <AbsoluteFill style={{ ...layer, justifyContent: 'center', alignItems: 'center' }}>
        <div
          style={{
            width: 940,
            padding: '52px 60px',
            borderRadius: 26,
            background: 'linear-gradient(160deg, #161f38, #111726)',
            border: `1px solid ${accent}`,
            fontFamily,
            ...(anim.fx.boxShadow !== undefined ? { boxShadow: anim.fx.boxShadow } : {}),
          }}
        >
          <div style={{ fontSize: 40, fontWeight: 700, color: '#e6edf3', ...textFx }}>{lines.join(' ')}</div>
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

  // bullets：每条一行，可用宽度 900px（画布更窄时按 90% 收），最多 6 行，字号从 48 起缩。
  const fitted = fitOrKeep(lines, {
    maxWidthPx: Math.min(900, Math.max(300, canvasWidth * 0.9)),
    baseFontPx: 48,
    maxLines: 6,
  })
  const bulletLines = fitted.text.split('\n')
  return (
    <AbsoluteFill style={{ ...layer, justifyContent: 'center', alignItems: 'center' }}>
      <div style={{ fontFamily, width: 900 }}>
        {bulletLines.map((line, index) => (
          <div key={`${index}-${line}`} style={{ display: 'flex', alignItems: 'center', margin: '18px 0' }}>
            <div style={{ width: 18, height: 18, borderRadius: 9, background: accent, marginRight: 24 }} />
            <div style={{ fontSize: fitted.fontSize, color: '#e6edf3', ...textFx }}>{line}</div>
          </div>
        ))}
      </div>
    </AbsoluteFill>
  )
}
