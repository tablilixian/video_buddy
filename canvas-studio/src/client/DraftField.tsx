/**
 * UI-04：文本类配置的「失焦 / 回车提交」输入框。
 *
 * 为什么不能即键即存：`dramaApiBase` / `exportDir` / `assetDir` 都是**强语义**字段 ——
 * 资产库位置改一个字符就是换库，API 基址敲到一半就是坏地址。原来每次 `onChange`
 * 都 `scope.set`，用户把 `/Users/wl/a` 改成 `/Users/wl/a2` 时，敲到 `a1` 的瞬间
 * 配置已经生效，期间任何生成调用都拿到半输入态。
 *
 * 组件内部持有草稿，外部值变化（例如目录选择器回填）时同步；只在失焦或回车时提交。
 * 数字类输入不受影响 —— 它们本来就即时生效，走 UI-03 的钳制路径。
 */
import { useEffect, useState, type ChangeEvent, type KeyboardEvent, type ReactElement } from 'react'

export interface DraftFieldProps {
  /** 已落库的真值。 */
  readonly value: string
  /** 失焦 / 回车时提交草稿；相等则不写，避免无意义的落盘。 */
  readonly onCommit: (next: string) => void
  readonly placeholder?: string | undefined
  readonly className?: string | undefined
}

export function DraftField(props: DraftFieldProps): ReactElement {
  const { value, onCommit, placeholder, className = 'csFieldInput' } = props
  const [draft, setDraft] = useState(value)

  // 外部值变化（目录选择器回填、其它分区同步写）时把草稿拉回真值。
  useEffect(() => { setDraft(value) }, [value])

  const commit = (): void => {
    if (draft !== value) onCommit(draft)
  }

  return (
    <input
      className={className}
      value={draft}
      placeholder={placeholder}
      spellCheck={false}
      onChange={(event: ChangeEvent<HTMLInputElement>) => { setDraft(event.target.value) }}
      onBlur={commit}
      onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Enter') event.currentTarget.blur()
      }}
    />
  )
}
