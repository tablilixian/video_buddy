/**
 * 视觉变换与帧级视觉状态（`Transform` / `VisualState`）—— P3 外提件的第二批。
 *
 * 为什么单独一个文件：`manifest.ts` 在 file-size-guard 的**行数棘轮**上（只准减不准增），
 * 2026-11-11 加真 3D（`rotateX / rotateY / z / perspective`）时那四个字段的注释本身就值
 * 30 行。与其把文档砍掉，不如把两个类型整体外提 —— 这一批顺带让 `manifest.ts` 净减 64 行，
 * 后续再加视觉维度也不必动棘轮。
 *
 * 依赖方向：本模块**不 import 任何东西**，`manifest.ts` 反向 re-export。单向无环。
 */

/**
 * 静态变换（百分比坐标系，相对画布）。
 *
 * 帧级插值由 `timing.ts` 的纯函数 `animateStateAt` 负责 —— 本模块零 Remotion 依赖，
 * Host 侧要能算、`node --test` 要能覆盖。（CV-334 之前 `manifest.ts` 此处注释写着
 * "组件用 `interpolate` 对其做帧级动画"，而 `interpolate` 在全仓只出现于那行注释、
 * 从未被 import —— 注释承诺的能力从没兑现过。现在兑现了，实现落在纯函数层。）
 */
export interface Transform {
  /** 水平中心位置（0–100，默认 50 居中）。 */
  x?: number
  /** 垂直中心位置（0–100，默认 50 居中）。 */
  y?: number
  /** 缩放倍数，默认 1（必须 > 0）。 */
  scale?: number
  /** 旋转角度（度），默认 0。 */
  rotation?: number
  /**
   * 绕水平轴俯仰（度），正数 = 上沿向后倒。默认 0。
   *
   * ⚠️ 与 `rotation` 不是一回事：这个是**真 3D**。一旦非 0，`layerTransform` 就带上
   * `perspective()`，渲染器随之把整棵子树拽进 WebGL 预合成（能力基准 #12 实测）。
   * 代价可量化：#12 里 0 个 3D 层 ≈14ms/帧，7 个 ≈77ms/帧（含 40 层卡墙的极端格）。
   */
  rotateX?: number
  /** 绕垂直轴偏转（度），负值 = 右侧靠近观察者。默认 0。真 3D，同上。 */
  rotateY?: number
  /** 沿视线方向平移（px，正 = 靠近观察者）。默认 0。真 3D，同上。 */
  z?: number
  /**
   * 透视距离（px），默认 1200。**只有 `rotateX` / `rotateY` / `z` 至少一个非 0 时才生效**
   * —— 只写这一项不会让画面进 3D（否则一个多余的镜头参数会把全片拖慢 3–5 倍）。
   *
   * 缺省值不是随手取的：能力基准 #12 实测出两条硬边界 ——
   *
   * 1. **透视距离必须远大于元素尺寸**（≥3–4 倍）。把 60px 的小卡放进 `perspective(420px)`
   *    时整块在渲染器里**静默消失**（预合成矩形算不出 ⇒ 该层被跳过，不报错、不留痕）。
   *    契约校验拦 <200 的值（`manifest-track-validate.ts` 的 `MIN_PERSPECTIVE`）。
   * 2. **只认元素自身的透视**。web-renderer 的 `TransformStyle` 只 pick
   *    `transform / rotate / scale / transformOrigin`，**父层 CSS `perspective` 属性会被
   *    整个丢掉** —— #12 的 B/C 两格：卡片退化成纯水平压扁（左右边等高、只是变窄），
   *    加 `transform-style: preserve-3d` 也救不回来。所以透视必须由本字段经
   *    `layerTransform` 写进**元素自己**的 transform 串（#12 的 A/D 两格才是真梯形）。
   */
  perspective?: number
}

/**
 * 帧级视觉状态（CV-334）：`Transform` 的超集，多一个 `opacity`。
 * 全部可选 —— 缺省表示"该维度不变"（取值回落到 `transform` / 组件缺省）。
 *
 * 3D 三维（`rotateX` / `rotateY` / `z`）与 `Transform` 同义且**可插值**，因此
 * `animate.from/to` 与 `exit.to` 都能写。
 * ⚠️ `perspective` **不在**这里：它是静态镜头参数，逐帧变透视会让每帧的预合成矩形
 * 都不同（昂贵且没有对应的视觉语义），契约校验会拒收 `from/to/exit.to` 里的它。
 */
export interface VisualState {
  /** 水平中心位置（0–100）。 */
  x?: number
  /** 垂直中心位置（0–100）。 */
  y?: number
  /** 缩放倍数（> 0）。 */
  scale?: number
  /** 旋转角度（度）。 */
  rotation?: number
  /** 绕水平轴俯仰（度）；可插值。 */
  rotateX?: number
  /** 绕垂直轴偏转（度）；可插值。 */
  rotateY?: number
  /** 沿视线方向平移（px）；可插值。 */
  z?: number
  /** 不透明度（0–1）；与轨道淡入淡出**相乘**（不是覆盖）。 */
  opacity?: number
}
