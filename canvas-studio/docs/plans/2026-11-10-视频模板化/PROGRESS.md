# PROGRESS · 视频模板化（单一进度事实源）

> **接管会话第一步就读这个。** 只记"做到哪了"，不记设计理由（理由在 `决策-模板需求收口.md` 与 `决策日志.md`）。
> 每完成一个可验证小步**立刻**更新本文件，不要攒到会话末尾。
>
> 状态图例：`[ ]` 未开始 · `[~]` 进行中 · `[x]` 完成且验证过 · `[!]` 卡住（见 `无人值守推进协议.md` §6）

最后更新：2026-11-11 07:05 · 阶段：**0A 进行中（0A-1 ~ 0A-6 完成，下一步 0A-7 渲染接线）**

---

## §0 交接速览（新会话只看这一屏就能开工）

**当前下一步：0A-7「`AudioTrack.tsx` 消费 `audio.sfx[]`」。** 精确落点见 §3 末尾。

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
- [ ] **0A-7 渲染接线**：`AudioTrack.tsx` 消费 `audio.sfx[]`（**纯追加**，不改 bgm/voiceOver 分支）
  - 见 §3 末尾「我在哪一步」的精确落点
- [ ] **0A-8 探针验证**：0A 收尾必跑 —— 渲出带音轨 mp4 + 按 `任务包-0A` §5.2.3 七条断言
  - 卡住按 `无人值守推进协议.md` §3 三级降级

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

**下一步：0A-7。** 已勘定的事实（直接照做，不用再摸）：

### 0A-7 的精确落点

1. 接线点在 **`src/remotion/components/Root.tsx:294-302`** —— 那里渲染 `<AudioTrack audio={manifest.audio} hasNativeAudio=… durationInFrames={manifest.meta.durationInFrames} fps={manifest.meta.fps} duckWindows={duckWindows} />`。
2. 要消费的东西在 **`src/remotion/components/AudioTrack.tsx`**（76 行）。它是 `<>` 片段：`bgmUrl` → `voiceOverUrl` → `voiceOver[]`（每条 `<Sequence from=… layout="none">` 包 `<Audio>`）。
   **sfx 照 `voiceOver[]` 那段追加**，一行都不改前面三个分支。
3. 换算入口是 **`src/audio-timeline.ts:289` `resolveSfxStartFrame(sfx, ctx)`**，返回 `number | null`：
   - `startFrame` → 直接返回（要求 `Number.isInteger && >= 0`）
   - `startSec` → `Math.round(sec * ctx.fps)`
   - `anchor` → `ctx.trackById.get(anchor.trackId)`，`base = at==='end' ? startFrame+durationInFrames : startFrame`，再加 `offsetSec * fps`
   - 三定位不是恰好一个 ⇒ 返回 `null`（**渲染期静默跳过**，因为校验层已在 write 时拒收；渲染器不应该 throw 把整片炸掉）
4. `ctx` 需要 `{ fps, trackById }`。`trackById` 用 `new Map(manifest.tracks.map(t => [t.id, t]))` 构建即可 ——
   **渲染器拿到的 manifest 一定是归一化后的**（`normalizeManifestTiming()` 在宿主侧 `host-tools.ts:3742` 已跑过），所以 `track.startFrame` 必有数字，顺序衔接（含负 gap 叠化）也已经算好。
   ⇒ **不要在渲染器里再跑一次 normalize**，会二次位移。
5. 音量：`gain`（0–2，缺省 1）× 需要的话再乘一个常数。**不要**接 `audioVolumeAt` 的闪避包络 —— 音效是点缀，被 BGM 闪避会让它听不见。
6. `layout="none"` 必须带（音频不产生视觉盒子）。

### 已确认的其它事实

- `assets/**` 已在 `package.json files` 白名单，新增 `assets/sfx/` **无需改**打包配置
- `validateAssetRefField` / `isAllowedManifestAssetRef` 已存在，sfx 直接复用
- `KNOWN_AUDIO_KEYS` 在 `manifest.ts` 974 行附近（现 8 键，含 `sfx`）
- GT 真值在 `gt/mix-report.json`（7 条），合成原语在 `gt/native_audiolib.py`
- 0A 六条事件类型 → 五支素材的对应：`thud`→thud.wav / `write`→write.wav / `card`→card.wav / `swipe`→swipe.wav / `swoosh`→swoosh.wav
