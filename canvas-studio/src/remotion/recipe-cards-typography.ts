/**
 * SSR 消化批 · typography 类目卡(来源:video-shotcraft-dsh demos/typography,Apache-2.0,
 * 手法参考、表达重写;逐卡翻译对照见 skills/.../shotcraft-catalog.md)。
 */
import { registerCard, type CardRenderContext } from './recipe-cards.js'

// ───────────────────────── 共用小件(全部确定性,无随机) ─────────────────────────

/** 轨 id(段前缀 + 部件名,同段多轨不撞 id)。 */
const tid = (ctx: CardRenderContext, part: string): string => `${ctx.segmentId}-${part}`

/**
 * 上游节拍折算:上游参考时长 ref(帧)内的帧号 → 本段时长 dur 的等比帧号。
 * 段长恰好等于参考长时逐帧还原原拍;段更短/更长时整段节奏同比例缩放 ——
 * 同时保证 animate/draw 窗口起点永不 ≥ 轨长(validateAnimateWindows 对此报 error)。
 */
const beat = (dur: number, ref: number, frame: number): number =>
  Math.max(0, Math.round((frame * dur) / ref))
/** 窗口长度版(≥1 —— animate.durationInFrames / draw.durationInFrames 必须是正整数)。 */
const beatLen = (dur: number, ref: number, frames: number): number =>
  Math.max(1, Math.round((frames * dur) / ref))

/** animate 段速记(from/to 只用 opacity/x/y/scale/rotation;时长钳到 ≥1)。 */
const seg = (
  from: Record<string, number>,
  to: Record<string, number>,
  startFrame: number,
  durationInFrames: number,
  easing: string,
): Record<string, unknown> => ({
  from,
  to,
  startFrame,
  durationInFrames: Math.max(1, Math.round(durationInFrames)),
  easing,
})

/** 尾部淡出(exit 只动 opacity —— box 轨的位置由 box 决定,x/y 会被校验拒收)。 */
const fadeOutExit = (dur: number, frames: number): Record<string, unknown> => ({
  durationInFrames: Math.max(1, Math.min(Math.round(frames), Math.max(1, Math.round(dur)))),
  to: { opacity: 0 },
})

/**
 * 三个接力词的确定性切分(TYP3):恰好 3 个空白词原样取用;≥3 取首/中/尾;
 * 不足 3 词(典型中文无空格)按字符三等分;再兜底整句复读。
 */
function relayWords(copy: string): [string, string, string] {
  const tokens = copy.trim().split(/\s+/).filter((t) => t.length > 0)
  if (tokens.length >= 3) {
    const mid = tokens[Math.floor((tokens.length - 1) / 2)] ?? ''
    return [tokens[0] ?? '', mid, tokens[tokens.length - 1] ?? '']
  }
  const chars = [...copy.replace(/\s+/gu, '')]
  if (chars.length >= 3) {
    const size = Math.ceil(chars.length / 3)
    const parts = [0, 1, 2]
      .map((i) => chars.slice(i * size, (i + 1) * size).join(''))
      .filter((s) => s.length > 0)
    if (parts.length === 3) return [parts[0] ?? '', parts[1] ?? '', parts[2] ?? '']
    const padded = [...parts]
    while (padded.length < 3 && padded.length > 0) padded.push(padded[padded.length - 1] ?? '')
    if (padded.length === 3) return [padded[0] ?? '', padded[1] ?? '', padded[2] ?? '']
  }
  return [copy, copy, copy]
}

/** TYP1:句尾短词(≤12 字符)抽出来当强调词;抽不出(中文整句/无空格)时用段名兜底。 */
function splitAccent(copy: string, label: string): { main: string; accent: string } {
  const tokens = copy.trim().split(/\s+/).filter((t) => t.length > 0)
  const last = tokens.length >= 2 ? tokens[tokens.length - 1] ?? '' : ''
  if (last.length > 0 && last.length <= 12) {
    return { main: tokens.slice(0, -1).join(' '), accent: last }
  }
  return { main: copy.trim(), accent: label }
}

/** TYP4/TYP5:首词当关键词(≤16 字符),其余为伴随行;单词时 rest 为空。 */
function leadWord(copy: string): { word: string; rest: string } {
  const tokens = copy.trim().split(/\s+/).filter((t) => t.length > 0)
  const first = tokens[0] ?? ''
  if (tokens.length >= 2 && first.length > 0 && first.length <= 16) {
    return { word: first, rest: tokens.slice(1).join(' ') }
  }
  return { word: copy.trim(), rest: '' }
}

// ── TYP1 · paper-title-card(压印字卡)──
// 上游:template/src/aifl/PaperTitleCard.tsx(references/shots/typography/paper-title-card.md;
// demos/ 无同名目录,按模板实现消化)。节拍:逐词入场 delay 4+i·4、9f/词(scale 1.28→1 +
// blur 7→0 + opacity,bezier(0.2,0.75,0.3,1));下划线 16→34f scaleX 0→1(bezier(0.3,0,0.2,1),
// 220×6px 强调色);副行 10→22f 淡入;尾部 8f 整卡淡出;总长 50–55f。
// 翻译口径(catalog「近似」):逐词 scale 压印无逐词缩放 → wordStagger(offsetY 8 + blur 7,
// 词距 4f;渲染器单词窗固定 12f ≈ 上游 9f);强调词分色降级为整行级 —— 句尾短词抽出独立
// 成行染 accentColor(抽不出时用段名),斜体无原语、以颜色承担强调;下划线 scaleX 无原语 →
// shape rect + animate scale 0→1(绕盒心,近 scaleX 观感);副行用段序角标(上游 mono 小字位)。
registerCard({
  id: 'TYP1',
  title: '压印字卡',
  assets: [],
  generate: (ctx) => {
    const dur = ctx.durationInFrames
    const b = (f: number) => beat(dur, 54, f)
    const bl = (f: number) => beatLen(dur, 54, f)
    const tail = Math.max(2, Math.min(8, Math.round(dur * 0.15)))
    const { main, accent } = splitAccent(ctx.copy, ctx.label)
    return [
      {
        id: tid(ctx, 'base'),
        type: 'shape',
        shape: 'rect',
        color: '#f2eee6',
        box: { x: 50, y: 50, w: 100, h: 100 },
        startFrame: ctx.startFrame,
        durationInFrames: dur,
        fadeFrames: 0,
        exit: fadeOutExit(dur, tail),
      },
      {
        id: tid(ctx, 'glow'),
        type: 'shape',
        shape: 'gradient',
        gradientType: 'radial',
        color: '#fff6e4',
        gradientCenter: { x: 50, y: 42 },
        gradientRadius: { x: 58, y: 68 },
        box: { x: 50, y: 50, w: 100, h: 100 },
        startFrame: ctx.startFrame,
        durationInFrames: dur,
        fadeFrames: 0,
        exit: fadeOutExit(dur, tail),
      },
      {
        id: tid(ctx, 'title'),
        type: 'textCard',
        variant: 'title',
        text: main,
        box: { x: 50, y: 43, w: 76, h: 22 },
        plate: 'none',
        color: '#2b2722',
        letterSpacingEm: -0.012,
        anim: 'wordStagger',
        animOptions: { offsetY: 8, blur: 7, wordDelayFrames: 4 },
        startFrame: ctx.startFrame + b(4),
        durationInFrames: Math.max(1, dur - b(4)),
        fadeFrames: 0,
        exit: fadeOutExit(dur, tail),
      },
      {
        id: tid(ctx, 'accent'),
        type: 'textCard',
        variant: 'title',
        text: accent,
        box: { x: 50, y: 60, w: 44, h: 11 },
        plate: 'none',
        color: ctx.accentColor,
        letterSpacingEm: -0.01,
        anim: 'fadeUp',
        animOptions: { offsetY: 6, blur: 5 },
        startFrame: ctx.startFrame + b(18),
        durationInFrames: Math.max(1, dur - b(18)),
        fadeFrames: 0,
        exit: fadeOutExit(dur, tail),
      },
      {
        id: tid(ctx, 'underline'),
        type: 'shape',
        shape: 'rect',
        color: ctx.accentColor,
        radius: 3,
        box: { x: 50, y: 68.6, w: 11.5, h: 0.9 },
        startFrame: ctx.startFrame,
        durationInFrames: dur,
        fadeFrames: 0,
        animate: [seg({ scale: 0.001 }, { scale: 1 }, b(16), bl(18), 'easeInOutCubic')],
        exit: fadeOutExit(dur, tail),
      },
      {
        id: tid(ctx, 'sub'),
        type: 'textCard',
        variant: 'subtitle',
        text: `${String(ctx.index + 1).padStart(2, '0')} / ${String(ctx.sectionCount).padStart(2, '0')}`,
        box: { x: 50, y: 81, w: 60, h: 9 },
        background: 'transparent',
        color: '#6f6a61',
        letterSpacingEm: 0.12,
        startFrame: ctx.startFrame + b(10),
        durationInFrames: Math.max(1, dur - b(10)),
        fadeFrames: 0,
        animate: [seg({ opacity: 0 }, { opacity: 1 }, 0, bl(12), 'linear')],
        exit: fadeOutExit(dur, tail),
      },
    ]
  },
})

// ── TYP2 · marker-underline-title(马克笔下划线)──
// 上源:demos/typography/marker-underline-title/MarkerUnderlineTitle.tsx。节拍:标题 0–22f
// 弹入(36px 上移 + opacity,ease-out-cubic);停一拍后下划线 32→42f 从左到右描画(10f,
// ease-out,≈p^2.2);白底 #f4f4f2,大字 118px/#191919,字距 -0.02em。
// 翻译口径(catalog「近似」):变宽毛糙笔形无原语 → 直接复用 canvas-studio 已验证可编译的
// assets/templates/promo/marker-underline/manifest.template.json 预烘焙笔形 —— d 字符串逐字
// 复制(未重算),shape:'path' + strokeWidth 0.78 + pivot{0,50} + draw(32f 起 10f easeOut),
// 即模板那条 underline 轨的原样搬运;标题入场取模板轨写法(backOut 22f,opacity+scale)。
registerCard({
  id: 'TYP2',
  title: '马克笔下划线',
  assets: [],
  generate: (ctx) => {
    const dur = ctx.durationInFrames
    const b = (f: number) => beat(dur, 75, f)
    const bl = (f: number) => beatLen(dur, 75, f)
    return [
      {
        id: tid(ctx, 'base'),
        type: 'shape',
        shape: 'rect',
        color: '#f4f4f2',
        box: { x: 50, y: 50, w: 100, h: 100 },
        startFrame: ctx.startFrame,
        durationInFrames: dur,
        fadeFrames: 0,
      },
      {
        id: tid(ctx, 'title'),
        type: 'textCard',
        variant: 'title',
        text: ctx.copy,
        box: { x: 50, y: 44, w: 70, h: 24 },
        plate: 'none',
        color: '#191919',
        letterSpacingEm: -0.02,
        startFrame: ctx.startFrame,
        durationInFrames: dur,
        fadeFrames: 0,
        animate: [seg({ opacity: 0, scale: 0.96 }, { opacity: 1, scale: 1 }, 0, bl(22), 'backOut')],
      },
      {
        id: tid(ctx, 'underline'),
        type: 'shape',
        shape: 'path',
        color: '#111111',
        // 预烘焙马克笔笔形(模板 assets/templates/promo/marker-underline,
        // manifest.template.json tracks[underline].d 原文照抄,坐标 = 0–100 双轴百分比):
        d: 'M50.00,56.82L50.33,56.82L50.65,56.83L50.98,56.83L51.30,56.83L51.62,56.83L51.95,56.82L52.27,56.82L52.60,56.81L52.92,56.79L53.25,56.78L53.58,56.76L53.90,56.75L54.23,56.72L54.55,56.70L54.88,56.68L55.20,56.65L55.52,56.62L55.85,56.59L56.17,56.56L56.50,56.53L56.83,56.50L57.15,56.46L57.48,56.43L57.80,56.40L58.12,56.37L58.45,56.34L58.77,56.31L59.10,56.28L59.42,56.25L59.75,56.23L60.08,56.21L60.40,56.19L60.73,56.17L61.05,56.16L61.38,56.14L61.70,56.13L62.02,56.12L62.35,56.12L62.67,56.11L63.00,56.11',
        strokeWidth: 0.78,
        pivot: { x: 0, y: 50 },
        draw: { to: 1, startFrame: b(32), durationInFrames: bl(10), easing: 'easeOut' },
        startFrame: ctx.startFrame,
        durationInFrames: dur,
        fadeFrames: 0,
      },
    ]
  },
})

// ── TYP3 · word-relay-geometry(几何词接力)──
// 上源:demos/typography/word-relay-geometry/WordRelayGeometry.tsx。节拍:三词槽位
// [0,0.36]/[0.32,0.68]/[0.64,1.0](重叠 0.04,180f);入场 0.07(≈13f)outCubic、出场末
// 0.05(≈9f)inQuad;Faster 虚线大圆 0.01–0.14 生长 0.4→1 + 慢转 1°/帧;Better 三圆 trim
// 相位差 0.06 依次生长;Stronger 描边 → sheen 扫光(0.08–0.26)→ 收纯白(0.27–0.34)+辉光。
// 翻译口径(catalog「近似」):描边→填充 = fx:'outline' 层淡出 + 实色层 anim:'maskReveal'
// 擦入(渲染器单词窗固定 12f,近似上游 21.6f inOutCubic);三圆 trim 依次生长 = 一条
// shape:'path' 三段子路径 + draw(rx=0.5625·ry 补偿 16:9 非等比拉伸,起点圆顶、顺时针);
// 虚线大圆 = shape circle(stroke+dash SVG 路线)+ animate(scale 生长/rotation 慢转);
// sheen = fx:'metal'(银蓝渐变,与上游 sheen 带同族)叠 opacity 进出窗;收白层 fx:'glow'
// (蓝白辉光近似上游白辉光);fx:'outline' 描边色固定奶油白,比上游 1px 灰描边更亮;
// 背景微尘粒子省略(纯装饰,给 10 轨预算让位)。
registerCard({
  id: 'TYP3',
  title: '几何词接力',
  assets: [],
  generate: (ctx) => {
    const dur = ctx.durationInFrames
    const b = (f: number) => beat(dur, 180, f)
    const bl = (f: number) => beatLen(dur, 180, f)
    const words = relayWords(ctx.copy)
    const wordBox = { x: 50, y: 50, w: 46, h: 16 }
    // 三段槽位端点(轨内绝对帧,180f 参考系):0–65 / 58–122 / 115–180。
    const s1End = Math.max(1, b(65))
    const s2Start = b(58)
    const s2End = Math.max(s2Start + 1, b(122))
    const s3Start = Math.min(b(115), Math.max(0, dur - 1))
    // Better 三圆:圆心 x = 50 ± 22.9(上游 ±110/480),视觉半径 248px → ry 23、rx 12.94
    //(rx = 0.5625·ry,抵消 viewBox 非等比拉伸);起点圆顶、顺时针两半弧接整圆。
    const trimD =
      'M 27.1 27 A 12.94 23 0 1 1 27.1 73 A 12.94 23 0 1 1 27.1 27 '
      + 'M 50 27 A 12.94 23 0 1 1 50 73 A 12.94 23 0 1 1 50 27 '
      + 'M 72.9 27 A 12.94 23 0 1 1 72.9 73 A 12.94 23 0 1 1 72.9 27'
    const relayExit = { durationInFrames: bl(9), to: { opacity: 0 } }
    return [
      {
        id: tid(ctx, 'base'),
        type: 'shape',
        shape: 'rect',
        color: '#07080c',
        box: { x: 50, y: 50, w: 100, h: 100 },
        startFrame: ctx.startFrame,
        durationInFrames: dur,
        fadeFrames: 0,
      },
      {
        // Faster · 虚线大圆:生长 0.4→1(2→25f outCubic)+ 慢转 1°/帧,随槽位退场。
        id: tid(ctx, 'c1-dash'),
        type: 'shape',
        shape: 'circle',
        color: 'transparent',
        stroke: '#565e78',
        strokeWidthPx: 3,
        dash: [20, 28],
        box: { x: 50, y: 50, w: 20.8, h: 37.04 },
        startFrame: ctx.startFrame,
        durationInFrames: s1End,
        fadeFrames: 0,
        animate: [
          seg({ opacity: 0 }, { opacity: 1 }, b(2), bl(23), 'easeOutCubic'),
          seg({ scale: 0.4 }, { scale: 1 }, b(2), bl(23), 'easeOutCubic'),
          seg({ rotation: 0 }, { rotation: Math.max(1, s1End - b(2)) }, b(2), Math.max(1, s1End - b(2)), 'linear'),
        ],
        exit: relayExit,
      },
      {
        // Better · 三实线圆 trim 依次生长(一条 path 三个子路径,draw 顺序描完)。
        id: tid(ctx, 'c2-trim'),
        type: 'shape',
        shape: 'path',
        color: '#565e78',
        d: trimD,
        strokeWidth: 0.23,
        draw: { to: 1, startFrame: Math.max(0, b(61) - s2Start), durationInFrames: bl(55), easing: 'easeOutCubic' },
        startFrame: ctx.startFrame + s2Start,
        durationInFrames: s2End - s2Start,
        fadeFrames: 0,
        exit: { durationInFrames: bl(11), to: { opacity: 0 } },
      },
      {
        id: tid(ctx, 'w1-outline'),
        type: 'textCard',
        variant: 'title',
        text: words[0],
        box: wordBox,
        plate: 'none',
        color: '#e8ecf4',
        fx: 'outline',
        startFrame: ctx.startFrame,
        durationInFrames: s1End,
        fadeFrames: 0,
        animate: [
          seg({ opacity: 0 }, { opacity: 1 }, 0, bl(13), 'easeOutCubic'),
          seg({ opacity: 1 }, { opacity: 0.25 }, bl(13), Math.max(1, b(33) - bl(13)), 'easeInOutCubic'),
        ],
        exit: relayExit,
      },
      {
        id: tid(ctx, 'w1-fill'),
        type: 'textCard',
        variant: 'title',
        text: words[0],
        box: wordBox,
        plate: 'none',
        color: '#ffffff',
        anim: 'maskReveal',
        startFrame: ctx.startFrame + b(11),
        durationInFrames: Math.max(1, s1End - b(11)),
        fadeFrames: 0,
        exit: relayExit,
      },
      {
        id: tid(ctx, 'w2-outline'),
        type: 'textCard',
        variant: 'title',
        text: words[1],
        box: wordBox,
        plate: 'none',
        color: '#e8ecf4',
        fx: 'outline',
        startFrame: ctx.startFrame + s2Start,
        durationInFrames: s2End - s2Start,
        fadeFrames: 0,
        animate: [
          seg({ opacity: 0 }, { opacity: 1 }, 0, bl(13), 'easeOutCubic'),
          seg({ opacity: 1 }, { opacity: 0.25 }, bl(13), Math.max(1, b(91) - s2Start - bl(13)), 'easeInOutCubic'),
        ],
        exit: relayExit,
      },
      {
        id: tid(ctx, 'w2-fill'),
        type: 'textCard',
        variant: 'title',
        text: words[1],
        box: wordBox,
        plate: 'none',
        color: '#ffffff',
        anim: 'maskReveal',
        startFrame: ctx.startFrame + b(68),
        durationInFrames: Math.max(1, s2End - b(68)),
        fadeFrames: 0,
        exit: relayExit,
      },
      {
        id: tid(ctx, 'w3-outline'),
        type: 'textCard',
        variant: 'title',
        text: words[2],
        box: wordBox,
        plate: 'none',
        color: '#e8ecf4',
        fx: 'outline',
        startFrame: ctx.startFrame + s3Start,
        durationInFrames: Math.max(1, dur - s3Start),
        fadeFrames: 0,
        animate: [
          seg({ opacity: 0 }, { opacity: 1 }, 0, bl(9), 'easeOutCubic'),
          seg({ opacity: 1 }, { opacity: 0 }, bl(9), Math.max(1, b(151) - s3Start - bl(9)), 'easeOut'),
        ],
      },
      {
        id: tid(ctx, 'w3-metal'),
        type: 'textCard',
        variant: 'title',
        text: words[2],
        box: wordBox,
        plate: 'none',
        color: '#e8ecf4',
        fx: 'metal',
        startFrame: ctx.startFrame + s3Start,
        durationInFrames: Math.max(1, dur - s3Start),
        fadeFrames: 0,
        animate: [
          seg({ opacity: 0 }, { opacity: 1 }, bl(9), Math.max(1, b(151) - s3Start - bl(9)), 'easeOut'),
          seg({ opacity: 1 }, { opacity: 0 }, Math.max(bl(9), b(151) - s3Start), Math.max(1, b(176) - s3Start - (b(151) - s3Start)), 'easeOut'),
        ],
      },
      {
        id: tid(ctx, 'w3-white'),
        type: 'textCard',
        variant: 'title',
        text: words[2],
        box: wordBox,
        plate: 'none',
        color: '#ffffff',
        fx: 'glow',
        startFrame: ctx.startFrame + b(164),
        durationInFrames: Math.max(1, dur - b(164)),
        fadeFrames: 0,
        animate: [seg({ opacity: 0 }, { opacity: 1 }, 0, bl(13), 'easeOut')],
      },
    ]
  },
})

// ── TYP4 · gradient-word-sweep(渐变扫充关键词)──
// 上源:demos/typography/gradient-word-sweep/GradientWordSweep.tsx。节拍:整行 0–12f 入场
// (outCubic,36px 上移);关键词 12–30f 快扫充能(18f outQuad,波前最亮向后衰减);30f 后
// 稳态辉光呼吸 + 闪电勾连;黑底 #050505,正文纯白静置。
// 翻译口径(catalog「近似」):波前逐字符梯度无原语 → 关键词双层叠加:白底层 fx:'glow'
// (稳态泛光)+ fx:'metal' 渐变层 opacity 随扫充窗淡入(充能完成态);方向性由 blend:'screen'
// 亮带 shape rect 横扫(x 30→70,easeOut,12–30f)近似;闪电勾连放弃(catalog 判例:无原语,
// 不做预生成);稳态呼吸降级为静态 glow(上游已知坑「泛光宁弱勿强」);入场 36px 上移在
// box 轨不可用 → scale 0.97→1 近似;文案取首词为关键词,其余作伴随行(单词时整句扫充)。
registerCard({
  id: 'TYP4',
  title: '渐变扫字',
  assets: [],
  generate: (ctx) => {
    const dur = ctx.durationInFrames
    const b = (f: number) => beat(dur, 96, f)
    const bl = (f: number) => beatLen(dur, 96, f)
    const { word, rest } = leadWord(ctx.copy)
    const kwBox = { x: 50, y: 42, w: 64, h: 18 }
    const tracks: Record<string, unknown>[] = [
      {
        id: tid(ctx, 'base'),
        type: 'shape',
        shape: 'rect',
        color: '#050505',
        box: { x: 50, y: 50, w: 100, h: 100 },
        startFrame: ctx.startFrame,
        durationInFrames: dur,
        fadeFrames: 0,
      },
      {
        id: tid(ctx, 'kw-base'),
        type: 'textCard',
        variant: 'title',
        text: word,
        box: kwBox,
        plate: 'none',
        color: '#ffffff',
        fx: 'glow',
        letterSpacingEm: -0.01,
        startFrame: ctx.startFrame,
        durationInFrames: dur,
        fadeFrames: 0,
        animate: [seg({ opacity: 0, scale: 0.97 }, { opacity: 1, scale: 1 }, 0, bl(12), 'easeOutCubic')],
      },
      {
        id: tid(ctx, 'kw-grad'),
        type: 'textCard',
        variant: 'title',
        text: word,
        box: kwBox,
        plate: 'none',
        color: '#ffffff',
        fx: 'metal',
        letterSpacingEm: -0.01,
        startFrame: ctx.startFrame,
        durationInFrames: dur,
        fadeFrames: 0,
        animate: [seg({ opacity: 0 }, { opacity: 1 }, b(12), bl(18), 'easeOut')],
      },
      {
        // 扫充亮带:blend screen 加亮,随扫充窗横穿关键词(opacity 三角窗 12→22→32f)。
        id: tid(ctx, 'sweep'),
        type: 'shape',
        shape: 'rect',
        color: '#b48cff',
        blend: 'screen',
        box: { x: 50, y: 42, w: 10, h: 22 },
        startFrame: ctx.startFrame,
        durationInFrames: dur,
        fadeFrames: 0,
        animate: [
          seg({ opacity: 0 }, { opacity: 1 }, b(12), bl(10), 'linear'),
          seg({ opacity: 1 }, { opacity: 0 }, b(22), bl(10), 'linear'),
          seg({ x: 30 }, { x: 70 }, b(12), bl(18), 'easeOut'),
        ],
      },
    ]
    if (rest.length > 0) {
      tracks.push({
        id: tid(ctx, 'rest'),
        type: 'textCard',
        variant: 'title',
        text: rest,
        box: { x: 50, y: 62, w: 74, h: 14 },
        plate: 'none',
        color: '#ffffff',
        startFrame: ctx.startFrame,
        durationInFrames: dur,
        fadeFrames: 0,
        animate: [seg({ opacity: 0, scale: 0.97 }, { opacity: 1, scale: 1 }, 0, bl(12), 'easeOutCubic')],
      })
    }
    tracks.push({
      id: tid(ctx, 'vignette'),
      type: 'shape',
      shape: 'vignette',
      color: '#000000',
      strength: 0.55,
      box: { x: 50, y: 50, w: 100, h: 100 },
      startFrame: ctx.startFrame,
      durationInFrames: dur,
      fadeFrames: 0,
    })
    return tracks
  },
})

// ── TYP5 · outline-word-fill(描边→填充)──
// 上源:demos/typography/outline-word-fill/OutlineWordFill.tsx。节拍(75f):空心词 4–14f
// scale 3.2→1 outCubic 收缩落位(4–10f opacity 显影);描边 50–55f 微增亮;55.6–57.2f 实心白
// ≈0.6f 硬切点亮(pop),57–64.5f 辉光一闪衰减;虚线大圆 12–57f 从画外 2.8x 收缩 + 自转
// 0.6°/帧(opacity 12–22f 0.85);两侧水平虚线 37.5–54f 从画框边伸向圆;底 #030303 + 微尘。
// 翻译口径(catalog「近似」):描边层 fx:'outline'(奶油白描边近似上游灰描边)+ 实色层
// 硬切;pop 硬切用两层 textCard 同框换位(outline 层 1f 窗淡出、实色层 1f 窗亮起),一闪
// 辉光 = fx:'glow' 闪层 10f 衰减;实色层 scale 1.06→1 easeOut 补点亮顿挫;虚线圆 = shape
// circle(stroke+dash)+ animate(scale 2.8→1 / rotation 线性自转);两侧虚线降级为实线细
// path + draw(生长 =「伸向圆」,虚线纹理无原语);微尘用 dotGrid 静点阵近似。
registerCard({
  id: 'TYP5',
  title: '描边填充词',
  assets: [],
  generate: (ctx) => {
    const dur = ctx.durationInFrames
    const b = (f: number) => beat(dur, 75, f)
    const bl = (f: number) => beatLen(dur, 75, f)
    const { word } = leadWord(ctx.copy)
    const wordBox = { x: 50, y: 50, w: 40, h: 16 }
    const popStart = b(56)
    // 虚线大圆:视觉直径 352px → 盒 18.3%×32.5%(16:9 下为正方形盒)。
    const circIn = b(12)
    const rotTo = Math.round((dur - circIn) * 0.6 * 10) / 10
    return [
      {
        id: tid(ctx, 'base'),
        type: 'shape',
        shape: 'rect',
        color: '#030303',
        box: { x: 50, y: 50, w: 100, h: 100 },
        startFrame: ctx.startFrame,
        durationInFrames: dur,
        fadeFrames: 0,
      },
      {
        id: tid(ctx, 'dust'),
        type: 'shape',
        shape: 'dotGrid',
        color: 'rgba(255,255,255,0.12)',
        dotSpacing: 96,
        dotRadius: 1.2,
        box: { x: 50, y: 50, w: 100, h: 100 },
        startFrame: ctx.startFrame,
        durationInFrames: dur,
        fadeFrames: 0,
      },
      {
        id: tid(ctx, 'circle'),
        type: 'shape',
        shape: 'circle',
        color: 'transparent',
        stroke: '#7d838e',
        strokeWidthPx: 2,
        dash: [24, 32],
        box: { x: 50, y: 50, w: 18.3, h: 32.5 },
        startFrame: ctx.startFrame,
        durationInFrames: dur,
        fadeFrames: 0,
        animate: [
          seg({ opacity: 0 }, { opacity: 0.85 }, circIn, bl(10), 'easeOut'),
          seg({ scale: 2.8 }, { scale: 1 }, circIn, bl(45), 'easeOutCubic'),
          seg({ rotation: 0 }, { rotation: rotTo }, circIn, Math.max(1, dur - circIn), 'linear'),
        ],
      },
      {
        id: tid(ctx, 'line-left'),
        type: 'shape',
        shape: 'path',
        color: '#7d838e',
        d: 'M 0 50 L 30 50',
        strokeWidth: 0.08,
        draw: { to: 1, startFrame: b(38), durationInFrames: bl(16), easing: 'easeOutCubic' },
        startFrame: ctx.startFrame,
        durationInFrames: dur,
        fadeFrames: 0,
      },
      {
        id: tid(ctx, 'line-right'),
        type: 'shape',
        shape: 'path',
        color: '#7d838e',
        d: 'M 100 50 L 70 50',
        strokeWidth: 0.08,
        draw: { to: 1, startFrame: b(38), durationInFrames: bl(16), easing: 'easeOutCubic' },
        startFrame: ctx.startFrame,
        durationInFrames: dur,
        fadeFrames: 0,
      },
      {
        // 描边层:收缩落位 → 微增亮 → pop 硬切让位(各 opacity 窗首尾相接,避免段间
        // 空档被「末段终点」规则钉死)。
        id: tid(ctx, 'word-outline'),
        type: 'textCard',
        variant: 'title',
        text: word,
        box: wordBox,
        plate: 'none',
        color: '#e8e8e8',
        fx: 'outline',
        startFrame: ctx.startFrame,
        durationInFrames: dur,
        fadeFrames: 0,
        animate: [
          seg({ opacity: 0 }, { opacity: 0.85 }, b(4), Math.max(1, b(10) - b(4)), 'easeOutCubic'),
          seg({ opacity: 0.85 }, { opacity: 0.85 }, b(10), Math.max(1, b(50) - b(10)), 'linear'),
          seg({ opacity: 0.85 }, { opacity: 1 }, b(50), Math.max(1, b(55) - b(50)), 'easeOut'),
          seg({ opacity: 1 }, { opacity: 1 }, b(55), Math.max(1, b(56) - b(55)), 'linear'),
          seg({ opacity: 1 }, { opacity: 0 }, b(56), Math.max(1, b(57) - b(56)), 'linear'),
          seg({ scale: 3.2 }, { scale: 1 }, b(4), bl(10), 'easeOutCubic'),
        ],
      },
      {
        id: tid(ctx, 'word-solid'),
        type: 'textCard',
        variant: 'title',
        text: word,
        box: wordBox,
        plate: 'none',
        color: '#ffffff',
        startFrame: ctx.startFrame + popStart,
        durationInFrames: Math.max(1, dur - popStart),
        fadeFrames: 0,
        animate: [
          seg({ opacity: 0 }, { opacity: 1 }, 0, 1, 'linear'),
          seg({ scale: 1.06 }, { scale: 1 }, 0, bl(9), 'easeOut'),
        ],
      },
      {
        id: tid(ctx, 'word-flash'),
        type: 'textCard',
        variant: 'title',
        text: word,
        box: wordBox,
        plate: 'none',
        color: '#ffffff',
        fx: 'glow',
        startFrame: ctx.startFrame + popStart,
        durationInFrames: Math.min(Math.max(1, dur - popStart), bl(10)),
        fadeFrames: 0,
        animate: [seg({ opacity: 0.85 }, { opacity: 0 }, 0, bl(10), 'easeOut')],
      },
    ]
  },
})

// ── TYP6 · title-demote-to-label(标题降格标签)──
// 上源:demos/typography/TitleDemoteToLabel.tsx(A 变体,92f)。节拍:标题 0–12f blur 12→0
// 显影;站稳一拍后 32–52f 单段连续补间 scale 1→0.3 + 位置 (50%,44%)→(7.8%,10.2%)
// inOutCubic,落成左上节标签;内容骨架 44f 起生长(块间 6.4f 错峰、12f/块 outCubic,
// 宽度 0.35→1 + 28px 上浮);B 变体(文本选中高亮)不做。
// 翻译口径(catalog「能(原生)」):单段连续补间 = 无 box textCard + animate(x/y/scale
// 一段 inOutCubic —— 无 box 才允许 animate x/y);blur 显影 = anim:'fadeUp' + blur 12
// (offsetY 0、词距 0 → 整块同步);骨架块 = shape rect + animate(opacity+scale 0.35→1,
// pivot{0,50} 从左缘向右生长,近似上游宽度生长;28px 上浮降级省略);几何坐标按上游
// 1920×1080 版式折算成百分比。
registerCard({
  id: 'TYP6',
  title: '标题降格标签',
  assets: [],
  generate: (ctx) => {
    const dur = ctx.durationInFrames
    const b = (f: number) => beat(dur, 92, f)
    const bl = (f: number) => beatLen(dur, 92, f)
    // 骨架块(上游 left 150 / top 210 / gap 34 的 1920×1080 版式 → 百分比盒):
    const blocks: { box: Record<string, number>; color: string; card?: boolean }[] = [
      { box: { x: 46.9, y: 20.6, w: 78.1, h: 2.4 }, color: '#dcdcda' },
      { box: { x: 41.1, y: 26.2, w: 66.7, h: 2.4 }, color: '#dcdcda' },
      { box: { x: 44.8, y: 31.8, w: 74.0, h: 2.4 }, color: '#dcdcda' },
      { box: { x: 27.6, y: 37.3, w: 39.6, h: 2.4 }, color: '#dcdcda' },
      { box: { x: 46.9, y: 55.6, w: 78.1, h: 27.8 }, color: '#ffffff', card: true },
    ]
    const tracks: Record<string, unknown>[] = [
      {
        id: tid(ctx, 'base'),
        type: 'shape',
        shape: 'rect',
        color: '#ececea',
        box: { x: 50, y: 50, w: 100, h: 100 },
        startFrame: ctx.startFrame,
        durationInFrames: dur,
        fadeFrames: 0,
      },
      {
        // 无 box:textCard 铺满层,animate x/y(0–100 画布百分比)承担「降格位移」。
        id: tid(ctx, 'title'),
        type: 'textCard',
        variant: 'title',
        text: ctx.copy,
        plate: 'none',
        color: '#2f2f2f',
        letterSpacingEm: -0.015,
        anim: 'fadeUp',
        animOptions: { offsetY: 0, blur: 12, wordDelayFrames: 0 },
        startFrame: ctx.startFrame,
        durationInFrames: dur,
        fadeFrames: 0,
        animate: [
          seg({ x: 50, y: 44, scale: 1 }, { x: 8, y: 10, scale: 0.3 }, b(32), bl(20), 'easeInOutCubic'),
        ],
      },
    ]
    blocks.forEach((block, i) => {
      tracks.push({
        id: tid(ctx, `block${i + 1}`),
        type: 'shape',
        shape: 'rect',
        color: block.color,
        ...(block.card === true ? { radius: 16, stroke: '#d8d8d6', strokeWidthPx: 2 } : {}),
        pivot: { x: 0, y: 50 },
        box: block.box,
        startFrame: ctx.startFrame,
        durationInFrames: dur,
        fadeFrames: 0,
        animate: [
          seg({ opacity: 0, scale: 0.35 }, { opacity: 1, scale: 1 }, b(44 + i * 6.4), bl(12), 'easeOutCubic'),
        ],
      })
    })
    return tracks
  },
})
