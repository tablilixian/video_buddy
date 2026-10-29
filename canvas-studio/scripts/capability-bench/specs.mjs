/**
 * 能力基准 · 十项规格表（唯一的"要测什么"来源）。
 *
 * 状态三种：
 *   done        —— 已实现，能出片
 *   todo        —— 设计已定（文档 §12.1），等实现：在 compositions/ 加 `NN-<axis>.tsx`
 *                  并在 entry.tsx 的 REGISTRY 里加一行
 *   substitute  —— 用近似实现（例：#2 没有 Skia，用 filter 链复刻"磨砂/噪点/光晕"）
 *
 * 素材池键：`clip` / `bgm` / `image` / `grain`，真实路径见下方 POOL_SOURCES。
 * **素材只占位，不评画质**（只要求 ffprobe 能读、宽高够铺满、时长够覆盖）。
 */

/** 素材池真实路径（VideoOut 输出目录，引用不复制）。换机器只需改这里。 */
export const POOL_SOURCES = {
  clip: '/Users/wl/Desktop/job/VideoOut/new222/projects/你好，分析一下这些素材/assets/3df37ec2-f100-42a9-bac9-8b4583bd0510.mp4',
  bgm: '/Users/wl/Desktop/job/VideoOut/new222/projects/生成一段伊甸园故事的视频，素材和故事，你/assets/474929ba-4c38-44b9-8958-02dcd1ae22e6.mp3',
  // 亮度实测 YAVG 118.8（中档，四格滤镜上/下都能看出来），1280×736 横版
  image: '/Users/wl/Desktop/job/VideoOut/new222/projects/帮我制作一段科普视频，玻璃为什么是透明的/assets/28d8647d-2557-4ca9-970e-ebab5b37c50d.png',
  // #05 的 TTS 真配音（本轮自产，3.864s；词级时间戳见 05-caption-word.tsx 头注释）
  tts: '/Users/wl/Desktop/job/VideoOut/remotion-capability-20261029/_assets/cap05-tts.mp3',
}

export const SPECS = [
  {
    id: '01',
    axis: '3d-webgl',
    title: '3D / WebGL（R3F 场景 + 贴图）',
    reference: 'three-basic · three-html',
    status: 'done',
    durationInFrames: 360,
    stills: [60, 179, 299],
    deps: 'three@0.170 + @react-three/fiber@8.18.0 + @remotion/three@4.0.535（子工程 npm i --legacy-peer-deps，G1/G2）',
    design: '暗底片头三段：P1 金属环面自转+轨道推近 → P2 图片贴图 → P3 视频贴图（useVideoTexture 帧精确 seek）；动画全用 useCurrentFrame 纯帧函数。',
    assets: ['image', 'clip'],
    expect: { videoCodec: 'h264', audioCodec: 'aac', hasAudio: false, minMotion: true },
  },
  {
    id: '02',
    axis: 'skia-shader',
    title: 'Skia 着色器（磨砂 / 噪点 / 光晕）· 近似片',
    reference: 'skia-shader · skia-zoomblur',
    status: 'substitute',
    durationInFrames: 240,
    stills: [60, 119, 200],
    deps: '近似方案零依赖；真 Skia 需 @remotion/skia + @shopify/react-native-skia（解包 9.6MB + CanvasKit wasm，可选冒烟本轮未做）',
    design: '近似三连：磨砂卡（手动模糊底图副本模拟 backdrop-filter）+ 三层 repeating-gradient 帧偏移噪点 + blur 光斑扫过；全部 filter 白名单内纯函数。',
    assets: ['image'],
    expect: { videoCodec: 'h264', audioCodec: 'aac', hasAudio: false, minMotion: true },
  },
  {
    id: '03',
    axis: 'html-in-canvas',
    title: '全量捕获（绕过 CSS 白名单）',
    reference: 'html-in-canvas-compose-webgl · html-in-canvas-motion-blur',
    status: 'done',
    durationInFrames: 300,
    allowHtmlInCanvas: true,
    deps: '零依赖，只需 Chromium flag `CanvasDrawElement` + Remotion 侧 allowHtmlInCanvas（R1 待验）',
    design: '皇冠片：conic-gradient 光环 + backdrop-filter 玻璃卡 + mix-blend-mode 颗粒层 + WebGL 立方体，一次录下来。',
    assets: ['image', 'grain'],
    expect: { videoCodec: 'h264', audioCodec: 'aac', hasAudio: false, minMotion: true },
  },
  {
    id: '04',
    axis: 'chart-map',
    title: '数据可视化（柱/折线 + 抽象 hexmap）',
    reference: 'AnimatedBarChart · switzerland-map',
    status: 'done',
    durationInFrames: 360,
    stills: [80, 179, 299],
    deps: '零依赖（纯 DOM/SVG）；地图**不做真实地理**（合规红线），改抽象 hexmap',
    design: 'a) 柱状+折线双轴，数据取伊甸园 manifest 8 条视频轨真实镜头时长；b) 六边形格阵按确定性 hash 值亮起（无国界、无投影）。',
    assets: [],
    expect: { videoCodec: 'h264', audioCodec: 'aac', hasAudio: false, minMotion: true },
  },
  {
    id: '05',
    axis: 'caption-word',
    title: '词级字幕（karaoke + 自动换行）',
    reference: 'captions-tester',
    status: 'done',
    durationInFrames: 300,
    stills: [20, 75, 149],
    deps: '零依赖（canvas measureText 自算折行）；词级时间戳 = 离线能量谷对齐（后端 TTS 无词级戳）',
    design: '"凌晨三点，门外的脚步声忽然停了。" 逐字 karaoke 高亮 + measureText 贪心折行 + 安全区避让；底部逐字对齐时间轴可核高亮与音频的相位。',
    assets: ['tts'],
    expect: { videoCodec: 'h264', audioCodec: 'aac', hasAudio: true, minMotion: true },
  },
  {
    id: '06',
    axis: 'audio-viz',
    title: '音频驱动视觉（波形 / 频谱）',
    reference: 'audio-visualization',
    status: 'done',
    durationInFrames: 300,
    stills: [30, 149, 268],
    deps: '零依赖（AudioContext.decodeAudioData + 纯函数）',
    design: 'mp3 包络驱动 64 根柱 + 连续波形线 + 六频段着色（box 低通级联，非 FFT）；柱高 = 包络采样，纯帧函数。',
    assets: ['bgm'],
    expect: { videoCodec: 'h264', audioCodec: 'aac', hasAudio: true, minMotion: true },
  },
  {
    id: '07',
    axis: 'path-morph',
    title: '矢量路径变形（interpolatePath）',
    reference: 'path-morph · shapes-morph · scale-path',
    status: 'done',
    durationInFrames: 240,
    deps: '@remotion/paths（已有）；万一是 SVG DOM 分支不通，改 clip-path: path()（§11.2 R4）',
    design: '圆 → 星 → 箭头同点数重采样 morph，描边边生长边变形。',
    assets: [],
    expect: { videoCodec: 'h264', audioCodec: 'aac', hasAudio: false, minMotion: true },
  },
  {
    id: '08',
    axis: 'effects',
    title: '滤镜 / 调色链',
    reference: 'effects-testbed',
    status: 'done',
    durationInFrames: 240,
    stills: [60, 119, 200],
    deps: '零依赖（filter 白名单）；blend / backdrop-filter / perspective 在 4.0.535 实证不读（§10.9）',
    design: '上排四格 filter 链（blur/tint/做旧/光晕，动态参数）+ 下排三格：look 五参一条链、mix-blend-mode difference 对照（预期失效 ⇒ R2 BUG 证据）、原图基线。',
    assets: ['image'],
    expect: { videoCodec: 'h264', audioCodec: 'aac', hasAudio: false, minMotion: true },
  },
  {
    id: '09',
    axis: 'transition',
    title: '转场（8 种现有 + clock-poly 修正 + 3 种近似）',
    reference: 'webgl-transition · light-leak',
    status: 'done',
    durationInFrames: 555,
    stills: [0, 292, 337, 382, 554],
    deps: '零依赖；clock 原版（conic mask，预期失效证据）+ clock-poly（clip-path: polygon() 扇形，R3 修正解）',
    design: '12 格 × 1.5s 逐格标名连播：fade/slide/zoom/dissolve/wipeL/wipeR/clock(conic 原版)/clock-poly(修正)/flipX(perspective 原版)/zoomBlur/linearBlur/crossWarp；clock 与 flipX 是问题项目视判据。',
    assets: ['image'],
    expect: { videoCodec: 'h264', audioCodec: 'aac', hasAudio: false, minMotion: true },
  },
  {
    id: '10',
    axis: 'editing',
    title: '剪辑：跳剪 / 变速 / 独立音轨',
    reference: 'video-editing-transition-series · sequence-playback-rate-testbed · jump-cuts',
    status: 'done',
    durationInFrames: 300,
    deps: '零依赖（@remotion/media 的 Video/Audio）',
    design: '同一段素材 5 次跳剪（trimBefore 各异）+ 变速 0.5/1/1.5/2 + 独立音轨 ducking。',
    assets: ['clip', 'bgm'],
    expect: { videoCodec: 'h264', audioCodec: 'aac', hasAudio: true, minMotion: true },
  },
]

export function getSpec(id) {
  const spec = SPECS.find((s) => s.id === id)
  if (!spec) throw new Error(`未知能力项：${id}（可选：${SPECS.map((s) => s.id).join(', ')}）`)
  return spec
}
