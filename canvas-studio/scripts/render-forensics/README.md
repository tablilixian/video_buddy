# 渲染取证台（render-forensics）

把 `session.v4` 那场"6 小时渲不出片"的争议，变成**可以重放的对照实验**。

会话里所有结论都建立在同一个混乱现场上：产品工单桥 + 隐藏渲染窗口 + 画布页 + 三个 compaction。
这一层的耦合太多，任何人都能给它分配一个根因（复盘 v2 就把"素材预取死锁"写成了 P0）。
本目录把耦合全部拆掉，只留 **Remotion + WebCodecs 编码器 + 一份 manifest**，
于是"同一份 manifest 在独立工程里能不能过"就成了归因的判决点。

## 已跑出的结论（2026-10-24，本机 Intel x64 / 8 核）

- **全片 61 轨 / 1800 帧：129–182s 渲通**（会话给 420s 预算却 39 次超时）。
- **重放会话自己的 12 份工件：10 份跑通**，`probe_min` 216ms（会话 55.6s）、`seg_s2` 37s（会话超时 150s）、
  `shapeonly_full` 116s（会话超时 420s）。2 份失败是**素材被客户端重启删了**，不是渲染。
- 三个原根因全部证伪：素材预取死锁 / 窗口节流 / 每单冷启动。
- 唯一真实的"慢"：中文 `textCard` 固定 ~19s（字体初始化 + 字形栅格化）。它解释 20s，解释不了 420s。

详见 `docs/session-v4-复盘-v4-实测结案.md`。

---

## 一、它回答什么

| 组 | 问题 | 判读 |
|---|---|---|
| **Q1** | 是否每次渲染都要付一次冷启动？ | 第 2–4 次明显更快 ⇒ 有预热收益，问题是"没复用"而不是"Remotion 慢" |
| **Q2** | "57 轨就挂"是轨道数导致的吗？ | ms/帧 对轨数拟合的斜率 <2 ⇒ 轨道数不是主因 |
| **Q3** | 固定开销到底多大？每帧单价多少？ | 对 10/60/270/600 帧做线性拟合，给截距与斜率，直接外推 1800 帧 |
| **Q4** | image / video / audio 轨会让渲染挂死吗？ | 三条全部跑通 ⇒ **「素材预取死锁」不成立**，得往产品侧找 |
| **Q6** | 一次中断之后，渲染器会不会持续劣化？ | 中断后 10 帧探针变慢 >2× ⇒ 状态残留确凿，reset 是必修 |
| **Q7** | `draft` 档的 `prefer-hardware` / `pageResponsiveness:disabled` 是元凶吗？ | 单项改动带来 >40% 提升即锁定元凶 |
| **Q8** | **同一份 61 轨 / 1800 帧能渲出来吗？** | **能 ⇒ 不是 Remotion 能力问题**；不能 ⇒ 能力边界 |
| **Q9** | 隐藏 / 可见 / 被遮挡窗口，哪个把 rAF 打下去？ | 只有某一档掉帧 ⇒ 节流开关缺失（产品现状已开，正好验证够不够） |
| **Q10** | 产品自己的 `renderManifestOnWeb`（字体注入 + 时长探测）有没有额外开销？ | 与裸调同量级 ⇒ 包装层无罪 |
| **Q11** | **会话里那些"超时刺客"文件，现在各要多久？** | 直接重放 12 份真实工件（`probe_min` / `probe_ecg` / `seg_s2` / `h1` / `shapeonly_full` …），对照会话结局 |

Q8 + Q11 是决定性实验，其余是为它们排除变量。

---

## 二、怎么跑

```bash
cd canvas-studio

# 只做自检（无 GUI 也能跑：打包 + 矩阵 + manifest 结构）
NODE_OPTIONS= node scripts/render-forensics/run.mjs --check

# 全矩阵（约 20–30 分钟，取决于机器）
NODE_OPTIONS= node scripts/render-forensics/run.mjs

# 单跑某一组
NODE_OPTIONS= node scripts/render-forensics/run.mjs --only=Q1
NODE_OPTIONS= node scripts/render-forensics/run.mjs --only=Q8          # 决定性实验：全片
NODE_OPTIONS= node scripts/render-forensics/run.mjs --only=Q11         # 重放会话真实工件（12 份）
NODE_OPTIONS= node scripts/render-forensics/run.mjs --only=Q9 --windows=hidden,hidden-throttled,visible,occluded

# 换一份 manifest / 整套真实工件目录
RF_MANIFEST=/path/to/manifest.json NODE_OPTIONS= node scripts/render-forensics/run.mjs --only=Q8
RF_BUILD_DIR=/path/to/build       NODE_OPTIONS= node scripts/render-forensics/run.mjs --only=Q11
```

产物：`scripts/render-forensics/out/<时间戳>/{REPORT.md,report.json,manifest/*.json}`

### 环境注意

- **必须有 GUI**：CSR 的 `canRenderMediaOnWeb` 在 `chrome-headless-shell` 里会挂起（REQ-034 S6 实测），
  所以只能在 headful 里判定。
- 在**受限沙箱**里跑会看到 `sandbox initialization failed` / GPU 进程退出：
  加 `RF_NO_SANDBOX=1`（追加 `--no-sandbox --disable-gpu-sandbox`）。正常终端不需要。
- `NODE_OPTIONS=` 不能省：沙箱注入的 shim 会把"mkdir 已存在的目录"判成越权，`bundle()` 直接撞。
- 每次 bundle 约 20s，产物缓存在 `out/.bundle`，第二次起秒开。

---

## 三、矩阵是怎么构造的（为什么可归因）

原则：**一组只改一个变量**。

- 纯形状合成 manifest（`synthManifest`）：排除素材、排除内容，只看轨道数/帧数。
- 真实 manifest 子集（`subsetManifest`）：从会话那份 61 轨里切片，自动修正三条校验规则
  （`meta.durationInFrames === max(end)`、`exit.durationInFrames <= 轨道时长`、不留下悬空 transition）——
  这三条正是会话里踩过的坑（`manifest.id` 缺失、`exit` 超轨长）。
- 素材单变量（`withAssetTrack` / `withAudio`）：把 image / video / 5 段旁白 + BGM
  分别挂上去。**顺带验证一件事**：会话里 5 段旁白与 BGM 都生成了，但 manifest 的 `audio`
  字段从未写过 —— 也就是说那份 manifest 渲出来本来就是**无声片**。这里可以直接复现"接上音频"的版本。

窗口档在 Electron 外壳里实现，同一个 manifest 换档重跑：

| 档 | 配置 | 对应现实 |
|---|---|---|
| `hidden` | `show:false` + `backgroundThrottling:false` + 两条 `disable-*-throttling` switch | 产品 `src/render-host/window.ts` 的现状 |
| `hidden-throttled` | `show:false` + 保留默认节流 | 对照组：如果这里明显慢，说明那两条 switch 是必需的 |
| `visible` | `show:true` + 关节流 | 用户盯着看的场景 |
| `occluded` | `show:true` 但被一个置顶透明窗口盖住 | "切到别的应用"的真实场景；产品没加 `--disable-backgrounding-occluded-windows` |

---

## 四、指标口径（别信产品报告里的字段）

产品 `RenderMetrics` 里三个字段都有坑，本工具全部自己打表：

| 字段 | 产品语义 | 坑 |
|---|---|---|
| `msPerFrame` | `totalMs / frames` | `totalMs` 从**字体注入之前**开始算，包含 `probeManifestDurations` 等准备阶段 ⇒ 不是纯渲染速度 |
| `encodeMs` | 取自 `onProgress().doneIn` | `doneIn` 在 `@remotion/web-renderer` 里是**"全部帧编码完成的时刻"**，不是"编码耗时"。被当成耗时后，会凭空造出 20–34s 的"编码尾巴" |
| `warm` | `warm: false` | `src/client/remotion-render.ts:288` **硬编码 false**，永远为假 |

本工具上报：`fetchMs / canRenderMs / renderMs / blobMs / msPerFrame(自己算) / rafHz /
firstFrameAt / lastFrameAt / encodeDoneAt / framesEmitted`。其中 `firstFrameAt`（首帧出现时刻）
就是"真实固定开销"的近似值。

---

## 五、已知不覆盖的部分

- **不走字体注入**：`applyManifestFonts` 未调用（真实 manifest 没有 `global.fonts`，等于 no-op）。
  若你的 manifest 带自定义字体，绝对数值会比这里高。
- **不走产品工单桥**：这是刻意的 —— 本工具就是要排除它。桥本身的问题（认领、轮询、超时结算）
  由 `src/render-poll-gate.ts` 的决策表单测 + 真机日志覆盖，不在这里。
- `draft` 档按产品预设（`scale:0.5` / `low` / `keyframe 10s` / `disabled` / `prefer-hardware`）原样复刻，
  所以 Q8 的 draft 结果**不能**直接换算成 standard 档时间 —— Q8 里专门有一条 standard 用于换算。
- 抽帧（`onFrame → PNG`）未启用：它是产品"交付前自检"的一部分，但会额外占主线程；
  Q8 的时间是"不含抽帧"的下界。
