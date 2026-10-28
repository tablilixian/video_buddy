/**
 * S3（2026-10-28 · CV-040 收口）：混音面板 —— 把「声音」变成调得动的。
 *
 * BGM / 旁白 / 环境声 三条：音量滑杆 + 淡入淡出 + duck 开关。改动即写回音频节点
 * 的 `audioTimeline`（StudioCanvasNode 上的段覆盖值，S3 新契约字段），成片装配
 * （src/compose.ts）读作该节点段的 gain / 淡变 / duck 覆盖 —— 老数据没有该字段
 * 时照走装配默认口径（0.35 铺底 / 0.8 单轨），行为可回退。
 *
 * D-04：时间轴只读首版不碰手势层 —— 本面板只写节点字段，不写时间轴。
 */
import { createElement } from 'react'
import type { StudioCanvasNode } from '../contracts/canvas.js'
import type { AudioTimeline } from '../audio-timeline.js'
import { nodeAudioOverride, buildNodeAudioTimeline, audioMixRows } from '../compose-selection.js'

/** 面板要的一行（调用方从画布节点派生）。 */
export interface AudioMixRowData {
  nodeId: string
  title: string
  role: 'bgm' | 'voiceOver'
  durationSec?: number
}

export interface AudioMixPanelProps {
  /** BGM 行（选中的 BGM 节点；undefined = 未选）。 */
  bgmNode?: StudioCanvasNode | undefined
  /** 旁白行（画布上的 tts_voiceover 节点）。 */
  voiceOverNodes: readonly StudioCanvasNode[]
  /** 写回节点字段（StudioFrame 提供，走 persistAfter + updateNode）。 */
  onUpdateNode(id: string, patch: { audioTimeline?: AudioTimeline }): void
}

export function AudioMixPanel(props: AudioMixPanelProps): React.JSX.Element {
  const { bgmNode, voiceOverNodes, onUpdateNode } = props
  const bgmOverride = bgmNode !== undefined ? nodeAudioOverride(bgmNode, 'bgm') : undefined
  return createElement(
    'div',
    { className: 'csMixPanel' },
    createElement('div', { className: 'csMixHint' },
      '混音设置随音频节点保存，成片装配时生效（BGM 铺底缺省 0.35，旁白满音量 1.0）'),
    // ── BGM 行 ──
    bgmNode === undefined
      ? createElement('div', { className: 'csMixRow', key: 'bgm-none' },
        createElement('span', { className: 'csMixRowLabel' }, 'BGM'),
        createElement('span', { className: 'csMixHint' }, '未选择 BGM —— 在上方下拉选用'))
      : createElement('div', { key: 'bgm' },
        createElement('div', { className: 'csMixRow' },
          createElement('span', { className: 'csMixRowLabel' }, 'BGM 音量'),
          createElement('input', {
            type: 'range', min: 0, max: 1, step: 0.05,
            value: bgmOverride?.gain ?? 0.35,
            title: 'BGM 线性增益（0–1）。缺省 0.35 = 铺底；成片无原生声时装配自动改用单轨 0.8',
            onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
              onUpdateNode(bgmNode.id, { audioTimeline: buildNodeAudioTimeline(bgmNode, 'bgm', { gain: Number(event.target.value) }) })
            },
          }),
          createElement('span', { className: 'csMixRowVal' }, `${(bgmOverride?.gain ?? 0.35).toFixed(2)}`)),
        createElement('div', { className: 'csMixRow' },
          createElement('span', { className: 'csMixRowLabel' }, '淡入/出'),
          createElement('input', {
            type: 'range', min: 0, max: 5, step: 0.5, style: { flex: 1 },
            value: bgmOverride?.fadeInSec ?? 1,
            title: '淡入秒数（0 = 不淡入）',
            onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
              onUpdateNode(bgmNode.id, { audioTimeline: buildNodeAudioTimeline(bgmNode, 'bgm', { fadeInSec: Number(event.target.value) }) })
            },
          }),
          createElement('span', { className: 'csMixRowVal' }, `${(bgmOverride?.fadeInSec ?? 1).toFixed(1)}s`),
          createElement('input', {
            type: 'range', min: 0, max: 5, step: 0.5, style: { flex: 1 },
            value: bgmOverride?.fadeOutSec ?? 1,
            title: '淡出秒数（0 = 不淡出）',
            onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
              onUpdateNode(bgmNode.id, { audioTimeline: buildNodeAudioTimeline(bgmNode, 'bgm', { fadeOutSec: Number(event.target.value) }) })
            },
          }),
          createElement('span', { className: 'csMixRowVal' }, `${(bgmOverride?.fadeOutSec ?? 1).toFixed(1)}s`))),
    // ── 旁白行 ──
    voiceOverNodes.length === 0
      ? createElement('div', { className: 'csMixRow', key: 'vo-none' },
        createElement('span', { className: 'csMixRowLabel' }, '旁白'),
        createElement('span', { className: 'csMixHint' }, '画布上暂无旁白节点 —— 用 tts_voiceover 生成'))
      : voiceOverNodes.map((node) => {
        const override = nodeAudioOverride(node, 'voiceOver')
        const gain = override?.gain ?? 1
        const duck = override?.duckAmount ?? 0
        return createElement('div', { key: node.id },
          createElement('div', { className: 'csMixRow' },
            createElement('span', { className: 'csMixRowLabel' }, '旁白音量'),
            createElement('input', {
              type: 'range', min: 0, max: 1, step: 0.05,
              value: gain,
              title: `${node.title ?? '旁白'} 的线性增益（0–1）`,
              onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
                onUpdateNode(node.id, { audioTimeline: buildNodeAudioTimeline(node, 'voiceOver', { gain: Number(event.target.value) }) })
              },
            }),
            createElement('span', { className: 'csMixRowVal' }, `${gain.toFixed(2)}`),
            createElement('label', { className: 'csMixRowCheck', title: '压 BGM 深度 0.5（旁白出声时 BGM 自动闪避）' },
              createElement('input', {
                type: 'checkbox',
                checked: duck > 0,
                onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
                  onUpdateNode(node.id, { audioTimeline: buildNodeAudioTimeline(node, 'voiceOver', { duckAmount: event.target.checked ? 0.5 : 0 }) })
                },
              }),
              'duck')),
          createElement('div', { className: 'csMixHint' }, node.title ?? '旁白'))
      }),
    // ── 环境声行（信息位：环境声由各镜素材决定，无节点可写）──
    createElement('div', { className: 'csMixRow', key: 'native' },
      createElement('span', { className: 'csMixRowLabel' }, '环境声'),
      createElement('span', { className: 'csMixHint' }, '由各镜素材的原生音轨决定（生成视频时开启 generateAudio）')),
  )
}

export { audioMixRows }
