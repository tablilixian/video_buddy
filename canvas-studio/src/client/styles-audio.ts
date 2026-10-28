/**
 * S3（2026-10-28 · CV-040 收口）：音频轨 / 混音面板 / 音频抽屉的样式。
 *
 * 为什么独立成文件：styles.ts 在文件行数棘轮白名单上（超大文件拆分执行计划的
 * 待拆对象），「只准减不准增」—— 本轮新增样式落这里，由 CanvasTimeline 首次
 * 挂载时注入（幂等，与 installStudioStyles 同一模式）。
 */
const AUDIO_STYLES = `
/* ── S3（2026-10-28 · CV-040 收口）：只读音频轨 / 混音面板 / 音频抽屉 ── */
.csTlLaneAudioBlock {
  position: absolute;
  top: 2px;
  bottom: 2px;
  border-radius: 4px;
  background: rgba(64, 132, 116, 0.32);
  border: 1px solid rgba(84, 178, 156, 0.55);
  overflow: hidden;
  display: flex;
  align-items: center;
  min-width: 2px;
}
.csTlLaneAudioBlock.csTlAudioOverflow { border-color: #d29a4a; background: rgba(210, 154, 74, 0.22); }
.csTlLaneAudioLabel {
  font-size: 10px;
  color: #cfe6df;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  padding: 0 4px;
  pointer-events: none;
}
.csTlAudioOverflowMark {
  position: absolute;
  right: 2px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 10px;
  color: #d29a4a;
  pointer-events: none;
}
.csMixPanel {
  border-top: 1px solid var(--dsw-alias-border-l2);
  padding: 8px 10px;
  display: grid;
  gap: 6px;
  background: var(--dsw-alias-surface-2, #1c2128);
}
.csMixRow { display: flex; align-items: center; gap: 8px; font-size: 11.5px; color: #aeb6c2; }
.csMixRowLabel { width: 52px; flex: none; color: #d6dbe2; }
.csMixRow input[type="range"] { flex: 1 1 auto; accent-color: var(--cs-accent, #4a9d8e); }
.csMixRowVal { width: 38px; flex: none; text-align: right; font-variant-numeric: tabular-nums; }
.csMixRowCheck { display: flex; align-items: center; gap: 4px; flex: none; font-size: 11px; color: #aeb6c2; }
.csMixHint { font-size: 10.5px; color: #6b737f; }
.csAudioDrawer {
  position: absolute;
  right: 8px;
  top: 8px;
  bottom: 8px;
  width: min(360px, 90%);
  z-index: 30;
  overflow: auto;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 10px;
  background: var(--dsw-alias-surface-1, #171b21);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
  padding: 10px;
  display: grid;
  gap: 8px;
  align-content: start;
}
.csAudioDrawerHead { display: flex; align-items: center; justify-content: space-between; font-size: 12.5px; color: #d6dbe2; }
.csAudioDrawerItem {
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 8px;
  padding: 8px;
  display: grid;
  gap: 6px;
  background: var(--dsw-alias-surface-2, #1c2128);
}
.csAudioDrawerTitle { font-size: 12px; color: #e9ecf1; display: flex; gap: 6px; align-items: baseline; }
.csAudioDrawerMeta { font-size: 10.5px; color: #6b737f; }
.csAudioDrawer audio { width: 100%; height: 28px; }
.csAudioDrawerLyric { font-size: 11px; color: #aeb6c2; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
`

let installed = false

/** 注入音频子系统样式（幂等；CanvasTimeline 挂载时调用）。 */
export function installAudioStyles(): void {
  if (installed || typeof document === 'undefined') return
  installed = true
  const element = document.createElement('style')
  element.setAttribute('data-plugin', 'canvas-studio-audio')
  element.textContent = AUDIO_STYLES
  document.head.appendChild(element)
}
