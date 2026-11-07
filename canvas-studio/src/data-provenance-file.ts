/**
 * B-4 数据溯源 · **读盘侧**（CV-447 P1-D 从 `data-provenance.ts` 拆出）。
 *
 * ## 为什么拆
 *
 * `data-provenance.ts` 头注释写的是「纯函数件」，P1-D 落码时却往里加了
 * `import { readFileSync } from 'node:fs'`。而那个文件同时被
 * `remotion/manifest-track-validate.ts → manifest.ts` 引用 —— 也就是**渲染侧 bundle**
 * （`scripts/render-forensics/entry.tsx`）必经。结果 webpack 报：
 *
 * ```
 * UnhandledSchemeError: Reading from "node:fs" is not handled by plugins
 * ```
 *
 * ⇒ 取证台 Q1–Q13 全组构建不了（O1 窗口节流实验因此跑不起来）。
 *
 * 分工由此定死：
 * - `data-provenance.ts` —— 纯函数，**零 `node:` 依赖**，渲染侧可达；
 * - 本文件 —— 要读盘，**只许宿主侧**（`host-tools.ts`）引用，别让 `src/remotion/**` 拉到。
 */
import { readFileSync } from 'node:fs'
import { pendingFactWarning } from './data-provenance.js'

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
