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
}

export const SPECS = [
  {
    id: '01',
    axis: '3d-webgl',
    title: '3D / WebGL（R3F 场景 + 贴图）',
    reference: 'three-basic · three-html',
    status: 'todo',
    deps: 'three + @react-three/fiber@^8.18 + @remotion/three（G2：默认装 9.x 会要 React 19，必崩）',
    design: '暗底片头：金属环面自转 + 轨道推近；第 4s 起贴占位图，再换 mp4 片段做 video texture。',
    assets: ['image', 'clip'],
    expect: { videoCodec: 'h264', audioCodec: 'aac', hasAudio: false, minMotion: true },
  },
  {
    id: '02',
    axis: 'skia-shader',
    title: 'Skia 着色器（磨砂 / 噪点 / 光晕）',
    reference: 'skia-shader · skia-zoomblur',
    status: 'substitute',
    deps: '近似方案零依赖；真 Skia 需 @remotion/skia + @shopify/react-native-skia（解包 9.6MB + CanvasKit wasm）',
    design: '近似：filter 链 + 预渲染噪点贴图做磨砂玻璃卡/噪点/光晕三连；可选冒烟：30 行 SkiaCanvas 画一个 runtime shader。',
    assets: ['image', 'grain'],
    expect: { videoCodec: 'h264', audioCodec: 'aac', hasAudio: false, minMotion: true },
  },
  {
    id: '03',
    axis: 'html-in-canvas',
    title: '全量捕获（绕过 CSS 白名单）',
    reference: 'html-in-canvas-compose-webgl · html-in-canvas-motion-blur',
    status: 'todo',
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
    status: 'todo',
    deps: '零依赖（纯 DOM/SVG）；地图**不做真实地理**（合规红线），改抽象 hexmap',
    design: 'a) 柱状+折线双轴，数据取真实镜头时长；b) 六边形格阵按值亮起（无国界、无投影）。',
    assets: [],
    expect: { videoCodec: 'h264', audioCodec: 'aac', hasAudio: false, minMotion: true },
  },
  {
    id: '05',
    axis: 'caption-word',
    title: '词级字幕（karaoke + 自动换行）',
    reference: 'captions-tester',
    status: 'todo',
    deps: '文本测量可选 @remotion/layout-utils；也可自算 measureText',
    design: '一句 12 字中文逐字高亮 + 两行自动换行 + 安全区避让；配音走后端 TTS。',
    assets: ['tts'],
    expect: { videoCodec: 'h264', audioCodec: 'aac', hasAudio: true, minMotion: true },
  },
  {
    id: '06',
    axis: 'audio-viz',
    title: '音频驱动视觉（波形 / 频谱）',
    reference: 'audio-visualization',
    status: 'todo',
    deps: '零依赖（AudioContext.decodeAudioData + 纯函数）',
    design: 'mp3 驱动 64 根柱 + 连续波形线 + 分频段三色；柱高必须与音频包络相关。',
    assets: ['bgm'],
    expect: { videoCodec: 'h264', audioCodec: 'aac', hasAudio: true, minMotion: true },
  },
  {
    id: '07',
    axis: 'path-morph',
    title: '矢量路径变形（interpolatePath）',
    reference: 'path-morph · shapes-morph · scale-path',
    status: 'todo',
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
    status: 'todo',
    deps: '零依赖（filter 白名单）；blend / backdrop-filter / perspective 在 4.0.535 实证不读（§10.9）',
    design: '同一张图切四格各跑一组 filter 组合；并排一格 look 五参、一格 mix-blend-mode（预期无变化 ⇒ 记 BUG 不判失败）。',
    assets: ['image'],
    expect: { videoCodec: 'h264', audioCodec: 'aac', hasAudio: false, minMotion: true },
  },
  {
    id: '09',
    axis: 'transition',
    title: '转场（8 种现有 + 3 种近似）',
    reference: 'webgl-transition · light-leak',
    status: 'todo',
    deps: '零依赖；clock 改 clip-path: polygon() 扇形（mask 只认 linear-gradient/url，§11.2 R3）',
    design: '8 种各 1.5s 连播并逐格标名，再接 zoomBlur / linearBlur / crossWarp 三种近似。',
    assets: ['image'],
    expect: { videoCodec: 'h264', audioCodec: 'aac', hasAudio: false, minMotion: true },
  },
  {
    id: '10',
    axis: 'editing',
    title: '剪辑：跳剪 / 变速 / 独立音轨',
    reference: 'video-editing-transition-series · sequence-playback-rate-testbed · jump-cuts',
    status: 'done',
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
