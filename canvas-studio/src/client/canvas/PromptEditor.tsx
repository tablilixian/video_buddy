import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import {
  irReplaceSegment,
  irSegmentBody,
  irSegmentize,
  PROMPT_PREVIEW_LINES,
  promptLineCount,
  promptShapeOf,
} from '../../prompt-shape.js'

/** 编辑档位（按改动规模升级，而不是给长文本一个更大的框了事）。 */
type PromptStage = 'read' | 'inline' | 'expand'

/** Props for the prompt editor (the three-stage editor). */
export interface PromptEditorProps {
  /** 节点 id —— 切换节点时用它重置草稿（同 CV-001 的 `key` 手法）。 */
  nodeId: string
  /** 字段标签（音乐节点有两个字段：音乐描述 / 歌词）。 */
  label: string
  /** 已保存的值（外部真相；提交后由上层回写再流回来）。 */
  value: string
  /** 提交新值。**只在内容真的变了时**才被调用。 */
  onCommit(next: string): void
  /** 编辑中禁用（例如该节点正在生成）。 */
  disabled?: boolean
  /** REQ-003 B1：挂载即进就地档并聚焦正文（画布浮层用）；缺省从只读档开始。 */
  autoEdit?: boolean
  /** REQ-003 F5：草稿种子（重开浮层时回填未保存草稿）；缺省从已保存值开始。 */
  seedDraft?: string
  /**
   * REQ-003 D5/F5：草稿镜像回调 —— 每次草稿变化（含重置）上报给宿主，
   * 用于「未保存 / 已改 N 处」读数。**不是**第二条写回路径：写回仍只走 `onCommit`。
   */
  onDraftChange?(draft: string): void
  /**
   * REQ-003 F6：Cmd/Ctrl+Enter 的宿主去向。画布浮层把它接成「保存并重试」；
   * 缺省保持既有语义（= 提交当前档）。触发即 stopPropagation，宿主根节点不重复响应。
   */
  onCmdEnter?(): void
}

/**
 * REQ-003 C1：外层「保存并重试」要先**落当前草稿**再触发重试 —— 草稿是本组件的
 * 内部状态，外部拿不到，只能经这个句柄驱动同一条 commit 路径（内容没变就不会写回，
 * 与内部「保存」按钮完全同语义；不另开第二条写回口径）。
 */
export interface PromptEditorHandle {
  commit(): void
}

/**
 * 提示词编辑器 —— **三档**，按改动规模逐级升格：
 *
 * | 档 | 形态 | 适合 |
 * |---|---|---|
 * | 一档 · 就地 | 点只读文本 → 原位变自增高 textarea，失焦提交 | 改几个词 |
 * | 二档 · 展开 | 编辑器升格占满右栏，带保存 / 取消 | 重写一段 |
 * | 三档 · 聚焦 | 居中大窗，左「已保存基准」右「编辑」并排 | 整篇重写 |
 *
 * 为什么不直接把单行 input 换成大 textarea：单行框的毛病不是「小」，而是**看不见
 * 自己在改什么也要一次改到位**。分档之后常见操作（改个词）留在原位、零跳转；只有
 * 真的要大改时才让界面让位。
 *
 * ## 两条语义（2026-09-16 拍板）
 *
 * 1. **编辑 = 写本地字段**：`onCommit` 只写回 `generationPrompt`，**不触发任何生成**。
 * 2. 要真的重跑，用户改完再点「重试」—— 于是「改完后悔」不需要付一次生成的钱。
 *
 * ## REQ-003 D 组：只读档按**内容形态**换展示（由内容算，不由用户手选）
 *
 * | 形态 | 只读档表现 | 整篇改去哪 |
 * |---|---|---|
 * | short | 全文（点进就地档） | 不需要 |
 * | long | 读数「N 行 / M 字」+ 前 3 行预览 +「展开编辑」—— 就地档**不硬撑全文** | 展开档（高度有上限） |
 * | ir | **段名常显、段体折叠**，点段名只展开要改的那段（段内编辑按行号 splice 回原文，其余逐字节不动） | 聚焦档 |
 */
export const PromptEditor = forwardRef<PromptEditorHandle, PromptEditorProps>(function PromptEditor(props, ref) {
  const { nodeId, label, value, onCommit, disabled = false, autoEdit = false, seedDraft, onDraftChange, onCmdEnter } = props
  const [stage, setStage] = useState<PromptStage>(autoEdit ? 'inline' : 'read')
  const [focusOpen, setFocusOpen] = useState(false)
  const [draft, setDraft] = useState(seedDraft ?? value)
  /** D3：正在编辑的 IR 段（只读档；null = 全部折叠）。 */
  const [segEditing, setSegEditing] = useState<number | null>(null)
  const [segBody, setSegBody] = useState('')
  const inlineRef = useRef<HTMLTextAreaElement>(null)
  const expandRef = useRef<HTMLTextAreaElement>(null)
  const focusRef = useRef<HTMLTextAreaElement>(null)
  const segRef = useRef<HTMLTextAreaElement>(null)

  // 节点切换 / 外部值变化 ⇒ 草稿回到真相。少了这一步，从一个节点切到另一个
  // 会把上一个节点的草稿当成新节点的内容显示出来。
  // 挂载那一跳不算「变化」（autoEdit / seedDraft 要的就是挂载即编辑态）—— 用 prev
  // 对照把首帧挡掉，否则初始编辑档会被这里的 setStage('read') 立刻冲掉。
  const truthRef = useRef({ nodeId, value })
  useEffect(() => {
    const prev = truthRef.current
    if (prev.nodeId === nodeId && prev.value === value) return
    truthRef.current = { nodeId, value }
    setDraft(value)
    setStage('read')
    setFocusOpen(false)
    setSegEditing(null)
  }, [nodeId, value])

  // D5：草稿镜像。依赖只有 draft —— 宿主传内联回调也不会每次渲染都触发
  // （否则「回调换新 → effect → setState → 再渲染」就是死循环）。闭包取的
  // 是本次渲染的回调，语义不变。
  useEffect(() => {
    if (onDraftChange !== undefined) onDraftChange(draft)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft])

  // 一档：自增高。用 layout effect —— 不然会先看到一帧原高度、再跳一下。
  useLayoutEffect(() => {
    const el = stage === 'inline' ? inlineRef.current : null
    if (el === null) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [draft, stage])

  // 焦点进到正在编辑的那一档。三档是三个不同节点，各走各的（不能共用一个 ref）。
  useEffect(() => {
    if (focusOpen) focusRef.current?.focus()
    else if (stage === 'expand') expandRef.current?.focus()
    else if (stage === 'inline') inlineRef.current?.focus()
    else if (stage === 'read' && segEditing !== null) segRef.current?.focus()
  }, [stage, focusOpen, segEditing])

  // 内部 commit 暴露给持有 ref 的宿主（画布浮层的「保存并重试」先落字段再重试）。
  useImperativeHandle(ref, () => ({ commit }))

  const commit = (): void => {
    if (draft !== value) onCommit(draft)
    setStage('read')
    setFocusOpen(false)
    setSegEditing(null)
  }
  const cancel = (): void => {
    setDraft(value)
    setStage('read')
    setFocusOpen(false)
    setSegEditing(null)
  }
  /** 就地档的失焦提交：内容没变就只是退出编辑态，不写回。 */
  const commitInline = (): void => {
    if (draft !== value) onCommit(draft)
    setStage('read')
  }
  /** D3：段体提交 —— 按行号 splice 回原文本，其余段逐字节不动。 */
  const commitSegment = (): void => {
    if (segEditing === null) return
    const segments = irSegmentize(value)
    const segment = segments[segEditing]
    if (segment !== undefined) {
      const next = irReplaceSegment(value, segment, segBody)
      if (next !== value) onCommit(next)
    }
    setSegEditing(null)
  }

  const onKeyDown = (
    event: React.KeyboardEvent<HTMLTextAreaElement>,
    commitFn: () => void,
  ): void => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      cancel()
      return
    }
    // Cmd/Ctrl+Enter = 提交（长文本里回车是换行，不能抢）。宿主接了 onCmdEnter
    // 时交宿主（浮层 = 保存并重试），并拦冒泡 —— 宿主根节点不再重复响应。
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      if (onCmdEnter !== undefined) {
        event.stopPropagation()
        onCmdEnter()
      } else {
        commitFn()
      }
    }
  }

  const shape = promptShapeOf(value)
  const segments = shape === 'ir' ? irSegmentize(value) : []
  const valueLines = promptLineCount(value)
  const preview = value.split('\n').slice(0, PROMPT_PREVIEW_LINES).join('\n')

  const header = (
    <div className="csPromptHead">
      <span className="csPromptLabel">{label}</span>
      <span className="csPromptCount">{value.length} 字</span>
      {!disabled && (
        <span className="csPromptTools">
          {stage === 'read' && (
            <>
              <button type="button" className="csDetailButton" title="就地编辑（失焦即保存）" onClick={() => { setDraft(value); setStage('inline') }}>编辑</button>
              <button type="button" className="csDetailButton" title="展开占满右栏编辑" onClick={() => { setDraft(value); setStage('expand') }}>展开</button>
            </>
          )}
          <button type="button" className="csDetailButton" title="在居中大窗里整篇重写" onClick={() => { setDraft(value); setFocusOpen(true) }}>聚焦</button>
        </span>
      )}
    </div>
  )

  /** 只读档正文：按形态分流（D1）。 */
  const readOnlyBody = shape === 'long'
    ? (
      // 就地档不硬撑全文：读数 + 前 3 行预览 + 展开入口。点击预览 = 展开。
      <div className="csPromptLongRead">
        <span className="csPromptLongMeta">长提示词 · {valueLines} 行 / {value.length} 字</span>
        <pre
          className="csPromptText csPromptLongPreview"
          role="button"
          tabIndex={disabled ? -1 : 0}
          title={disabled ? undefined : '点击展开编辑'}
          onClick={() => { if (!disabled) { setDraft(value); setStage('expand') } }}
        >{preview}{valueLines > PROMPT_PREVIEW_LINES ? '\n…' : ''}</pre>
        {!disabled && (
          <span className="csPromptLongTools">
            <button type="button" className="csDetailButton" onClick={() => { setDraft(value); setStage('expand') }}>展开编辑</button>
          </span>
        )}
      </div>
    )
    : shape === 'ir'
      ? (
        // 结构化提示词：段名常显、段体折叠；点段名只展开要改的那段（D3）。
        <div className="csPromptSegs">
          {segments.map((segment, index) => (
            <div className="csPromptSeg" key={`${segment.name ?? '(body)'}-${index}`}>
              <button
                type="button"
                className="csPromptSegHead"
                title={segEditing === index ? undefined : '展开这一段编辑'}
                onClick={() => {
                  if (disabled) return
                  if (segEditing === index) { setSegEditing(null); return }
                  setSegEditing(index)
                  setSegBody(irSegmentBody(value, segment))
                }}
              >
                <span className="csPromptSegMark">{segEditing === index ? '▾' : '▸'}</span>
                <span className="csPromptSegName">{segment.name ?? '（正文）'}</span>
                <span className="csPromptSegCount">{Math.max(segment.bodyEnd - segment.bodyStart, 0)} 行</span>
              </button>
              {segEditing === index && (
                <div className="csPromptSegBody">
                  <textarea
                    ref={segRef}
                    className="csPromptArea csPromptAreaSeg"
                    value={segBody}
                    onChange={event => { setSegBody(event.target.value) }}
                    onBlur={commitSegment}
                    onKeyDown={event => { onKeyDown(event, commitSegment) }}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )
      : (
        <pre
          className="csPromptText"
          role="button"
          tabIndex={disabled ? -1 : 0}
          title={disabled ? undefined : '点击就地编辑'}
          onClick={() => { if (!disabled) { setDraft(value); setStage('inline') } }}
          onKeyDown={event => { if (!disabled && event.key === 'Enter') { setDraft(value); setStage('inline') } }}
        >
          {value.length > 0 ? value : '（空 — 点击填写）'}
        </pre>
      )

  return (
    <div className="csPrompt">
      {header}
      {stage === 'read' && readOnlyBody}
      {stage === 'inline' && (
        <textarea
          ref={inlineRef}
          className="csPromptArea csPromptAreaAuto"
          value={draft}
          rows={1}
          onChange={event => { setDraft(event.target.value) }}
          onBlur={commitInline}
          onKeyDown={event => { onKeyDown(event, commitInline) }}
        />
      )}
      {stage === 'expand' && (
        <>
          <textarea
            ref={expandRef}
            className="csPromptArea csPromptAreaFill"
            value={draft}
            onChange={event => { setDraft(event.target.value) }}
            onKeyDown={event => { onKeyDown(event, commit) }}
          />
          <div className="csPromptFoot">
            <span className="csPromptHint">保存后不会立刻重新生成 —— 可先看一遍再点「重试」</span>
            {/* D4：整篇重写引导到既有聚焦档（1040×640 双栏），不新造第四档。 */}
            {!disabled && (
              <button type="button" className="csDetailButton" title="在居中大窗里整篇重写" onClick={() => { setFocusOpen(true) }}>聚焦编辑</button>
            )}
            <button type="button" className="csDetailButton csDetailButtonActive" onClick={commit}>保存</button>
            <button type="button" className="csDetailButton" onClick={cancel}>取消</button>
          </div>
        </>
      )}
      {stage === 'read' && (
        <p className="csPromptHint">改动先落成参数；点「重试」才真的重新生成一版</p>
      )}
      {focusOpen && (
        <div
          className="csPromptFocusBackdrop"
          // 点遮罩 = 取消（草稿丢弃），与 Esc 同一语义。
          onPointerDown={event => { if (event.target === event.currentTarget) cancel() }}
        >
          <div className="csPromptFocus" role="dialog" aria-label={`聚焦编辑：${label}`}>
            <header className="csPromptFocusHead">
              <span className="csPromptFocusTitle">{label}</span>
              <span className="csPromptCount">{draft.length} 字 · 已保存 {value.length} 字</span>
              <button type="button" className="csDetailDrawerClose" onClick={cancel} aria-label="关闭">×</button>
            </header>
            <div className="csPromptFocusBody">
              {/* 左窗是**只读基准**（当前已保存的那一版），右窗才是编辑区 ——
                  大改时最需要的是「原来写的是什么」，而不是更大的空白。 */}
              <section className="csPromptFocusPane">
                <h4 className="csPromptFocusPaneTitle">已保存</h4>
                <pre className="csPromptText csPromptTextBench">{value.length > 0 ? value : '（空）'}</pre>
              </section>
              <section className="csPromptFocusPane">
                <h4 className="csPromptFocusPaneTitle">编辑</h4>
                <textarea
                  ref={focusRef}
                  className="csPromptArea csPromptAreaBench"
                  value={draft}
                  onChange={event => { setDraft(event.target.value) }}
                  onKeyDown={event => { onKeyDown(event, commit) }}
                />
              </section>
            </div>
            <footer className="csPromptFocusFoot">
              <span className="csPromptHint">保存后不会立刻重新生成 —— 关掉大窗再点「重试」</span>
              <button type="button" className="csDetailButton csDetailButtonActive" onClick={commit}>保存</button>
              <button type="button" className="csDetailButton" onClick={cancel}>取消</button>
            </footer>
          </div>
        </div>
      )}
    </div>
  )
})
