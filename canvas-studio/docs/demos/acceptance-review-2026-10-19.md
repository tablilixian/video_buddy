# 真机验收评审 ·《修表的人》（2026-10-19）

> 材料：`session.jsonl 18`（4219 行 / 129 次工具调用 / 3 turns）+ 项目目录 `~/Desktop/job/VideoOut/newOut1/projects/做一条 20 秒的写实短片《修表的人》，/`
> 方法：manifest 原文逐字段核对 · 落盘资产实测取色/取时 · 产品源码反查（作为「实现是否支持」的判据）

---

## 〇、一句话结论

**成片质量超预期，链路合规无 shortcut；但三期能力只点亮了三分之一，且 W6 闭环（抽帧 + 渲染报告）在真机上 100% 失效——数据算出来了、落盘了，就是没送到模型手里。**

三条最该处理的：

1. **P0 · `render_composition` 的返回文本里没有 `frames` / `report`** —— 8 张抽帧 14:38:31 已落盘，模型完全不知道，自己用 ffmpeg 又抽了一遍；
2. **P0 · ML-10 对「素材驱动」的片子恒误报** —— 分母把 600 帧背景 / 600 帧波形 / 465 帧视频全算「静态」，连续 7 次渲染都在报，agent 只能当噪声忽略；
3. **P1 · `startAfter` 与 `transition` 语义互斥** —— `gapFrames ≥ 0` 只能表达「相邻」或「留空」，而叠化要求两轨**重叠**。只要片子用转场，`startAfter` 就永远用不上（本次 9 次渲染 0 次使用）。

---

## 一、事实台账

| 项 | 实测值 |
| --- | --- |
| 会话 | 14:00:19 起 → 15:08 交付，约 **68 分钟** |
| 工具调用 | 129 次（`bash` 51 / `read` 13 / `ask_user_choice` 10 / `render_composition` 9 / `upload_image` 9 / `tts_voiceover` 6 / `write_storyboard` 5 / `video_composite` 3 / `qc_shot` 3 / `image_generate` 3） |
| 视频素材 | H3 Ref2VA ×3，**864×480 / 5.17s / 带原生音频** |
| 成片 | `standard` 档 **1280×720 · 30fps · 20.07s · H.264 1545kbps / AAC 48k 立体声** |
| 渲染次数 | 9 次（**7 成功**：6 draft + 1 standard；**2 次 600s 超时**） |
| 单次渲染耗时 | standard ≈ **35s**（15:07:01→15:07:36），约 0.058 s/帧 |
| 画布节点 | 28 个（含 **7 个成片节点**：6 draft + 1 standard） |
| 编排体检 | ML-02 首轮真实命中（已修）；**ML-10 连报 7 次**（误报） |
| 质检 | S1 **FAIL**（误判）/ S3、S2 PASS |

---

## 二、做得好的（这些是这次真正的收获）

### 2.1 链路零 shortcut

11 步全部落地：3 次点选澄清 → `write_storyboard` 5 次（§00/§03/§04/§05/角色/声音/素材/硬约束）→ 用户点「确认落地」→ Look 卡冻结 → 角色卡 `lockedPrompt` 625 字 → 4 张参考上传 → 3 镜 Ref2VA（每镜一条）→ BGM → TTS → 合成 → `qc_shot` → 交付报告。

**关键点：`lockedPrompt` 没有被改写**（`character_sheet` 传入 625 字中文，后续 3 次 `video_composite` 的六段式里 `<Subject 1>` 是它的英文转写：60 多岁东亚男性 / 灰白短发+白鬓角 / 瘦脸高颧骨 / 深鱼尾纹与法令纹 / 神态平静。三镜主体描述一致。

⚠️ 唯一偏差：V1 写的是「face, **hands**, hair, glasses and clothing come from」，V2/V3 去掉了 `hands`。S1 是手部微距，加 `hands` 是对的；但 **S3 里老人把表放回柜台、伸手关灯，同样露手**，V3 却没锁定手部来源 —— 属于可记录的一致性小风险（本次没崩，是因为三镜都用了同一组参考图）。

### 2.2 三处自检是「工程做法」而不是「感觉做法」

| 做法 | 抓到了什么 |
| --- | --- |
| 抽帧 → `upload_image` → `image2vl` 问「有没有大字标题 / 底色是暖褐还是纯黑」 | 首版片头卡底色 **纯黑**（`bg-base` 的 `box` 写成 0,0，只铺了左上四分之一）；片尾底部**没有波形** |
| `ffmpeg crop → scale=1:1 → od` 逐点取色 | 把「底色不对」从主观描述变成 `33 15 8` vs `4 2 0` 的硬数字 |
| `ffmpeg volumedetect` 逐 0.5s 扫电平 | 发现 V1 只有 -33.5dB 而 V2 是 -20.3dB（差 13dB），三句旁白电平不齐 |

### 2.3 两个「误报」判断都对

我独立核对源码，两条结论都成立：

- **ML-10 是误报**：`motion-lint.ts:253-264` 的 `movingFrames` 只累加 `animate`/`exit`/`fade` 区间，而 `totalTrackFrames` 把**所有轨**的 `durationInFrames` 都加进分母 —— 三镜 465 帧真实运动、600 帧背景、600 帧波形全被当成「静止」；
- **`qc_shot` S1 是误判**：`S1` 按分镜就是手部微距，质检却按「面部 / 发型 / 中长焦中景」核对，基准与镜头设计冲突。

**这两个判断如果错了，后续会白改一堆东西。它没有错。**

### 2.4 音频这条线是自己趟出来的

用户投诉的顺序是：「没听到念台词」→「语气不对，要 60 岁沙哑」→「还欠沧桑」。agent 的解法是：

```
3 条独立 TTS → 各自 loudnorm 到 -16 LUFS → 降 1.5 半音 + 低频加厚 + acrusher 磨砂 + 轻颤音
→ 按落点（2.60 / 7.07 / 11.90s）拼成一条 vo 轨 → 交给 manifest 的单个 voiceOverUrl
```

这条链路**不是产品提供的**（见 P2-6/P2-7），是它用 ffmpeg 现搓的。

### 2.5 交付报告敢写「已知偏差」

五条全列：片尾卡 3.33s ≠ 2.5s（被叠化挤占）、源素材 480p 上采样、片名无衬线、沙哑是后处理补的、叠化中点能量下陷 25%。**没有藏。**

### 2.6 超时后先定位、不盲目重试

第一次 600s 超时后，它没有直接重试，而是去 `grep renderTimeoutMs` / `grep CS-RENDER-TIMEOUT` 读实现，确认超时下限就是 10 分钟，然后改用「请你把画布切到前台」的 ask_user_choice 解决。第二次同样处理。

---

## 三、需要改进的（agent 侧，都是「这次能更好」）

| # | 问题 | 证据 | 影响 |
| --- | --- | --- | --- |
| A1 | **照抄了契约文档的错误示例** | `manifest-contract.md:222` 给的是 `box:{x:0,y:0,w:100,h:100}`，而 `Shape.tsx:109` 是 `left/top + translate(-50%,-50%)` ⇒ **box 的 x/y 是中心点**，0,0 只铺左上四分之一 | 2 次渲染白跑 + 一轮取色排查 + 一次 VL 误判 |
| A2 | **9 次渲染 0 次 `startAfter`** | 最终 manifest 全用显式 `startFrame`（65/210/355/500/78/212/357）；连三句首尾相接的字幕（78+134=212）也是手算 | W1-2 等于没验；且说明「顺序衔接」在带转场的片子里没用武之地（见 P1-3） |
| A3 | **ML-10 连报 7 次，直到交付报告才解释** | #81/#93/#100/#108/#116/#120 每次渲染返回都带它 | 用户中途看不到「这条是误报」，容易以为片子真有问题 |
| A4 | **480p 素材上采样到 720p 交付** | `video_composite` 三次都没传 `resolution`，走缺省 864×480；成片 1280×720 | 白丢约 1.48× 的细节。它自己标了偏差，但本可避免 |
| A5 | **字幕默认没配音** | 用户第一句反馈就是「除了音效，没有听到念台词的声音」；TTS 直到第 88 次调用才出现 | 多 1 轮渲染 + 3 次 TTS + 3 次重做 + 后处理 ≈ 30 分钟。SKILL 第 8 步本应覆盖「字幕是否需要配音」 |
| A6 | 报告数字小错 | 「三镜占 445/600 帧」，实际 155×3 = **465** | 交付物可信度 |
| A7 | **6 个草稿成片节点全留在画布** | `canvas.json` 里 7 个 video-composite 节点（6 个 `draft:true`），每个 0.9–1MB | 画布上 7 个几乎一样的成片，用户要自己清（见 P2-10） |

---

## 四、值得记录并立项处理的问题（产品侧）

### P0-1 · `render_composition` 的 `frames` / `report` 没进模型可见文本

**现象**：标准档渲染返回全文只有 357 字符：

```
已生成产物: …/05bec612….mp4 (1280x720, 20.07s)；注意: [编排体检 ML-10] …
画布节点 id: ebb620b8-…（纳入 15 段，音轨 环境声 + BGM + 旁白）
⚠️ [编排体检 ML-10] …
```

**没有 `frames[]`，没有 `report{}`。**

**证据（这条是硬的）**：

- 抽帧**确实跑通了**：`assets/` 里 14:38:31 一次性落了 **8 张 png**，与 `pickSampleFrames` 的「4 均匀 + 转场中点，上限 8」完全吻合；
- `host-tools.ts:2621-2623` 把 `frames` 塞进了 payload，`:2628` 塞了 `report`；
- 但 `host-tools.ts:321-339` 的 `renderComposeResult` 只拼 `url + 纳入 N 段 + 音轨 + warnings`，**从未输出 frames / report**；
- 于是 agent 在 `#70` 自己去 `ls assets | grep -i frame`（当然找不到，落盘名是 `<assetId>.png`），又去 `/var/folders`、`/tmp` 找，最后 `ffmpeg` 抽了 9 张 `preview/*.png`，还三次 `upload_image` 送 VL。

**根因**：`output.render` 与 `output.schema` 不同步。schema 里有、文本渲染没写 ⇒ 模型读不到。

**影响**：三期 W6 整条闭环（先看抽帧再汇报、按 `msPerFrame`/`warm`/`lint` 决策）**完全失效**。工具描述（`host-tools.ts:2489`）还明确承诺「返回里还有 frames[]/report{}，先看这几张图再汇报」—— 承诺与实现不一致，会直接误导模型。

**修法**：在 `renderComposeResult` 里补两段（`compose_video` 无这两字段时自动跳过）：

```
抽帧 8 张（第 0/75/155/… 帧）：<url1> <url2> …   ← 建议一行一条，便于模型逐张看
渲染报告：quality=standard 600 帧 / 35.0s / 58.3ms·帧 / 编码 2.1s / 3.88MB / 1545kbps / warm=false
```

**验收**：断言「返回文本含 `frames` 的每个 url」与「含 `msPerFrame`」——纯字符串断言即可，能反向变红。

---

### P0-2 · ML-10 对素材驱动片恒误报，会训练 agent 无视体检

**实测**：ML-10 连续 7 次渲染都在报（「动效覆盖仅占轨道总时长的 2%」），一次没消失。

**根因**（`motion-lint.ts:253-264`）：

```ts
let movingFrames = 0
for (const segment of segments) movingFrames += …      // 只有 animate/exit/fade/draw
const totalTrackFrames = tracks.reduce(…)              // 所有轨，含 video / bg / audioViz
if (movingFrames / totalTrackFrames < 0.3) → ML-10
```

本次分母 ≈ 2321 帧（bg 600 + 三镜 465 + 波形 600 + 文字卡 656），分子只有 ≈116 帧（入场 44 + 退场 72）⇒ 恒 5%，永远 < 0.3。

**影响**：一条永远为真的提示 = 噪声。这次 agent 正确地忽略了它，但代价是**学会了忽略 lint** —— 下次真出现 ML-02 这类硬问题，也可能被一起跳过（首轮它确实修了 ML-02，但那是第 2 次渲染，还没被 ML-10 磨掉耐心）。

**修法**（择一，建议都做）：

1. 分母排除 `video` 轨（视频本身在动，不该要求 animate）；
2. 分母排除「常驻装饰轨」：`shape` 满画布背景、`audioViz` 整片长的；
3. 兜底：`video` 轨帧数占比 > 40% 时直接不判 ML-10。

**验收**：拿本次 manifest 断言「ML-10 不出现」；再拿一份纯静态图文 manifest 断言「ML-10 仍出现」（双向）。

---

### P1-3 · `startAfter` 与 `transition` 语义互斥，导致 W1-2 在真机上不可能被用

**代码事实**：

- `normalize-timing.ts:85`：`gapFrames` 必须是 **>= 0** 的整数；
- `normalize-timing.ts:95`：`startFrame = 引用轨.startFrame + 引用轨.durationInFrames + gap`；
- `manifest.ts` 校验：`transition` 要求**两轨必须重叠**（首尾相接只会降级成硬切 warning）。

⇒ `startAfter` 只能产出「相邻」或「留空」，**产不出重叠**；而只要有叠化，就必须重叠。

**实测结果**：9 次渲染 0 次使用 `startAfter`，全部手算 65/210/355/500。而三期文档里写的正是「6 幕用 `startAfter` 衔接，不要手算帧号」。

**修法（推荐）**：允许 `gapFrames` 为负，语义定义为「与引用轨**重叠** `|gap|` 帧」。`-10` 恰好等于「10 帧叠化窗口」。这比新增字段更小、更自然，且与现有的 `+gap` 公式同一个表达式（不用改解析逻辑，只改校验那行的 `gap < 0` 判断）。

**同步**：`manifest-contract.md` 与工具描述补一句「要叠化就写 `gapFrames: -10`，与转场时长对齐」。

**验收**：`startAfter:{trackId:a,gapFrames:-10}` 解析出 `a.start+a.dur-10`；归一后删字段（现有铁律）；带 transition 的 manifest 能过校验。

---

### P1-4 · 契约文档的 `box` 示例是错的（照抄得四分之一底）

**文档**（`manifest-contract.md:218-226`）：

```jsonc
{ "shape": "gradient", "color": "#111827", "box": { "x": 0, "y": 0, "w": 100, "h": 100 } }
```
> `box` 是相对画布的百分比坐标（0–100）。

**实现**（`Shape.tsx:109-126`）：`left: box.x%` `top: box.y%` + `transform: translate(-50%,-50%)` ⇒ **x/y 是形状中心**。`0,0` + `w/h=100` ⇒ 盒子中心在左上角 ⇒ 只覆盖左上四分之一。

**实测取证**（同一帧 0.6s，draft 640×360，取 `crop=8:8` 均值）：

| 采样点 | `box 0,0`（第 1/2 次渲染） | `box 50,50`（第 3 次起） |
| --- | --- | --- |
| (20,20) | `4 2 0` | `33 15 8` |
| (300,20) | `0 0 0` | `20 10 4` |
| (20,170) | `3 0 1` | `31 13 6` |

**修法**：文档示例改 `{"x":50,"y":50,"w":100,"h":100}`，并把说明改成「`x`/`y` 是形状**中心**，`w`/`h` 是宽高，均按画布百分比；铺满全屏用 `50,50,100,100`」。可选加一条校验 warning：`box` 中心落在画布外 → 提示。

---

### P1-5 · 渲染超时下限 10 分钟 + 页面不可见时静默挂死

**实测**：两次「成片渲染超时（600 秒内画布客户端未返回结果）」，合计白等 **20 分钟**。两次都是同一个原因：画布页不在前台。

**代码事实**：`timing.ts:1253` `RENDER_TIMEOUT_MIN_MS = 10 * 60_000` ⇒ 任何渲染最少等 10 分钟才报错；客户端渲染依赖页面可见（`requestAnimationFrame` 被浏览器节流/暂停）。

**修法**：

1. 客户端检测到 `document.visibilityState === 'hidden'` 时**主动** `POST /remotion/cancel`（或上报 `paused`），宿主立即失败并给出「画布页需保持可见」的明确文案 —— 从 10 分钟降到秒级；
2. `RENDER_TIMEOUT_MIN_MS` 降到 60–120s（20s 片 standard 只要 35s，10 分钟下限毫无必要）；
3. 工具描述前置警告：「渲染期间画布页必须保持前台可见」。

---

### P2-6 · `tts_voiceover` 没有音色/年龄/语速参数

用户连提两轮「要 60 岁沙哑」，TTS 只能靠自然语言「沧桑一点」引导，最终靠 `ffmpeg` 降调 + `acrusher` 磨砂硬补。

**建议**：至少给 `voiceId` / `speed` / `pitchSemitones` 三个参数；短期可在工具描述里承认「音色由文本引导，超出模型音域需后处理」，避免 agent 反复重试浪费额度（本次重试 2 轮）。

### P2-7 · `audio.voiceOverUrl` 只支持单轨，多句台词必须外部拼

本次 agent 自己用 ffmpeg 拼了 `voiceover-timeline-v4.mp3`（14.32s，三句按 2.60/7.07/11.90 落点）。

**建议**：`audio.voiceOver` 支持数组 `[{src, startFrame}]`，宿主内部拼轨。否则「多句旁白」这条路永远要 agent 手搓 ffmpeg —— 而终端用户跑不了 ffmpeg。

### P2-8 · `qc_shot` 基准串味，手部微距被按「面部/中长焦中景」判 FAIL

`shotRefs:["分镜 1"]`，但判定理由出现「未呈现面部与发型」「与期望的中长焦中景交替、固定机位不符」—— 那是 S2 的镜头语汇。

**建议**：QC 只取该镜自己的 `camera`/`shotSize`/`subject`；并允许镜头声明 `facesVisible: false`（微距/背影/空镜）以跳过外貌核对。否则「手部特写」这类镜头永远 FAIL。

### P2-9 · 视频素材分辨率与交付分辨率无联动提示

`video_composite` 三次都没传 `resolution` ⇒ 864×480；成片 1280×720 是上采样。

**建议**：`render_composition` 核对素材真实分辨率，若 < 成片分辨率达 1.2× 以上，给 warning：「素材 864×480 低于成片 1280×720，细节为上采样」。让 agent 有机会主动要求重出 736p。

### P2-10 · 草稿渲染每次都新增节点，画布堆 6 个成片

7 次成功渲染 ⇒ 7 个 `video-composite` 节点并排（6 个 `draft:true`），无 `replaces` 关系。

**建议**：同项目内 draft 成片默认「后一版替换前一版」（或折叠为一个「成片版本组」）。否则用户要手工清理，且画布会随迭代线性膨胀。

---

## 五、三期能力点亮表（对着 20 项逐条给出证据）

| 工作包 | 能力 | 真机结果 | 证据 |
| --- | --- | --- | --- |
| W1-1 | `exit` 退场 | ✅ **用得最透** | 5 条文字轨全带 `exit`（主标下沉+放大、字幕上浮 54、片尾淡出 18 帧） |
| W1-2 | `startAfter` | ❌ **0 次** | 9 份 manifest 里 `startAfter` 出现 0 次 |
| W1-3 | 编排体检 12 条 | ⚠️ **接线通、结论受 ML-10 干扰** | ML-02 首轮真实命中并被修好；ML-10 连报 7 次为误报 |
| W2-1 | 缓动 13 档 | ⚠️ 用了 4 档 | `backOut`（主标）/`easeOutCubic`（副标）/`easeInOut`（转场）/`easeIn`（退场） |
| W2-2 | `spring` | ❌ 未用 | — |
| W2-3 | `colorShift` | ❌ 未用 | 0 次 |
| W2-4 | `meta.look` | ✅ **六项全开** | contrast 1.06 / saturation 0.98 / brightness 1.0 / temperature +0.18 / vignette 0.35 / grain 0.16 |
| W2-5 | `blend` | ❌ 未用 | 0 次 |
| W2-6 | 转场参数化 | ⚠️ 半用 | 4 处 `dissolve` + `easing`；**`softness` 全缺**（默认硬边） |
| W3-1 | 媒体五字段 | ❌ **全未用** | 三条 video 轨只有 `src/startFrame/durationInFrames` |
| W3-2 | 音量包络 + 闪避 | ✅ | `fadeIn 0.8` / `fadeOut 1.6` / `duck.amount 0.38` / `mix{bgm .3, vo 1}` |
| W3-3 | `audioViz` 升级 | ⚠️ 半用 | `smoothing 0.45` ✅；`mode:"bars"` ❌（id 却叫 `pulse-line`）；`gradient` ❌ |
| W3-4 | 预取 | ✅ 间接 | 无黑帧、无「前几帧没颗粒」 |
| W4-1 | `measureText` 实测字号 | ✅ 间接 | 三次 VL 复核均无压边/裁切 |
| W4-2 | 4 个文本动效 | ⚠️ 1 个 | 字幕全用 `fadeUp` + `animOptions{offsetY:12,blur:3,wordDelay:2}`；`wordStagger`/`maskReveal`/`typewriter` 未用 |
| W5-1 | 三档 quality | ✅ | draft ×6 / standard ×1，输出 640×360 vs 1280×720 |
| W5-2 | 草稿角标 | ✅ | `canvas.json` 6 个节点 `draft:true`，standard 无标记 |
| W5-5 | 探测缓存 | ✅ | `assets/.remotion-probe.json` 已生成并复用 |
| W6-1 | 渲后抽帧 | ✅ 后端 / ❌ 送达 | 14:38:31 落盘 **8 张**，但返回文本没提 |
| W6-2 | 渲染报告 | ✅ 后端 / ❌ 送达 | payload 有 `report`，文本无；agent 只好自己 `ffprobe` 算耗时/码率 |
| W6-3 | 预览增强 | 未验证 | 本次没走预览面板 |

**统计：完全点亮 6 项 / 部分 5 项 / 未用或不可见 9 项。**

---

## 六、建议的处理顺序

**第一批（W6 价值回收，改动最小、收益最大）**

1. P0-1 补 `renderComposeResult` 的 frames/report 文本 —— 一个函数、两行拼接；
2. P0-2 修 ML-10 分母 —— 一个条件；
3. P1-4 改文档 `box` 示例 + 说明 —— 纯文档。

**第二批（能力可用性）**

4. P1-3 允许负 `gapFrames`（=`overlapFrames`）—— 一条校验 + 文档；
5. P1-5 页面隐藏即取消 + 超时下限降到 90s —— 客户端一处监听、一个常量。

**第三批（体验债，需要设计）**

6. P2-7 多句旁白原生支持（`voiceOver` 数组）；
7. P2-8 `qc_shot` 按镜头取基准 + `facesVisible`；
8. P2-10 草稿成片替换而非并列。

---

## 七、给下一轮的验收补充

本次没覆盖到的：`startAfter`（P1-3 修完后专测）、`spring`、`colorShift`、`blend`、`softness`、媒体五字段、`wordStagger`/`maskReveal`、预览增强（W6-3）。

建议下一条片子**刻意只用视频片段 + 大量图文卡**，逼出「媒体五字段 + 转场柔化」；再下一条用**纯图文（无视频）**，让 ML-10 真正有意义。

---

## 八、处置状态（2026-10-19 收尾更新）

执行单见 [`../plans/REQ-034-优化总纲-20261019.md`](../plans/REQ-034-优化总纲-20261019.md)（批次 A / B / C）。

| 评审条目 | 对应执行项 | 状态 |
|---|---|---|
| P0-1 `renderComposeResult` 不渲染 `frames[]`/`report{}` | O-01 | ✅ 代码完成·**真机验收通过**（CV-350） |
| P0-2 ML-10 对素材驱动片恒误报 | O-02 | ✅ 代码完成·**真机验收通过**（CV-351，口径按总纲 §1 修订） |
| P1-3 `gapFrames >= 0` ⇒ `startAfter` 与转场互斥 | O-08 | 🟡 代码完成·待真机验收（负值 = 重叠；负起始帧拒收；<6 帧提示） |
| P1-4 契约文档 `box` 示例错（x/y 是中心） | O-03 | ✅ 代码完成·**真机验收通过**（CV-352） |
| P1-5 超时下限 10 分钟 + 页面不可见静默挂死 | O-04 / O-06 | 🟡 代码完成·待真机验收（RenderHost + 心跳判活 + 90s 新口径） |
| P2-6 TTS 缺音色/语速 | O-09 | 🟡 代码完成·待真机验收（宿主 ffmpeg `speed` / `pitchSemitones`；`voiceId` 后端无此字段，不做） |
| P2-7 `voiceOverUrl` 单轨 | O-10 | 🟡 代码完成·待真机验收（`audio.voiceOver[]`，与单轨互斥） |
| 总纲新增：QC 基准串味（手部微距被判「未呈现面部」） | O-11 | 🟡 代码完成·待真机验收（按本镜卡正文判定 + `facesVisible:false`） |
| 总纲新增：素材分辨率与交付分辨率无联动 | O-12 | 🟡 代码完成·待真机验收（`[分辨率]` warning，阈值 1.05） |
| 总纲新增：草稿成片每次都新增节点 | O-13 | 🟡 代码完成·待真机验收（draft 就地替换） |

O-04 四问结论见 [`../plans/REQ-034-O-04-spike结果-20261019.md`](../plans/REQ-034-O-04-spike结果-20261019.md)。

