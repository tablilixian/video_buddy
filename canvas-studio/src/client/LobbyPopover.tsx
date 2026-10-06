/**
 * REQ-028：首页输入框的**统一「chip 触发器 + 悬浮气泡弹出框」组件**。
 *
 * 演示（docs/assets/library-2026-10-06/video-agent-inputbox.html）把所有选择项
 * 统一成一套规格，这里逐条落地：
 *
 * - **定位**：触发器上方 `bottom: calc(100% + 11px)` 向上展开（参考内容方框在输入框
 *   顶部，改 `below` 向下展开、尖角翻到上沿）；贴左对齐，右侧的选择器（执行模式）
 *   与贴住右缘时翻转的参考内容面板改右对齐。
 * - **小尖角**：10×10 方块旋转 45°（::after），距左 20px，跟随面板同底色与描边。
 * - **面板**：宽按内容 226–268px（调用方传），圆角 12px，内边距 6px。
 * - **菜单项**：固定行高 34px，左打勾 13px + 主文案 12.5px + 右侧 meta 10.5px；
 *   选中态＝勾亮起 + 文案提亮 + meta 变琥珀色。选中语义照进 `aria-pressed`
 *   （本仓 chip 选中态的唯一来源约定，样式只读属性）。
 * - **展开动效**：opacity 0→1 + translateY(6px→0)，150ms（transition 实现，
 *   不占 @keyframes 三语义配额）；展开时触发器同步高亮、caret 旋转 180°。
 * - **关闭**：点面板外 / Esc / 再点一次触发器；**同一时刻只允许一个面板展开**
 *   —— 开新面板前先关掉本模块已登记的其它面板（模块级登记表，跨组件互斥：
 *   三枚规格 chip 在宿主卡的工具行里，参考内容方框在 dock 行，四者共享一份互斥）。
 * - **hover 气泡**：同一个气泡组件复用于画幅 / 执行模式 chip（「当前：…」），
 *   面板展开时自动隐藏。
 *
 * ## 为什么触发器不写 `aria-haspopup="menu"`
 *
 * styles.ts 的 CV-259 规则 `.csChat [data-phase="hero"] button[aria-haspopup="menu"]`
 * 会把 hero 态卡片内**所有**菜单触发器 `display:none`（藏宿主的两个下拉用），
 * 白名单只放回了宿主模型座椅。我们的 chip 就渲染在那张卡里 —— 写了该属性就会被
 * 误杀。故只用 `aria-expanded` + `aria-controls` 表达展开态（缺 haspopup 的语义
 * 损失小于整个入口消失），等宿主那条规则消失后再补齐。
 */
import { useCallback, useEffect, useId, useRef, useState, type ReactElement } from 'react'

/** 已展开面板的关闭回调登记表：开新面板前先全部关掉（单开互斥）。 */
const openClosers = new Set<() => void>()

/** 选中态勾（13px，与演示同一枚 SVG）。 */
export function LobbyCheckGlyph(): ReactElement {
  return (
    <svg className="csLobbyMiChk" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 13l4 4L19 7" />
    </svg>
  )
}

export interface LobbySelProps {
  /** 触发按钮的**内容**（图标 + 读数 + caret；外壳由本组件统一画）。 */
  readonly chip: ReactElement
  /**
   * 触发按钮的类。缺省 = 统一药丸壳 `.csLobbyChip`；传入则**整体替换**外壳类
   * （参考内容方框用 `.csLobbyAttachAdd` —— 58×58 虚线方框不是药丸，与药丸壳
   * 叠加只会互相打架）。
   */
  readonly chipClassName?: string
  /** 无障碍名（触发按钮内容里若无可读文本则必须给）。 */
  readonly chipLabel: string
  /** 面板宽度（px；按内容 226–268，演示逐面板定宽）。 */
  readonly popWidth: number
  /** 面板对齐：默认贴左；触发器在卡右缘时用 right。 */
  readonly align?: 'left' | 'right'
  /** 展开方向：默认向上；参考内容方框在输入框顶部，用 below 向下展开。 */
  readonly expand?: 'up' | 'below'
  /** hover 气泡文案（「当前：…」）；不传则无气泡。面板展开时自动隐藏。 */
  readonly tip?: string
  /**
   * 面板内容（头 / 菜单 / 分隔 / 脚注，由调用方拼装）。收参数 `close`：
   * 单选类面板（模型、执行模式、附件来源）选中即关，调 `close()`；
   * 多字段面板（画幅+分辨率、时长）保持展开便于连续调，不理会即可。
   */
  readonly children: (close: () => void) => ReactElement
}

/**
 * 「chip 触发器 + 气泡弹出框」的统一外壳。展开态照进 `data-open`（样式只读
 * 属性，见 DD-08：属性选择器必须有真实的 .tsx 写入方）。
 */
export function LobbySel(props: LobbySelProps): ReactElement {
  const { chip, chipClassName, chipLabel, popWidth, align = 'left', expand = 'up', tip, children } = props
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLSpanElement>(null)
  const popId = useId()
  /** below 展开时贴住右缘的面板翻转为右对齐（演示同款判定，避免越出卡片）。 */
  const [flip, setFlip] = useState(false)

  const close = useCallback(() => { setOpen(false) }, [])

  useEffect(() => {
    if (!open) return
    // 单开互斥：登记自己，先关掉别人。
    openClosers.forEach((closer) => { if (closer !== close) closer() })
    openClosers.add(close)
    const onPointerDown = (event: MouseEvent): void => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      openClosers.delete(close)
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, close])

  // below 展开的面板在打开那一刻量一次：右缘放不下就翻右对齐（宽度恒定，
  // 打开后不会自己变宽，无需持续观测）。
  useEffect(() => {
    if (!open || expand !== 'below') { setFlip(false); return }
    const box = rootRef.current?.getBoundingClientRect()
    if (box !== undefined) setFlip(box.left + popWidth > document.documentElement.clientWidth - 12)
  }, [open, expand, popWidth])

  const effectiveAlign: 'left' | 'right' = expand === 'below' && flip ? 'right' : align

  return (
    <span
      ref={rootRef}
      className="csLobbySel"
      data-open={open ? 'true' : undefined}
      data-expand={expand}
      data-align={effectiveAlign}
    >
      {tip !== undefined && <span className="csLobbyTip" role="presentation">{tip}</span>}
      <button
        type="button"
        className={chipClassName ?? 'csLobbyChip'}
        aria-expanded={open}
        aria-controls={open ? popId : undefined}
        aria-label={chipLabel}
        onClick={() => { setOpen((value) => !value) }}
      >
        {chip}
      </button>
      <div className="csLobbyPop" id={popId} style={{ width: popWidth }}>
        {children(close)}
      </div>
    </span>
  )
}

/** 面板小节标题（10.5px 字距放大写风格，如「画幅比例」「输出分辨率」）。 */
export function LobbyPopHead({ children }: { children: string }): ReactElement {
  return <h4 className="csLobbyPopHead">{children}</h4>
}

/** 面板内分隔线。 */
export function LobbyDivider(): ReactElement {
  return <div className="csLobbyDv" role="presentation" />
}

/** 面板底部脚注（差异说明写这里，不占菜单行）。 */
export function LobbyPopFoot({ children }: { children: string }): ReactElement {
  return <p className="csLobbyPopFoot">{children}</p>
}

export interface LobbyMenuItemProps {
  /** 主文案（12.5px，选中提亮加粗）。 */
  readonly label: string
  /** 右侧 meta（10.5px；选中变琥珀色）。缺省不渲染。 */
  readonly meta?: string
  /** 选中态（aria-pressed 照进 DOM）。 */
  readonly selected?: boolean
  onSelect(): void
}

/** 统一菜单行（固定 34px 行高：勾 + 主文案 + 右侧 meta）。 */
export function LobbyMenuItem(props: LobbyMenuItemProps): ReactElement {
  const { label, meta, selected = false, onSelect } = props
  return (
    <button type="button" className="csLobbyMi" aria-pressed={selected} onClick={onSelect}>
      <LobbyCheckGlyph />
      <span className="csLobbyMiLb">{label}</span>
      {meta !== undefined && <span className="csLobbyMiMeta">{meta}</span>}
    </button>
  )
}

export interface LobbyRatioCardProps {
  /** 比例卡里的矩形小样（宽 × 高 px，按真实比例缩放到长边 36）。 */
  readonly boxWidth: number
  readonly boxHeight: number
  /** 主行（16:9 / 9:16）。 */
  readonly label: string
  /** 副行（横屏 / 竖屏）。 */
  readonly sub: string
  readonly selected: boolean
  onSelect(): void
}

/** 画幅大卡（上段两卡：比例矩形小样 + 两行文案；选中描边走 accent）。 */
export function LobbyRatioCard(props: LobbyRatioCardProps): ReactElement {
  const { boxWidth, boxHeight, label, sub, selected, onSelect } = props
  return (
    <button type="button" className="csLobbyRatio" aria-pressed={selected} onClick={onSelect}>
      <span className="csLobbyRatioBw">
        <span className="csLobbyRatioBox" style={{ width: boxWidth, height: boxHeight }} />
      </span>
      <span className="csLobbyRatioLb">{label}<br />{sub}</span>
    </button>
  )
}

export interface LobbyCustomRowProps {
  /** 该行是否处于选中态（选中才激活输入框）。 */
  readonly selected: boolean
  /** 输入框值（草稿秒数；未填为空串）。 */
  readonly value: string
  /** 秒数键入（草稿即改即回写，chip 读数随动）。 */
  onChange(value: string): void
  /** 点行（未选中时点行 = 选中并聚焦输入框）。 */
  onPick(): void
}

/**
 * 时长面板的「自定义」行：勾 + 行名 + 右侧数字输入框。
 *
 * 未选中时输入框 disabled 且呈静默态（无描边、降透明）——演示口径：不可键入
 * 也不可 Tab 聚焦；点行才激活并聚焦。Enter 提交（blur 收敛）由输入框自理。
 */
export function LobbyCustomRow(props: LobbyCustomRowProps): ReactElement {
  const { selected, value, onChange, onPick } = props
  const inputRef = useRef<HTMLInputElement>(null)
  // 选中那一刻聚焦并全选：点行 → 直接键入（演示 pickCustom 同款）。
  useEffect(() => {
    if (!selected) return
    const input = inputRef.current
    if (input !== null && document.activeElement !== input) { input.focus(); input.select() }
  }, [selected])
  return (
    // 整行是一枚「选中自定义」的按钮，数字输入框嵌在里面（演示同结构）——
    // 外壳因此**不能**用 <button>（交互元素里嵌输入框是非法 HTML，聚焦会被
    // 浏览器拆台），用 div[role=button] + 键盘等价（Enter / Space 选中）。
    // 输入框自己的点击不再冒泡成「点行」，避免选中后点框重新走一遍 pick。
    <div
      className="csLobbySblock"
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label="自定义时长"
      onClick={() => { onPick() }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onPick() }
      }}
    >
      <LobbyCheckGlyph />
      <span className="csLobbySlabel">自定义</span>
      <span
        className="csLobbyNumwrap"
        onClick={(event) => { event.stopPropagation() }}
        onKeyDown={(event) => { event.stopPropagation() }}
        role="presentation"
      >
        <input
          ref={inputRef}
          type="number"
          className="csLobbyNumInput"
          min={1}
          max={300}
          step={1}
          inputMode="numeric"
          aria-label="自定义时长（秒）"
          value={value}
          disabled={!selected}
          onChange={(event) => { onChange(event.target.value) }}
        />
        <span className="csLobbyNumUnit">秒</span>
      </span>
    </div>
  )
}
