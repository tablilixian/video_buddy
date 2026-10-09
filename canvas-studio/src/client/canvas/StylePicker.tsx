import { useEffect, useMemo, useRef, useState } from 'react'
import {
  NO_STYLE_ID,
  STYLE_CATEGORIES,
  stylesInCategory,
  type VisualStyle,
} from '../../visual-styles.js'

/** 「全部」tab 的显示名（demo `STY_CATS` 把 '全部' 置首）。 */
const ALL_CATEGORY = '全部'

/** Props for the style picker popover (CV-288 · REQ-029 §十一). */
export interface StylePickerProps {
  /** 当前选中的风格 id；空串 / undefined = 未选风格。 */
  readonly selectedId: string
  /** 选中即写回（id + 注入文本快照）并收起弹层。传空串 = 选「无风格」。 */
  readonly onSelect: (style: VisualStyle | undefined) => void
  /** 关闭弹层（点空白 / Esc 由外层处理，这里给「×」或切形态用）。 */
  readonly onClose?: () => void
}

/**
 * 风格选择弹层：分类 tab + 色板卡片网格（CV-288 / D3 / D4 / D10）。
 *
 * 形态照 demo `canvas-imagenode-inputbox.html` 的 `.pop-style`：
 * 分类 tab 横向可滚（**真溢出才**加右端渐隐，渐隐写死会把最后一个 tab 淡掉）、
 * 卡片网格纵向可滚、「无风格」卡常驻各分类首位（demo `NONESTY` 口径）。
 *
 * D3 = 纯色板（CSS 渐变），**不预留真图字段**：半吊子的空占位正是 CV-116 那类
 * 「四处必须同改」漂移的形状，真图版另起一轮。
 */
export function StylePicker(props: StylePickerProps) {
  const { selectedId, onSelect, onClose } = props
  const [category, setCategory] = useState<string>(ALL_CATEGORY)
  const tabsRef = useRef<HTMLSpanElement>(null)

  // 分类集合含「全部」置首 —— 与 demo `STY_CATS`（'全部' + 去重后的分类序）同构。
  const tabs = useMemo(() => [ALL_CATEGORY, ...STYLE_CATEGORIES], [])
  const list = useMemo(() => stylesInCategory(category), [category])

  // 右端渐隐**只在真溢出时**加（演示同款判定 `scrollWidth > clientWidth + 1`）：
  // 渐隐写死会把最后一个 tab「题材」淡掉，看上去像被禁用。
  useEffect(() => {
    const el = tabsRef.current
    if (el === null) return
    const sync = (): void => {
      el.classList.toggle('csStyleTabsMask', el.scrollWidth > el.clientWidth + 1)
    }
    sync()
    const ro = new ResizeObserver(sync)
    ro.observe(el)
    return () => { ro.disconnect() }
  }, [tabs])

  return (
    <span className="csChipPop csStylePop" role="group" aria-label="视觉风格">
      <span className="csStyleTabs" role="tablist" ref={tabsRef}>
        {tabs.map(tab => (
          <button
            type="button"
            key={tab}
            role="tab"
            aria-selected={tab === category}
            className={tab === category ? 'csStyleTab csStyleTabOn' : 'csStyleTab'}
            onClick={() => { setCategory(tab) }}
          >
            {tab}
          </button>
        ))}
      </span>

      <span className="csStyleGridWrap">
        <span className="csStyleGrid">
          {/* 无风格卡常驻首位（demo：NONESTY 拼在任何分类列表前）。 */}
          <StyleCard
            name="无风格"
            swatch="linear-gradient(140deg,#2b3340,#1a2028)"
            selected={selectedId === '' || selectedId === NO_STYLE_ID}
            onClick={() => { onSelect(undefined) }}
          />
          {list.map(style => (
            <StyleCard
              key={style.id}
              name={style.name}
              swatch={style.swatch}
              selected={selectedId === style.id}
              onClick={() => { onSelect(style) }}
            />
          ))}
        </span>
      </span>

      <span className="csStyleFoot">
        风格作为提示词前缀注入，可与摄像机设置叠加；不额外计费。
        <span className="csStyleFootDim">风格会影响构图与画面处理方式；项目级一致性由 Look 卡控制。</span>
      </span>
      {onClose !== undefined && (
        <button type="button" className="csStyleClose" aria-label="关闭风格面板" onClick={onClose}>×</button>
      )}
    </span>
  )
}

/** 单张风格卡：色板 + 勾选角标 + 名称（demo `.scard`）。 */
function StyleCard(props: { name: string; swatch: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className={props.selected ? 'csStyleCard csStyleCardOn' : 'csStyleCard'}
      aria-pressed={props.selected}
      onClick={props.onClick}
    >
      <span className="csStyleSwatch" style={{ background: props.swatch }}>
        {props.selected && (
          <svg className="csStyleCheck" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 13l4 4L19 7" />
          </svg>
        )}
      </span>
      <span className="csStyleName">{props.name}</span>
    </button>
  )
}
