import { useEffect, useLayoutEffect, useRef, useState } from 'react'

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
 */
export function PromptEditor(props: PromptEditorProps) {
  const { nodeId, label, value, onCommit, disabled = false } = props
  const [stage, setStage] = useState<PromptStage>('read')
  const [focusOpen, setFocusOpen] = useState(false)
  const [draft, setDraft] = useState(value)
  const inlineRef = useRef<HTMLTextAreaElement>(null)
  const expandRef = useRef<HTMLTextAreaElement>(null)
  const focusRef = useRef<HTMLTextAreaElement>(null)

  // 节点切换 / 外部值变化 ⇒ 草稿回到真相。少了这一步，从一个节点切到另一个
  // 会把上一个节点的草稿当成新节点的内容显示出来。
  useEffect(() => {
    setDraft(value)
    setStage('read')
    setFocusOpen(false)
  }, [nodeId, value])

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
  }, [stage, focusOpen])

  const commit = (): void => {
    if (draft !== value) onCommit(draft)
    setStage('read')
    setFocusOpen(false)
  }
  const cancel = (): void => {
    setDraft(value)
    setStage('read')
    setFocusOpen(false)
  }
  /** 就地档的失焦提交：内容没变就只是退出编辑态，不写回。 */
  const commitInline = (): void => {
    if (draft !== value) onCommit(draft)
    setStage('read')
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
    // Cmd/Ctrl+Enter = 提交（长文本里回车是换行，不能抢）。
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      commitFn()
    }
  }

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

  return (
    <div className="csPrompt">
      {header}
      {stage === 'read' && (
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
      )}
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
}
