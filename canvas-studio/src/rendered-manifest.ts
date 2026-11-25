/**
 * REQ-041 第 2 批（2026-11-25）· **渲后 manifest 落盘**（`build/manifest.json`）。
 *
 * ## 解决什么
 *
 * 段清单有两条读法：
 * ① `deliver/card.json` 的段指针（只有 standard/high 才写卡，draft 没有）；
 * ② 派生：`build/spec.json` + **`build/manifest.json`**（`segment-media.ts`
 *    的 `derivedRowsFromBuild`）。
 *
 * `build/manifest.json` 此前只在 `scaffold_manifest` / `patch_spec_section(writeTo)`
 * 时写，而**实际渲染的 manifest 是宿主 reconcile 之后的**：`normalizeManifestTiming`
 * 解析 `startAfter`、`expandGroups` 把组内百分比摊成画布坐标、`materializeManifestSources`
 * 把域内绝对路径换成同源 URL、alpha 标记给透明图轨写 `hasAlpha`、
 * `reconcileManifestVideoDurations` 按 ffprobe 真值改写 video 轨 `durationInFrames`。
 * 模型声明 125 帧、真值 3.0s ⇒ 校正成 90 帧后**切段边界整体前移**：派生读盘按旧帧窗
 * 算段，渲染按新帧窗出片 ⇒ 段行与真实产物错位（表现是「卡上这一段其实是隔壁那一段
 * 的画面」）。
 *
 * 所以渲染成功后宿主落盘一次「**渲了什么**」—— 派生读法一行不改，事实源从此一致。
 * 副作用如实记账：落盘的是**展开后**的 manifest，`groups` 这层写作者糖不会保留
 * （它本来就是「写作者糖」，渲染器/校验器/客户端都不认它）。
 *
 * ## 纪律
 *
 * - **只在渲染成功后写**：渲挂了的 reconciliation 结果不该覆盖用户手里的 manifest；
 * - **不抛**：写盘失败只回一句 note（成片已经好了，段清单退化为「少了 draft 段行」）；
 * - 不写画布、不动 `canvas.json`（D15）。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { CompositionManifest } from './remotion/manifest.js'

/** `build/manifest.json` 的绝对路径（派生读盘与宿主落盘必须同一条路径）。 */
export function renderedManifestPath(projectDir: string): string {
  return join(projectDir, 'build', 'manifest.json')
}

/**
 * 把**实际渲出去的那份** manifest 落盘。返回 `note` 表示没写成（原因），调用方
 * 把它并进回执，不要抛。
 */
export function writeRenderedManifest(input: {
  projectDir: string
  manifest: CompositionManifest
}): { path: string; note?: string } {
  const path = renderedManifestPath(input.projectDir)
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, `${JSON.stringify(input.manifest, null, 2)}\n`, 'utf8')
    return { path }
  } catch (cause) {
    return { path, note: `渲后 manifest 落盘失败（${cause instanceof Error ? cause.message : String(cause)}）：段清单将退回上一版帧窗` }
  }
}
