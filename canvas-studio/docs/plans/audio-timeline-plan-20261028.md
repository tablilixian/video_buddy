# 音频子系统收口计划（统一时间轴 · 2026-10-28）

> **状态**：**已拍板（2026-10-28，D-01~D-06 全部按建议通过）· 零代码落地**｜ **编号**：未取号（开工时按 STATUS §4.1 水位取；**已核水位 2026-10-28 = CV-376，故本计划占 CV-377 起**，按「验收通过后才登记」纪律不预领）
> **执行纪律（2026-10-28 用户指令）**：见 **§10** —— **连续推进到 S6 全部完成，中途不停、不询问、不等确认**；新出现的选择自行拍板并记入 §10.3（D-07 起）；**只在全部完成后向用户汇报一次**。
> **续接入口**：新会话开局直接粘 [2026-10-28-交接-音频收口全流程.md](./2026-10-28-交接-音频收口全流程.md)（自包含的 S0→S6 全流程任务书：执行纪律 + 阶段一句话清单 + 已核实的坑 + 红线 + 汇报格式）
> **治的条目**：CV-040（P1 多段成片音轨断裂 / Master Audio）、CV-039 剩余部分、P2-6/P2-7 验收闭环、CV-006 已修部分的收尾
> **既有文档关系**：本文是**执行计划**；能力矩阵与后端实测数据见 [audio-generation-plan.md](../audio-generation-plan.md)，音画对齐路线的历史推导见 [av-timeline-plan.md](../av-timeline-plan.md)，逐层验收剧本见 [audio-acceptance-checklist.md](../audio-acceptance-checklist.md)。三份文档里的「未做」清单有相当部分已随 CV-127~130 / CV-199 / CV-209 / CV-353 落地，**状态一律以本文 §1 的代码核实为准**。

---

## 1. 现状：代码核实（2026-10-28 逐点验证，非文档转述）

### 1.1 一句话根因

**音频在系统里不是一个「时间轴」，是三个布尔。**

`src/remotion/manifest.ts:1893-1909`

```ts
export function audioCompositionFrom(input: {
  hasNative: boolean
  hasBgm: boolean
  hasVoiceOver: boolean
}): StudioAudioComposition
```

整个系统对「声音」的唯一内部表示就是 `(有没有原生声, 有没有 BGM, 有没有旁白)` 这个三元组，派生出 8 个枚举值（`src/contracts/canvas.ts:110-118`）。**「第 3 秒到第 8 秒有一句旁白」「第 2 段视频没有音轨」「BGM 比成片短 2.3 秒」这三类信息，模型里根本没有位置可放。**

下游**大部分**症状是这一点的推论。但要诚实区分：**CV-040 的实际表现是两个层叠加的结果** ——

| 层 | 缺陷 | 实测后果 |
|---|---|---|
| **模型层** | 音频只能是「三个布尔」，表达不了时间 | 无法逐段定位、无法多轨、无法 duck、角标文案跟不上行为 |
| **工具层** | `buildTranscodeArgs`（`compose.ts:230`）对无音轨段 `-an` 丢流，且不统一 `-ar/-ac` | 音轨断裂 / 静默变速（§1.4 实验 A、C） |

**只修模型层不动工具层，片子照样坏；只修工具层不动模型层，能力永远上不去** —— 这也是本计划 S1（模型）与 S2（工具）必须都做的原因。

### 1.2 逐点核实表

| # | 事实 | 位置 | 影响 |
|---|---|---|---|
| 1 | **per-clip 音频探测其实已经有了**：逐段 `ffprobe` 写 `clip.hasAudio`（`Promise.all` 并发跑） | `src/compose.ts:524-529` | ⚠️ 但探测结果**没有进入任何模型**，只影响下一条的一个分支 —— 「测了但没用起来」 |
| 2 | **无音轨片段用 `-an` 直接丢掉音频流**：`...(hasAudio ? ['-c:a','aac'] : ['-an'])`，且两条分支**都没有 `-ar` / `-ac`** | `src/compose.ts:230`（`buildTranscodeArgs`） | 两个独立缺陷：① 丢流导致 concat 流结构不一致（音轨断裂）；② 不统一采样率/声道导致 concat 按第一段参数解读后续所有段（静默变速变调）。**均已在 §1.4 实测** |
| 3 | 混音分支只看整条 concat 结果的单一布尔 `hasConcatAudio = parseFfmpegStreams(...).hasAudio` | `src/compose.ts:565` | 「3 段里只要有 1 段有声」⇒ 全片按「有原生声」处理；哪段缺、缺多久、接缝在哪，全部不可知 |
| 4 | `buildAmixArgs` 只有两条分支：`hasConcatAudio ? amix : BGM 直接当音轨` | `src/compose.ts:330-360` | 无法表达「环境声 0.6 / BGM 0.3 / 旁白 1.0 且第 5 秒起」 |
| 5 | 旁白在 compose 侧只有**一条**：`voiceOverUrl` 单轨，`amix=inputs=2` | `src/compose.ts:353` | 多句配音必须 agent 自己用 ffmpeg 拼长轨（`tts_voiceover` 结果文案里明写「多句用 audio.voiceOver 数组」——那是 **render 路径**的能力，compose 路径没有） |
| 6 | render 侧（Remotion）**已有多轨**：`audio.voiceOver[{src, startFrame, volume}]`、`mix`、`fadeIn/Out`、`duck` | `src/remotion/manifest.ts:546-571` | ✅ 两条路径能力**不对称**：同一句「加个旁白」，走 `compose_video` 和走 `render_composition` 得到的东西不一样 |
| 7 | `AUDIO_COMPOSITION_HINTS` 仍写着「多镜拼接，各镜环境声**已丢弃**」 | `src/contracts/canvas.ts:141,144` | **与 CV-209（H3 原生音轨已成多镜主声轨）直接冲突** —— 用户悬停角标看到的是错的行为解释。这是「模型表达不了时间轴 ⇒ 文案跟不上行为」的实证 |
| 8 | 前端时间轴只按顺序数节点，音频节点与视频同列参与排序 | `src/client/canvas/CanvasTimeline.tsx:89`（431 行全文件） | 没有音频轨、没有时间刻度 ⇒ 看不出「音乐比成片长/短几秒」（CV-007 的残留） |
| 9 | **没有节拍/响度测量实现**（`src/` 内 `silencedetect` 仅 1 处注释、`bpmDetect` 零命中），但**契约里早就有位置**：`StoryboardBgm { bpm, lufs, sidechain }`（`src/contracts/storyboard.ts:128-132`），且已进渲染与 diff（`storyboard-render.ts:449-453` 会显示「BPM」行）。当前 `bpm/lufs` 靠人工填（seed 默认 0），`sidechain` 是一句文字描述 | `grep -rnE beats src/` 命中全部落在 `storyboard-*`（契约/渲染/diff/seed），无分析实现 | ① 「按拍拆镜」「MV 卡点」只能靠估算；② **好消息**：分析能力做出来后应当**回填这两个既有字段**（`bpm` / `lufs`），不新造第二套事实源；③ `sidechain` 那句文字（如「1.5–3kHz 避让人声」）正是 S2b `duckAmount` 的语义来源，两边可以接上 |
| 10 | 内置 ffmpeg **6.0**，14 个关键音频滤镜全可用（实测逐条 `-filters` 列匹配：`adelay` `amix` `apad` `anullsrc` `atempo` `atrim` `afade` `volume` `sidechaincompress` `loudnorm` `ebur128` `silencedetect` `astats`） | `dsh-plugin-desktop/build/ffmpeg/darwin-arm64/ffmpeg` | **全部音频能力可本地实现，不需要后端、不需要新依赖** |

### 1.3 已具备、不要重做的能力

- **逐段音频探测**（`clip.hasAudio`，`src/compose.ts:524-529`）—— 要复用它，不要另写一套
- 画布音频一等节点（`kind='audio'`）、就地播放、可拖进度条、播放器窗口、歌词三处渲染（CV-128/130）
- `tts_voiceover` 的 `speed`（`atempo` 变速不变调）/ `pitchSemitones`（变调不变速）（O-09）
- 成片导出按钮**已传** `bgmNodeId`（`src/client/StudioFrame.tsx:1941-1946`，CV-006 已修）
- BGM 时长守卫的**告警**（`bgmShortfallMessage`，`src/compose.ts:303-312`）——缺的是自动补偿，不是检测
- `music_generation` 后端偶发 500 的重试降级（CV-127b）、纯器乐 `[Instrumental]` 默认值、`degradedFields` 诚实回显

---

### 1.4 实测：CV-040 的确切表现（2026-10-28，内置 ffmpeg 6.0 真跑）

样本：3 段 2s / 320×240 / 25fps，`t1` 有音轨(440Hz)、`t2` **无音轨**、`t3` 有音轨(880Hz)。临时样本已清理，S0 会用脚本重造到 `tests/fixtures/audio/`（下方命令可直接复跑）。

#### 实验 A｜现状做法（直接 concat，等同 `buildTranscodeArgs` 传 `-an` 的产物）

| 指标 | 实测值 |
|---|---|
| 成片视频时长 | 6.02s |
| **成片音轨实际时长** | **4.09s** ← 少了 2 秒 |
| 能量分布 | 0–2s 有声 / **2–4s 有声（这是第三段的声音被错位塞进来）** / **4–6s 完全无声** |

⇒ **从第 2 秒开始音画就错位 2 秒，最后 2 秒彻底静音，而 ffmpeg 全程退出码 0。** 这就是 CV-040 的可执行定义。

⚠️ 注意：用 `ffmpeg -f null -` 看时长会误判成 6.02s（解码器会给缺失部分补静音帧）。**唯一可靠的判定是导出音轨后逐秒算 RMS**，或用 `silencedetect` 看静音区间位置，不能只看容器 Duration。

#### 实验 B｜S2a 方案（无音轨段补等长静音轨，再 concat）

| 指标 | 实测值 |
|---|---|
| 成片音轨时长 | 6.13s（比视频长 0.11s，AAC 编码延迟，由 `-t filmDuration` 裁掉即可） |
| 能量分布 | 0–2s 有声 / **2–4s 静音** / 4–6s 有声 ✅ **对齐正确** |

⇒ S2a 方案**成立**，且断言容差应定 **±0.15s**（不是 ±0.05s，会因 AAC padding 假红）。

#### 实验 C｜采样率不一致（更隐蔽的一类）

样本：`t1` 44.1kHz mono 与 `t4` 48kHz stereo 混拼（**这正是真实场景**：H3 原生音轨 32kHz、`txt2audio` 44.1kHz、TTS 未知）。

| 指标 | 实测值 |
|---|---|
| concat 是否报错 | **否**（退出码 0，无 warning） |
| 成片音轨时长 | 6.29s（比视频 6.02s 长 0.27s） |
| 能量分布 | 后半段每秒都有声，但 RMS 从 −24dB 单调降到 −26dB —— **音频被按错误参数解读，整体变速/变调** |

⇒ **这是「静默损坏」：顺序对、有声音，但听起来就是不对，且没有任何一方会报错。** 根因是 `buildTranscodeArgs` 只写 `-c:a aac`，**没有统一 `-ar` / `-ac`**，而 concat demuxer 用第一段的参数去解读后续所有段。

**⇒ S2a 必须同时补 `-ar 48000 -ac 2`（统一交付口径），这一条比补静音轨更紧急** —— 补静音只治「某段没声音」，统一参数治「所有段声音都不对」。

---

## 2. 目标与验收口径

### 2.1 五个目标（对应用户提出的五条要求）

| 目标 | 可判定口径 |
|---|---|
| **能力充分发挥** | 后端已确认可用的音频能力（原生音轨 / audio reference / txt2audio 精确时长）在**两条合成路径上都能用**，且参数可见、结果可回读 |
| **一致性** | `compose_video` 与 `render_composition` 消费**同一个** `AudioTimeline` 模型、**同一套**校验、**同一个** ffmpeg 装配函数；角标文案由行为派生并有测试钉死 |
| **稳定性** | 缺音轨/短音轨/超长音轨/多轨重叠四类输入**不产生静默错误**：要么自动补偿并显式告知，要么在合成前拒绝 |
| **易用性** | 用户可在时间轴上「看见」声音、在播放器里「调」声音、在导出前「被拦住」；agent 可在工具结果里「自查」声音 |
| **MV / 音乐创作** | 有本地节拍数据（`beats.json`）、有歌词时间轴（`lrc`）、有卡点吸附、有多版抽卡对比 |

### 2.2 全局验证纪律（沿用项目既有铁律）

1. 每阶段必须先有**能变红的断言**，再接修复（`clean.mjs` → tsdown → `tsc -p tsconfig.json` + `tsc -p tsconfig.client.json --emitDeclarationOnly` → `verify:loader` → `test:smoke`）。
2. **反向变异**：每阶段至少 2 处变异必须让测试变红，还原后全绿；变异结果写进阶段小结。
3. 音频类修复的验收**不依赖人耳**：统一用 `ffprobe`（流/时长）+ `silencedetect`（静音区间）+ `astats`（分段 RMS）做机器判定，样本落 `tests/fixtures/audio/`。
4. 真机部分（需 GUI）由用户执行，脚本只出「一键跑 + 报告落盘」。

### 2.3 做完之后长什么样（用户视角对照）

| 场景 | 现在（已实测/已核实） | 做完之后 |
|---|---|---|
| 3 镜片子，其中 1 镜没开音轨 | 第 2 秒起音画错位 2 秒、最后 2 秒静音、无人报错（§1.4 实验 A） | 该镜静音、其余镜声音在正确位置，结果文本写明「第 2 段无原生音轨，已补 2.0s 静音」 |
| 两种来源的音频混用（H3 32k / 音乐 44.1k / TTS） | 顺序对但整体变速变调，无人报错（§1.4 实验 C） | 统一 48k/立体声，听感一致；不再依赖「碰巧参数相同」 |
| 两句话的旁白 | 必须自己用 ffmpeg 拼成一条长轨，起手就错 | 两句各自指定起点与音量，落点精确（`voiceOverNodeIds`） |
| BGM 比成片短 | 后半段突然静音，只有一条 warning | 自动补静音并告知，或导出前拦住让你选「补 / 重生成 / 继续」 |
| 想知道「音乐到第几秒结束」 | 打开播放器手动听 | 时间轴上有独立音频轨，一眼看出长短差 |
| 做 MV / 卡点片 | 靠估拍点，切点靠运气 | `beats.json` 有 BPM 与拍点，切点吸附到拍点，低置信明确告知 |
| 角标「纯 BGM」的含义 | 文案说「各镜环境声已丢弃」，但 CV-209 之后其实没丢 | 文案由行为派生，有测试钉死，不再与实现打架 |

---

## 3. 分阶段计划

### S0 · 基线固化：把已实测的断裂变成可重跑的红（0.5 天）

**取证已完成**（见 §1.4，三组实验均有数据）。本阶段只做「从手工实验 → 可重跑断言」，不重复调研。

⚠️ **一处必须避开的坑（2026-10-28 复核发现）**：`scripts/run-smoke.mjs` 断言「本次失败集合 ⊆ `tests/baseline-red.json`」，而该名单**已清零**（2026-10-01 起）⇒ **若把 S0 这 3 条故意红的断言写进 `tests/*.test.mjs`，`yarn test:smoke` 会立刻变红**，且属于「名单外新增红」，门禁直接退出码 1。这也解释了为什么不能用 `node --test` 单跑来规避（项目铁律：测试入口只准 `yarn test:smoke`）。

⇒ 因此 S0 的取证产物走**探针**而非测试：探针跑在门禁之外，退出码语义独立，修好后**再把同一批判据搬进 `tests/`（那时是绿的）**。

| 产出 | 说明 |
|---|---|
| `scripts/fixtures/make-audio-fixtures.mjs` | 把 §1.4 的手工命令固化成脚本：6 个样本（有声 2s / 无声 2s / 有声短 0.4s / 有声长 0.6s / 16k 单声道 / 48k 立体声），320×240 / 25fps，总 <300KB，落 `tests/fixtures/audio/`（**不入 git 也 OK，脚本可随时重造**） |
| 判定工具 | 新 `scripts/probe/lib/audio-probe.mjs`：`audioRmsBySecond(file)`（导出 wav 后逐秒 RMS，用最小 wav 头解析，**零依赖**）+ `audioDurationOf(file)`（`ffmpeg -i` stderr 的 `Duration:`，复用 `src/ffmpeg-run.ts:239` 的 `parseFfmpegDuration` 口径）。放在 `scripts/probe/lib/` 而不是 `tests/helpers/`（后者不存在，且探针与测试要共用）。**禁止用 `ffmpeg -f null -` 判时长**（§1.4 已证会补静音帧误判成 6.02s） |
| 取证探针 | 新 `scripts/probe/audio-baseline.probe.mjs`：跑现有 `compose.ts` 实现，输出 3 条判据的实测值到 `build/probe/audio-baseline.json`，不符合预期即**退出码 1**。判据：① 3 段含 1 无声 → 音轨时长 == 视频时长（实测 4.09 vs 6.02）；② 该段区间静音（实测有声）；③ 44.1k/48k 混拼 → 音轨时长 == 视频时长（实测 6.29 vs 6.02） |
| 一页结论 | `docs/plans/audio-baseline-20261028.md`：三条的实测数值 + ffprobe 片段，作为后续每阶段的对照尺 |

**退出条件**：`node scripts/probe/audio-baseline.probe.mjs` 稳定退出码 1，且 `build/probe/audio-baseline.json` 里三条都带实测数值（不是 `assert(false)`）—— 这 3 条就是后续每个阶段的验收尺子。**同时 `yarn test:smoke` 必须仍全绿**（S0 不改产品代码、不动 `tests/`，这一点本身就是 S0 的自检）。

---

### S1 · 统一模型：`AudioTimeline` 成为唯一事实源（1.5 天）

**新文件 `src/audio-timeline.ts`（纯函数，零 IO，零 ffmpeg 调用）**

```ts
export interface AudioSegment {
  /** 来源：画布节点 id（可回溯源）| 资产 URL */
  sourceNodeId?: string
  url: string
  /** 绝对起点（秒）。旁白/音效必须有；BGM 缺省 0 */
  startSec: number
  /** 期望占用时长（秒）。0/缺省 = 用素材真实时长 */
  durationSec?: number
  /** 线性增益（0–1，1 = 原音量）。全系统只用这一套口径，不引入 dB 双轨 */
  gain?: number
  fadeInSec?: number
  fadeOutSec?: number
  /** 旁白段压 BGM 的深度（0 = 不压） */
  duckAmount?: number
  /** 素材缺失/过短时的处置：'pad'（补静音，缺省）| 'loop' | 'error' */
  onShort?: 'pad' | 'loop' | 'error'
  role: 'native' | 'bgm' | 'voiceOver' | 'sfx'
}

export interface AudioTimeline {
  fps: number
  durationSec: number
  segments: AudioSegment[]
}
```

关键函数（全部纯函数，全部可单测）：

| 函数 | 职责 | 为什么必须单独存在 |
|---|---|---|
| `resolveAudioTimeline(input)` | 校验 + 归一化：越界起点、负时长、同 role 重叠、`duckAmount` 无旁白、`onShort` 非法 | 校验只写一次，两条路径共用；否则又是一份放水白名单 |
| `compositionFromTimeline(tl)` | 派生 8 枚举（**取代** `audioCompositionFrom` 的三布尔入参，函数保留做兼容包装） | 枚举从时间轴**推出**，不再手工传三个 bool |
| `buildAudioGraph(tl)` | 生成 `filter_complex` 文本（`atrim` → `asetpts` → `adelay` → `volume`/`afade` → `amix`/`sidechaincompress`） | **唯一生成点**，禁第二处拼音频参数 |
| `describeTimeline(tl)` | 生成给模型看的中文摘要（每段起止/角色/音量/是否补了静音） | 模型自查的唯一通道 |

**契约层同步**

- `src/contracts/canvas.ts`：`AUDIO_COMPOSITION_HINTS` 两处错文案改对（`bgm` → 「多镜拼接，BGM 为唯一声轨（原生声已按镜混入 BGM 之下）」；`none` → 按实际行为重写）；新增 `AUDIO_COMPOSITION_DERIVATION` 说明「枚举由时间轴派生」。
- 新增 `tests/audio-hints-doc.test.mjs`：**把文案钉回行为**（CV-365 的 `manifest-contract-doc` 同款做法）——`hints.bgm` 不得出现「已丢弃」当 `hasNative` 为真；`compositionFromTimeline` 的 8 条映射逐条断言 + 文案关键词对应。

**退出条件**：`resolveAudioTimeline` / `buildAudioGraph` / `compositionFromTimeline` 三函数覆盖率 100%，8 枚举映射 8 条断言，文案漂移断言能变红。

---

### S2 · 后端接线（2.5 天 = S2a 止血 0.5 + S2b 结构 2）

分两步走：**S2a 用最小改动止住「音轨断裂」，S2b 才做结构升级**。理由 —— S2a 只改一个函数就能让 CV-040 的主症状消失，先拿到可验收的成果，再承担重构风险。

#### S2a · 止血：统一音频参数 + 无音轨片段补等长静音轨（0.5 天）

**S2a 有两件事，都是小改动**：① 无音轨段从 `-an` 改成补等长静音轨；② 所有段统一 `-ar 48000 -ac 2`（实验 C 证明这条更急）。

```
改前：...(hasAudio ? ['-c:a', 'aac'] : ['-an'])
改后：...(hasAudio
         ? ['-c:a', 'aac', '-ar', '48000', '-ac', '2']      // 统一采样率/声道
         : [...ANULLSRC_ARGS, '-t', String(clipRealDuration), '-c:a', 'aac',
            '-ar', '48000', '-ac', '2', '-shortest'])        // 补等长静音轨
ANULLSRC_ARGS = ['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo']
```

⚠️ **段真实时长的来源**：per-clip 探测（`compose.ts:524-529`）已经每段跑了一次 `ffmpeg -i`，`Duration:` 就在同一个 stderr 里 —— 补一次 `parseFfmpegDuration` 即可，**零额外进程**（与 CV-138 用 concatProbe 顺带取时长的做法同源）。不要为此再起一轮 ffprobe。

| 改动 | 文件 | 要点 |
|---|---|---|
| **统一音频参数** | `src/compose.ts` `buildTranscodeArgs` | 所有段一律 `-ar 48000 -ac 2`（交付口径）。这是实验 C 的直接对策：不统一 ⇒ concat 静默变速变调。**注意**：H3 原生音轨 32kHz 上采样到 48k 有极小损失，但换来「全链路一个参数」，值得；如需保真可后续按段记录 `sourceSampleRate` 并只对齐不改采样（S2b 再议） |
| 无音轨补静音 | `src/compose.ts` `buildTranscodeArgs` | 用 `-f lavfi -i anullsrc` 作为**第二输入** + `-t <段时长>`（`-shortest` 兜底），让该段输出始终带一条 aac；`hasAudio` 语义不变（仍是「原本有没有」），新增 `padded: boolean` 供结果文本回显 |
| 顺带取时长 | `src/compose.ts` 探测循环 | 每段同时记 `clip.realDuration`（探测失败记 0，不伪造）；S2b 的段起点前缀和直接吃这个值 |
| 结果回显 | `src/host-tools.ts` `renderComposeResult` | 「第 N 段无原生音轨，已补 N.Ns 静音」逐段列出 —— 模型能看见，用户能看见 |
| 断言 | `tests/compose-audio-pad.test.mjs` | 判据直接搬 S0 探针那 3 条（此时应**全绿**，故可进 `tests/` 不撞 smoke 门禁），另加：② 该段区间静音、相邻段区间有声（逐秒 RMS）；④ 全无声 3 段 → 成片仍有音轨；⑤ 单段有声 → 参数 diff 只多 `-ar/-ac` 两项；⑥ 探测失败（假 ffmpeg 替身）→ 不伪造时长、降级有 warning |
| **既有断言同批更新** | `tests/compose.test.mjs:79-89` | **必须先知道**：该条明确 `assert.ok(buildTranscodeArgs(...false).includes('-an'))`，S2a 一改即红，且属「基线名单外新增红」⇒ smoke 门禁直接退出码 1。**同批改**为断言「无音轨段产出仍带 aac + `-ar 48000 -ac 2` + `anullsrc`」。为避免 `buildTranscodeArgs` 签名膨胀（需新增段真实时长），建议把音频编码参数抽成独立纯函数 `buildAudioCodecArgs({ hasAudio, clipDurationSec })`，由 `buildTranscodeArgs` 内部转调 —— 新断言直接测该函数，旧测试只改一条 |
| 反向变异 | — | M1 去掉 `-ar/-ac` → 断言③红；M2 恢复 `-an` → 断言①②红；M3 `-t` 用请求值而非真实时长 → 断言①红 |

**S2a 退出条件**：S0 的 3 条红全部变绿；单镜路径除 `-ar/-ac` 外参数 diff 为空；反向变异 3 处全部能变红。

#### S2b · 结构升级：视频流 concat + 音轨从零装配（2 天）

**这是全计划的核心改动。**

现状是「concat 顺带把音频也拼了，再拿结果去和 BGM 混」。改成：

```
视频：逐段统一转码（-an 丢弃音频）→ concat demuxer → 无声母版 v.mp4
音频：AudioTimeline → buildAudioGraph → 一条完整音轨 a.m4a
合流：ffmpeg -i v.mp4 -i a.m4a -map 0:v -map 1:a -c:v copy -c:a aac → 成片
```

**为什么这么改**：音轨从零装配才有绝对时间坐标。只要走 concat，各段音频就被钉在「自己那一段」里，`adelay`/`duck`/多轨全部无处落脚。S2a 补的静音轨在这里被 `AudioTimeline` 的 `role:'native'` 段取代（同一语义，不同实现）。

| 改动 | 文件 | 要点 |
|---|---|---|
| 段级模型 | `src/audio-timeline.ts` | 复用 S1 的 `AudioSegment`；每段由 `clip.hasAudio` + 真实时长 + 段起点（前缀和）生成 |
| 主装配替换 | `src/compose.ts` | `buildAmixArgs` 保留为**兼容包装**（老单测仍跑），内部转调 `buildAudioGraph`；**兼容的验收判据 = 现有 `tests/compose.test.mjs:91-99` 那条（`amix=inputs=2:duration=first:normalize=0` / `volume=0.35` / 单轨 `volume=0.8`）逐字符仍成立** —— 不成立就说明包装没兼容，改了老断言等于把回归藏起来 |
| 单镜路径不回归 | `src/compose.ts` | 单镜整出仍走一次转码直出（不 concat），音轨行为逐字符不变（对比测试） |
| 时长守卫升级 | `src/compose.ts` | `bgmShortfallMessage` 保留；新增自动 `apad` 补齐（`CANVAS_STUDIO_AUDIO_AUTOPAD=0` 回退到报错），warnings 明说「已自动补 N.Ns 静音」 |
| 旁白多轨 | `src/compose.ts` | `compose_video` 新增 `voiceOverNodeIds: string[]`（与 `bgmNodeId` 并存），内部转成 segments；**与 render 路径的 `audio.voiceOver[]` 语义对齐** |
| ducking | `src/audio-timeline.ts` | 有旁白段时用 `sidechaincompress`（BGM 为被压侧），`duckAmount` 控制深度；无旁白段完全不动 —— 与 render 侧「以字幕窗口为依据」的口径对齐后统一文档化 |
| render 路径复用 | `src/remotion/manifest.ts` + 渲染器 | `ManifestAudio` → `AudioTimeline` 的适配函数（`timelineFromManifestAudio`），装配也走 `buildAudioGraph`；**渲染器侧只做播放，不做混音决策** |

**S2b 退出条件**

- S0 全部红变绿；
- 新增断言：① 3 段中 1 段无声 → 成片该段时间区间 `silencedetect` 命中、总时长不变；② 旁白 2 句不同起点 → 两段区间 `astats` 都有能量；③ BGM 短 2.3s → 尾段静音且 warnings 含「已自动补 2.3s」；④ 单镜直出文本/参数逐字符不变；
- `compose.ts` 不超 1200 行棘轮（当前 799 → 若音频装配不拆出去，预计净增约 150 行，接近上限 ⇒ **S2b 就把音频装配整体搬到 `src/audio-compose.ts`**，别塞纯函数层 `audio-timeline.ts`）。

---

### S3 · 前端：把「声音」变成看得见、调得动、拦得住（1.5 天）

| 改动 | 文件 | 说明 |
|---|---|---|
| 时间轴加音频轨 | `src/client/canvas/CanvasTimeline.tsx` | 只读先做：一条独立 lane，按 `startSec/durationSec` 摆放色块 + 时长标尺；**不做拖拽**（交互留 S3b，避免一次改太多） |
| 波形包络 | 复用 `kind='audio'` 节点的真波形 | 现状是 id 派生假波形（`audio-generation-plan.md §12.2` P3）；改为首次挂载时后端算一次峰值（`astats` 或 `aresample+ashowinfo`），缓存到节点 `waveform?: number[]`（≤200 桶） |
| 混音面板 | 新 `src/client/cmd/AudioMixPanel.tsx`（或并入详情抽屉） | BGM / 旁白 / 环境声 三条：音量滑杆 + 淡入淡出 + duck 开关；改动即写回节点 `audioTimeline` |
| 导出前预检 | `src/client/StudioFrame.tsx` | 点「导出成片」前跑一次 `resolveAudioTimeline`：短 BGM / 无任何声源 / 多轨重叠 → 弹确认框（不是硬拦），文案给「补静音 / 重新生成 / 继续」三选 |
| 成片角标修正 | 同上（读 `AUDIO_COMPOSITION_LABELS/HINTS`） | 文案随 S1 自动变对，前端零改动即受益 —— 这就是「单一事实源」的收益证明 |
| 音频抽屉 | 新 `AudioDrawer`（可从工具栏或图层区进入） | 全项目音频列表：时长、来源工具、歌词首行、试听、多版并排比较（为 S5 抽卡铺路） |

**退出条件**：一条 3 段混音成片在时间轴上能看出「哪段有声、旁白从第几秒开始、BGM 到第几秒结束」；`CanvasTimeline` 单测新增 ≥6 条（纯函数 `layoutAudioLane(segments, durationSec)` 抽出来测，不测 JSX）。

---

### S4 · Skill：把时间轴交给 agent，而不是靠纪律（1 天）

**问题**：现在 skill 里全是「`duration` 必须等于成片总时长」这类**纪律**，agent 一旦不守就没有兜底。S1~S2 之后有了真模型，就应该把纪律换成**可填的参数**。

| 改动 | 文件 | 说明 |
|---|---|---|
| 总纲加「第 2c 步：声音规划」 | `skills/canvas-studio-creation/SKILL.md` + `references/audio-first.md`（新建） | 在分镜之前先定三件事：**人声/纯器乐**、**有没有旁白**、**BGM 时长 = 目标总时长**。给出「音乐先行」的最小流程与「视频先行 + 事后对齐」的降级流程，明确各自的失败判据 |
| 配音轨规划（替换现有第 8 步的「定配音」单点） | 同上 | 多句旁白写成 `voiceOver: [{nodeId, startSec}]`；给「每句起始帧怎么算」的算法（`startSec = 镜头起始秒 + 入点留白`），禁止 agent 自己算 ffmpeg |
| `music-prompt-writing` 补按拍章节 | `skills/music-prompt-writing/references/beat-editing.md`（新建） | S5 有 `beats.json` 之后，写清「读 beats → 切点吸附到最近拍/半拍」的具体写法与容许误差 |
| 新 skill：`mv-production`（MV 制作） | `skills/mv-production/` | 输入：一首歌 + 一组素材；流程：歌词分句 → 时间轴 → 每句一组画面 → 卡点切换 → 字幕跟唱。**只写复用既有工具的流程，不引入新工具**（除非 S5 的 `lyrics.json` 需要） |
| 工具描述同步 | `src/host-tools.ts` | `compose_video` / `render_composition` / `tts_voiceover` 的描述里加「声音规划见 canvas-studio-creation 第 2c 步」指针。`tts_voiceover` 的结果文案（`host-tools.ts:972`）**已经**同时指向 `bgmNodeId` 与 `audio.voiceOver`，但 compose 侧只收单条 ⇒ 多句旁白在画布路径上无处可填；S2 补 `voiceOverNodeIds` 后再回改这句（「compose 用 voiceOverNodeIds 数组」） |
| 体积闸 | `SKILL.md` 总纲 ≤14KB 硬闸 | 新增内容必须等量置换，不许破闸（实测现 11,316B，余量 3,020B；`audio-first.md` 走 references 分册不占主文） |

**退出条件**：让 agent 做一条「3 镜 + 2 句旁白 + 30s BGM」的片子，它**第一次调用就填对** `voiceOverNodeIds` 与 `bgmNodeId`，且结果文本里能读出 3 段音轨的起止 —— 不需要人再教一遍。

---

### S5 · MV 与音乐创作增强：从「能配乐」到「能对拍」（2 天）

这一阶段是**新能力**，与前四阶段解耦，可以并行或后置。

| 能力 | 实现 | 依赖 | 风险 |
|---|---|---|---|
| **本地节拍分析** | 新 `src/beat-analyze.ts`：`ffmpeg -af ebur128` 取逐帧响度 → 自相关估 BPM → 峰值定位出拍点 → `beats.json`（`{bpm, beats: number[], confidence}`）落音频节点 | 无（内置 ffmpeg 已验证可用 `ebur128`/`silencedetect`） | 电子/打击乐准，弦乐/氛围曲置信度低 ⇒ **必须回 confidence**，低置信时 skill 禁用卡点路径而不是硬用 |
| **回填既有契约（不新造事实源）** | 分析结果写回 `06_sound.bgm`：拍点 → `bpm`（约定 4/4 时 `bpm = 60 / 拍间隔中位数`）；`ebur128` 实测整体响度 → `lufs`；`sidechain` 那句文字 → `AudioSegment.duckAmount` 的默认值来源 | 节拍分析 + 既有唯一写入点 `mergeStoryboardWrite` | **只测量回填，不做母带**：`lufs` 用于「让 agent/用户看见响度」与安全阈值告警，**不按目标 LUFS 做风格化归一化**（与 §7 边界一致）。回填走 `mergeStoryboardWrite`，禁第二处写故事板 |
| **歌词时间轴** | `lyrics.json`：`[{line, startSec, endSec}]`。两条入口：① 人工/agent 指定（精确）；② 启发式对齐（按行字数 + 人声段 `silencedetect` 切分，粗但可用） | ① 无 ② 节拍分析 | ② 精度有限，必须标注 `source:'estimated'` 并在 UI 弱化显示 |
| **卡点剪辑** | `timeline` 工具（或 `layout_table` 同款项目级文件）读 `beats.json`，把镜头切点吸附到最近拍点（容差 `±0.5 拍`，超出不吸附并告警） | 节拍分析 | 吸附后总时长可能变 ⇒ 必须重算 `durationInFrames` 并过尾部完整性校验（CV-361 的教训） |
| **多版抽卡对比** | `music_generation` 支持 `variants: 2-3`（内部循环调 3 次，参数微扰：bpm ±3 / 编曲词替换），产物并列落画布，选定后其余 `retired`（复用 CV-108 版本链语义） | 无 | 3 次调用 = 3 倍耗时/额度 ⇒ 仅显式请求时启用，不进默认路径 |
| **后端能力争取（对外，不阻塞）** | 按 `audio-generation-plan.md §9` 优先级：`seed`（可复现 + 抽卡刚需）→ `repaint/src_audio`（>5min 续写、变奏）→ `reference_audio`（跨片风格统一）→ 回显真实 bpm 与音频时长 | 外部 | 拿不到就用本地节拍分析兜底 |

**退出条件**：给一首 30s 有明确鼓点的曲子，`beats.json` 的 BPM 与人工数拍误差 ≤2；用它做一条 8 镜 MV，切点落在拍点 ±0.1s 内；低置信曲子**不吸附**且有明确提示。

---

### S6 · 验收与登记（0.5 天）

| 项 | 内容 |
|---|---|
| **反向变异矩阵** | ≥7 处：① 去掉 per-clip 探测 → S0 的红回归；② `adelay` 起点写死 0 → 旁白错位断言红；③ 自动补静音开关失效 → 时长断言红；④ `hints` 文案改回「已丢弃」→ 文档漂移测试红；⑤ `compositionFromTimeline` 8 枚举任一映射错 → 映射测试红；⑥ `beats.json` 置信度阈值为 0 → 低置信断言红；⑦ 混音面板音量不写回 → 前端纯函数测试红 |
| **真机金路径 1 条** | `scripts/probe/audio-mix.probe.mjs`（Electron 里跑，仿 `render-host-e2e.probe.mjs`）：造 3 段（1 段无声）→ `compose_video` 带 BGM + 2 句旁白 → 成片落盘 → `ffprobe`/`silencedetect` 断言 → 报告 `/tmp/cs-audio-mix/report.json`，退出码 0/1 |
| **STATUS 登记** | S1~S2 一条（CV-040 收口）、S3 一条（音频轨 + 混音面板）、S4 一条（skill）、S5 两条（节拍/歌词轨、抽卡）；每条按纪律写 §4.1 索引行 + `cv-details.md` 小节 + `changelog.md` 一行，再跑 `node scripts/status-summary.mjs` |
| **文档同步** | `audio-acceptance-checklist.md` 的「未做」清单按本文实测重写（当前有 5 项已过时）；`audio-generation-plan.md §10` 落地表补本轮状态 |

---

## 4. 三端覆盖矩阵（自查没有漏面）

| 维度 | 后台（Host） | Skill | 前端（Client） |
|---|---|---|---|
| **能力** | per-clip 探测 / 多轨装配 / ducking / 自动补静音 | 第 2c 步声音规划 / 多句旁白写法 / MV 流程 | 音频轨 / 混音面板 / 音频抽屉 / 真波形 |
| **一致性** | 单一 `AudioTimeline` + 单一 `buildAudioGraph`；compose 与 render 同源 | 只有一个「声音规划」入口，两条路径同一套参数名 | 角标文案由模型派生，不再手工维护 |
| **稳定性** | 四类脏输入不静默：越界拒收、缺轨补静音、短轨自动 pad、重叠告警 | 低置信节拍禁用卡点；`degradedFields` 非空不许声称已生效 | 导出前预检弹确认；失败有「补静音/重生成/继续」出路 |
| **易用性** | 工具结果回显每段起止 + 是否补静音（模型能自查） | 指针式分册，主文不胀 | 时间轴看得见、播放器调得动、抽屉比得快 |
| **MV / 音乐** | `beats.json` / `lyrics.json` / 多版抽卡 | `mv-production` + 按拍章节 | 段落色块按拍对齐、跟唱高亮 |

---

## 5. 关键设计决策（已拍板 2026-10-28）

> 用户于 2026-10-28 明确：**六条全部按建议通过**，不再回议。下表「拍板结果」列即执行口径；若后续实测推翻，须在本文追加一行「变更记录」而不是就地改写。

| # | 决策 | 拍板结果（= 执行口径） | 落地位置 |
|---|---|---|---|
| **D-01** | 音轨是否改为「从零装配」（视频流 `-an` 后单独合流） | ✅ **是**。绝对时间坐标是 duck / 多轨 / 精确落点的唯一前提。**S2b 开工前必须通过 G1a 离线自验**（见 §6；人耳补验 G1b 不阻塞），单镜路径全程不变 | S2b |
| **D-02** | 成片短 BGM 的默认处置 | ✅ **自动 `apad` 补静音 + 显式 warning**，文案写明「已自动补 N.Ns 静音」；`CANVAS_STUDIO_AUDIO_AUTOPAD=0` 回退到旧行为（只告警不补） | S2b |
| **D-03** | `StudioAudioComposition` 八枚举是否保留 | ✅ **保留**，改为从 `AudioTimeline` 派生；老 `canvas.json` 无 `audioTimeline` 时用 `timelineFromComposition()` 反推等价时间轴（**只读不写回**，不迁移历史数据） | S1 |
| **D-04** | 时间轴首版是否可拖拽编辑 | ✅ **只读首版**。音频 lane 走独立组件 + 只读 props，不碰既有手势层；拖拽留 S3b | S3 |
| **D-05** | 节拍分析精度不够时 | ✅ **回 `confidence`，低置信禁用卡点路径**，`beats.json` 仅作参考信息并在 UI 弱化显示 | S5 |
| **D-06** | 多版抽卡是否进默认流程 | ✅ **仅显式请求**（`variants: 2-3`），不进默认路径；产物并列落画布，选定后其余 `retired` | S5 |

**拍板带来的一处计划调整**：D-01 通过后，S2b 从「可选的结构升级」变成「既定工作」。**2026-10-28 追加指令（连续推进不中断）**进一步取消了「等用户真机验收再进 S2b」的等待 —— 改为 G1a 离线自验（见 §6）通过即进 S2b；真机人耳确认（G1b）移到交付清单，由用户在收工后跑。唯一保留的硬约束：**带着未解释的 A/V 偏差不得进 S2b 重构**（重构会把定位难度放大一个量级）。

---

## 6. 工期与依赖

```
S0 取证 0.5d ──→ S1 模型 1.5d ──→ S2a 止血 0.5d ──[G1a 离线自验]──→ S2b 结构 2d ──→ S3 前端 1.5d ──→ S6 验收 0.5d
               │                                                            ↑
               └─→ S5 音乐/MV 2d ──────────────────────────────────────────┘（可并行，依赖 S1 的模型）
S4 skill 1d（依赖 S1 契约定型，可与 S2b/S3 并行）
```

合计 ≈ **9.5 人日**（不含用户真机补验与后端争取）。

**闸门语义已改（2026-10-28 用户指令：连续推进不中断）**：原 G1「等用户真机验收后才准进 S2b」会让会话停在等人上，与执行纪律冲突 ⇒ 拆成 **G1a（agent 自验，必须过）** 与 **G1b（用户补验，交付后清单）**；G2 改为**合成鼓点曲机器判定**，不再依赖人耳。

| 闸 | 位置 | 判据 | 谁执行 | 是否阻塞推进 |
|---|---|---|---|---|
| **G1a** | S2a 之后、S2b 之前 | `scripts/probe/audio-mix.probe.mjs` 退出码 0；成片音轨时长 == 视频时长（±0.15s）；逐秒 RMS 对齐；A/V 偏差 ≤1 帧（`ffmpeg -i` 双流时长差） | **agent（离线）** | ✅ 必须过；不过则先修 S2a，修不动就回退并记遗留（§10） |
| **G1b** | 全部交付后 | 真机 GUI 跑同一条 probe，人耳确认无「后半段突然静音 / 人声错位」 | **用户** | ❌ 不阻塞；写进交付清单 |
| **G2** | S5 节拍分析之后 | 用 `make-audio-fixtures.mjs` 生成**已知 BPM 的合成鼓点曲**（120 / 90 / 140 三档），估出的 BPM 误差 ≤2、拍点对齐 ≤0.1s | **agent（机器判定）** | ✅ 必须过；不达标则按 D-05 降级并在文档记录实际精度 |

**S0→S1→S2a 是「零外部依赖段」**：纯本地 ffmpeg + 纯函数 + 单测，不需要 GUI、不需要后端、不消耗额度 —— 因此这一整段必须连续做完，中途不停。

---

## 7. 明确不做（边界）

- **不做 AI 母带艺术化处理**：`loudnorm` 只用于「防止某一路过响」的安全阈值（可选开关），不做风格化压限。
- **不改后端音频入参字段名**：`audio1..audio3` 已于 2026-09-10 与后端确认一致，不动。
- **不迁移历史项目数据**：老 `canvas.json` 缺 `audioTimeline` 时按 D-03 的派生函数读，不写回、不批量回填（开发阶段铁律）。
- **不在本轮做音乐「分轨」（extract/lego/complete）**：后端未暴露，纯客户端做不了。
- **不碰 `deepseek-harness/` submodule**：全部改动在 `canvas-studio/` 与 `dsh-plugin-desktop/` 的自有文件内。

---

## 8. 风险与止损

| 风险 | 触发信号 | 止损 |
|---|---|---|
| 音轨从零装配后 A/V 不同步 | 成片音画偏差 >1 帧 | 保留 `CANVAS_STUDIO_AUDIO_LEGACY_CONCAT=1` 回退到旧路径，先发安全版再查偏差根因 |
| `compose.ts` 破 1200 行棘轮 | `test:smoke` 的文件大小闸红 | S2 就把音频装配整体搬到 `audio-compose.ts`（不塞 `audio-timeline.ts`，那是纯函数层） |
| 节拍分析在真实曲子上不可用 | BPM 误差 >5 | 关闭卡点默认路径，`beats.json` 只作参考信息 + `confidence` 显式低 |
| 前端时间轴改动引发画布回归 | 拖拽/多选/时间轴选择用例红 | 音频 lane 走**独立组件 + 只读 props**，不碰既有手势层 |
| 真机验收无法在 agent 侧执行 | 需 GUI | 不阻塞交付：agent 侧以 G1a/G2 的机器判据替代，真机步骤写成「一条命令 + 报告落盘」进交付清单，用户收工后跑（G1b） |

---

## 9. 拍板后的剩余卡点（2026-10-28 复核：**开工无阻塞**）

拍板消掉的是「**决策**卡点」—— D-01~D-06 六条已定，不存在「做着做着要回头问方向」的情况。但要把「没有卡点」说准确，需要区分四类：

| 类别 | 具体项 | 是否阻塞开工 | 处置 |
|---|---|---|---|
| **A. 需要人**（拍板消不掉，已移出关键路径） | G1b 真机补验（GUI 人耳）、桌面验收 | ❌ 不阻塞任何阶段 | 全部改为「交付后清单」：脚本 + 一条命令 + 报告落盘，用户收工后跑；agent 侧用 G1a/G2 的机器判据替代 |
| **B. 需要外部**（不阻塞） | S5「后端能力争取」：`seed` / `repaint` / `reference_audio` / 回显真实 bpm | ❌ 不阻塞（有本地兜底） | 本地 `beat-analyze.ts` 先跑通；后端拿到就用，拿不到不影响交付 |
| **C. 技术不确定**（已预置出口） | ① 从零装配后 A/V 偏差；② 节拍分析在弦乐/氛围曲上不灵；③ 上采样 32k→48k 的极小损失 | ❌ 不阻塞（每条都有回退开关） | ① `CANVAS_STUDIO_AUDIO_LEGACY_CONCAT=1`；② D-05 低置信禁用卡点；③ S2b 记 `sourceSampleRate`、只对齐不改采样 |
| **D. 工程约束**（已量化） | `compose.ts` 1200 行棘轮、`SKILL.md` 14KB 硬闸、测试入口只准 `yarn test:smoke` | ❌ 不阻塞（已给拆法） | 音频装配搬到新 `src/audio-compose.ts`；skill 新增内容走 `references/` 分册 + 主文等量置换 |

**结论：没有阻塞项，按 §10 的执行纪律连续推进到 S6 完成。** 原「唯一的卡点是人肉验收」已消解：G1a/G2 都把人工判据换成了 ffmpeg 机器判据（时长 / 逐秒 RMS / 双流时长差 / 已知 BPM 合成曲），G1b 人耳确认降级为交付后清单。执行期不得因等待用户而在阶段之间停下。

### 9.1 开工前置自检（handoff 时逐条确认）

1. `cd canvas-studio`，内置 ffmpeg 路径 `../dsh-plugin-desktop/build/ffmpeg/darwin-arm64/ffmpeg`（6.0，14 个音频滤镜已验证可用）；**`ffprobe` 不在该目录**，需要时用 `ffmpeg -i` 解析 stderr（`parseFfmpegStreams` / `parseFfmpegDuration` 已有）。
2. 验证链顺序：`clean.mjs` → `tsdown` → `tsc -p tsconfig.json` + `tsc -p tsconfig.client.json --emitDeclarationOnly` → `verify:loader` → `yarn test:smoke`；**只跑 tsdown 就测 = 测旧码**（测试 import `lib/**`）。
3. 反向变异**禁止** `sed -i ''`；含反引号的批量替换**禁止** `node -e`；同文件多条 Edit 串行。
4. 取号：开工时 `git log` + STATUS §4.1 复核水位（**本轮核到 CV-376**），验收通过后才登记，不预领。
5. 不碰 `deepseek-harness/` submodule；`git` 由助手 commit，push 由用户手动。

---

## 10. 执行纪律（2026-10-28 用户指令，优先级高于本文其余流程描述）

> 用户原话：**「不希望中间停下来，直到所有任务完成前都不能停；有不明白的或需要拍板的自己做决定；全部完成后告诉我做了什么。」**

### 10.1 四条硬规则

1. **连续推进**：`S0 → S1 → S2a → G1a → S2b → S3 → S4 → S5 → G2 → S6` 一口气做完。**中途不询问、不等确认、不「先汇报再继续」**；每阶段验收全绿立即进下一阶段。
2. **自主决策**：新出现的选择按 §10.2 的裁决顺序自己定，记进 §10.3 决策日志（编号从 **D-07** 起），**不回头问**。
3. **完成后一次性汇报**：格式见 §10.4，只在全部阶段结束时汇报一次。
4. **停下来的唯一合法理由**：全部阶段完成（或用户主动打断）。

### 10.2 自主裁决顺序（遇到本文没写明的事，按此顺序判）

1. 本文已写明的 → 照做（D-01~D-06 已定，不再议）。
2. 本文没写、但 §7「明确不做」划了边界的 → 取边界内侧最保守的实现。
3. 仍然不明 → 选「**不破坏既有行为 + 可回退 + 可观测**」的那一版：优先加 env 开关 / warning，**不新增契约字段**、不改既有工具签名语义。
4. 同一问题**连续 3 轮修复无进展** → 回退到该阶段的安全形态，记入 §10.5 遗留清单，**继续推进下一阶段**（不因单点卡住全局）。

### 10.3 决策日志（执行时逐条追加，禁止事后补写）

| # | 阶段 | 触发问题 | 自决内容 | 理由 | 推翻成本 |
|---|---|---|---|---|---|
| D-07 | S0 | 实验 C 计划用 44.1k/48k，样本集定为 16k/48k 后损坏比预测重（容器虚报 12.02s + 解码器中止），wav 导出非零退出 | 探针把「部分解码」作为合法实测值（`decodePartial` 标注），不崩、照常出判据 | 损坏本身就是取证对象；修复后该分支自然不再触发 | 低（探针内一个分支） |
| D-08 | S1 | ①计划 §S1 的链序 `adelay → volume/afade` 会让淡变落在前插静音上；②`onShort:'loop'` v1 装配不支持 | ①链序改为 `volume → afade → adelay`（淡变锚内容起点）；②loop 按 pad 降级 + `loop-unsupported` warning | ①正确性优先于计划的示意箭头；②不静默丢语义（§10.2 第 3 条） | 低（纯函数内重排/分支） |
| D-09 | S2a | ①ffmpeg 选项按「下一个文件」归属，计划草图的 anullsrc 参数位（原 `-c:a` 处）实测报 `Option vf cannot be applied to input`；②补静音后 concat 恒有音频流，角标会冒充「原生声」；③补静音回显通道 | ①anullsrc 输入整体紧跟 `-i` 输入区（`buildAudioCodecArgs` 产出放在 `-vf` 之前）；②新增 `hasNativeAudio = hasConcatAudio && 至少一段真有声`，角标/amix 分支/静片警告全用后者（行为与补静音前一致）；③回显走 `warnings`（renderComposeResult 已渲染，零 schema 变更） | ①实测约束；②③不破坏既有行为 + 可观测（§10.2 第 3 条） | 低（各一处调用点） |

### 10.4 完成汇报格式

1. **阶段逐条**：每个阶段做了什么 + 改了哪些文件（路径）+ 验证结果（跑过的命令与关键数值，不是「已通过」四个字）；
2. **偏差**：与本文 §1.4 / §3 预测不一致的地方，及原因；
3. **降级与遗留**：§10.5 清单内容 + 为什么没做；
4. **用户需要跑的一条命令**：G1b 真机补验（含预期输出与失败时看哪一行）；
5. **git 状态**：commit 了几笔、hash 前缀、是否待 push。

### 10.5 遗留清单（执行时填）

| # | 阶段 | 遗留项 | 原因 | 下一步 |
|---|---|---|---|---|

### 10.6 红线（即使授权自决也不放开）

- 不碰 `deepseek-harness/` submodule；不改后端入参字段名（`audio1..audio3`）。
- **不迁移 / 不回填历史项目数据**（老 `canvas.json` 只读派生）。
- 不 kill Electron 进程；不跳过验证链（`clean.mjs` → `tsdown` → `tsc`×2 → `verify:loader` → `yarn test:smoke`）。
- 不为「让测试变绿」而改既有断言的语义 —— 唯一例外是 S2a 已点名的 `tests/compose.test.mjs:79-89`（`-an` 那条），且必须在汇报里单独说明改了什么、为什么等价。
- `git push` 由用户手动；助手只 commit。
