/**
 * RQ-23（REQ-038）· **多关键帧相机**插值（2D 轻量版，纯函数、零随机源、可单测）。
 *
 * 口径（需求正本 §3 RQ-23 + §5.2 拍板）：
 * - 相邻 key 之间按段内进度 `t` 插值，`t` 先过 `easing`（缺省 easeInOut，与老
 *   `animate` 同缺省）⇒「逐关键帧段内线性 + 段间 easing」；
 * - 每个字段独立 lerp；key 里缺省的字段按**静态缺省**补全后再插值
 *   （x/y=0、zoom=1、rot=0、persp=800）—— 半声明 key 不会把字段插成 NaN；
 * - 首 key 之前 / 末 key 之后**夹取**（不外推）；
 * - `x`/`y` 是设计 px（1080 基准）—— 渲染层负责 `scaleDesignPx` 换算，本层只算数值。
 *
 * 确定性：输入相同 → 输出逐帧相同（REQ-038 §8 纪律 8；验收判据 2「插值可复现」）。
 */
import type { CameraKey, CameraMotion } from './manifest.js'
import { DEFAULT_ANIMATE_EASING, easingFunctionFor } from './timing.js'

/** 相机在某帧的完整状态（所有字段已补全缺省，渲染层直接贴样式）。 */
export interface CameraState {
  x: number
  y: number
  zoom: number
  rotX: number
  rotY: number
  rotZ: number
  persp: number
}

export const CAMERA_DEFAULTS: Readonly<CameraState> = Object.freeze({
  x: 0,
  y: 0,
  zoom: 1,
  rotX: 0,
  rotY: 0,
  rotZ: 0,
  persp: 800,
})

/** key → 完整状态（缺省字段补静态缺省）。 */
function normalizeKey(key: CameraKey): CameraState {
  return {
    x: key.x ?? CAMERA_DEFAULTS.x,
    y: key.y ?? CAMERA_DEFAULTS.y,
    zoom: key.zoom ?? CAMERA_DEFAULTS.zoom,
    rotX: key.rotX ?? CAMERA_DEFAULTS.rotX,
    rotY: key.rotY ?? CAMERA_DEFAULTS.rotY,
    rotZ: key.rotZ ?? CAMERA_DEFAULTS.rotZ,
    persp: key.persp ?? CAMERA_DEFAULTS.persp,
  }
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

/**
 * 相机状态求值（纯函数）。
 *
 * `keys` 为空返回静态缺省；单 key 返回该 key（补全后）；多 key 按帧插值。
 * frame 轴乱序时**按 frame 升序排序后求值**（校验层已拒非递增 —— 这里是渲染层的
 * 确定性兜底，不抛错把整片炸黑：D-15「渲染期 throw 的代价远大于少一个效果」同款取舍）。
 */
export function cameraStateAt(camera: CameraMotion | undefined, localFrame: number): CameraState {
  if (camera === undefined || !Array.isArray(camera.keys) || camera.keys.length === 0) {
    return { ...CAMERA_DEFAULTS }
  }
  const keys = [...camera.keys].sort((a, b) => a.frame - b.frame)
  const first = normalizeKey(keys[0] as CameraKey)
  if (keys.length === 1) return first
  const lastFrame = keys[keys.length - 1]?.frame ?? 0
  const firstFrame = keys[0]?.frame ?? 0
  if (localFrame <= firstFrame) return first
  if (localFrame >= lastFrame) return normalizeKey(keys[keys.length - 1] as CameraKey)
  // 找到 localFrame 所在段：keys[i].frame <= local < keys[i+1].frame。
  let index = 0
  for (let i = 0; i < keys.length - 1; i += 1) {
    const frameAt = keys[i]?.frame ?? 0
    const frameNext = keys[i + 1]?.frame ?? 0
    if (localFrame >= frameAt && localFrame < frameNext) {
      index = i
      break
    }
  }
  const a = normalizeKey(keys[index] as CameraKey)
  const b = normalizeKey(keys[index + 1] as CameraKey)
  const span = (keys[index + 1]?.frame ?? 0) - (keys[index]?.frame ?? 0)
  const t = span > 0 ? (localFrame - (keys[index]?.frame ?? 0)) / span : 0
  const ease = easingFunctionFor(camera.easing ?? DEFAULT_ANIMATE_EASING, undefined)
  const e = ease(Math.min(1, Math.max(0, t)))
  return {
    x: lerp(a.x, b.x, e),
    y: lerp(a.y, b.y, e),
    zoom: lerp(a.zoom, b.zoom, e),
    rotX: lerp(a.rotX, b.rotX, e),
    rotY: lerp(a.rotY, b.rotY, e),
    rotZ: lerp(a.rotZ, b.rotZ, e),
    persp: lerp(a.persp, b.persp, e),
  }
}

/**
 * 相机状态 → CSS transform 串（渲染层唯一拼串点；设计 px 由调用方换算后传入）。
 * `perspective()` 必须在 rotate 之前（先给旋转提供透视深度），translate3d 触发合成层。
 */
export function cameraTransformStyle(state: CameraState): string {
  return [
    `translate3d(${state.x.toFixed(2)}px, ${state.y.toFixed(2)}px, 0)`,
    `perspective(${state.persp.toFixed(1)}px)`,
    `rotateX(${state.rotX.toFixed(2)}deg)`,
    `rotateY(${state.rotY.toFixed(2)}deg)`,
    `rotateZ(${state.rotZ.toFixed(2)}deg)`,
    `scale(${state.zoom.toFixed(4)})`,
  ].join(' ')
}

/** RQ-23 校验（`validateManifest` 的 image case 调用）：keys 形状 + 取值域 + 递增。 */
export function validateCameraMotion(
  camera: unknown,
  at: string,
  errors: string[],
): void {
  if (camera === undefined) return
  if (typeof camera !== 'object' || camera === null || !Array.isArray((camera as CameraMotion).keys)) {
    errors.push(`${at}.camera 必须是对象且带 keys 数组（如 {"keys":[{"frame":0,"zoom":1},{"frame":120,"zoom":1.35}]}）`)
    return
  }
  const { keys } = camera as CameraMotion
  if (keys.length === 0 || keys.length > 64) {
    errors.push(`${at}.camera.keys 必须是 1–64 个关键帧`)
    return
  }
  let prevFrame = -1
  keys.forEach((key, index) => {
    const keyAt = `${at}.camera.keys[${index}]`
    if (typeof key !== 'object' || key === null || typeof key.frame !== 'number' || !Number.isInteger(key.frame) || key.frame < 0) {
      errors.push(`${keyAt}.frame 必须是 >= 0 的整数（轨内本地帧）`)
      return
    }
    if (key.frame <= prevFrame) {
      errors.push(`${keyAt}.frame 必须严格递增（上一帧 ${prevFrame}）`)
    }
    prevFrame = key.frame
    for (const field of ['x', 'y', 'rotX', 'rotY', 'rotZ'] as const) {
      const value = key[field]
      if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 5000)) {
        errors.push(`${keyAt}.${field} 必须是 |值| ≤ 5000 的有限数`)
      }
    }
    if (key.zoom !== undefined && (typeof key.zoom !== 'number' || !Number.isFinite(key.zoom) || key.zoom < 0.1 || key.zoom > 10)) {
      errors.push(`${keyAt}.zoom 必须是 0.1–10 的有限数`)
    }
    if (key.persp !== undefined && (typeof key.persp !== 'number' || !Number.isFinite(key.persp) || key.persp < 100 || key.persp > 10000)) {
      errors.push(`${keyAt}.persp 必须是 100–10000 的有限数（px，CSS perspective 距离）`)
    }
  })
}
