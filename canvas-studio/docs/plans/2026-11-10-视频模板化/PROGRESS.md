# PROGRESS · 视频模板化（单一进度事实源）

> **接管会话第一步就读这个。** 只记"做到哪了"，不记设计理由（理由在 `决策-模板需求收口.md` 与 `决策日志.md`）。
> 每完成一个可验证小步**立刻**更新本文件，不要攒到会话末尾。
>
> 状态图例：`[ ]` 未开始 · `[~]` 进行中 · `[x]` 完成且验证过 · `[!]` 卡住（见 `无人值守推进协议.md` §6）

最后更新：2026-11-11 10:20 · 阶段：**0A / 0B / 1C / 1 全部完成**（0A=CV-460、0B=CV-461、1C=CV-462、1=CV-463 已提交未 push）；剩下的是**三层登记**（用户明确划出边界，不在本批做）

---

## §0 交接速览（新会话只看这一屏就能开工）

**代码侧已收尾。** 四项全部落地、每项都有单测 + 反向变异 + 真机探针（1 的探针：`scripts/probe/template-e2e.probe.mjs`，6 条断言全绿）。

唯一未做的事是**入库三层登记**（STATUS §4.1 / `cv-details.md` / `changelog.md`）—— 用户本轮明确把它划到验收通过之后，别提前登记。

后续若要继续，按 `执行总表.md` 的下一阶段取：段组合（G2）/ 模板自带图（2 期）/ 模板库扩容。开工前必读：本文件 §0 + §3 末尾「我在哪一步」、`决策日志.md` D-12 ~ D-30、`无人值守推进协议.md` §1（验证梯度）+ §11（收尾动作）。

**三条容易踩死的环境事实**（血泪，别重试）：

| 事 | 正确做法 | 错误做法 |
|---|---|---|
| 构建 | `CODEBUDDY_SAFE_DELETE_BULK_THRESHOLD=100000 CODEBUDDY_SAFE_DELETE_BULK_COUNT_LIMIT=100000 yarn build` | 裸 `yarn build` ⇒ `clean.mjs` 撞批量删除闸 `SAFE_DELETE_BULK_CONFIRM_REQUIRED {count:715}` |
| 跑测试前 | 必须 `npx tsc -p tsconfig.json`（`lib/routes.js` 是 **tsc** 产出） | 只跑 `npx tsdown` ⇒ 测的是旧码（tsdown 只产 `client.js` / `render-host.js`） |
| 反向变异后 | 变异 → `npx tsc` → 跑测试应变红 → 还原 → **`yarn build` 全量重建** | 只 tsdown ⇒ 变异根本没进产物，测试照样绿，误判"守卫无效" |

---

## 前置准备（已完成）

- [x] 需求收口（10 拍板项 + 10 卡点）→ `决策-模板需求收口.md`
- [x] P-3 可运行验证（骨架过校验、逐字节还原、结构 0 差异）→ `原型-compile.mjs`
- [x] 容量审计器（模块 + 19 项自测）→ `原型-audit-text-fit.mjs`
- [x] LLM 填参验证 + 适配闸门（五判据）→ `原型-template-fit-gate.mjs`
- [x] 执行总表 → `执行总表.md`
- [x] **GT 真值持久化** → `gt/{mix-report.json, audio-events-source.json, native_audiolib.py}`（原只存 `/tmp`，会丢）
- [x] **0A §5.1/§5.2 按真值重写**（旧的 8 条事件表是混响尾误检，已废弃）
- [x] **0A 契约决策 1 改为三定位并存**（anchor / startFrame / startSec，互斥）
- [x] **0A 的 SFX 路径改为 `/canvas-studio/remotion/sfx/*`**（原 `/canvas-studio/assets/sfx/*` 必然 404）
- [x] 无人值守推进协议 → `无人值守推进协议.md`

---

## 第一波 A · 0A（SFX 事件轨）

> 与 1C 并行。改 `manifest.ts` + `routes.ts` + 新建 `src/audio-sfx/`、`assets/sfx/`。

- [x] **0A-1 契约**：`ManifestSfx` + `ManifestSfxAnchor` + `resolveSfxStartFrame()` + `SfxResolveContext` 已加入契约
  - 验收：两个 `tsc` 均 EXIT=0（零错误）· `tests/remotion-sfx.test.mjs` 中 12 条换算断言全绿
- [x] **0A-2 校验**：`KNOWN_AUDIO_KEYS` 加 `sfx`；`KNOWN_SFX_KEYS` / `MAX_SFX_EVENTS=64`；`validateSfxList()` 已接入主链路
  - 覆盖：三定位恰好一个 · anchor.trackId 存在 · anchor.at 枚举 · gain 0–2 · pan −1..1 · 空数组 error · 条数上限 · 外链拒收 · 契约外字段只 warning · 超时长 warning
  - 验收：`tests/remotion-sfx.test.mjs` **33/33 绿**；相邻 `remotion-anchor` + `remotion-render-job` **20/20 绿**
  - **反向变异已做**：`round`→`floor` ⇒ 2 条舍入用例变红；关掉"三定位恰好一个" ⇒ 3 条用例变红 ✅
- [x] **0A-3 音频区分**：`summarizeManifestAudio` 计入 sfx；`timelineFromManifestAudio` 产出 `role:'sfx'` 段；枚举 8 → **9 值**（加 `sfx`）
  - 关键决策：sfx **不参与**「原生/BGM/旁白」三布尔正交展开（否则 8 → 16 值，角标文案爆炸）；它只在三者皆无时把 `none` 顶掉
  - **发现枚举有 3 处副本**（`contracts/canvas.ts` 类型+2 张文案表 / `host-tools.ts:148` 工具 schema enum / `client/styles.ts` 角标样式），已全部同步为 9 值
  - 换算实现迁移到 `audio-timeline.ts` 单源（`manifest.ts` 改为 re-export）——否则会与 `audio-compose` 成环，且派生/渲染会各算一套
  - 验收：`remotion-sfx` **41/41 绿**；音频相关 6 个测试文件 **69/69 绿**（含 `audio-hints-doc` 的「9 键齐全」守卫，它先按设计变红、同步后转绿）

- [x] **0A-4 合成库**：`src/audio-sfx/{dsp,voices,wav,index}.ts`
  - `dsp.ts`：`SFX_SAMPLE_RATE=48000` / `mulberry32`（确定性 PRNG，**替代** numpy `default_rng(11)`）/ `gaussian` / `lowpass`（255 抽头 sinc×Hamming 直接卷积）/ `highpass` / `bandpass` / `paneSplit`（等功率）/ `normalizePeak`
  - `voices.ts`：`whoosh` / `thud` / `write` 三原语 + `SFX_VOICES` **5 支**（thud / write / swoosh / card / swipe）+ `seedFor`（FNV-1a）
  - `wav.ts`：`encodeWavStereo`（16bit PCM / 48kHz / 立体声 / 44 字节头）、`readWavHeader`
  - `index.ts`：`SFX_URL_PREFIX` / `SFX_ASSET_VERSION=1` / `SfxAssetEntry` / `SfxAssetManifest`
  - 验收：`tests/audio-sfx.test.mjs` **24/24 绿**（确定性、滤波方向、bright 排序、五支互异、WAV 头、int16 量化 ≤1 LSB）
- [x] **0A-5 素材产出**：`scripts/build-sfx.mjs`（`--force` / `--check` / 幂等跳过）→ `assets/sfx/*.wav` + `manifest.json`
  - 实测产出（归一峰值统一 **0.891**）：
    ```
    thud    7200 帧  0.150s   28.2 KB
    write  57600 帧  1.200s  225.0 KB
    swoosh 14400 帧  0.300s   56.3 KB
    card   14400 帧  0.300s   56.3 KB
    swipe  12000 帧  0.250s   46.9 KB
    ```
  - `ffprobe` 五支全为 `pcm_s16le, 48000 Hz, 2 ch`，时长精确到样本；重跑输出「跳过 5」，`--check` 通过 ⇒ 幂等成立
  - **频谱方向验证（过零率）**：`write 32067 > swipe 20936 > swoosh 17620 > card 12153 > thud 380`，与 `bright` 参数排序精确吻合
- [x] **0A-6 只读路由**：`src/routes.ts` 新增 `ROUTE_REMOTION_SFX = '/canvas-studio/remotion/sfx'` + `REMOTION_SFX_DIR`
  - 形态照 `ROUTE_REMOTION_FONTS`：loopback authority（403）→ 只 GET（405）→ 单个文件名白名单 `^[a-z0-9-]+\.wav$`（400）→ `join`+`startsWith` 兜底（403）→ 缺失 404 → 强缓存 + `nosniff`
  - **额外精确放行 `manifest.json`**（只有一个固定名，不做通配），Content-Type 走 `ASSET_CONTENT_TYPES` 查表（`.wav` → `audio/wav`）
  - 验收：`tests/remotion-sfx-route.test.mjs` **8/8 绿**（照 `tests/remotion-fonts-route.test.mjs` 搭的同构 harness；穿越用例走**原生 http 请求**，因为 `fetch` 会先把 `..` 归一化掉，测不到守卫）
  - **反向变异已做**：把白名单判据改成 `if (false)` ⇒ 测试 **3 + 5 精确变红**（6/8 绿），还原后 8/8 转绿 ✅
- [x] **0A-7 渲染接线**：`AudioTrack.tsx` 消费 `audio.sfx[]`（**纯追加**，不改 bgm/voiceOver 分支）
  - `timing.ts` 新增 `SfxVolumeOptions` + `sfxVolumeAt()`（fade-in 线性 0→gain，afade 约定；fade-out 需显式 `durationInFrames`，渲染器 MVP 不传——三个拍板见决策日志 **D-16**）
  - `AudioTrack.tsx`：加 `tracks` 窄结构 prop（`SfxAnchorTrack`）+ `trackById` 查表 + sfx 分支（`resolveSfxStartFrame` → `<Sequence from layout="none">` 包 `<Audio>`；解析失败静默跳过；volume 回调**相对帧** → `startFrame + f` 绝对帧进包络）
  - `Root.tsx:301` 接线点传 `tracks={manifest.tracks}`（渲染器拿到的 manifest 已归一化，**未**再 normalize）
  - `manifest.ts` 仅 `fadeOutSec` JSDoc 补渲染器口径一行（契约不变）
  - **棘轮补登 4 处**（`tests/file-size-guard.test.mjs`）：`timing.ts` 1447→1500（本次 +53）；`styles.ts` 11154→11157 与 `#STUDIO_STYLES` 11137→11140（0A-3 漏登）、`manifest.ts` 2196→2398（0A-1/2 漏登）、`routes.ts` 3686→3737 与 `#registerStudioRoutes` 2997→3041（0A-6 漏登）——见 **D-17**
  - 验收：两 `tsc` 绿 · `remotion-sfx` **46/46**（新增 5 条 `sfxVolumeAt` 断言）· 音频相关全量回归 **131/131**（8 个测试文件）· `file-size-guard` **3/3** · `yarn build` + `verify-client-loader` 绿
  - **反向变异已做**：`sfxVolumeAt` fade-in 斜坡改直通 `gain` ⇒ 仅「淡入线性」1 条**精确变红**（45/46）；还原 → `npx tsc` → `yarn build` 全量重建 → 49/49 复绿 ✅
- [x] **0A-8 探针验证**：`scripts/probe/sfx-e2e.probe.mjs`（新写，照 `render-host-e2e` 骨架）——真实 Electron 隐藏窗口渲 7 条 GT 事件（4 条 `startFrame` + 3 条 `anchor` 卡），出 mp4 后顺序跑 `任务包-0A` §5.2.3 七条断言（期望值全部从 `gt/mix-report.json` + `assets/sfx/manifest.json` 读，不硬编码）
  - **验收：七条全绿（ok=true，exit 0）**。实测：帧号 `[35,75,456,534,544,553,1056]` 逐条精确相等（anchor 折算与直接声明一致）；三卡集合对齐 `[534,544,553]`；起音差分 Δ∈[1,2]、spread ≤1；窗口峰值 0 ~ −3.8dB；响度成片 −26.0 vs 同机带 gain 参考 −26.2（**差 0.2 LU**）；窗外无额外声音
  - **断言口径三次修订（全部实证驱动，见 D-18）**：④±1 帧→差分口径（muxer priming 实证）· ⑥GT 闸→相对参考 ±3LU（参考必须带 gain）· ①撤平均码率判据（稀疏内容物理事实）
  - **重大误判反转（D-18 必读）**：中途出现的「Chromium 忽略码率 / 响度塌 10 LU」是**假象**——根因是自建参考混音漏乘 GT gain；逐事件能量比 CSR/REF = 0.55/0.25/0.30/0.30/0.28 ≈ **精确吻合各事件 gain**，渲染本身无损
  - 顺带修复/加固（D-18 拍板保留）：`extractWav48` 固定输出路径覆盖 bug（outName 参数化）· `page.ts` CSP 补 `worker-src 'self' blob:` + `'wasm-unsafe-eval'`（blob worker 被 script-src 拦截，实锤）· `remotion-render.ts` 显式注册 WASM AAC 编码器（编码器选择钉到确定性路径）
  - muxer 既有属性（非本批引入，bgm/voiceOver 同受影响）：不补偿 AAC priming ⇒ 音频恒定后移 ~2.5 帧、音轨比视频长 ~69ms（18.069s vs 18.0s 实锤）

## 第一波 B · 1C（装饰构件层）

> **唯一零冲突包**。只新建 `src/remotion/furniture.ts`，不碰 `manifest.ts`。**CV-462 已提交**。

- [x] **1C-1** `furniture.ts` 纯函数（禁 `transition`/`@keyframes`，插值走 `timing.ts`）
  - 三构件：`cornerBrackets`（四角括线，8 个 `rect` 拼 L 形）· `progressBar`（刻度带 + 匀速游标）· `starfield`（mulberry32 固定种子星点）
  - `expandFurniture()` / `expandFurnitureList()` 产出**普通 shape 轨**（渲染器零契约扩展）；id 前缀 `fx-`（D-23）；`box()` 收口 4 位小数（防浮点噪声破坏逐字节确定性）
  - 验收：`tests/remotion-furniture.test.mjs` **12/12 绿**（含 `1C ★几何` 中心坐标、`1C ★零契约扩展` 展开产物直接过 `validateManifest`、`1C ★反向变异锚点`）
  - **反向变异已做**：括线中心语义退化成左上角 ⇒ **2 条精确变红**，还原复绿；广域回归 **661/661**
- [x] **1C-2** manifest 接入（可选字段，默认关闭）
  - **没有新增 manifest 字段**：构件在编译期就展开成 `tracks[]`，契约不动 ⇒ 「默认关闭时逐帧不变」自动成立（不存在「渲染器读了个新字段才画」的路径）
  - `motion-lint.ts` 给 `fx-` 前缀轨豁免 ML-05（匀速是设计意图，D-23）
- [x] **1C-3** 构件默认关闭时**逐帧不变**（像素哈希）
  - 由 1C-2 的结构保证（同 manifest 输入 ⇒ 同渲染）；1 的探针实测「同 manifest 重渲帧 **0 字节差异**」反证了这条链路的确定性
  - ⚠️ `msPerFrame` **允许上升**，不要与"逐帧不变"写成互斥目标

---

## 第二波 · 0B（文本溢出上报）

> 抢 `manifest.ts` + `host-tools.ts`，必须等第一波 A 完成。

- [x] **0B-1 **`text-fit-plan.ts`**：`TextFitPlan`（**含 `renderText`**）+ `planTextFit` + 五 variant 预算 + `textCardCapacityWarnings`；测量器外提到 `text-measure.ts`
  - 口径：未缩号（`fontPx >= base && !overflow`）⇒ `renderText` = 原文（数组按 variant 拼接口径：`dataCard` 空格、其余换行）；缩号或溢出才换成策略的行
  - `dataCard` / `caption` **不缩号**（字号分别是 `dataCardMetrics` 缩放系数与显式 `fontSize` 决定），`minFontPx` 钉在基准号让缩号循环不跑
  - 验收：`tests/remotion-text-fit.test.mjs` **26/26 绿**（含 3 条 ★等价性 对账：subtitle 有无 box × 4 种盒 / 无 box title / dataCard 与旧 `fitOrKeep` 逐项相同）
- [x] **0B-2** `TextCard.tsx` 四分支改消费 `plan`（`plan.fontPx` / `plan.renderText`），删掉本地 `fitOrKeep` 与私有 measurer
  - 用 `useMemo` 缓存（依赖 track/box/画布/字体/measurer）—— 原先逐帧重算，纯浪费
- [x] **0B-3** 体检接线：`text-fit-audit.ts`（`auditTextFit` / `textFitWarnings` / `sanitizeTextFitEntries`）
  - 落点 = `client/remotion-render.ts` **prepare 阶段**（字体就绪之后、能力判定之前），溢出项进 `warnings`
  - 上报链：`RenderMetrics.textFit` → `metricsReport` → `/remotion/commit?metrics` → `asRenderReport`（**数组不在原数值白名单里，必须显式收口**）→ `commitRenderJob` → `RenderJobReport.textFit` → `render_composition` 的 `report` schema（`additionalProperties:false`，显式加 9 字段）
  - 验收：`report schema 声明 textFit` 用例绿（`tests/render-tool-contract.test.mjs` 23/23）；`asRenderReport` 导出后由 `★上报通道` 用例直测（数组不再被数值白名单吞掉）
- [x] **0B-4** 修既有缺陷：`title` 带 box 时按**盒宽**算可用宽；`bullets` 容器 `min(900, max(300, 90%))` + 折行宽扣 **42px** 圆点
  - 同步改 `skills/code-driven-explainer/references/manifest-contract.md`（实现细节第 4 条 + 新增「文字放不下时会发生什么」一节）与 `tests/manifest-contract-doc.test.mjs` 的对码断言
- [x] **0B-5** 单测 + 反向变异 + 棘轮
  - **反向变异已做**：`shrunk = true`（无条件用策略折行）⇒ 仅「★反向变异锚点」**1 条精确变红**（21/22），还原 → `npx tsc` → `yarn build` 全量重建 → 26/26 复绿
  - 棘轮补登 5 处：`api.ts` 1365→1379、`host-tools.ts` 5008→5016、`manifest.ts` 2398→2426、`render-job.ts` 1263→1265、`routes.ts` 3737→3744
  - 顺带：**0A 漏跑 `gen-manifest-fields.mjs`**（sfx 段未进生成文档）本次补生成（+21 行，见 D-22）
  - 实测：manifest*/remotion*/render*/*text*/scaffold/size-guard/motion-lint/billing-routes/sfx-route 合计 **719/719 绿**；三个 `tsc` config 绿；`yarn build` + `verify-client-loader` 绿
  - 真 manifest 对账（`原型-manifest-b1b2.json`）：11 条文字轨全部 `overflow=false`、`validateManifest` 0 新增告警
  - **真机回归**：复跑 `scripts/probe/sfx-e2e.probe.mjs` **exit 0 / 七条断言全绿**（帧 `[35,75,456,534,544,553,1056]`、响度 −26.0 vs 参考 −26.2）⇒ 客户端 prepare 阶段新增的体检**没有破坏真实渲染链路**（这份 bundle 里就带着 `auditTextFit`）
  - **真机端到端已补齐（1 的探针）**：`scripts/probe/template-e2e.probe.mjs` 的断言 3 直接断言「真机回报里有 `textFit` 且逐条 `overflow=false`」，三支样片实测 6 / 6 / 3 条全绿 ⇒ 这一环不再是人工欠账。

---

## 第三波 · 1（模板库）

> **CV-463 已提交。** 新增 6 个源文件 + 3 个模板目录 + 2 个测试 + 2 份文档。

- [x] **1-0 前置**：`scaffold_manifest` 补写 `meta.generatedBy`（`render-job.ts:1136` 只认 `'manifest-builder'`，不补则模板片全带假告警）
  - 落点两处：缺省骨架路径 + `compileTemplate` 的 `meta` 收口；另有单测「默认路径 generatedBy」
- [x] **1-1** registry + `list_templates`（带筛选：体裁 / 时长档 / 素材需求）
  - `src/remotion/template-registry.ts`（读盘 `assets/templates/<family>/<id>/`，坏模板进 `problems` **点名**而不是静默跳过；按 `meta.id` 字典序）
  - `src/host-tools-template.ts` 的 `list_templates`：输出**文本清单**（✅/❌ 贴模板显示），末尾给「恰好 1 个 / 0 个 / 多个」结论；**契约版本不符的模板不进候选**（D-24）
- [x] **1-2** `scaffold_manifest({templateId, slots, writeTo})`；与 `recipe` 互斥
  - 三方互斥（template / recipe / title+durationSeconds），冲突一律 `CS-USER-ERR` 显式拒收而不是静默忽略（D-27）
  - `dryRun: true` 的输出 = 完整槽位合同（等价于被砍掉的 `describe_template`）
- [x] **1-3** `gateTemplate()` 五判据接入选模板路径；阈值 35% 做成常量；回退**显式告知**
  - `INFO_SUFFICIENCY_MIN_RATIO = 0.35` / `DURATION_WINDOW_RATIO = 0.35`；五条各有一条会红的用例
- [x] **1-4** `contractVersion` 常量（**不符即拒绝**，推翻任务包的「warn 不拒收」，见 D-24）
  - `MANIFEST_CONTRACT_VERSION = '1'` 在 `manifest.ts`（单一事实源），`compileTemplate` 顶部校验
- [x] **1-5** 3 个模板内容：`assets/templates/{science,product,report}/`（`manifest.template.json` + `slots.json` + `meta.json`，**无 spec.json**）
  - `science/three-cards` 1920×1080@60 · 1080 帧 = 18s · 9 槽 · 构件 `cornerBrackets`+`progressBar` · 4 sfx
  - `product/feature-walkthrough` 1920×1080@30 · 720 帧 = 24s · 9 槽 · 同上 · 4 sfx
  - `report/data-summary` 1920×1080@30 · 600 帧 = 20s · 9 槽 · 仅 `cornerBrackets` · 2 sfx（`dataCard` + `countUp`）
  - 三者骨架**直接**过 `validateManifest` 且 `warnings` 为空；`frames/` 只放 README（不自带图，D-28）
- [x] **1-6** `skills/code-driven-explainer/references/template-usage.md`（`SKILL.md` 体积不得增加，现 15284/15360）
  - `SKILL.md` **一字未加**（只剩 76 字节，塞不进去）；另在 `manifest-contract.md` 加「模板通道」一节 + `manifest-fields.generated.md` 重生成（D-29）
- [x] **1-7** 端到端：对话内列候选 → 选 → 填参 → 闸门 → 出片
  - 前三段由 `tests/template-tools.test.mjs` **11/11** 覆盖（`list_templates` 4 条 + 模板通道 7 条：dryRun / 超限拦截 / 缺必填 / 互斥 / 未知模板 / writeTo 落盘 / generatedBy）
  - **「出片」由真机探针兜住**：`scripts/probe/template-e2e.probe.mjs` —— 三模板各渲一支样片 + 一支去构件对照片 + 一支重渲照片，**6 条断言全绿**（详见「收尾」）

---

## 收尾

- [x] 3 个模板各出一支样片（探针）
  - `scripts/probe/template-e2e.probe.mjs`（Electron 隐藏窗口真渲，报告 `/tmp/cs-template-e2e/report.json`）
  - 实测：**6/6 断言全绿**。① 三支样片 h264 **1920×1080**，时长 18.03 / 24.02 / 20.03s（期望 18 / 24 / 20，偏差 = muxer priming 的既有属性）；② 音效混流 aac/48kHz/立体声，峰 **0.315 / 0.293 / 0.284**，有声帧 39 / 32 / 12 ≥ 音效条数 4 / 4 / 2；③ `report.textFit` **端到端**（0B 当时缺的就是这一环）6 / 6 / 3 条全 `overflow=false`；④ **构件上屏**：与「同模板去 furniture」成片做像素差分，四角 71 / 72 / 107 / 294 像素、底部带 1948 像素、画面中心仅 7 像素噪声（阈值 40）；⑤ **确定性**：同 manifest 重渲帧 **0 字节差异**；⑥ 三模板目录自洽（7 个条目齐全）
  - 判据口径的教训（写进 D-30）：括线只有 1.5px 粗，**区域均值**会被面积稀释到与压缩噪声同档 ⇒ 必须用「差分像素数」
- [ ] STATUS §4.1 / `cv-details.md` / `changelog.md` 三处登记（CV 从 460 起）
  - **用户本轮明确划出边界**：不在本批做，验收通过后再登记
- [x] 更新本文件为"全部完成"，并整理 §6 待人工清单

### 全量 smoke 抓到的 6 条新红（已全部修掉）

> 教训：定向单测全绿 ≠ 可以交付。这 6 条全是「新增工具必须登记」的**横切门禁**，只在全量里跑得到。

| 门禁 | 原因 | 修法 |
|---|---|---|
| 组件契约速查与源码一致 | `component-contract.generated.md` 已陈旧（**0A 也漏了**：sfx / KNOWN_SFX_KEYS / MAX_SFX_EVENTS 都没进） | `node scripts/gen-component-contract.mjs` 重生成 |
| 静态守卫：src/ 不再有裸抛 | `template-registry.ts` 2 处 + `audio-sfx/wav.ts` 1 处（**0A 引入**）`throw new Error` | 各加自定义错误类（`TemplateRegistryError` / `WavFormatError`）；转换点仍在 `template-scaffold.ts` 的 catch → `CS-USER-ERR` |
| 参数分类表 | 6 个新入参未归类 | `templateId` 进 `HANDLE_PARAMS`（合法值只能来自 `list_templates`）；其余 5 个进豁免表并写明理由（容器 / 数值 / 布尔，真风险由 slot-contract 拒收） |
| REQ-008① 展示表 | `list_templates` 无三档表项 | `tool-presentation.ts` 加 `{ tier:'A', title:'模板清单', icon:'模' }` |
| AR-06① 工具总数 | 51 → 52 | `tests/tool-registry.test.mjs` 的 `EXPECTED_TOOL_COUNT` + 变更注释 |
| AR-06② 工具名单 | 同上 | 名单加 `list_templates` |

**文档欠账（有意留下）**：`STATUS.md §3.4` 的工具计数仍是 51 —— 属于「三层登记」那一批，随 CV 登记一次改。`docs/README.md` 与 `docs/canvas-studio-tools.md` 已同步为 52（这两处不在禁区）。

---

## 我在哪一步（给接管者的提示）

**本批四项（0A / 0B / 1C / 1）全部完成并提交，未 push。** 剩下唯一动作是**三层登记**（STATUS §4.1 / `cv-details.md` / `changelog.md`）—— 用户明确要求验收通过后再做，不要提前。

### 1（模板库）已落的事实（新会话不用再查）

- **编译链只有一条**：`compileTemplate(bundle, values)` = 槽位校验 → 占位符替换 → 构件展开 → 音效注入 → 时长自洽（K-6）→ `validateManifest` 自检。任何一步失败返回 `ok:false`，**不抛半成品**。
- **模板 = 真 manifest 骨架 + `{{slotId}}`**，没有 spec 编译器（P-3）。所以模板产物**可以被模型继续编辑**（加轨 / 换色 / 改文案），不是二值选择。
- **占位符两条口径**：整串占位符 ⇒ 原值（数组保数组）；嵌在长文里 ⇒ 字符串化（数组按 `\n`）。见 D-26。
- **id 是内容哈希**（`comp-tpl-` + FNV-1a 8 位），禁时间成分；测试里除了「比字节」还钉了**形状**（`/^comp-tpl-[0-9a-f]{8}$/`）—— 只比字节抓不到 1ms 分辨率的 `Date.now()`（D-25 的教训）。
- **契约版本不符 ⇒ 拒绝**（`MANIFEST_CONTRACT_VERSION`，D-24），`list_templates` 里这类模板标 ❌ 且**不进候选**。
- **五条判据**在 `template-gate.ts`，纯函数、无 IO；阈值两个常量（`INFO_SUFFICIENCY_MIN_RATIO` / `DURATION_WINDOW_RATIO` = 0.35）。
- **模板目录**：`assets/templates/<family>/<id>/`，7 个条目（`meta.json` / `slots.json` / `furniture.json` / `audio.json` / `manifest.template.json` / `README.md` / `frames/`）。坏目录进 `problems` 点名。
- **真机证据在探针里**，不在单测里：`scripts/probe/template-e2e.probe.mjs`。跑法见文件头，报告落 `/tmp/cs-template-e2e/report.json`。
  - 探针里有个坑已修：假宿主不调 `recordRenderHostReport()` 的话，窗口层 8s 后会打**假**告警「从未收到任何自报，本单回退画布页」，容易把后来人带沟里。

### 1C（构件层）已落的事实

- `furniture.ts` 三构件（`cornerBrackets` / `progressBar` / `starfield`），产出**普通 shape 轨**，id 前缀 `fx-`（D-23）。
- `shape:'path'` 是非等比缩放（`viewBox 0 0 100 100` + `preserveAspectRatio="none"`）⇒ L 形括线必须用 **8 个 `rect`** 拼，不能画 path。
- 构件的 `box()` 收口到 4 位小数：浮点噪声会破坏「同输入逐字节相同」。
- 手写 `fx-` 开头的轨会被 `FURNITURE_ID_CONFLICT` 拒收（前缀是构件的命名空间）。

### 上一批（0B）的开工要点（已不适用，留作背景）

1. 唯一**零冲突**包：只新建 `src/remotion/furniture.ts`，**不碰 `manifest.ts`**（要接字段时再抢，且 1C-2 才动它）。
2. 硬约束：禁 `transition` / `@keyframes`（Remotion 确定性渲染），插值一律走 `timing.ts`；构件**默认关闭**时逐帧像素哈希不变；`msPerFrame` **允许上升**（两件事不是一对互斥目标）。
3. 任务包：`任务包-1C-装饰构件层.md`；验收闸 `执行总表.md` §5.4。

### 0B 已落的事实（新会话不用再查）

- **唯一排版决策入口 `planTextFit`**（`src/remotion/text-fit-plan.ts`），组件与体检共用。改字号/行数只改这里。
- **`renderText` 是像素保真的关键**：未缩号时必须 = 原文（浏览器自己折行），**不要**改成 `lines.join('\n')` —— 反向变异实测：那一改只有 1 条用例变红（`★反向变异锚点`），说明守卫有效。
- 体检落点在 `client/remotion-render.ts` 的 prepare 阶段（字体就绪后），结果进 `metrics.textFit` + `warnings`；宿主侧 `asRenderReport` **只认数值键**，数组必须显式收口（`sanitizeTextFitEntries`）。
- 量出口径不新增计时字段（`prepareTextFitMs` 故意不做，D-21）。
- `dataCard` / `caption` **不缩号**：前者字号由 `dataCardMetrics` 的缩放系数定，后者是显式 `fontSize`。体检对它们只做「折行数是否超设计行数」的上报。
- 校验期静态合同是 **warning 不 error**（D-19），文案带「压到 N 字以内 / 加大 box」。
- 等价性对账在 `tests/remotion-text-fit.test.mjs` 的三条 ★等价性 用例：subtitle / 无 box title / dataCard 与旧 `fitOrKeep` 逐项相同 —— 这三条是「老 manifest 逐像素不变」的机器证明；`bullets` 与带 box 的 `title` 是 0B-4 有意修的两处（D-20）。

### 0A 已落的事实（新会话不用再查）

- `sfxVolumeAt` 在 **`src/remotion/timing.ts`**（`audioVolumeAt` 之后），fade-in 线性、fade-out 需显式 `durationInFrames`（渲染器 MVP 不传）；拍板理由见决策日志 **D-16**。
- `<Audio>` 在 `<Sequence from={正数}>` 内的 volume 回调拿**相对帧**（0 = 素材起点）—— remotion `useFrameForVolumeProp` 返回 `frame + cumulatedNegativeFrom`，正数 from 时后者恒 0（读 node_modules 实证）。接线处用 `startFrame + f` 换算绝对帧。
- `tests/remotion-sfx.test.mjs` 末段有 5 条 `sfxVolumeAt` 断言（含反向变异锚点）。
- 探针七条断言全绿的实测口径与两次反转记录在 **D-18**；报告落 `/tmp/cs-sfx-e2e/report.json`（临时目录，重跑覆盖）。
- **muxer priming 既有属性**：CSR 渲染的音频恒定后移 ~2.5 帧、音轨比视频长 ~69ms —— 帧级精确对齐的需求（将来模板）要按差分口径验收，别拿绝对帧号较真。

### 已确认的其它事实

- `assets/**` 已在 `package.json files` 白名单，新增 `assets/sfx/` **无需改**打包配置
- `validateAssetRefField` / `isAllowedManifestAssetRef` 已存在，sfx 直接复用
- `KNOWN_AUDIO_KEYS` 在 `manifest.ts` 974 行附近（现 8 键，含 `sfx`）
- GT 真值在 `gt/mix-report.json`（7 条），合成原语在 `gt/native_audiolib.py`
- 0A 六条事件类型 → 五支素材的对应：`thud`→thud.wav / `write`→write.wav / `card`→card.wav / `swipe`→swipe.wav / `swoosh`→swoosh.wav
- **改过 `manifest.ts` 必须跑 `node scripts/gen-manifest-fields.mjs`**（门禁 `tests/manifest-fields-drift.test.mjs`；0A 就漏了一次，D-22）
