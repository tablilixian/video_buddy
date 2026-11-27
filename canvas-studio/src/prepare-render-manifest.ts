/**
 * 渲染前 manifest 变换管线的**唯一实现点**（2026-11-27 审查 P1-2）。
 *
 * 为什么抽出来：`render_composition` 与 `rerender_segment` 必须对「合并了 override 的
 * manifest」做**同一套**变换（组展开 → 校验 → 素材物化 → 素材核对 → alpha 标记 →
 * video 时长真值回核 → 复校），段缓存的钥匙是变换后轨的 hash。此前单段重渲把 raw
 * override 轨直接并回**已变换**的快照、跳过全部变换 ⇒ 同一条手工轨算出两个 hash
 * （两路径永不互相命中，还会互删对方的缓存条目）；素材类手工轨的本地路径没物化，
 * 单段重渲渲出缺图的段。纯 shape/orbit 轨（无 src）侥幸不受影响 —— 真机只验过这类。
 *
 * 幂等性前提（对**已变换**的快照再跑一遍必须无副作用）：
 * - `expandGroups`：组已展开、无 groups 字段 ⇒ 原样；
 * - `materializeManifestSources`：同源 URL 原样放行（`isSameOrigin` 短路）；
 * - alpha 标记：`hasAlpha === true` 的轨原样返回；
 * - `reconcileManifestVideoDurations`：真值没变 ⇒ 时长不再改写。
 *
 * ⚠️ **尾部截断检测（CV-360）不在这条管线里** —— 它是宿主入口专属的预检（拦
 * 「声明 60s、轨道只排到 21s」的半截 manifest），而真值校正会**合法缩短**轨道，
 * 在校正后跑它必然假红（`host-tools.ts` 原注释已声明此边界）。
 */
import { readdirSync } from 'node:fs'
import { checkManifestAssets } from './remotion/asset-check.js'
import { mapTracksDeep } from './remotion/group-children.js'
import { expandGroups } from './remotion/groups.js'
import { validateManifest, type CompositionManifest } from './remotion/manifest.js'
import { materializeManifestSources } from './remotion/materialize.js'
import { reconcileManifestVideoDurations } from './remotion/timing.js'
import { throwError } from './error-system.js'

/** 素材引用的同源 URL 前缀（拒收文案里的可执行指引）。 */
const ASSET_URL_HINT = '/canvas-studio/assets/'

/**
 * REQ-035 F-08：素材缺失时的"相近文件名"提示。
 *
 * 为什么需要：`watch-hero.png` 被 GC 删掉后，同目录还有 `watch-720.png` 和原始出图，
 * 但报错只说"缺失"，agent 只能重新裁一遍（事故里重裁后又撞同一堵墙）。
 * 这里按词干做子串互含匹配，把候选列出来 —— 只提示，不改语义。
 */
export function nearMissAssetHint(assetsDir: string, missing: readonly string[]): string {
  let names: string[]
  try {
    names = readdirSync(assetsDir)
  } catch {
    return ''
  }
  const hints: string[] = []
  for (const entry of missing) {
    const base = entry.split('→').pop()?.trim().split('/').pop() ?? ''
    if (base.length === 0) continue
    const stem = base.replace(/\.[^.]+$/u, '').toLowerCase()
    const probe = stem.slice(0, 8)
    const near = names.filter((name) => {
      if (name === base) return false
      const other = name.replace(/\.[^.]+$/u, '').toLowerCase()
      return other.includes(probe) || stem.includes(other)
    })
    if (near.length > 0) hints.push(`${base} → 同目录相近文件：${near.slice(0, 3).join(' / ')}`)
  }
  return hints.length === 0 ? '' : `提示：${hints.join('；')}。若目标就是其中某张，把 manifest 的 src 改成它即可。`
}

export interface PrepareRenderManifestResult {
  /** 变换后的 manifest（组展开 + 素材物化 + alpha 标记 + video 时长真值校正）。 */
  manifest: CompositionManifest
  /** 首次校验（组展开后）的 warnings —— 体检文案在这层并进来。 */
  validationWarnings: string[]
  /** 真值校正后复校的 warnings（调用方按「不与首次重复」过滤后展示）。 */
  revalidationWarnings: string[]
  /** ffprobe 真值校正过的轨道说明（复校失败文案里带上）。 */
  reconciledWarnings: string[]
  /** video 轨真实时长（`buildShotRenderDeps` 的 realDurations 入参）。 */
  realDurations: Record<string, number>
  /** 素材真实像素（O-12 上采样检测的 `checkManifestResolution` 入参）。 */
  realSizes: Record<string, { width: number; height: number }>
}

/**
 * 合并 override 之后、渲染之前，把 manifest 走完全部变换。失败抛 `CS-USER-ERR`
 * （文案带可执行下一步），零副作用 —— 拒收发生在任何落盘/渲染之前。
 *
 * @param input.manifest - **已并入 override** 的 manifest（`mergeProjectOverrides` 的产物）。
 */
export async function prepareRenderManifest(input: {
  manifest: CompositionManifest
  assetsDir: string
  projectId: string
}): Promise<PrepareRenderManifestResult> {
  // 1) 分组展开（2026-10-25 · shotcraft P1）：`groups` 是**写作者糖** —— 组声明一个
  //    绝对矩形，组内轨道的 `box` 用组内百分比，在这里展开成画布绝对坐标。渲染器 /
  //    校验器 / 客户端一律看不到组，否则「组内 x」与「画布 x」变成两套打架的坐标体系。
  const expanded = expandGroups(input.manifest)
  // 分组有降级（未知组名 / 组内轨缺 box / 组 id 重复）时**直接拒收**而不是静默按原样渲：
  // 静默降级的结果是「画面位置对不上但没人报错」，比一次明确的拒收难查得多。
  if (expanded.warnings.length > 0) {
    throwError('CS-USER-ERR', {
      message: `分组声明有问题，已拒收（避免静默降级成错位的画面）：${expanded.warnings.join('；')}。`
        + 'groups 里每条需要 {id, box:{x,y,w,h}}；成员轨用 `group` 引用组 id 且必须自带 `box`（组内 0–100 百分比）。',
    })
  }
  const validation = validateManifest(expanded.manifest)
  if (!validation.ok) {
    throwError('CS-USER-ERR', { message: `manifest 校验失败：${validation.errors.join('；')}` })
  }
  // 2) 素材物化（R3）：域内本地绝对路径 → 同源 URL；域外路径**显式拒收**。
  //    渲染发生在渲染进程的**浏览器环境**，域外绝对路径会被解析成 `http://<origin>/…`
  //    而必然 404，且失败只发生在渲染进程、宿主无感 ⇒ 不能放行。
  const materialized = materializeManifestSources(expanded.manifest, input.assetsDir, input.projectId)
  if (materialized.rejected.length > 0) {
    throwError('CS-USER-ERR', {
      message: `成片素材引用不可用（${materialized.rejected.join('；')}）。`
        + `素材须用 ${ASSET_URL_HINT} 开头的画布资产 URL，或位于本项目资产目录内的绝对路径；`
        + '其它位置的文件请先导入本项目再渲染。',
    })
  }
  const source = materialized.manifest
  // 3) 素材核对（宿主侧，无浏览器，§8.2）+ 按真值校正 video 轨时长（§10.4）。
  //    缺失素材**硬失败**（Z-8）：宿主侧已能判定，放行只会得到一条无上下文的渲染失败。
  const pre = await checkManifestAssets(source, input.assetsDir)
  if (pre.missing.length > 0) {
    throwError('CS-USER-ERR', {
      message: `成片素材缺失或不可用（${pre.missing.join('；')}），请补齐素材后再渲染。`
        + nearMissAssetHint(input.assetsDir, pre.missing),
    })
  }
  // 4) 透明素材标记：宿主探到 alpha 通道的 image 轨写 `hasAlpha: true`，渲染组件据此
  //    跳过媒体层垫底色（甜品复刻复盘：硬编码 `#05080f` 是「透明图带深底」根因）。
  //    只在有 alpha 时改写 —— 无 alpha 的轨保持原样；已标记的轨原样返回（幂等）。
  //    S1-B：容器子轨的 image 同样要标记（mapTracksDeep 深映射）。
  const alphaMarkedTracks = mapTracksDeep(source.tracks, (track) => {
    if (track.type !== 'image' || pre.alphaSources[track.src] !== true) return track
    if (track.hasAlpha === true) return track
    return { ...track, hasAlpha: true }
  })
  const reconciled = reconcileManifestVideoDurations(
    { ...source, tracks: alphaMarkedTracks } as CompositionManifest,
    pre.realDurations,
    source.meta.fps,
  )
  const manifest: CompositionManifest = { ...source, tracks: reconciled.tracks }
  // 5) **校正后复校**（2026-10-16 补）：`reconcileManifestVideoDurations` 会按 ffprobe
  //    真值改写 video 轨的 `durationInFrames` —— 原本合法的排布会失效（轨缩短后相邻
  //    两轨不再重叠 = 转场无意义 = error）。此前无人拦就直接进渲染：模型声明 125 帧、
  //    真值 3.0s → 校正 90 帧 → 转场两侧缺空，成片过渡静默变成硬切。
  const revalidation = validateManifest(manifest)
  if (!revalidation.ok) {
    throwError('CS-USER-ERR', {
      message: `manifest 按素材真值校正时长后不再自洽：${revalidation.errors.join('；')}。`
        + (reconciled.warnings.length > 0 ? `已校正的轨道：${reconciled.warnings.join('；')}。` : '')
        + '请按真实时长重排相邻轨与转场窗口后重试（不要原样重试）。',
    })
  }
  return {
    manifest,
    validationWarnings: validation.warnings,
    revalidationWarnings: revalidation.warnings,
    reconciledWarnings: reconciled.warnings,
    realDurations: pre.realDurations,
    realSizes: pre.realSizes,
  }
}
