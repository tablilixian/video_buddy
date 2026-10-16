/**
 * CV-333：最小**内联**标记渲染（反引号 → `<code>`，双星 → `<strong>`）。
 *
 * ## 为什么需要它
 *
 * 契约层（`skill-upload-contract.ts` 的 `advisoryText`、`SkillStatusBadge` 的
 * `detail`）的文案是 **Host 与 UI 共用的一份措辞**：Host 把它写进工具结果/日志，
 * UI 把它显示给用户。它按 markdown 习惯写（`` `name` ``、`**重点**`），
 * 而 **React 的文本节点不渲染 markdown** —— 直接放进去，用户看到的是字面的
 * 反引号与星号（``改 frontmatter 的 `name` 后重传``、`但**不一定会用**`）。
 *
 * 两条现成的替代路都不合适：
 * - 把文案里的标记去掉 → 契约层的 markdown 是给**模型与终端**看的，去掉会让
 *   `advisoryText` 的测试断言与可读性一起退化；
 * - 引一个 markdown 库 → 为了两个标记引依赖，还平白多出一片 `dangerouslySetInnerHTML`
 *   的 XSS 面。
 *
 * ## 范围（故意很窄）
 *
 * 只认这两个**行内**标记，且**不支持**标题 / 列表 / 链接 / 图片 / 嵌套。
 * 不认识的一律按纯文本原样输出 —— 渲染器永远不会把用户内容变成 HTML。
 */
import { Fragment } from 'react'
import type { ReactElement } from 'react'

/** 拆分用：捕获组让 `split` 保留分隔符本身。 */
const TOKEN = /(`[^`\n]+`|\*\*[^*\n]+\*\*)/u

/** 替换用：`replaceAll` 要求正则带 `g`，单独一份免得调用点各自加旗标。 */
const TOKEN_GLOBAL = /(`[^`\n]+`|\*\*[^*\n]+\*\*)/gu

/**
 * 把标记还原成纯文本（用于**放不下 JSX 的地方**：`title=` 提示、`window.confirm`）。
 *
 * 属性值与弹窗文案都只接受字符串，标记在那里不会渲染、只会以字面量出现。
 */
export function plainText(text: string): string {
  return text.replace(TOKEN_GLOBAL, (token) =>
    (token.startsWith('`') ? token.slice(1, -1) : token.slice(2, -2)))
}

/** 内联标记渲染：`{ text }` 里的反引号与双星会被渲染成 `<code>` / `<strong>`。 */
export function RichText(props: { readonly text: string }): ReactElement {
  const parts = props.text.split(TOKEN)
  return (
    <>
      {parts.map((part, index) => {
        if (part.length > 2 && part.startsWith('`') && part.endsWith('`')) {
          return <code key={index}>{part.slice(1, -1)}</code>
        }
        if (part.length > 4 && part.startsWith('**') && part.endsWith('**')) {
          return <strong key={index}>{part.slice(2, -2)}</strong>
        }
        // 用 Fragment 而不是裸字符串：`map` 的每一项都需要 key。
        return <Fragment key={index}>{part}</Fragment>
      })}
    </>
  )
}
