/**
 * SSR 消化批 · camera 类目卡(来源:video-shotcraft-dsh demos/camera,Apache-2.0,
 * 手法参考、表达重写;逐卡翻译对照见 skills/code-driven-explainer/references/shotcraft-catalog.md)。
 *
 * 本批 4 张(CAM1–CAM4)全部判定「能(2D 轻量)」,统一走 RQ-23 image.camera
 * 多关键帧相机(`camera-motion.ts` 纯函数插值):
 * - x/y 是**设计 px**(1080 基准);聚焦点 (cx,cy) 换算 x=(960−cx)×zoom、
 *   y=(540−cy)×zoom(渲染层 transformOrigin=center,见 ImageClip.tsx 相机层);
 * - camera.keys 的 key 缺省字段按**静态缺省**补全(不继承上一 key)—— 恒定字段
 *  (rotY/rotZ/persp 等)每个 key 都要重复携带,`camKey()` 合并器专门防这个坑;
 * - 相机 key 全程用白名单 easing;上游逐帧曲线(bezier/逐帧震屏)在生成器里用
 *   确定性算式采样成稠密 keys(camera.easing='linear'),同输入同输出;
 * - 相机层外露出的四缘 = 媒体层垫底色(#05080f 暗场)—— 俯瞰/斜拍卡按
 *   「浮窗/舞台」语义设计,覆盖率已用 CSS 投影脚本逐帧验算(数值见各卡注释);
 * - 上游 CameraMotionBlur(急推/滑移段运动模糊)无对应层,按 catalog 口径省略。
 *
 * 截图素材槽位统一 `shotImage`(UI 截图,source:'user');缺素材降级为静态
 * 版式(fallbackTracks),不阻断出片(RQ-21 fallback 口径)。
 */
import { registerCard, type CardRenderContext } from './recipe-cards.js'

// ───────────────────────── 本文件内的小工具(全部纯函数,零随机源) ─────────────────────────

/** 轨 id 前缀(硬纪律 4:同段多轨不撞 id)。 */
const tid = (ctx: CardRenderContext, part: string): string => `${ctx.segmentId}-${part}`

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

// 与 timing.ts 白名单同式的本地采样器(只用来**生成 key 数值**,不进 manifest)。
const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3)
const easeInOutCubic = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

/** cubic-bezier(x1,y1,x2,y2) 的 y(t) —— 二分反解 u,确定性(steep-tilt-glide 滑移曲线)。 */
const bezierY = (t: number, x1: number, y1: number, x2: number, y2: number): number => {
  const bez = (u: number, p1: number, p2: number): number =>
    3 * (1 - u) * (1 - u) * u * p1 + 3 * (1 - u) * u * u * p2 + u * u * u
  let lo = 0
  let hi = 1
  for (let i = 0; i < 32; i += 1) {
    const mid = (lo + hi) / 2
    if (bez(mid, x1, x2) < t) lo = mid
    else hi = mid
  }
  return bez((lo + hi) / 2, y1, y2)
}

/** 相机 key 全字段形态(恒定字段由 base 携带,防「缺省字段被插回静态缺省」)。 */
interface CamKey {
  frame: number
  x: number
  y: number
  zoom: number
  rotX: number
  rotY: number
  rotZ: number
  persp: number
}

/** `camKey(base, frame, patch)`:base = 本卡恒定机位,patch = 该 key 变化的字段。 */
const camKey = (base: Omit<CamKey, 'frame'>, frame: number, patch: Partial<Omit<CamKey, 'frame'>> = {}): CamKey => ({
  ...base,
  frame,
  ...patch,
})

/**
 * 帧表取整并保证**严格递增**(camera.keys 校验口径:≥0 整数、严格递增)。
 * 上游节拍以全片占比标定时(cursor-flyover),按段长折算后用这里去重/保序。
 */
const bumpFrames = (frames: number[]): number[] => {
  const out: number[] = []
  let prev = -1
  for (const f of frames) {
    const rounded = Math.max(0, Math.round(f))
    prev = Math.max(prev + 1, rounded)
    out.push(prev)
  }
  return out
}

/** 暗场底(渐变近黑;相机卡里被媒体垫底盖住,仅在降级版式/极端露边时兜底可见)。 */
const stageBase = (ctx: CardRenderContext): Record<string, unknown> => ({
  id: tid(ctx, 'stage'),
  type: 'shape',
  shape: 'gradient',
  color: '#080910',
  box: { x: 50, y: 50, w: 100, h: 100 },
  startFrame: ctx.startFrame,
  durationInFrames: ctx.durationInFrames,
  fadeFrames: 0,
})

/** 段级暗角(playsout 设计语言三件套之一,每卡必挂)。 */
const stageVignette = (ctx: CardRenderContext): Record<string, unknown> => ({
  id: tid(ctx, 'vignette'),
  type: 'shape',
  shape: 'vignette',
  color: '#000000',
  strength: 0.55,
  box: { x: 50, y: 50, w: 100, h: 100 },
  startFrame: ctx.startFrame,
  durationInFrames: ctx.durationInFrames,
  fadeFrames: 0,
})

/**
 * 缺 `shotImage` 时的降级版式(四卡共用):静态标题卡 —— 相机动不了,至少把
 * 文案落干净(RQ-21:缺 user 素材按 fallback 降级出片,不阻断)。
 */
const fallbackTracks = (ctx: CardRenderContext): Record<string, unknown>[] => {
  const num = String(ctx.index + 1).padStart(2, '0')
  return [
    stageBase(ctx),
    {
      id: tid(ctx, 'fb-dots'),
      type: 'shape',
      shape: 'dotGrid',
      color: 'rgba(152,163,255,0.18)',
      dotSpacing: 28,
      dotRadius: 1.6,
      box: { x: 50, y: 50, w: 100, h: 100 },
      startFrame: ctx.startFrame,
      durationInFrames: ctx.durationInFrames,
      fadeFrames: 0,
    },
    {
      id: tid(ctx, 'fb-eyebrow'),
      type: 'textCard',
      variant: 'subtitle',
      text: `${num} / ${String(ctx.sectionCount).padStart(2, '0')} · ${ctx.label}`,
      box: { x: 50, y: 30, w: 44, h: 6 },
      startFrame: ctx.startFrame + 6,
      durationInFrames: Math.max(6, ctx.durationInFrames - 12),
      fadeFrames: 0,
    },
    {
      id: tid(ctx, 'fb-title'),
      type: 'textCard',
      variant: 'title',
      text: ctx.copy,
      box: { x: 50, y: 50, w: 76, h: 26 },
      plate: 'none',
      letterSpacingEm: -0.022,
      startFrame: ctx.startFrame + 10,
      durationInFrames: Math.max(12, ctx.durationInFrames - 20),
      fadeFrames: 0,
      anim: 'fadeUp',
      animOptions: { offsetY: 18, wordDelayFrames: 2 },
    },
    {
      id: tid(ctx, 'fb-accent'),
      type: 'shape',
      shape: 'rect',
      color: ctx.accentColor,
      box: { x: 50, y: 66, w: 12, h: 0.8 },
      startFrame: ctx.startFrame + 14,
      durationInFrames: Math.max(6, ctx.durationInFrames - 20),
      fadeFrames: 6,
    },
    stageVignette(ctx),
  ]
}

// ───────────────────────── CAM1 · crash-zoom-punch(急推冲刺 · 撞停震屏款) ─────────────────────────
//
// 上游:demos/camera/crash-zoom-punch/CrashImpactReal.tsx(120f)。同目录 CrashZoomReal.tsx
// 为**回弹款**(46–51f zoom 2.6→2.45 过冲回收);catalog「落位回弹或撞停震屏二选一、
// 两款别混用」—— 本卡取撞停款(强调级"就是它"),回弹款节拍留档如上。
// 节拍:0–40f 全景 hold(zoom 1、焦点居中)→ 40–46f 急推 6f(zoom 1→2.5,段内
// ease-in bezier(0.55,0,0.7,1) ≈ easeInCubic;焦点 (960,540)→(960,620),y 收敛
// 与 zoom 同段同拍)→ 46f 撞停:震屏 env=14px·e^(−t/1.8),sx=env·sin(3.3t)、
// sy=0.7·env·sin(4.1t+0.9),逐帧 x/y keys(8 键 7f 收干,30fps 整帧采样写死)→
// 54f 起特写 hold 真静止。急推 >10f 读作普通推近(上游坑),6f 原拍保留。
// 覆盖率验算:全程 0% 露出(急推 y 收敛 80px 在 zoom≥1 的覆盖余量内)。
registerCard({
  id: 'CAM1',
  title: '急推冲刺(撞停震屏)',
  assets: [{
    slot: 'shotImage',
    kind: 'ui',
    source: 'user',
    required: false,
    fallback: '缺截图降级为静态标题版式(fallbackTracks)—— 急推必须有真截图,终点高清(低倍图糊字,上游坑 Q2)',
  }],
  generate: (ctx) => {
    const src = ctx.assetSrc('shotImage')
    if (src === undefined) return fallbackTracks(ctx)
    const dur = ctx.durationInFrames
    // 前 hold:原拍 40f;段长不足时压缩 hold、保住「急推 6f + 震屏 7f」的骨架。
    const holdEnd = clamp(dur - 34, 8, 40)
    const hit = holdEnd + 6
    // 震屏折线:上游公式在 30fps 整帧上的采样值(since=0..7),写死常量(硬纪律 1)。
    const SHAKE: { sx: number; sy: number }[] = [
      { sx: 0, sy: 7.68 },
      { sx: -1.27, sy: -5.39 },
      { sx: 1.44, sy: 1.03 },
      { sx: -1.21, sy: 1.1 },
      { sx: 0.9, sy: -1.06 },
      { sx: -0.62, sy: 0.34 },
      { sx: 0.41, sy: 0.13 },
      { sx: -0.26, sy: -0.19 },
    ]
    const TY_END = -200 // 聚焦 (960,620) @ zoom 2.5:y=(540−620)×2.5
    const base = { x: 0, y: 0, zoom: 1, rotX: 0, rotY: 0, rotZ: 0, persp: 800 }
    const keys: CamKey[] = [camKey(base, 0), camKey(base, holdEnd)]
    for (let i = 0; i < SHAKE.length; i += 1) {
      const s = SHAKE[i] as { sx: number; sy: number }
      keys.push(camKey(base, hit + i, { x: s.sx, y: TY_END + s.sy, zoom: 2.5 }))
    }
    keys.push(camKey(base, hit + SHAKE.length, { x: 0, y: TY_END, zoom: 2.5 }))
    const captionAt = Math.min(hit + 16, Math.max(0, dur - 10))
    return [
      {
        id: tid(ctx, 'shot'),
        type: 'image',
        src,
        fit: 'cover',
        box: { x: 50, y: 50, w: 100, h: 100 },
        camera: { keys, easing: 'easeInCubic' },
        startFrame: ctx.startFrame,
        durationInFrames: dur,
        fadeFrames: 0,
      },
      {
        id: tid(ctx, 'caption'),
        type: 'textCard',
        variant: 'subtitle',
        text: ctx.copy,
        startFrame: ctx.startFrame + captionAt,
        durationInFrames: Math.max(6, dur - captionAt),
        fadeFrames: 0,
        anim: 'fadeUp',
        animOptions: { offsetY: 18, wordDelayFrames: 2 },
      },
      stageVignette(ctx),
    ]
  },
})

// ───────────────────────── CAM2 · cursor-flyover(光标巡览) ─────────────────────────
//
// 上游:demos/camera/cursor-flyover/CursorFlyover.tsx(180f @30fps,节拍以全片占比标定)。
// 节拍:俯瞰淡入(0–14%,outCubic,上游另带 5px blur → 纯淡入近似)→ 四角巡览,
// 过渡/停留交替(过渡窗 20–32 / 40–52 / 60–72 / 79–91%,easeInOutCubic),相机五站:
// 俯瞰 s=0.8(世界 50%,50%)→ 四角 s=1.72((37,32)→(77,32)→(77,72)→(37,72));
// 每步**落位帧**打点击涟漪(0.055 全片长,scale 0.3→1.9,opacity 0.85→0)。
// 光标 = shape rect 小块 + animate 同表 waypoints(画布 %):光标活在相机层外的
// 画布空间、定寸渲染,不需要上游 world 内的 1/s 反缩放补偿;涟漪 = 描边圆环 ×4。
// 近似:audio.sfx click 四连本渲染器无音频轨原语,省略;停留段 ≤1px 呼吸位移
// (上游防"卡住"建议)未加,确定性优先。四角外缘露垫底 ≈ 上游浮窗外 bg(验算:
// 站 2/3 右缘 ~10–12%、站 4 底缘 ~2%,俯瞰段 37% = 浮窗设计本身)。
registerCard({
  id: 'CAM2',
  title: '光标巡览',
  assets: [{
    slot: 'shotImage',
    kind: 'ui',
    source: 'user',
    required: false,
    fallback: '缺截图降级为静态标题版式(fallbackTracks)—— 巡览对象应是整页产品截图',
  }],
  generate: (ctx) => {
    const src = ctx.assetSrc('shotImage')
    if (src === undefined) return fallbackTracks(ctx)
    const dur = ctx.durationInFrames
    // 上游 CAM 表(世界 %,s=zoom)+ 光标落点(世界 % = 画布 %,带指向偏置)。
    const STATIONS = [
      { tx: 50, ty: 50, s: 0.8 },
      { tx: 37, ty: 32, s: 1.72 },
      { tx: 77, ty: 32, s: 1.72 },
      { tx: 77, ty: 72, s: 1.72 },
      { tx: 37, ty: 72, s: 1.72 },
    ]
    const CURSOR: [number, number][] = [[50, 52], [41, 38], [82, 36], [71, 76], [33, 78]]
    const WIN = [0.2, 0.32, 0.4, 0.52, 0.6, 0.72, 0.79, 0.91] // 四段过渡的起/止(全片占比)
    const F = bumpFrames(WIN.map((v) => v * dur))
    // 相机 keys:0f 俯瞰 + 每段起止各一键(停留段 = 等值键,不参与插值)。
    const base = { x: 0, y: 0, zoom: 0.8, rotX: 0, rotY: 0, rotZ: 0, persp: 800 }
    const focusOf = (st: { tx: number; ty: number; s: number }): { x: number; y: number; zoom: number } => ({
      x: (960 - st.tx * 19.2) * st.s,
      y: (540 - st.ty * 10.8) * st.s,
      zoom: st.s,
    })
    const keys: CamKey[] = [camKey(base, 0)]
    for (let i = 0; i < 4; i += 1) {
      const focus = focusOf(STATIONS[i + 1] as { tx: number; ty: number; s: number })
      keys.push(camKey(base, F[i * 2] as number, focus))
      keys.push(camKey(base, F[i * 2 + 1] as number, focus))
    }
    // 光标:与相机同表的过渡段(停留段省略 —— 无活动段时停在末段 to)。
    const cursorXY: Record<string, unknown>[] = []
    for (let i = 0; i < 4; i += 1) {
      const from = CURSOR[i] as [number, number]
      const to = CURSOR[i + 1] as [number, number]
      cursorXY.push({
        from: { x: from[0], y: from[1] },
        to: { x: to[0], y: to[1] },
        startFrame: F[i * 2],
        durationInFrames: (F[i * 2 + 1] as number) - (F[i * 2] as number),
        easing: 'easeInOutCubic',
      })
    }
    const rippleAt = (i: number): Record<string, unknown> => {
      const at = CURSOR[i + 1] as [number, number]
      const start = F[i * 2 + 1] as number
      return {
        id: tid(ctx, `ripple-${i + 1}`),
        type: 'shape',
        shape: 'circle',
        color: 'transparent',
        stroke: ctx.accentColor,
        strokeWidthPx: 3,
        box: { x: at[0], y: at[1], w: 4.2, h: 7.5 },
        startFrame: ctx.startFrame + start,
        durationInFrames: clamp(dur - start, 4, 10),
        fadeFrames: 0,
        animate: [{
          from: { scale: 0.3, opacity: 0.85 },
          to: { scale: 1.9, opacity: 0 },
          durationInFrames: clamp(dur - start, 4, 10),
          easing: 'easeOutCubic',
        }],
      }
    }
    return [
      {
        id: tid(ctx, 'shot'),
        type: 'image',
        src,
        fit: 'cover',
        box: { x: 50, y: 50, w: 100, h: 100 },
        camera: { keys, easing: 'easeInOutCubic' },
        startFrame: ctx.startFrame,
        durationInFrames: dur,
        fadeFrames: 0,
        animate: [{
          from: { opacity: 0 },
          to: { opacity: 1 },
          startFrame: 0,
          durationInFrames: Math.max(2, Math.round(dur * 0.14)),
          easing: 'easeOutCubic',
        }],
      },
      {
        id: tid(ctx, 'cursor'),
        type: 'shape',
        shape: 'rect',
        color: '#f8faff',
        stroke: '#151b30',
        strokeWidthPx: 2,
        radius: 2,
        box: { x: 50, y: 52, w: 1.2, h: 2.2 },
        transform: { rotation: -12 },
        startFrame: ctx.startFrame,
        durationInFrames: dur,
        fadeFrames: 0,
        animate: [
          { from: { opacity: 0 }, to: { opacity: 1 }, startFrame: 0, durationInFrames: Math.max(2, Math.round(dur * 0.14)), easing: 'easeOutCubic' },
          ...cursorXY,
        ],
      },
      rippleAt(0),
      rippleAt(1),
      rippleAt(2),
      rippleAt(3),
      {
        id: tid(ctx, 'caption'),
        type: 'textCard',
        variant: 'subtitle',
        text: ctx.copy,
        startFrame: ctx.startFrame + 6,
        durationInFrames: Math.max(6, F[0] as number),
        fadeFrames: 0,
        // 俯瞰段讲完就走:第一段过渡起步时淡出(box 轨 exit 只动 opacity)。
        exit: { durationInFrames: 6, to: { opacity: 0 } },
      },
      stageVignette(ctx),
    ]
  },
})

// ───────────────────────── CAM3 · overhead-camera-moves(俯拍揭示 · B 式桌面滑降) ─────────────────────────
//
// 上游:demos/camera/overhead-camera-moves/OverheadTabletopDrop.tsx(145f)。同目录
// TiltReveal.tsx 为 **A 式**纯抬头揭示(留档:25f 俯角定格 → 43f rotX −80→2.6→
// −0.9→0 抬正 + scale 3.2→1 + persp 600→1200,outCubic);catalog 两式同卡,
// 本卡取信息量更全、且"三通道同跑"最能体现 keys 原生优势的 B 式。
// 节拍:0–55f 俯拍横滑(只动 x,+360→−360 inOutCubic;rotX 62°/zoom 1.4 恒定;
// 上游横移 ±650px 属 5600px 宽桌面,画布取景单图按覆盖余量等比压到 ±360)→
// 55–85f 骤降扎入:rotX 62→−1.8 + zoom 1.4→2.28 + x→0 三通道同跑(outCubic,
// keys 逐 3f 采样,天然同拍)→ 85–93f 过冲回正(rotX −1.8→0.6→0,zoom 2% 收敛
// 2.28→2.24)→ 93f 起正视满屏 hold 真静止 52f。
// 覆盖率验算:drop 段零露出;俯拍段顶部露垫底 ≈ 上游「桌面远缘 + 背景」
// (34%@f=0,随 zoom 收拢归零)。
registerCard({
  id: 'CAM3',
  title: '俯拍桌面滑降',
  assets: [{
    slot: 'shotImage',
    kind: 'ui',
    source: 'user',
    required: false,
    fallback: '缺截图降级为静态标题版式(fallbackTracks)—— 落版目标应是整页 dashboard 截图',
  }],
  generate: (ctx) => {
    const src = ctx.assetSrc('shotImage')
    if (src === undefined) return fallbackTracks(ctx)
    const dur = ctx.durationInFrames
    const PAN_END = clamp(Math.round(dur * 0.38), 20, 55) // 原拍 55f(145f 的 38%)
    const DROP_END = PAN_END + 30 // 原拍 30f 骤降
    const base = { x: 0, y: 0, zoom: 1.4, rotX: 62, rotY: 0, rotZ: 0, persp: 1600 }
    const keys: CamKey[] = []
    // 横滑段:inOutCubic 逐 1/11 采样(linear 全局 easing + 稠密 keys 保曲线)。
    for (let i = 0; i <= 11; i += 1) {
      keys.push(camKey(base, Math.round((PAN_END * i) / 11), { x: lerp(360, -360, easeInOutCubic(i / 11)) }))
    }
    // 骤降段:三通道同跑,outCubic 逐 3f 采样。
    for (let i = 1; i <= 9; i += 1) {
      const e = easeOutCubic(i / 10)
      keys.push(camKey(base, PAN_END + i * 3, {
        x: lerp(-360, 0, e),
        zoom: lerp(1.4, 2.28, e),
        rotX: lerp(62, -1.8, e),
      }))
    }
    // 过冲回正:rotX −1.8→0.6→0,zoom 收 2%。
    keys.push(camKey(base, DROP_END, { x: 0, zoom: 2.28, rotX: -1.8 }))
    keys.push(camKey(base, DROP_END + 4, { x: 0, zoom: 2.26, rotX: 0.6 }))
    keys.push(camKey(base, DROP_END + 8, { x: 0, zoom: 2.24, rotX: 0 }))
    const num = String(ctx.index + 1).padStart(2, '0')
    return [
      {
        id: tid(ctx, 'shot'),
        type: 'image',
        src,
        fit: 'cover',
        box: { x: 50, y: 50, w: 100, h: 100 },
        camera: { keys, easing: 'linear' },
        startFrame: ctx.startFrame,
        durationInFrames: dur,
        fadeFrames: 0,
      },
      {
        id: tid(ctx, 'eyebrow'),
        type: 'textCard',
        variant: 'subtitle',
        text: `${num} / ${String(ctx.sectionCount).padStart(2, '0')} · ${ctx.label}`,
        box: { x: 50, y: 10, w: 44, h: 5 },
        startFrame: ctx.startFrame + 6,
        durationInFrames: Math.max(6, dur - 12),
        fadeFrames: 0,
      },
      {
        id: tid(ctx, 'title'),
        type: 'textCard',
        variant: 'title',
        text: ctx.copy,
        box: { x: 50, y: 50, w: 72, h: 22 },
        plate: 'none',
        letterSpacingEm: -0.022,
        startFrame: ctx.startFrame + DROP_END + 12,
        durationInFrames: Math.max(10, dur - DROP_END - 12),
        fadeFrames: 0,
        anim: 'fadeUp',
        animOptions: { offsetY: 22, wordDelayFrames: 2 },
      },
      {
        id: tid(ctx, 'accent'),
        type: 'shape',
        shape: 'rect',
        color: ctx.accentColor,
        box: { x: 50, y: 64, w: 10, h: 0.8 },
        startFrame: ctx.startFrame + DROP_END + 18,
        durationInFrames: Math.max(6, dur - DROP_END - 18),
        fadeFrames: 6,
      },
      stageVignette(ctx),
    ]
  },
})

// ───────────────────────── CAM4 · steep-tilt-glide(侧立滑移) ─────────────────────────
//
// 上游:demos/camera/steep-tilt-glide/SteepTiltGlide.tsx(120f,「物动镜不动」)。
// 节拍:镜头常数全程不动 —— rotY −60°(实战 55–65°,出区间等于换手法)/rotZ −2°/
// persp 1100/zoom 1.0;页面沿横面滑移 0–119f,bezier(0.3,0.12,0.72,0.9)(起步
// 柔和、近匀速、**尾段斜率不归零**,全程不安定停死 —— keys 逐 10f 采样,末 14f
// 仍有 ~17px 位移);揭亮 = 黑罩 opacity 0.7→0.4(0–18f)→0(18–44f)linear;
// 速度重影 = 同素材滞后 3f/5f 双轨(opacity 0.26/0.13,上游 g1/g2 量级);
// 文字悬空贴落 = textCard fadeUp(offsetY 大值)错峰;左缘紫晕 radial 渐显。
// 近似(catalog 口径):对画布取景截图,相机平移与页面自移在语义上按
// 「物动镜不动」标注;上游 6200px 超宽页面在 image 轨道模型内无法整幅入场
// (相机只探索 cover 取景),滑移行程按 rotY −60 覆盖余量压到 210px(全程贴住
// 画缘,投影验算露出 ≤2%);同形软影随高度收敛做不了,fadeUp 定值近似。
registerCard({
  id: 'CAM4',
  title: '侧立滑移',
  assets: [{
    slot: 'shotImage',
    kind: 'ui',
    source: 'user',
    required: false,
    fallback: '缺截图降级为静态标题版式(fallbackTracks)—— 滑移主体应是超宽页面/长截图',
  }],
  generate: (ctx) => {
    const src = ctx.assetSrc('shotImage')
    if (src === undefined) return fallbackTracks(ctx)
    const dur = ctx.durationInFrames
    // 滑移行程:x −740→−950(rotY −60/persp 1100 下贴住左右画缘的可用窗口,
    // 已含 rotZ −2 的角部旋转余量);上游页面行程 4160px 的画布取景等比压缩。
    const TX0 = -740
    const TX1 = -950
    const base = { x: TX0, y: 0, zoom: 1, rotX: 0, rotY: -60, rotZ: -2, persp: 1100 }
    const glideKeys = (): CamKey[] => {
      const ks: CamKey[] = [camKey(base, 0)]
      for (let f = 10; f <= dur - 10; f += 10) {
        ks.push(camKey(base, f, { x: lerp(TX0, TX1, bezierY(f / dur, 0.3, 0.12, 0.72, 0.9)) }))
      }
      ks.push(camKey(base, Math.max((ks[ks.length - 1] as CamKey).frame + 1, dur - 1), { x: TX1 }))
      return ks
    }
    const keys = glideKeys()
    // 速度重影:同一排程整体滞后 lag 帧(ghost(f) = main(f−lag))。
    const ghostKeys = (lag: number): CamKey[] => keys.map((k) => ({ ...k, frame: k.frame + lag }))
    const ghost = (lag: number, opacity: number, part: string): Record<string, unknown> => ({
      id: tid(ctx, part),
      type: 'image',
      src,
      fit: 'cover',
      box: { x: 50, y: 50, w: 100, h: 100 },
      camera: { keys: ghostKeys(lag), easing: 'linear' },
      startFrame: ctx.startFrame,
      durationInFrames: dur,
      fadeFrames: 0,
      animate: [{ from: { opacity }, to: { opacity } }],
    })
    // 揭亮:黑罩两段线性(上游 shade [0,18,44]→[0.7,0.4,0])。
    const shadeW1 = Math.max(2, Math.round(dur * 0.15))
    const shadeW2 = Math.max(2, Math.round(dur * 0.37)) - shadeW1
    return [
      ghost(5, 0.13, 'ghost-far'),
      ghost(3, 0.26, 'ghost-near'),
      {
        id: tid(ctx, 'shot'),
        type: 'image',
        src,
        fit: 'cover',
        box: { x: 50, y: 50, w: 100, h: 100 },
        camera: { keys, easing: 'linear' },
        startFrame: ctx.startFrame,
        durationInFrames: dur,
        fadeFrames: 0,
      },
      {
        id: tid(ctx, 'shade'),
        type: 'shape',
        shape: 'rect',
        color: '#050409',
        box: { x: 50, y: 50, w: 100, h: 100 },
        startFrame: ctx.startFrame,
        durationInFrames: dur,
        fadeFrames: 0,
        animate: [
          { from: { opacity: 0.7 }, to: { opacity: 0.4 }, startFrame: 0, durationInFrames: shadeW1, easing: 'linear' },
          { from: { opacity: 0.4 }, to: { opacity: 0 }, startFrame: shadeW1, durationInFrames: shadeW2, easing: 'linear' },
        ],
      },
      {
        id: tid(ctx, 'glow'),
        type: 'shape',
        shape: 'gradient',
        gradientType: 'radial',
        gradientRadius: { x: 40, y: 50 },
        color: 'rgba(118,58,190,0.30)',
        box: { x: 20, y: 66, w: 80, h: 100 },
        startFrame: ctx.startFrame,
        durationInFrames: dur,
        fadeFrames: 0,
        animate: [{
          from: { opacity: 0.15 },
          to: { opacity: 1 },
          startFrame: Math.max(2, Math.round(dur * 0.12)),
          durationInFrames: Math.max(4, Math.round(dur * 0.47)),
          easing: 'linear',
        }],
      },
      {
        id: tid(ctx, 'title'),
        type: 'textCard',
        variant: 'title',
        text: ctx.label,
        box: { x: 50, y: 26, w: 72, h: 16 },
        plate: 'none',
        letterSpacingEm: -0.022,
        startFrame: ctx.startFrame + 8,
        durationInFrames: Math.max(10, dur - 8),
        fadeFrames: 0,
        anim: 'fadeUp',
        animOptions: { offsetY: 120, wordDelayFrames: 4 },
      },
      {
        id: tid(ctx, 'copy'),
        type: 'textCard',
        variant: 'subtitle',
        text: ctx.copy,
        box: { x: 50, y: 86, w: 56, h: 6 },
        startFrame: ctx.startFrame + 28,
        durationInFrames: Math.max(8, dur - 28),
        fadeFrames: 0,
        anim: 'fadeUp',
        animOptions: { offsetY: 70, wordDelayFrames: 3 },
      },
      stageVignette(ctx),
    ]
  },
})
