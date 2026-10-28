/**
 * S3（2026-10-28 · CV-040 收口）：音频抽屉 —— 全项目音频列表：时长、来源工具、
 * 歌词首行、试听、多版并排比较。从时间轴工具栏「音频」进入。
 *
 * 只读首版：并列展示全部 kind='audio' 节点（含已作废/被取代版本，标注来源工具
 * 供多版抽卡对比）；试听直接 `<audio controls>` 同源 URL。歌词首行取节点 text
 * （tts_voiceover 结果文案落盘正文；音乐节点无 text 则不显示）。
 */
import { createElement } from 'react'
import type { StudioCanvasNode } from '../contracts/canvas.js'
import { audioDrawerRows } from '../compose-selection.js'

export interface AudioDrawerProps {
  /** 画布上全部音频节点（含失效版本，标注供对比）。 */
  nodes: readonly StudioCanvasNode[]
  onClose(): void
  /** 点选节点（在画布定位）。 */
  onSelect(id: string): void
}

export function AudioDrawer(props: AudioDrawerProps): React.JSX.Element {
  const { nodes, onClose, onSelect } = props
  const rows = audioDrawerRows(nodes)
  return createElement(
    'div',
    { className: 'csAudioDrawer' },
    createElement('div', { className: 'csAudioDrawerHead' },
      createElement('span', null, `音频 ${rows.length} 个`),
      createElement('button', { type: 'button', onClick: onClose, title: '关闭' }, '✕')),
    rows.length === 0
      ? createElement('div', { className: 'csAudioDrawerMeta' }, '画布上还没有音频节点 —— 用 music_generation 生成 BGM、tts_voiceover 生成旁白')
      : rows.map(({ node, role, retired, lyricFirstLine, durationSec }) => createElement(
        'div',
        { key: node.id, className: 'csAudioDrawerItem' },
        createElement('div', { className: 'csAudioDrawerTitle' },
          createElement('span', null, node.title ?? '音频'),
          createElement('span', { className: 'csAudioDrawerMeta' },
            `${role === 'voiceOver' ? '旁白' : '配乐'}${node.toolName !== undefined ? ` · ${node.toolName}` : ''}${retired ? ' · 已作废/被取代' : ''}`)),
        createElement('div', { className: 'csAudioDrawerMeta' },
          durationSec !== undefined ? `时长 ${durationSec.toFixed(2)}s` : '时长未探测',
          retired ? '（仅作对比参考，不进新成片）' : ''),
        lyricFirstLine !== undefined
          ? createElement('div', { className: 'csAudioDrawerLyric', title: lyricFirstLine }, `♪ ${lyricFirstLine}`)
          : null,
        node.url !== undefined
          ? createElement('audio', { controls: true, src: node.url, preload: 'none' })
          : null,
        createElement('button', { type: 'button', onClick: () => onSelect(node.id) }, '在画布定位'),
      )),
  )
}
