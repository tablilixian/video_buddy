import { useState } from 'react'
import {
  detectStyleConflicts,
  promptCharCount,
  SOFT_PROMPT_LIMIT,
  stylePrefixRatio,
  RATIO_WARN,
} from '../../style-conflicts.js'
import { composeImagePrompt } from '../../prompt-injection.js'

/**
 * 风格提示条 —— CV-288 验收反馈批。
 *
 * 同时承载两件事（都是**只读展示**，不改任何生成语义）：
 * - **B 冲突提示**：风格与用户提示词在色彩/光线/景深/媒介上正面冲突时，逐条列出
 *   维度与原文证据。验收现场「选了风格却看不出效果」的根因就是它——模型静默按
 *   用户更长的描述出图，不报错也不提示。
 * - **A 最终提示词预览**：点开看「节奏 + 摄像机 + 风格 + 你写的」合成全文，字数
 *   超 Krea2 约 500 字软限制时标黄，并给出风格前缀占比。
 *
 * ## 为什么预览复用 `composeImagePrompt`
 *
 * 预览必须与真实生成**逐字一致**，否则就成了误导。这里直接 import
 * `prompt-injection.ts` 的同一个纯函数（`generate.ts` 也从那里转出），不存在
 * 「预览一套、实际另一套」的第二份实现。
 *
 * ## 为什么默认收起
 *
 * 这是**辅助信息**，不是必读项。验收现场的问题恰恰是「信息藏得太深」——风格文本
 * 只存在于节点 JSON，界面没有任何地方能看见。所以：冲突提示在有冲突时**直接展开**
 * （那是异常信号，该被看见），字数/占比这类中性信息收在「查看最终提示词」后面。
 */
export interface StyleHintBarProps {
  /** 已落盘的风格注入文本；空串 = 未选风格（此时整条不渲染）。 */
  readonly stylePrefix: string
  /** 摄像机前缀（参与合成，预览里要显示）。 */
  readonly cameraPrefix: string
  /** 用户当前提示词（草稿优先，由调用方传）。 */
  readonly prompt: string
}

export function StyleHintBar(props: StyleHintBarProps) {
  const { stylePrefix, cameraPrefix, prompt } = props
  const [open, setOpen] = useState(false)

  const conflicts = detectStyleConflicts(stylePrefix, prompt)
  // 预览走生成时同一个函数——不是「照着 composeImagePrompt 再拼一遍」。
  const finalPrompt = composeImagePrompt({ prompt, cameraPrefix, stylePrefix })
  const chars = promptCharCount(finalPrompt)
  const ratio = stylePrefixRatio(stylePrefix, prompt)
  const overLimit = chars > SOFT_PROMPT_LIMIT
  const diluted = ratio < RATIO_WARN && promptCharCount(prompt) > 0

  // 未选风格 ⇒ 无前缀可注入，也没有冲突可言，整条不占地方。
  // 放在全部计算之后：早返回放在计算之前会让这些 const 只在部分路径可达。
  if (stylePrefix.trim() === '') return null

  return (
    <div className="csStyleHint">
      {conflicts.length > 0 && (
        <div className="csStyleWarn" role="status">
          <span className="csStyleWarnTag">风格可能被提示词覆盖</span>
          {conflicts.map(c => (
            <div className="csStyleWarnRow" key={c.dimension}>
              <span className="csStyleWarnDim">{c.dimension}</span>
              <span className="csStyleWarnMsg">{c.message}</span>
            </div>
          ))}
          <span className="csStyleWarnFoot">风格只是提示词的一段前缀，冲突时模型按你写的来。</span>
        </div>
      )}

      <button type="button" className="csStyleHintToggle" onClick={() => { setOpen(v => !v) }}>
        {open ? '收起最终提示词 ▴' : '查看最终提示词 ▾'}
        <span className={overLimit ? 'csStyleHintCount csStyleHintCountOver' : 'csStyleHintCount'}>
          {chars} 字
        </span>
      </button>

      {open && (
        <div className="csStylePreview">
          <div className="csStylePreviewRow">
            <span className="csStylePreviewKey">风格前缀</span>
            <span className="csStylePreviewVal">{stylePrefix}</span>
          </div>
          {cameraPrefix.trim() !== '' && (
            <div className="csStylePreviewRow">
              <span className="csStylePreviewKey">摄像机前缀</span>
              <span className="csStylePreviewVal">{cameraPrefix}</span>
            </div>
          )}
          <div className="csStylePreviewRow">
            <span className="csStylePreviewKey">你的提示词</span>
            <span className="csStylePreviewVal">{prompt}</span>
          </div>
          <div className="csStylePreviewFoot">
            <span>风格占全文 {(ratio * 100).toFixed(0)}%</span>
            {diluted && <span className="csStylePreviewWarn">提示词较长，风格权重可能被稀释</span>}
            {overLimit && (
              <span className="csStylePreviewWarn">
                超出 Krea2 约 {SOFT_PROMPT_LIMIT} 字软限制（仅提示，不拦截）
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
