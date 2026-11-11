# PROGRESS · 视频模板化（单一进度事实源）

> **接管会话第一步就读这个。** 只记"做到哪了"，不记设计理由（理由在 `决策-模板需求收口.md` 与 `决策日志.md`）。
> 每完成一个可验证小步**立刻**更新本文件，不要攒到会话末尾。
>
> 状态图例：`[ ]` 未开始 · `[~]` 进行中 · `[x]` 完成且验证过 · `[!]` 卡住（见 `无人值守推进协议.md` §6）

最后更新：2026-11-11 08:40 · 阶段：**0A 全部完成（0A-1 ~ 0A-8，探针七条断言全绿）；下一步 = 0B 文本溢出上报**

---

## §0 交接速览（新会话只看这一屏就能开工）

**当前下一步：0B-1「`TextFitPlan.renderText`」（第二波，抢 `manifest.ts` + `host-tools.ts`，0A 已收尾让出）。** 精确落点见 §3 末尾「我在哪一步」。

开工前必读三份（按顺序，都短）：

1. 本文件 §0 + §3 末尾「我在哪一步」
2. `决策日志.md` D-01 ~ D-15（尤其 **D-12/D-13/D-14**：路由放行规则、测试怎么跑、构建踩的坑）
3. `无人值守推进协议.md` §1（验证梯度）+ §11（收尾动作）

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

> **唯一零冲突包**。只新建 `src/remotion/furniture.ts`，不碰 `manifest.ts`。

- [ ] **1C-1** `furniture.ts` 纯函数（禁 `transition`/`@keyframes`，插值走 `timing.ts`）
- [ ] **1C-2** manifest 接入（可选字段，默认关闭）
- [ ] **1C-3** 构件默认关闭时**逐帧不变**（像素哈希）
  - ⚠️ `msPerFrame` **允许上升**，不要与"逐帧不变"写成互斥目标

---

## 第二波 · 0B（文本溢出上报）

> 抢 `manifest.ts` + `host-tools.ts`，必须等第一波 A 完成。

- [ ] **0B-1** `TextFitPlan` 加 **`renderText`** 字段（未缩号时 = 原文 raw）
- [ ] **0B-2** `TextCard.tsx` 消费 `plan.renderText`（**不要**渲染 `plan.lines`）
- [ ] **0B-3** `report.textFit` 进 `report` schema（`additionalProperties:false`，必须显式加）
- [ ] **0B-4** 顺带修既有缺陷：`title` 的 `maxWidthPx` 不看 `box`；`bullets` 写死 `width:900` 且未扣 42px 圆点
- [ ] **0B-5** 单测 + 反向变异（`renderText`→`lines.join('\n')` 必须让逐像素断言变红）

---

## 第三波 · 1（模板库）

- [ ] **1-0 前置**：`scaffold_manifest` 补写 `meta.generatedBy`（`render-job.ts:1136` 只认 `'manifest-builder'`，不补则模板片全带假告警）
- [ ] **1-1** registry + `list_templates`（带筛选：体裁 / 时长档 / 素材需求）
- [ ] **1-2** `scaffold_manifest({templateId, slots, writeTo})`；与 `recipe` 互斥
- [ ] **1-3** `gateTemplate()` 五判据接入选模板路径；阈值 35% 做成常量；回退**显式告知**
- [ ] **1-4** `contractVersion` 常量（旧版本 warn 不拒收）
- [ ] **1-5** 3 个模板内容：`assets/templates/{science,product,report}/`（`manifest.template.json` + `slots.json` + `meta.json`，**无 spec.json**）
- [ ] **1-6** `skills/code-driven-explainer/references/template-usage.md`（`SKILL.md` 体积不得增加，现 15284/15360）
- [ ] **1-7** 端到端：对话内列候选 → 选 → 填参 → 闸门 → 出片

---

## 收尾

- [ ] 3 个模板各出一支样片（探针）
- [ ] STATUS §4.1 / `cv-details.md` / `changelog.md` 三处登记（CV 从 460 起）
- [ ] 更新本文件为"全部完成"，并整理 §6 待人工清单

---

## 我在哪一步（给接管者的提示）

**下一步：0B（文本溢出上报）。** 0A 已收尾，勘定的事实：

### 0B 的开工要点

1. 0A 已完成并让出共享文件：`manifest.ts` / `host-tools.ts` 现在归 0B（执行总表 §3 矩阵第二波）。
2. 0B 五步见本文件「第二波 · 0B」清单 + `任务包-0B-文本溢出上报.md`；反向变异锚点 = `renderText`→`lines.join('\n')` 必须让逐像素断言变红。
3. 探针复用：`scripts/probe/sfx-e2e.probe.mjs` 的骨架（假宿主 + commit 等待 + 断言序列）可抄给 0B 的像素验证；跑法同协议 §2（`env -u ELECTRON_RUN_AS_NODE ELECTRON_DISABLE_SANDBOX=1 ../dsh-plugin-desktop/node_modules/.bin/electron scripts/probe/<名字>.probe.mjs`）。

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
