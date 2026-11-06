/**
 * B-4（CV-440，P-01 / P-17）数据溯源契约 —— 纯函数件。
 *
 * 事故（RUN-2 折线混基准）：折线前 8 点用 1951–1980 口径、后 3 点换 1850–1900，
 * 契约层没有「出处 / 基准」概念 ⇒ 混口径数字合法通过，画面把 30 年升温画成
 * 1.10 ℃（同口径真值约 0.83 ℃）。且 storyboard 里该事实自己写着
 * `status:'pending'`，与成片 manifest 之间**没有任何桥**。
 *
 * 本模块两件事（均为观察期 warning，P5 拍板本轮不升 error）：
 * ① `looksLikeNumericFact` —— dataCard 的「数值型事实」触发口径（收窄版）：
 *   温标 / 量级 / 百分比等可溯源数字才触发；BPM / 时长 / 节奏 / 计数 / 日期等
 *   元数据豁免（P-01 复核实测：宽口径会把 BPM 类全部打红，诱导 agent 编造出处
 *   糊弄闸门 —— 恰是本条要治的病）。
 * ② `pendingFactWarning` —— storyboard `facts[].status` 与成片之间的宿主桥：
 *   渲染回执点名 pending 事实（pending 事实不得进成片）。
 */
import { readFileSync } from 'node:fs'

/**
 * dataCard `v` 是否像「数值型事实」。触发 = 含数字且带可溯源量纲标记，
 * 或单数字 ± 前后缀；豁免 = 速率 / 时长 / 计数 / 日期等元数据单位。
 */
export function looksLikeNumericFact(v: string): boolean {
  if (!/\d/.test(v)) return false
  // 元数据豁免：BPM / 赫兹 / 帧率 / 时长（h·min·s·秒·分·小时）/ 日期 / 量词计数。
  // 「分」要看上下文（分钟 ≠ 百分之），所以不单列「分」，只豁免「分钟」。
  // 注意：\b 是 ASCII 词界，对中文后缀（分钟 / 秒）永不匹配 —— CJK 分支不带 \b。
  if (/\d\s*(bpm|hz|khz|fps|min|sec|ms|h)(?![a-z])|分钟|秒|帧|小时/i.test(v)) return false
  if (/\d\s*(个|项|条|步|页|张|镜|次|人份|集|季|周|天|日|月|年)/.test(v)) return false
  if (/(^|\s)\d{3,4}\s*[-–—/~]\s*\d{3,4}(\s|$)/.test(v)) return false // 1951–1980 年份区间
  // 可溯源量纲标记：温标 / 百分比 / 千分比 / 量级 / 货币 / 长度质量。
  if (/[℃°]|%|‰|亿|万|元|[$€£¥]|吨|千米|公里|km|kg|米|升|ml|dB|LUFS/i.test(v)) return true
  // 单数字 ± 前后缀（16% / ¥3.2 / 45.1亿 之外的裸数字事实，如「1.28」）。
  return /^[^0-9]*\d+(?:\.\d+)?[^0-9]*$/.test(v)
}

/**
 * storyboard `facts[]` → 一条 pending 提醒（纯函数；facts 形状容错，坏数据返回空）。
 * 溯源字段（claim / source / status）与成片的桥 —— 观察期只点名不阻断。
 */
export function pendingFactWarning(facts: unknown): string {
  if (!Array.isArray(facts)) return ''
  const pending = facts.filter(
    (f): f is { claim?: unknown } => typeof f === 'object' && f !== null && (f as { status?: unknown }).status === 'pending',
  )
  if (pending.length === 0) return ''
  const claims = pending
    .map((f) => String((f as { claim?: unknown }).claim ?? '').trim())
    .filter((c) => c.length > 0)
    .slice(0, 2)
  const preview = claims.length > 0 ? `：${claims.join('；')}${pending.length > 2 ? ' 等' : ''}` : ''
  return `数据溯源：事实表有 ${pending.length} 条 pending（未核源）事实${preview}。pending 事实不得进成片（P-17）——若本片图表 / 数据卡引用了这些数字，先核源升级 verified 并重跑 facts-builder 落盘，或补 dataSource:'observed' 说明（B-4 观察期提醒）`
}

/**
 * 读本项目的事实表 pending 事实并出提醒文案（CV-447 P1-D）。
 *
 * 优先读 `build/fact-snapshot.json`（B2 事实快照，agent 用 `facts-builder.mjs` 落盘）；
 * 快照不存在时回落到 storyboard `01_facts`。读不到 / 损坏 ⇒ 空串
 * （事实表是可选前置，没有它不该挡渲染）。
 *
 * 为什么优先快照：真机事故里 agent 口头"已标 verified"但没写任何文件 ⇒ storyboard 仍是
 * pending，交付 lint 连续两次报假警报。快照是**落盘真值**，纪律也写死了状态变更必须重跑
 * `facts-builder`（叙述式更新不算数）。
 */
export function readPendingFactWarning(projectDir: string, storyboardPath: string): string {
  try {
    const snapshot = JSON.parse(readFileSync(`${projectDir}/build/fact-snapshot.json`, 'utf8')) as {
      facts?: unknown
    }
    return pendingFactWarning(snapshot.facts)
  } catch {
    // 快照缺失 / 坏 JSON：回落到 storyboard（老项目路径）。
  }
  try {
    const doc = JSON.parse(readFileSync(storyboardPath, 'utf8')) as {
      sections?: { '01_facts'?: { facts?: unknown } }
    }
    return pendingFactWarning(doc.sections?.['01_facts']?.facts)
  } catch {
    return ''
  }
}
