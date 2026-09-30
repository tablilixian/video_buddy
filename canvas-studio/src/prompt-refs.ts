/**
 * REQ-003 Step 3 / F2-F3：`<Picture N>` 与参考位的一致性。
 *
 * 为什么必须做：`video_composite` 的参考数组**顺序就是**提示词里 `<Picture N>` 的
 * 编号（1=首帧 / 2=首尾帧 / ≥3=多参考），而 H3 IR 预检对编号不连续只 WARN 不阻断
 * （CV-236）。也就是说用户拖动参考图的顺序 = 在改提示词语义 —— UI 不能装不知道：
 * 删/换/重排后要**显式提示**（amber，不阻断生成），并给「同步编号 / 撤销这次改动」。
 *
 * 「同步编号」按出现顺序致密化成 `1..k`，**越界**的夹到 k（k = 当前参考张数）——
 * 夹意味着"指向是猜的"，返回被夹的**处数**（同一编号多处出现按多处计），
 * 调用方必须把处数说给用户，不能静默改语义。
 */

/** 按出现顺序抽出的全部 `<Picture N>` 编号（不去重）。 */
export function pictureNumbersIn(prompt: string): readonly number[] {
  const out: number[] = []
  const re = /<Picture\s+(\d+)>/gi
  let match: RegExpExecArray | null
  while ((match = re.exec(prompt)) !== null) {
    out.push(Number(match[1]))
  }
  return out
}

/**
 * F2：编号与参考张数的失配。
 * `dangling` = 超出参考张数的编号（按出现顺序）；`max` = 最大编号（无编号时 0）。
 */
export function pictureIssues(prompt: string, refCount: number): { dangling: readonly number[]; max: number } {
  const numbers = pictureNumbersIn(prompt)
  return {
    dangling: numbers.filter(number => number > refCount),
    max: numbers.length === 0 ? 0 : Math.max(...numbers),
  }
}

/**
 * F3：按出现顺序把编号致密化为 `1..k`，越界的夹到 k。
 * 只改 `<Picture N>` 标记本身，提示词其余文本逐字节原样（测试有逐字节比对）。
 */
export function rewritePictureNumbers(prompt: string, refCount: number): { text: string; clamped: number } {
  // 去重保序：同一个编号在文本里多处出现时映射到同一个新编号（首现顺序决定位次）。
  const order: number[] = []
  const seen = new Set<number>()
  for (const number of pictureNumbersIn(prompt)) {
    if (!seen.has(number)) {
      seen.add(number)
      order.push(number)
    }
  }
  const map = new Map<number, number>()
  // 夹取判定按**编号**算（want 被压到 k 之下才算猜），计数按**出现处数**算。
  const clampedNumbers = new Set<number>()
  order.forEach((number, index) => {
    const want = index + 1
    const got = refCount > 0 ? Math.min(want, refCount) : want
    if (got !== want) clampedNumbers.add(number)
    map.set(number, got)
  })
  let clamped = 0
  const text = prompt.replace(/<Picture\s+(\d+)>/gi, (_all, digits: string) => {
    const original = Number(digits)
    const target = map.get(original)
    if (target === undefined) return _all
    if (clampedNumbers.has(original)) clamped += 1
    return `<Picture ${target}>`
  })
  return { text, clamped }
}
