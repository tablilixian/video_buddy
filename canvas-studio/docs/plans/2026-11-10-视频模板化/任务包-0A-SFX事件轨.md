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

### 决策 1：契约落 `manifest.audio.sfx[]`，用 **秒**不用帧

```jsonc
"audio": {
  "sfx": [
    { "src": "/canvas-studio/assets/sfx/hit.wav", "startSec": 0.58, "gain": 1.0, "pan": 0 },
    { "src": "/canvas-studio/assets/sfx/whoosh.wav", "startSec": 7.76, "gain": 0.7, "pan": -0.3 }
  ]
}
```

**为什么用 `startSec` 而不是 `startFrame`**：
- `audio.voiceOver` 用 `startFrame`，但那是**素材对齐**（旁白是整段录音，帧号要对齐到具体某句的起点）。
- sfx 是**编排事件**，模板要跨 fps 复用（同一模板 30fps / 60fps 都要能播）。秒是唯一能跨的表示。
- MotionGit 的音效事件表本身就是秒制（`{"t":4.65,"type":"hit"}`）。
- **渲染时换算成帧**：`startFrame = round(startSec * fps)`。

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

`src` 必须满足与其它轨一样的同源约束（同源 `/canvas-studio/assets/...` 或项目资产目录内绝对路径），外链一律拒收。合成库要把 WAV **落到项目资产目录**（或 `canvas-studio/assets/sfx/`），再按相对/绝对路径引用。

---

## 3. 契约定义

### 3.1 TypeScript

```ts
/** manifest.ts —— 放在 ManifestAudio 上方 */
export interface ManifestSfx {
  /** 音效素材 URL。与 tracks[].src 同一套同源约束（`validateAssetRefField`）。 */
  src: string
  /** 绝对起点（秒，成片时间坐标）。渲染时按 fps 换算成帧。 */
  startSec: number
  /** 线性增益 0–2（缺省 1）。1 = 原音量。 */
  gain?: number
  /** 声明用声像 −1..1（0 = 居中）。**仅在素材由本仓合成库产出时生效**；
   *  指向外部素材时校验层发 warning（pan 被忽略）。 */
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
// ManifestAudio 内追加
  /**
   * 音效事件轨。**秒制时间轴**（startSec），渲染时按 fps 换算成帧。
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
| 每项 `src` 非空字符串且过 `validateAssetRefField`（同源） | error |
| 每项 `startSec` 是有限数且 ≥ 0 | error |
| 每项 `gain` 在 0–2（缺省 1） | error |
| 每项 `pan` 在 −1..1（缺省 0） | error |
| 每项 `startSec` 超出成片时长 ⇒ warning（别用 error，音频轨短于成片是常态） | warning |
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
1. 读配方表 → 合成全部 voice → 写 WAV 到**项目资产目录**（`/canvas-studio/assets/sfx/` 或当前项目 `assets/`）
2. 输出一份**清单 JSON**（voice id → 落盘路径 → 时长 → 电平），供校验层判断「这个 src 是不是本仓合成的（pan 是否生效）」
3. 可重复执行（幂等：文件已存在且参数未变则跳过）

> 合成库产出的素材**不进授权账本**（零授权、代码生成），但**要登记到项目素材清单**，让宿主知道这些文件存在。

---

## 5. 验收

### 5.1 单测（纯函数层，全绿才算过）

| 断言 | 期望 |
|---|---|
| `sfxStartFrame([{startSec:0.58}], 60)` | `[35]`（0.58×60 = 34.8 → 35） |
| `sfxStartFrame([{startSec:7.76}], 30)` | `[233]`（7.76×30 = 232.8 → 233） |
| `sfxStartFrame` 对同一 `startSec` 不同 fps | 换算后秒级误差 ≤ 1/120s |
| `sfxVolumeAt` 在 `startFrame` 处 | 等于 `gain`（淡入起点） |
| `sfxVolumeAt` 在 `startFrame + fadeInSec×fps` 后 | 等于 `gain` |
| `sfxVolumeAt` 在淡出区间 | 线性下降 |
| DSP：`pan(x, 0)` 的 L/R | 能量相等 |
| DSP：`pan(x, 1)` 的 L/R | R = x, L = 0（√2 分配） |
| DSP：`lowpass` / `highpass` 输出长度 | 与输入等长 |
| WAV 写出的头 | RIFF/WAVE/fmt /data 块长度字段自洽；读回样本数 = 帧数×2 |
| 合成出的 `hit.wav` | 时长 ∈ [0.15s, 0.6s]，峰值 ∈ [0.5, 1.0] |
| `validateManifest`：`sfx` 合法 | ok=true, 0 error, 0 warning |
| `validateManifest`：`sfx` 含 `src:"https://外链/x.wav"` | 报 error（同源约束） |
| `validateManifest`：`sfx` 含 `gain: 5` | 报 error（0–2） |
| `validateManifest`：`sfx` 含 `pan: 3` | 报 error（−1..1） |
| `validateManifest`：`sfx: []` | 报 error |
| `validateManifest`：`sfx` 存在但未加进 `KNOWN_AUDIO_KEYS` | **必测**：应报契约外字段 warning（防回归） |

### 5.2 端到端（真机）

1. 用 `原型-manifest-b1b2.json` 加 `audio.sfx`，**按 `视频模板化-基线与代码事实索引.md` §4.1 的 5 组事件**：

```jsonc
"sfx": [
  { "src": ".../hit.wav",   "startSec": 0.58,  "gain": 1.0, "pan": 0 },
  { "src": ".../pop.wav",   "startSec": 0.69,  "gain": 0.45, "pan": -0.4 },
  { "src": ".../typing.wav","startSec": 1.41,  "gain": 0.4, "pan": 0 },
  { "src": ".../whoosh.wav","startSec": 7.76,  "gain": 0.7, "pan": -0.3 },
  { "src": ".../hit.wav",   "startSec": 9.06,  "gain": 0.5, "pan": -0.6 },
  { "src": ".../hit.wav",   "startSec": 9.22,  "gain": 0.5, "pan": 0.2 },
  { "src": ".../hit.wav",   "startSec": 9.36,  "gain": 0.5, "pan": -0.6 },
  { "src": ".../swoosh.wav","startSec": 17.71, "gain": 0.45, "pan": 0 }
]
```

2. 走 `render_composition`（**`manifestPath` 走文件，别内联**），成片落盘后：

```sh
ffprobe -v error -show_entries stream=codec_type,codec_name,sample_rate,channels -of csv=p=0 成片.mp4
# 期望：video=h264 + audio=aac, 48000, 2
```

3. **起音检测比对**（脚本见 `视频模板化-基线与代码事实索引.md` §4.1）：

| 事件组 | GT 时刻 | 期望偏差 |
|---|---|---|
| A | 0.580 | ≤ 1 帧（0.0167s） |
| B | 1.410–2.290 | 起音 ≤ 1 帧；簇内间隔保持 |
| C | 7.760 | ≤ 1 帧 |
| D | 9.060 / 9.220 / 9.360 | **每个 ≤ 1 帧**，且三者间隔仍为 0.160s |
| E | 17.710 | ≤ 1 帧 |

4. **电平**：整片 mean 落在 −40 .. −25 dB，max 落在 −12 .. −2 dB（GT 实测 mean −33.1 / max −3.7）。

> 验收脚本请写进 `canvas-studio/scripts/` 或测试目录，**名字里带 `sfx`**，便于后续模板回归复用。

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
