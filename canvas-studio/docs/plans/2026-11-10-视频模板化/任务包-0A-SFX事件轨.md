# 任务包 0A · SFX 事件轨（程序化合成音效 + 渲染接线）

> **一句话目标**：让 `render_composition` 渲出的成片**带声音**，且音效点时刻与模板声明**逐点对齐（±1 帧）**。
> **归属**：Phase 0 第 0.1 项 · 消灭差距 #1 · 纯能力缺口
> **共享数据**：[`视频模板化-基线与代码事实索引.md`](视频模板化-基线与代码事实索引.md)（基线与资产路径，动手前先读）

---

## 0. 交给你的边界

| | |
|---|---|
| **要做** | ① manifest 契约扩 `audio.sfx[]` ② 程序化合成音效库（零授权） ③ 渲染侧把 sfx 播出来 ④ 音效资产落盘与同源引用 |
| **不要做** | 不要动 `audio-timeline.ts` 的 `buildAudioGraph`（那是 `compose_video` 路径，不归本任务） · 不要动任何 `textCard` / `shape` 外观 · 不要改 `render_composition` 的既有入参语义 |
| **前置** | 无（可与 0B、1C 并行） |
| **预计** | 3–5 个工作日 |

---

## 1. 现状（动手前请按 `视频模板化-基线与代码事实索引.md` §5 的索引**重读**这些文件，可能已被并发会话改动）

### 1.1 实机成片为什么是静音

```
render_composition
  └─ renderMediaOnWeb  (src/client/remotion-render.ts:266)
       └─ Remotion 合成（浏览器内 CSR）
            └─ <AudioTrack audio={manifest.audio} …/>   (src/remotion/components/AudioTrack.tsx)
                 ├─ audio.bgmUrl     → <Audio volume={(f)=>audioVolumeAt(f, env)} />
                 ├─ audio.voiceOverUrl → <Audio volume={voiceVolume} />
                 └─ audio.voiceOver[]  → <Sequence from={startFrame}><Audio/></Sequence>
```

**`AudioTrack` 只认这三样。**没有 sfx，没有事件，没有 pan。

### 1.2 为什么不复用已有的音频时间轴

`src/audio-timeline.ts` 有完整的 `AudioSegmentRole = 'native'|'bgm'|'voiceOver'|'sfx'`、`AudioSegment.startSec/gain/fadeInSec/fadeOutSec/duckAmount/onShort`、`buildAudioGraph`（ffmpeg filter_complex 唯一生成点，支持 pan 与闪避）。

**但它只被 `compose_video` 用**（`compose.ts:669`）。`render_composition` 走的是 Remotion 组件内播放，**根本不进 ffmpeg 混音**。

⇒ **不要试图把 render 路径改成走 ffmpeg**（会推翻「一键出带音轨成片」的既有拍板，见 `AudioTrack.tsx` 头部注释）。**在组件内播 sfx。**

### 1.3 `<Audio>` 没有 pan

`@remotion/media` 的 `<Audio>` 只有 `src` 和 `volume`（可以是 `(frame) => number`），**没有声像参数**。

⇒ **pan 必须在素材里烘好**。而我们的音效是程序化合成的 ⇒ 烘 pan 零成本。

---

## 2. 设计决策（照做，别改）

### 决策 1：契约落 `manifest.audio.sfx[]`，**三种定位方式并存，互斥**

```jsonc
"audio": {
  "sfx": [
    { "src": "/canvas-studio/remotion/sfx/thud.wav", "startSec": 0.58, "gain": 0.55, "pan": 0 },

    // 模板写法：跟着轨道走，模板被复用/整段位移时不用改
    { "src": "/canvas-studio/remotion/sfx/card.wav",
      "anchor": { "trackId": "b2-card-1", "at": "start", "offsetSec": 0.12 }, "gain": 0.3 },

    // 帧精确写法：验收复刻 GT 时用，绕开秒→帧舍入争议
    { "src": "/canvas-studio/remotion/sfx/swipe.wav", "startFrame": 1056, "gain": 0.3 }
  ]
}
```

**为什么不是"只用帧"或"只用秒"**（2026-11-10 拍板，推翻本节旧版的"只用秒"）：

| 定位方式 | 语义 | 谁用 | 优先级 |
|---|---|---|---|
| `anchor` | 相对某条轨的 `start`/`end` + `offsetSec` | **模板**（模板是骨架，音效必须跟着卡走） | 1（最高） |
| `startFrame` | 成片绝对帧 | GT 复刻验收、需要帧精确的场合 | 2 |
| `startSec` | 成片绝对秒 | 手写 manifest、跨 fps 复用 | 3 |

- **必须支持 `anchor`**（K-8）：否则模板换个例子、卡片位移，音效就全错位。`host-tools.ts:4430` 已有同构的 anchor 思路可照抄。
- **`startSec` 仍保留**：它是"物理时间"的唯一正确表示 —— 同一模板在 30fps / 60fps 下 `startSec` 不变而 `startFrame` 要变。旧版这个论证是对的。
- **`startFrame` 必须加**：GT 真值 `9.060s × 60 = 543.6` 帧，与视觉入场 544 帧差 0.4 帧。要断言"音画帧域精确对齐"，秒制做不到（`round` 是唯一桥）。
- **三者同时给 ≥2 个 ⇒ error**（叠在一起语义不明，必须拒收，不能"取优先级最高的那个"静默忽略）。

> **与总表 P-5「帧为基准」的关系**：P-5 管的是**验收口径**（比对时一律换到帧域，不拿秒值互扣），本决策管的是**存储格式**（三种都存，按用途选）。两者不冲突，桥就是 `startFrame = anchor ? anchorFrame : round(startSec × fps)`。

### 决策 2：运行时**只认 `src`**；`type` 是可选元数据

合成 DSP 跑不了在 CSR 渲染里（浏览器里没有我们的合成库，且合成必须确定性）。所以：

> **合成是离线步骤，产出 WAV 文件；渲染期只引用文件。**

契约里 `type` 保留为**可选**的溯源元数据（记录「这份素材是用哪个配方合成的」），**渲染器不解释它**。校验层也不因缺 `type` 报错。

> ⚠️ 别设计成「运行时按 `type` 合成」—— 那会让渲染依赖浏览器 DSP，不可控也不可测。

### 决策 3：pan 在合成期烘入文件

- 合成库接受 `pan` 参数，按 MotionGit 的等功率声像公式生成立体声：
  ```
  L = x·√((1−p)/2)    R = x·√((1+p)/2)    p ∈ [−1, 1]
  ```
  （与 `native_audiolib.py:21` `pan()` 一致）
- manifest 里的 `pan` 字段**只作声明与校验**，运行时不再处理。
- **若 `src` 指向用户自带素材（非本仓合成库产出），`pan` 不生效 ⇒ 校验层必须发 warning**：`「外部音效素材不支持声像，pan 已被忽略」`。

### 决策 4：素材同源约束不变

`src` 必须满足与其它轨一样的同源约束，外链一律拒收。两条合法路径：
- **包内合成素材**：物理 `<pkg>/assets/sfx/*.wav`，URL `/canvas-studio/remotion/sfx/*.wav`（新增只读路由，见 §5.2 / P-1）
- **用户自带素材**：项目资产目录内 `/<projectId>/<file>`（该路由要求**恰好两段**，不能有子目录）

> ⚠️ **不要**写 `/canvas-studio/assets/sfx/x.wav`。`/canvas-studio/assets` 那条路由（`routes.ts:1229`）要求恰好两段 `/<projectId>/<file>`，会把 `sfx` 当成 projectId ⇒ 404。

---

## 3. 契约定义

### 3.1 TypeScript

```ts
/** manifest.ts —— 放在 ManifestAudio 上方 */

/** sfx 的锚定定位：跟随某条轨的起点/终点。模板必用（换例子、卡片位移时不用改音效表）。 */
export interface ManifestSfxAnchor {
  /** 被锚定的轨 id。必须存在于 tracks[] 中，否则 error。 */
  trackId: string
  /** 锚到该轨的起点还是终点（end = startFrame + durationInFrames）。 */
  at: 'start' | 'end'
  /** 相对锚点的偏移（秒，可负）。缺省 0。 */
  offsetSec?: number
}

export interface ManifestSfx {
  /** 音效素材 URL。与 tracks[].src 同一套同源约束（`validateAssetRefField`）。 */
  src: string
  /**
   * 定位：**三者必须恰好给一个**（给 0 个或 ≥2 个都报 error）。
   *   1. anchor     —— 模板写法，跟随轨道
   *   2. startFrame —— 帧精确（GT 复刻验收）
   *   3. startSec   —— 绝对秒，跨 fps 复用
   */
  anchor?: ManifestSfxAnchor
  /** 绝对起点（帧，成片时间坐标）。与 startSec / anchor 互斥。 */
  startFrame?: number
  /** 绝对起点（秒，成片时间坐标）。渲染时按 fps 换算成帧。与 startFrame / anchor 互斥。 */
  startSec?: number
  /** 线性增益 0–2（缺省 1）。1 = 原音量。 */
  gain?: number
  /** 声明用声像 −1..1（0 = 居中）。**仅在素材由本仓合成库产出时生效**；
   *  指向外部素材时校验层发 warning（pan 被忽略）。MVP 不复刻声像，验收不断言。 */
  pan?: number
  /** 淡入（秒，缺省 0）。 */
  fadeInSec?: number
  /** 淡出（秒，缺省 0）。 */
  fadeOutSec?: number
  /** 可选溯源元数据：这份素材由哪个合成配方产出（渲染器不解释）。 */
  type?: string
}
```

```ts
/**
 * 把一条 sfx 解析成绝对帧号。**唯一换算入口**（渲染与校验都调它，不许各写一份）。
 * 返回 null 表示定位不合法（调用方负责报 error）。
 */
export function resolveSfxStartFrame(
  sfx: ManifestSfx,
  ctx: { fps: number; trackById: Map<string, { startFrame: number; durationInFrames: number }> },
): number | null
```

> **为什么要有 `resolveSfxStartFrame` 这个唯一入口**：三种定位方式 × 渲染/校验/验收脚本 = 6 处独立换算会漂。本仓已有 `startAfter` 的先例（`normalize-timing.ts` 统一解析），sfx 照同一模式做。

```ts
// ManifestAudio 内追加
  /**
   * 音效事件轨。定位三选一（anchor / startFrame / startSec）。
   * 素材由程序化合成库离线产出（零授权）；运行时只引用文件，不做实时合成。
   */
  sfx?: ManifestSfx[]
```

### 3.2 校验规则（`manifest.ts`）

| 规则 | 级别 |
|---|---|
| `sfx` 存在时必须是数组 | error |
| `sfx` 为空数组 ⇒ error（「没有音效就别写这个字段」） | error |
| `sfx` 条数 > 64 ⇒ error（对齐 `MAX_VOICE_OVER_CLIPS` 的量级） | error |
| **`anchor` / `startFrame` / `startSec` 恰好给一个**（0 个或 ≥2 个） | error |
| `anchor.trackId` 不存在于 `tracks[]` | error |
| `anchor.at` 不是 `'start' \| 'end'` | error |
| 每项 `src` 非空字符串且过 `validateAssetRefField`（同源） | error |
| 每项 `startSec` 是有限数且 ≥ 0；`startFrame` 是非负整数 | error |
| 每项 `gain` 在 0–2（缺省 1） | error |
| 每项 `pan` 在 −1..1（缺省 0） | error |
| 解析出的帧号超出成片时长 ⇒ warning（别用 error，音频轨短于成片是常态） | warning |
| `pan ≠ 0` 且 `src` 指向外部素材（不在本仓合成库清单内） ⇒ warning | warning |
| `sfx` 出现在 `KNOWN_AUDIO_KEYS` 里（否则整段会被判契约外字段） | — |

---

## 4. 改动清单

### 4.1 契约层

| 文件 | 改动 |
|---|---|
| `src/remotion/manifest.ts` | ① 加 `ManifestSfx` 接口 ② `ManifestAudio` 加 `sfx?: ManifestSfx[]` ③ `KNOWN_AUDIO_KEYS`（:974）加 `'sfx'` ④ 新增 `KNOWN_SFX_KEYS` ⑤ 在 audio 校验段（:1852 起）加 sfx 校验 |
| `src/remotion/timing.ts` | 新增纯函数 `sfxStartFrame(sfx, fps): number[]`（秒→帧，含排序与去重）——**放这里是因为它属于「时间轴算术」，与 `audioVolumeAt` 同域** |

> **铁律**：`KNOWN_AUDIO_KEYS` 不加 `'sfx'` ⇒ 整段 sfx 会被判契约外字段而报 warning。**这是最容易漏的一步。**

### 4.2 渲染层

| 文件 | 改动 |
|---|---|
| `src/remotion/components/AudioTrack.tsx` | 追加 sfx 渲染：`(audio.sfx ?? []).map((s, i) => <Sequence key={...} from={Math.max(0, Math.round(s.startSec * fps))} layout="none"><Audio src={s.src} volume={s.gain ?? 1} /></Sequence>)` |

要点：
- **`layout="none"`**（与 `voiceOver` 一致）：音频不产生视觉盒子，别让它参与布局。
- 音量：`<Audio>` 的 `volume` 可以是 `(frame) => number` ⇒ 若要支持 `fadeInSec`/`fadeOutSec`，写成函数：`volume={(f) => sfxVolumeAt(f, {startFrame, gain, fadeInSec, fadeOutSec})}`。**把 `sfxVolumeAt` 做成 `timing.ts` 里的纯函数**（可单测），与 `audioVolumeAt` 同风格。
- 缺省 `gain` = 1。

### 4.3 音效合成库（新目录 `src/audio-sfx/`）

> 按 canvas-studio 的规则：**可单测的纯函数放 `src/*.ts` 顶层或专目录，不要放 `src/client/**`**（`src/client/` 是 React 渲染进程侧）。

| 文件 | 内容 |
|---|---|
| `src/audio-sfx/dsp.ts` | DSP 原语（纯函数，零 IO）：`lowpass` / `highpass` / `bandpass` / `adsr` / `pan` / `saw` / `sq` / `tri` / `sin` / `sweep` / `noise` / `reverb` / `addAt` |
| `src/audio-sfx/voices.ts` | 音效配方：`hit` / `pop` / `whoosh` / `swoosh` / `card` / `tick` / `thud` / `write` / `typing` / `click` / `ding` / `rise` / `stamp` / `crash`（**先做这 14 个够 B1+B2 用**，全 34 种后续按需补） |
| `src/audio-sfx/synth.ts` | `renderVoice(type, options) → { left: Float32Array, right: Float32Array, sampleRate }` |
| `src/audio-sfx/wav.ts` | WAV 写出：44 字节 RIFF 头 + PCM16 交错 stereo |
| `src/audio-sfx/catalog.ts` | 配方表：`{ id, type, durationSec, gain, build(params) }`，含 `pan` 烘入 |

**移植来源**：`/tmp/motion_probe_2026/x/core/native_audiolib.py`（361 行，全清单见 `视频模板化-基线与代码事实索引.md` §4.3）。逐个原语对照翻，**参数默认值照抄**。

**确定性要求**：`noise()` 在 Python 侧用固定种子 `np.random.default_rng(11)`。TS 侧用固定种子的确定性伪随机（不必逐样本对齐 Python，**验收只比时刻与电平，不比波形**）。

**采样率**：MotionGit 用 44100；本仓音频交付是 48kHz（`AUDIO_DELIVERY_SAMPLE_RATE`）。**合成用 48000**，与本仓其它音频一致。

### 4.4 离线产出（素材落盘）

**先做成 CLI 脚本，不要先碰 `host-tools.ts`**：

> ⚠️ `src/host-tools.ts` 近期被并发会话改动过（`host-tools.ts` / `canvas-asset-attach.ts` / `tool-presentation.ts`）。动手前先 `git status` + 重读当前内容。**第一版用脚本产出，避免撞车**；等工具注册稳定后再决定是否注册为宿主工具（LLM 侧调用）。

脚本职责：
1. 读配方表 → 合成全部 voice → 写 WAV 到**包内静态目录 `assets/sfx/`**（经 `/canvas-studio/remotion/sfx/*` 只读路由对外；用户自带音效才落项目资产目录）
2. 输出一份**清单 JSON**（voice id → 落盘路径 → 时长 → 电平），供校验层判断「这个 src 是不是本仓合成的（pan 是否生效）」
3. 可重复执行（幂等：文件已存在且参数未变则跳过）

> 合成库产出的素材**不进授权账本**（零授权、代码生成），但**要登记到项目素材清单**，让宿主知道这些文件存在。

---

## 5. 验收

### 5.1 单测（纯函数层，全绿才算过）

| 断言 | 期望 |
|---|---|
| `resolveSfxStartFrame({startSec:0.58}, {fps:60})` | `35`（0.58×60 = 34.8 → 35） |
| `resolveSfxStartFrame({startSec:7.6}, {fps:30})` | `228`（7.6×30 = 228） |
| `resolveSfxStartFrame({startSec:0.58}, {fps:30})` | `17`（0.58×30 = 17.4 → 17，**同一 startSec 换 fps 必须重算**） |
| `resolveSfxStartFrame({startFrame:1056}, {fps:60})` | `1056`（`startFrame` 不随 fps 变） |
| `resolveSfxStartFrame({anchor:{trackId:"b2-card-1",at:"start"}}, …)`，该轨 `startFrame=534` | `534` |
| `resolveSfxStartFrame({anchor:{trackId:"b2-card-1",at:"start",offsetSec:0.1}}, {fps:60})` | `540`（534 + round(0.1×60)=6） |
| `resolveSfxStartFrame({anchor:{trackId:"b2-card-1",at:"end"}}, …)`，该轨 `534+50` | `584` |
| `resolveSfxStartFrame` 三种定位同时给 / 一个都不给 | `null`（调用方报 error） |
| `resolveSfxStartFrame` 的 `anchor.trackId` 查不到 | `null` |
| `sfxVolumeAt` 在 `startFrame` 处 | 等于 `gain`（淡入起点） |
| `sfxVolumeAt` 在 `startFrame + fadeInSec×fps` 后 | 等于 `gain` |
| `sfxVolumeAt` 在淡出区间 | 线性下降 |
| DSP：`pan(x, 0)` 的 L/R | 能量相等 |
| DSP：`pan(x, 1)` 的 L/R | R = x, L = 0（√2 分配） |
| DSP：`lowpass` / `highpass` 输出长度 | 与输入等长 |
| WAV 写出的头 | RIFF/WAVE/fmt /data 块长度字段自洽；读回样本数 = 帧数×2 |
| 合成出的 `thud.wav` | 时长 ∈ [0.15s, 0.6s]，峰值 ∈ [0.5, 1.0] |
| `validateManifest`：`sfx` 合法（带 `startSec`） | ok=true, 0 error, 0 warning |
| `validateManifest`：三种定位同时给 | 报 error |
| `validateManifest`：三种定位都不给 | 报 error |
| `validateManifest`：`anchor.trackId` 不存在 | 报 error |
| `validateManifest`：`src:"https://外链/x.wav"` | 报 error（同源约束） |
| `validateManifest`：`gain: 5` | 报 error（0–2） |
| `validateManifest`：`pan: 3` | 报 error（−1..1） |
| `validateManifest`：`sfx: []` | 报 error |
| `validateManifest`：`sfx` 存在但未加进 `KNOWN_AUDIO_KEYS` | **必测**：应报契约外字段 warning（防回归） |
| **反向变异**：把 `resolveSfxStartFrame` 的 `round` 改 `floor` | 0.58@60 得 34 而非 35 ⇒ 上面的用例必须变红 |
### 5.2 端到端（真值表 · 2026-11-10 已按 `gt/mix-report.json` 重写）

> ⚠️ **本节此前的一版是错的，已废弃。** 旧表（`hit@0.58 / pop@0.69 / typing@1.41 / whoosh@7.76 / hit@9.06,9.22,9.36 / swoosh@17.71`，共 8 条）来自「对 GT 音轨做 RMS 检波」的产物，把**混响尾**当成了独立事件，且漏检首个、尾部多检一个。
> 权威数据是 GT 混音器自己输出的 `gt/mix-report.json`（`selectedEvents: 7`）。**不要再用 `视频模板化-基线与代码事实索引.md` §4.1 那 15 个"峰"。**

#### 5.2.1 真值：7 条事件（`gt/mix-report.json`）

GT 成片 1280×720@**60fps**，`source.t` 减去 B1 起点 250s 即为 `outputTime`。

| # | owner | 调用点 | type | gain | pan | dur | `outputTime` | 帧@60 |
|---|---|---|---|---|---|---|---|---|
| 1 | B1 | `B1.hit/0` | `thud` | 0.55 | 0 | — | 0.580 | **35** |
| 2 | B1 | `B1.line/0` | `write` | 0.25 | 0 | **1.2** | 1.250 | **75** |
| 3 | B1 | `B1.exit/0` | `swoosh` | 0.30 | 0 | — | 7.600 | **456** |
| 4 | B2 | `B2.card/0` | `card` | 0.30 | −0.2 | — | 8.900 | **534** |
| 5 | B2 | `B2.card/1` | `card` | 0.30 | +0.2 | — | 9.060 | **544**（543.6） |
| 6 | B2 | `B2.card/2` | `card` | 0.30 | −0.2 | — | 9.220 | **553**（553.2） |
| 7 | B2 | `B2.exit/0` | `swipe` | 0.30 | 0 | — | 17.600 | **1056** |

**三条必须理解的事实**：

1. **音效时刻 = 视觉入场帧，不是"偏后 9 帧"**。视觉三卡入场实测 **534 / 544 / 553 帧**（= 8.900 / 9.067 / 9.217 s），音效 `round(8.900×60)=534`、`round(9.060×60)=544`、`round(9.220×60)=553` ⇒ **帧域完全相等**。秒域那 0.007/0.003 的差是秒→帧舍入，不是设计偏移。
2. **`write` 是一条 1.2 秒的长事件，不是 11 击打字簇。** 旧表的 `typing@1.41` 与"簇内间隔保持"这条验收一并作废。
3. **第三个卡片音效是 `9.220` 不是 `9.360`。** `9.36 − 9.22 = 0.14 ≈ 一个事件间隔`，是"尾部多检一个"的典型指纹。

#### 5.2.2 落盘 manifest

用 `原型-manifest-b1b2.json` 加 `audio.sfx`（`src` 按 P-1 指向 `/canvas-studio/remotion/sfx/*.wav`，**不是** `/canvas-studio/assets/sfx/`）：

```jsonc
"sfx": [
  { "src": "/canvas-studio/remotion/sfx/thud.wav",   "startSec": 0.580, "gain": 0.55, "pan": 0,    "type": "thud"   },
  { "src": "/canvas-studio/remotion/sfx/write.wav",  "startSec": 1.250, "gain": 0.25, "pan": 0,    "type": "write"  },
  { "src": "/canvas-studio/remotion/sfx/swoosh.wav", "startSec": 7.600, "gain": 0.30, "pan": 0,    "type": "swoosh" },
  { "src": "/canvas-studio/remotion/sfx/card.wav",   "startSec": 8.900, "gain": 0.30, "pan": -0.2, "type": "card"   },
  { "src": "/canvas-studio/remotion/sfx/card.wav",   "startSec": 9.060, "gain": 0.30, "pan": 0.2,  "type": "card"   },
  { "src": "/canvas-studio/remotion/sfx/card.wav",   "startSec": 9.220, "gain": 0.30, "pan": -0.2, "type": "card"   },
  { "src": "/canvas-studio/remotion/sfx/swipe.wav",  "startSec": 17.600,"gain": 0.30, "pan": 0,    "type": "swipe"  }
]
```

> `pan` 靠不同 `src` 变体是不行的（同一文件 L/R 已烘死）。**给 `card` 生成 pan=0 的中置版本即可** —— 本仓 `pan` 是声明字段，运行时不再处理（决策 3）。GT 那 ±0.2 的声像是 GT 混音器的处理，本仓 MVP 不复刻声像，**验收也不断言声像**。

#### 5.2.3 断言（按此顺序跑，任一失败即停）

| # | 断言 | 判据 |
|---|---|---|
| 1 | 成片有音轨 | `ffprobe` ⇒ `h264` + `aac` / 48000 / 2ch |
| 2 | **事件帧号** | `round(startSec×60)` 逐条 = `[35, 75, 456, 534, 544, 553, 1056]`，**逐条精确相等**（不是 ±1 —— 帧域无舍入余量） |
| 3 | 三卡音画对齐 | 卡片三事件帧 `[534,544,553]` 与视觉三卡入场帧 `[534,544,553]` **集合相等** |
| 4 | 起音实测 | 从成片解 aac，对 7 个窗口做起音检测，实测起音帧与第 2 条**偏差 ≤ 1 帧**（这一条才允许 ±1，因为编解码有延迟） |
| 5 | 事件窗口峰值 | 逐窗口峰值落在 GT 同窗口 ±6 dB |
| 6 | 整片响度 | `ebur128` integrated **−24 ~ −18 LUFS**（GT 实测 −21.1）。**不要用 dB mean**：GT mean −33.1 在旧闸 −20~−9 之外，纯音效片天然低响度 |
| 7 | 无额外静音 | 除 7 个事件窗外的区间不应有 > −60 dBFS 的峰（防"每帧都放了音效"这类错误） |

> 验收脚本写进 `canvas-studio/scripts/`，**名字带 `sfx`**，便于模板回归复用。脚本的期望值**必须从 `gt/mix-report.json` 读**，不要硬编码 —— 硬编码会让将来换 GT 时静默失准。

### 5.3 回归

- 全库既有单测全绿（`corepack yarn test`）
- `corepack yarn typecheck` 全绿
- **既有 manifest 逐像素不变**：不带 `sfx` 的老 manifest 渲出来音频行为与之前一致（`AudioTrack` 的改动必须是**纯追加**，不得改变 bgm/voiceOver 分支）

---

## 6. 不做什么

- ❌ 不改 `audio-timeline.ts` / `buildAudioGraph` / `compose_video` 路径
- ❌ 不把 render 路径改成 ffmpeg 混音
- ❌ 不引入真实授权音效素材（本任务走零授权合成路线；素材路线留作后续）
- ❌ 不实现实时声像（pan 只在合成期）
- ❌ 不做 BGM 与 sfx 的 duck 交互（`audio.duck` 现在只作用于 BGM）
- ❌ 不动 `textCard` / `shape` 的任何外观

---

## 7. 已知的坑

1. **`KNOWN_AUDIO_KEYS` 漏加 `'sfx'`** ⇒ 整段被判契约外字段。**单测里专门加一条反向断言防回归。**
2. **`<Audio>` 的 `volume` 是函数时，每帧都会求值** ⇒ 淡入淡出函数必须纯、无副作用、不能分配对象（每帧 1080 次，垃圾回收会拖慢渲染）。
3. **`<Sequence from>` 用帧号 ⇒ 必须 `Math.round(startSec × fps)`**，且 `from` 会被钳到 ≥ 0。
4. **`layout="none"` 必须加**：否则音频 Sequence 会参与布局计算，污染画布。
5. **素材必须是同源 URL**：合成库要真的把文件落到磁盘，不能只在内存里生成。
6. **WAV 文件头别写错**：44 字节标准头，RIFF size = 36 + dataSize，byteRate = sampleRate×channels×2，blockAlign = channels×2。写错了 Remotion 解不出来，而且**报错信息很难懂**。
7. **电平别做归一化到满刻度**：多个 sfx 叠加后会削顶。合成时按 GT 的增益口径（`g` 字段）来，别用峰值归一。
8. **`gain` 语义是线性 0–1，不是 dB**（与本仓现有 `AudioSegment.gain` 一致）。
