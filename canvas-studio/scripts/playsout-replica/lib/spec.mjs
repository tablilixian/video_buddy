/**
 * playsout 复刻 · 分镜 spec（内容与时序的事实源）。
 *
 * 这份数据是「源工程 → manifest」的中间层：**只声明内容与时机**，不声明实现。
 * 组装器（`build-manifest.mjs`）把每条 spec 翻成 manifest 的轨。
 *
 * 所有帧号都是**全片坐标系**（与源工程 `Main.tsx` 的 `SHOTS` / `VO` / `SFX` 一致），
 * 组装时减去镜头起点变成「轨内相对帧」。
 */

/** 英文旁白：9 句（源工程 `Main.tsx` 的 `VO`）。 */
export const VO = [
  { from: 18, dur: 102, seconds: 3.192, src: 'vo/vo-01.mp3', text: 'Every super-app has dead time. PlaysOut fills it.' },
  { from: 236, dur: 184, seconds: 5.928, src: 'vo/vo-02.mp3', text: 'One feed inside your app. Mini-games, micro-dramas, live shows.' },
  { from: 452, dur: 146, seconds: 4.68, src: 'vo/vo-03.mp3', text: '12M users. 200 titles. Under three seconds to play.' },
  { from: 690, dur: 138, seconds: 4.392, src: 'vo/vo-04.mp3', text: 'One lightweight SDK. Native or webview, live in minutes.' },
  { from: 880, dur: 89, seconds: 2.76, src: 'vo/vo-05.mp3', text: 'PRISM matches the right title to every user.' },
  { from: 1030, dur: 92, seconds: 2.856, src: 'vo/vo-06.mp3', text: 'GPU nodes localize it for every market.' },
  { from: 1196, dur: 67, seconds: 2.04, src: 'vo/vo-07.mp3', text: 'A live catalogue, ready to ship.' },
  { from: 1372, dur: 110, seconds: 3.48, src: 'vo/vo-08.mp3', text: 'Built for super-apps, creators, and advertisers.' },
  { from: 1704, dur: 100, seconds: 2.952, src: 'vo/vo-09.mp3', text: 'PlaysOut. Bite-sized entertainment, everywhere.' },
]

/** 硬字幕窗口（源工程 `Captions.tsx` 的 `CAPTIONS`）。 */
export const CAPTIONS = [
  { from: 20, to: 118, text: 'Every super-app has dead time. PlaysOut fills it.' },
  { from: 238, to: 418, text: 'One feed inside your app. Mini-games, micro-dramas, live shows.' },
  { from: 454, to: 596, text: '12M users. 200 titles. Under three seconds to play.' },
  { from: 692, to: 826, text: 'One lightweight SDK. Native or webview, live in minutes.' },
  { from: 882, to: 967, text: 'PRISM matches the right title to every user.' },
  { from: 1032, to: 1120, text: 'GPU nodes localize it for every market.' },
  { from: 1198, to: 1261, text: 'A live catalogue, ready to ship.' },
  { from: 1374, to: 1480, text: 'Built for super-apps, creators, and advertisers.' },
  { from: 1706, to: 1798, text: 'PlaysOut. Bite-sized entertainment, everywhere.' },
]

/**
 * SFX 钉帧表（源工程 `audio.ts` 的 `SFX`，46 条）。
 * `startFrom` 是源工程 Remotion `<Audio startFrom>` 的源内起始帧 —— 我们的 DSL
 * 没有等价字段（只有 `gain` / `pan` / 淡入淡出），故**保留在 spec 里做溯源**，
 * 组装时不表达（能力缺口，见交付说明）。
 */
export const SFX = [
  { from: 0, src: 'audio/sfx/scifi/space-intro-futuristic.mp3', gain: 0.4 },
  { from: 8, src: 'audio/sfx/transition/swoosh-slow.mp3', gain: 0.45 },
  { from: 62, src: 'audio/sfx/transition/sweep-fast.mp3', gain: 0.3 },
  { from: 96, src: 'audio/sfx/transition/whoosh-big.mp3', gain: 0.5 },
  { from: 116, src: 'audio/sfx/impact/hit-fast-exciting.mp3', gain: 0.55 },
  { from: 120, src: 'audio/sfx/light/sparkle.mp3', gain: 0.45 },
  { from: 152, src: 'audio/sfx/transition/swoosh-quick.mp3', gain: 0.26 },
  { from: 206, src: 'audio/sfx/camera/zoom-futuristic.mp3', gain: 0.4 },
  { from: 262, src: 'audio/sfx/transition/transition-tech.mp3', gain: 0.36 },
  { from: 318, src: 'audio/sfx/camera/ui-zoom-in.mp3', gain: 0.3 },
  { from: 354, src: 'audio/sfx/ui/switch-click-quick.mp3', gain: 0.3 },
  { from: 368, src: 'audio/sfx/ui/switch-click-quick.mp3', gain: 0.28 },
  { from: 382, src: 'audio/sfx/ui/switch-click-quick.mp3', gain: 0.26 },
  { from: 420, src: 'audio/sfx/camera/ui-zoom-out.mp3', gain: 0.26 },
  { from: 446, src: 'audio/sfx/data/data-scan.mp3', gain: 0.36 },
  { from: 470, src: 'audio/sfx/counter/clock-tick-single.mp3', gain: 0.58 },
  { from: 500, src: 'audio/sfx/counter/clock-tick-single.mp3', gain: 0.55 },
  { from: 530, src: 'audio/sfx/counter/clock-mech-retract.mp3', gain: 0.32 },
  { from: 566, src: 'audio/sfx/light/shimmer-sparkle-sweep.mp3', gain: 0.32 },
  { from: 614, src: 'audio/sfx/transition/swoosh-quick.mp3', gain: 0.26 },
  { from: 668, src: 'audio/sfx/camera/zoom-futuristic.mp3', gain: 0.36 },
  { from: 700, src: 'audio/sfx/mech/machine-activate-short.mp3', gain: 0.34 },
  { from: 722, src: 'audio/sfx/text/typewriter-digital.mp3', gain: 0.24 },
  { from: 796, src: 'audio/sfx/light/sparkle-touch.mp3', gain: 0.3 },
  { from: 836, src: 'audio/sfx/data/whoosh-electric.mp3', gain: 0.36 },
  { from: 880, src: 'audio/sfx/transition/sweep-fast.mp3', gain: 0.26 },
  { from: 910, src: 'audio/sfx/transition/sweep-fast.mp3', gain: 0.26 },
  { from: 940, src: 'audio/sfx/transition/sweep-fast.mp3', gain: 0.26 },
  { from: 962, src: 'audio/sfx/ui/pop-electric.mp3', gain: 0.32 },
  { from: 978, src: 'audio/sfx/light/sparkle-touch.mp3', gain: 0.28 },
  { from: 1004, src: 'audio/sfx/data/data-compute.mp3', gain: 0.4 },
  { from: 1030, src: 'audio/sfx/scifi/tech-hum-futuristic.mp3', gain: 0.26 },
  { from: 1084, src: 'audio/sfx/transition/transition-snap.mp3', gain: 0.32 },
  { from: 1142, src: 'audio/sfx/light/stardust-swish.mp3', gain: 0.28 },
  { from: 1172, src: 'audio/sfx/transition/transition-tech-slide.mp3', gain: 0.4 },
  { from: 1232, src: 'audio/sfx/light/light-sweep-magic.mp3', gain: 0.32 },
  { from: 1292, src: 'audio/sfx/ui/switch-light.mp3', gain: 0.28 },
  { from: 1340, src: 'audio/sfx/transition/whoosh-fast.mp3', gain: 0.32 },
  { from: 1396, src: 'audio/sfx/ui/switch-click-quick.mp3', gain: 0.24 },
  { from: 1436, src: 'audio/sfx/ui/switch-click-quick.mp3', gain: 0.24 },
  { from: 1476, src: 'audio/sfx/ui/switch-click-quick.mp3', gain: 0.24 },
  { from: 1494, src: 'audio/sfx/transition/transition-soft.mp3', gain: 0.26 },
  { from: 1508, src: 'audio/sfx/transition/swoosh-quick.mp3', gain: 0.26 },
  { from: 1564, src: 'audio/sfx/transition/whoosh-big.mp3', gain: 0.42 },
  { from: 1532, src: 'audio/sfx/riser/riser-cine.mp3', gain: 0.5 },
  { from: 1676, src: 'audio/sfx/impact/impact-cine-big.mp3', gain: 0.6 },
  { from: 1676, src: 'audio/sfx/impact/hit-fast-exciting.mp3', gain: 0.45 },
  { from: 1676, src: 'audio/sfx/light/sparkle.mp3', gain: 0.4 },
  { from: 1710, src: 'audio/sfx/light/light-aura.mp3', gain: 0.24 },
]

/**
 * 三张呼吸字卡（源工程 `Main.tsx` 的三处 `TitleCard`）。
 *
 * 每行按**分段**声明（`segments`）：源工程用 `Seg[]` 区分普通词与强调词（强调词是
 * peri 色），我们的 DSL 一个轨只有一个颜色 ⇒ 强调段单独成轨、用 `fx:"metal"` 表达。
 */
export const TITLE_CARDS = [
  {
    shot: 't1',
    variant: 'slide',
    eyebrow: 'THE LAYER',
    lines: [
      { segments: [{ text: 'The' }, { text: 'entertainment', accent: true }] },
      { segments: [{ text: 'layer', accent: true }, { text: 'for every' }] },
      { segments: [{ text: 'super-app.' }] },
    ],
  },
  {
    shot: 't2',
    variant: 'wipe',
    eyebrow: 'INSTANT PLAY',
    lines: [
      { segments: [{ text: 'Under' }, { text: '3 seconds,', accent: true }] },
      { segments: [{ text: 'from tap to play.' }] },
    ],
  },
  {
    shot: 't3',
    variant: 'rise',
    eyebrow: 'GLOBAL',
    lines: [
      { segments: [{ text: 'One' }, { text: 'build.', accent: true }] },
      { segments: [{ text: 'Every market.' }] },
    ],
  },
]

/** Hero 的三格式 chip（源工程 `scenes/Hero.tsx` 的 `CHIPS`）。 */
export const HERO_CHIPS = [
  { text: 'Mini-games', from: 150, color: '#B6FF3C' },
  { text: 'Micro-dramas', from: 164, color: '#FF4D9D' },
  { text: 'Live shows', from: 178, color: '#38E1FF' },
]

/** Hero 的 2.5D 相机关键帧（源工程 `scenes/Hero.tsx` 的 PageCam keys）。 */
export const HERO_CAM = [
  { frame: 0, cx: 960, cy: 470, zoom: 0.95, rotX: 0, rotY: 0 },
  { frame: 56, cx: 960, cy: 530, zoom: 1.0, rotX: 0, rotY: 0 },
  { frame: 120, cx: 960, cy: 820, zoom: 1.07, rotX: 4, rotY: -5 },
  { frame: 190, cx: 960, cy: 930, zoom: 1.26, rotX: 8, rotY: 0 },
  { frame: 240, cx: 960, cy: 930, zoom: 1.30, rotX: 8, rotY: 0 },
]

/** SDK 的 2.5D 相机关键帧（源工程 `scenes/Sdk.tsx`）。 */
export const SDK_CAM = [
  { frame: 0, cx: 960, cy: 330, zoom: 0.98, rotX: 0, rotY: 0 },
  { frame: 64, cx: 960, cy: 520, zoom: 1.08, rotX: 3, rotY: -4 },
  { frame: 168, cx: 960, cy: 645, zoom: 1.18, rotX: 5, rotY: 0 },
]

/** SDK 的代码块（源工程 `scenes/Sdk.tsx` 的 `CODE`，逐行合并成纯文本）。 */
export const SDK_CODE = [
  "import { PlaysOut } from '@playsout/sdk';",
  '',
  "PlaysOut.init({ appId, locale: 'en-MY' });",
  "PlaysOut.open({ format: 'mini-game' });",
]

/** 规模数据的四行（源工程 `scenes/Metrics.tsx` 的 `ROWS`）。 */
export const METRIC_ROWS = [
  { value: '12M+', label: 'Users reached to date', color: '#ECECF2', start: 8 },
  { value: '200+', label: 'Titles live', color: '#98A3FF', start: 14 },
  { value: '6.2 min', label: 'Average session length', color: '#ECECF2', start: 20 },
  { value: '<3s', label: 'Load time, full stack shipped', color: '#98A3FF', start: 26 },
]

/** PRISM：宿主 App 里的 9 个 logo + 6 张汇聚中的内容卡（源工程 `scenes/Prism.tsx`）。 */
export const PRISM_IN_APP = ['grab', 'wechat', 'line', 'snapchat', 'careem', 'douyin', 'viu', 'erosnow', 'tvazteca']

export const PRISM_CARDS = [
  { src: 'games/kitty-crush-saga.jpg', from: { x: 2080, y: 216 }, to: { x: 770, y: 392 }, rot: 14, hit: true },
  { src: 'games/fifa-rivals.jpg', from: { x: 2120, y: 466 }, to: { x: 1006, y: 392 }, rot: -10 },
  { src: 'games/drama-dont-mess.jpg', from: { x: 2050, y: 726 }, to: { x: 1242, y: 392 }, rot: 8 },
  { src: 'games/tetris.jpg', from: { x: 2140, y: 966 }, to: { x: 770, y: 628 }, rot: -6 },
  { src: 'games/drama-walked-away.jpg', from: { x: 2000, y: 1076 }, to: { x: 1006, y: 628 }, rot: 12 },
  { src: 'games/monopoly.jpg', from: { x: 2160, y: 336 }, to: { x: 1242, y: 628 }, rot: -14 },
]

/** Compute 的 4 个节点（源工程 `scenes/Compute.tsx` 的 `NODES`，像素坐标）。 */
export const COMPUTE_NODES = [
  { x: 480, y: 414, label: 'Mexico City' },
  { x: 965, y: 306, label: 'Istanbul' },
  { x: 1251, y: 389, label: 'UAE' },
  { x: 1488, y: 496, label: 'Malaysia' },
]

/** Audience 的三列强调（源工程 `scenes/Audience.tsx` 的 `TICKS`）。 */
export const AUDIENCE_TICKS = [
  { x: 344, label: 'FOR SUPER-APPS', color: '#B6FF3C', at: 54 },
  { x: 960, label: 'FOR CREATORS', color: '#FF4D9D', at: 96 },
  { x: 1578, label: 'FOR ADVERTISERS', color: '#FFC24B', at: 138 },
]

/** 收场合影的 9 块（源工程 `scenes/Outro.tsx` 的 `TILES`）。 */
export const OUTRO_TILES = [
  { src: 'partners/grab.png', kind: 'logo' },
  { src: 'games/kitty-crush-saga.jpg', kind: 'cover' },
  { src: 'partners/wechat.png', kind: 'logo' },
  { src: 'games/drama-dont-mess.jpg', kind: 'cover' },
  { src: 'partners/snapchat.png', kind: 'logo' },
  { src: 'games/fifa-rivals.jpg', kind: 'cover' },
  { src: 'partners/line.png', kind: 'logo' },
  { src: 'games/monopoly.jpg', kind: 'cover' },
  { src: 'partners/careem.png', kind: 'logo' },
]

/** 各镜头的眉标（源工程各 scene 里的 `Eyebrow`）。 */
export const EYEBROWS = {
  open: { from: 132, text: 'MINI PROGRAMS INFRASTRUCTURE' },
  hero: { from: 8, text: '[01]  ONE FEED · EVERY FORMAT' },
  metrics: { from: 4, text: '[ WHY PLAYSOUT ]  SCALE, MEASURED' },
  sdk: { from: 4, text: '[02]  DUAL-FORM SDK · NATIVE + WEBVIEW' },
  prism: { from: 4, text: '[03]  PRISM · RIGHT CONTENT, EACH USER' },
  compute: { from: 4, text: '[04]  COMPUTE · LOCALISED, GPU-POWERED' },
  catalogue: { from: 6, text: '[05]  CATALOGUE · 200+ TITLES, LOCALISED' },
  audience: { from: 4, text: "[06]  WHO IT'S FOR" },
}
