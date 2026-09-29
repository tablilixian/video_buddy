/**
 * REQ-005 / CV-256：首页对话式创建的**自动命名**纯函数（方案 5.2）。
 *
 * 放在 `src/` 根而不是 `src/client/` —— DEV-WORKFLOW 的硬约束：Host 的 tsconfig
 * 排除 `client/` 目录，纯函数写进 client 就测不到（`tests/project-naming.test.mjs`
 * 直连 `lib/project-naming.js`）。两侧都不持有状态，只吃字符串吐字符串。
 *
 * ## 为什么命名权在客户端（而不是 Host 加一个「自动命名模式」）
 *
 * store 里已有全量 `projects`，建项目前就能把摘要跑成不撞名的名字；而 Host 侧重名
 * 校验（`projects.ts` 的 toLowerCase 比对）保持不变、继续当最后防线 —— 改 Host 契约
 * 会让「重名」语义从显式变隐式，收益不成比例（方案 5.2 的「不采用的替代」）。
 */

/** 兜底项目名（摘要清洗后为空时）。E1：输入不可见字符也要能开一个项目出来。 */
export const UNTITLED_PROJECT_NAME = '未命名项目'

/**
 * 摘要长度上限：取前 20 个**码点**（不是 UTF-16 码元 —— 按码元切会把 emoji /
 * 生僻字切成半个孤 surrogate，落进项目名就是一串乱码），给重名后缀留出
 * `validateProjectName` 的 80 字符余量（20 码点的最坏情况也远未触顶）。
 */
const SUMMARY_LENGTH = 20

/**
 * `validateProjectName` 的黑名单（`projects.ts:94`）：C0/C1 控制字符与路径分隔符。
 * 用 `new RegExp` 而不是字面量正则：控制字符的转义写进源码容易被编辑器/传输层吃掉，
 * 字符串形态一眼可读、也更好在测试里对拍。
 */
const INVALID_NAME_CHARS = new RegExp('[\\u0000-\\u001f\\u007f/\\\\]', 'gu')

/** 折叠空白：换行 / 制表 / 连续空格 → 单空格（项目名是单行，不能带结构）。 */
const COLLAPSE_WHITESPACE = /\s+/gu

/**
 * 从一句创意生成候选项目名：折叠空白 → 清洗黑名单字符 → 截断 → 空则兜底。
 *
 * 不做语义摘要（不调模型）：首页回车到建项目必须是同步可预期的一步，且「摘要」
 * 就是用户自己刚打的那句话的前 20 个字 —— 比任何自动概括都更贴近他的意图。
 */
export function summarizeName(idea: string): string {
  const cleaned = idea
    .replace(COLLAPSE_WHITESPACE, ' ')
    .replace(INVALID_NAME_CHARS, ' ')
    .trim()
  if (cleaned.length === 0) return UNTITLED_PROJECT_NAME
  return [...cleaned].slice(0, SUMMARY_LENGTH).join('').trim()
}

/**
 * 撞名去重：大小写不敏感比对（对齐 Host `projects.ts` 的 toLowerCase 口径，
 * E10「仅大小写不同也算重名」走的就是这条路），撞了追加序号。
 *
 * 与 `uniqueDirName` 同思路但作用在 name 上。**不设次数上限**：候选项两两不同、
 * 已占用集合有限，鸽笼原理保证循环必然终止 —— 写死 1000 反而要在第 1000 次撞名时
 * 造一个还可能撞的兜底名。
 */
export function dedupeProjectName(name: string, taken: readonly string[]): string {
  const used = new Set(taken.map(entry => entry.toLowerCase()))
  const trimmed = name.trim()
  const base = trimmed.length > 0 ? trimmed : UNTITLED_PROJECT_NAME
  if (!used.has(base.toLowerCase())) return base
  for (let index = 2; ; index += 1) {
    const candidate = `${base} ${index}`
    if (!used.has(candidate.toLowerCase())) return candidate
  }
}
