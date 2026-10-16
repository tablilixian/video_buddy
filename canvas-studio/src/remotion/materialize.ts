/**
 * REQ-034（Remotion 集成）· R3 素材物化（宿主侧纯函数，**无浏览器**）。
 *
 * ## 为什么需要它（缺口溯源）
 * route B（CSR）的渲染发生在 Electron **渲染进程的浏览器环境**：`components/VideoClip.tsx`
 * 把 `track.src` 直接交给 `@remotion/media` 的 `<Video>`，由浏览器**自己 fetch**。于是
 * `src` 若填本地绝对路径（如 `/Users/me/x.mp4`），浏览器会把它解析成
 * `http://<origin>/Users/me/x.mp4` ⇒ **必然 404**，且失败只发生在渲染进程、宿主完全无感。
 *
 * 而「放行 + 不核对 + 渲染 404」此前是三重叠加的：
 * 1. 契约层 `isAllowedManifestAssetRef`（`manifest.ts`）只判形状（以 `/` 开头即放行）；
 * 2. `checkManifestAssets`（`asset-check.ts`）对非 `/canvas-studio/assets/` 前缀的引用
 *    **直接 `continue`** —— 不核对、不告警；
 * 3. 渲染期静默 404（正是 `references/fonts.md` 自己警告过的「最难查的一类」）。
 *
 * 本模块补上中间那一环：把**本项目资产目录内**的本地绝对路径物化为同源 URL
 * （渲染进程可直接 fetch）；目录外的一律**拒收**，由调用方硬失败 —— 把静默失败换成
 * 带中文原因的显式失败。
 *
 * ## 边界（刻意不做）
 * **不拷贝文件**：域外路径只报错、不搬进资产目录。搬文件是有副作用的能力扩张
 * （命名冲突 / 体积 / 幂等 / 清理），需单独决策，不在本批范围。
 */

import { basename, resolve, sep } from 'node:path'
import { ASSET_URL_PREFIX, type CompositionManifest } from './manifest.js'

/** 物化结论。 */
export interface MaterializeResult {
  manifest: CompositionManifest
  /** 被物化（本地绝对路径 → 同源 URL）的引用条数。 */
  remapped: number
  /**
   * 拒收的引用（形如 `<字段> → <原值>`）。非空 ⇒ 调用方应**硬失败**，
   * 不得放行到渲染（否则就是静默 404）。
   */
  rejected: string[]
}

/** 已是同源资产 URL（宿主与渲染进程都能解析）。 */
function isSameOrigin(ref: string): boolean {
  return ref.startsWith(ASSET_URL_PREFIX)
}

/** 本地绝对路径形态（与 `isAllowedManifestAssetRef` 同口径：排除协议相对 `//host`）。 */
function isAbsolutePath(ref: string): boolean {
  return ref.startsWith('/') && !ref.startsWith('//')
}

/**
 * 把 Manifest 里的素材引用统一物化为同源资产 URL。
 *
 * 覆盖三类字段（三处都是「同源 URL 或本地绝对路径」的同一条约束）：
 * - `tracks[].src`（`video` / `image` 轨）；
 * - `audio.bgmUrl` / `audio.voiceOverUrl`；
 * - `global.fonts[].src`（动态字体）。
 *
 * @param manifest - 已通过 `validateManifest` 的 Manifest。
 * @param assetsDir - 本项目资产目录（`registry.assetsDir(projectId)`）。
 * @param projectId - 目标项目 id（物化后的 URL 需要它）。
 * @returns 物化后的 Manifest + 计数 + 拒收清单。**无改动时原样返回入参对象**（零拷贝）。
 */
export function materializeManifestSources(
  manifest: CompositionManifest,
  assetsDir: string,
  projectId: string,
): MaterializeResult {
  // `resolve` 同时完成两件事：相对转绝对、把 `..` 归一化 —— 后者天然挡掉
  // `/assets/<p>/../../etc/passwd` 这类穿越（归一化后必然落在 root 之外）。
  const root = resolve(assetsDir)
  const rejected: string[] = []
  let remapped = 0

  /** 单条引用 → 可渲染 URL：同源原样；域内路径转 URL；域外记拒收（原值返回）。 */
  const toUrl = (ref: string, label: string): string => {
    if (isSameOrigin(ref)) return ref
    if (!isAbsolutePath(ref)) return ref
    const abs = resolve(ref)
    // 只接受**资产目录之下**的路径（前缀比较必须带 `sep`：`<root>-evil` 是同前缀兄弟
    // 目录、不是子路径）。目录自身（`abs === root`）不是素材文件，一并拒收。
    if (abs.startsWith(root + sep)) {
      remapped += 1
      return `${ASSET_URL_PREFIX}${projectId}/${basename(abs)}`
    }
    rejected.push(`${label} → ${ref}`)
    return ref
  }

  const tracks = manifest.tracks.map((track) => {
    if (track.type !== 'video' && track.type !== 'image') return track
    const url = toUrl(track.src, `tracks[${track.id}].src`)
    return url === track.src ? track : { ...track, src: url }
  })

  const audio = manifest.audio === undefined
    ? undefined
    : (() => {
        const next = { ...manifest.audio }
        if (typeof next.bgmUrl === 'string') next.bgmUrl = toUrl(next.bgmUrl, 'audio.bgmUrl')
        if (typeof next.voiceOverUrl === 'string') next.voiceOverUrl = toUrl(next.voiceOverUrl, 'audio.voiceOverUrl')
        return next
      })()

  const global = manifest.global === undefined
    ? undefined
    : (() => {
        const next = { ...manifest.global }
        if (Array.isArray(next.fonts)) {
          next.fonts = next.fonts.map((font, index) => {
            if (typeof font.src !== 'string') return font
            const url = toUrl(font.src, `global.fonts[${index}].src`)
            return url === font.src ? font : { ...font, src: url }
          })
        }
        return next
      })()

  // 全部已是同源 URL ⇒ 无需重建对象（保持引用，零副作用）。
  if (remapped === 0 && rejected.length === 0) {
    return { manifest, remapped: 0, rejected: [] }
  }

  return {
    manifest: {
      ...manifest,
      tracks,
      ...(audio !== undefined ? { audio } : {}),
      ...(global !== undefined ? { global } : {}),
    },
    remapped,
    rejected,
  }
}
