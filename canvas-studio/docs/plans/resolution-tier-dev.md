# 分辨率三档分级 · 开发文档（实施稿）

> **上游**：`docs/resolution-tier-guide.md`（参考稿）→ `docs/plans/resolution-tier.md`（需求 / 决策）
> **本文档只讲「怎么改」**：三档取值、目标代码形态、逐文件改动、测试怎么建、怎么验、怎么回滚。
> **取值已定**：三档来自 **H3 官方推荐分辨率表**（用户 2026-09-15 提供），不再是反推占位值。
> **状态**：`P1 已落地 + P0 已实测`（P2/P3 同批落地；**P1' 待 P0-d 复测**——见 §0.5）。
> **三档取值已结案**：来自 **H3 官方推荐分辨率表**（用户 2026-09-15 提供）。
> **P0 实测结论**：图片侧**完全按请求出图**（三档逐字节一致）；视频侧 `megapixels=0.4` 实测 **864×480**（与 H3 表第一行吻合），`1` / `2` 首轮**连接级失败**，复测中。

---

## 0. 三档取值（已定，附出处）

来源：H3 视频生成推荐分辨率表（`megapixels × aspect → output`，输出保证为 **32 的倍数**）。
参考稿选的就是这张表的 **0.4 / 1.0 / 2.0** 三行 —— 与下表逐字一致。

| 档 | megapixels | 16:9 | 9:16 | 用途 |
|:--|:--|:--|:--|:--|
| `480p` | 0.4 | 864 × 480 | 480 × 864 | 草稿 / 试拍 |
| `768p` | 1.0 | **1376 × 768** | 768 × 1376 | **默认** |
| `2k` | 2.0 | 1920 × 1088 | 1088 × 1920 | 交付 |
| （1:1） | — | 1024 × 1024 | — | 三档共用（1:1 仅图片类工具可用） |

三条已核实的性质：

1. **三档宽高全是 32 的倍数**：864=32×27、480=32×15、1376=32×43、768=32×24、1920=32×60、1088=32×34 ✅
2. **`megapixels` 是视频侧唯一的画质旋钮** —— 视频端点收 `aspect + megapixels`，**不收 width/height**（`docs/canvas-studio-api-usage.md:31,219`）。所以视频像素**只能从这张表反推**，不能自由指定
3. 三档都**不精确等于** 16:9（1.8000 / 1.7917 / 1.7647）→ 见 §1.3，**这不是缺陷**

---

## 0.5 P0 实测结果（2026-09-15，真机）

脚本：`scripts/probe-resolution-tiers.mjs`　产物：`docs/api-probe/resolution-tier-1789462074585/`
真实像素一律由 **ffprobe** 量出，**不采信响应里的任何声明值**。

### P0-a / P0-c 图片端点 —— 全部通过 ✅

| 请求 | HTTP | 耗时 | 真实产物 | 一致 |
|:--|:--|:--|:--|:--|
| 1280 × 720（旧默认） | 200 | 16.6 s | 1280 × 720 | ✅ |
| **864 × 480**（480p） | 200 | **5.3 s** | 864 × 480 | ✅ |
| **1376 × 768**（768p 新默认） | 200 | 14.5 s | 1376 × 768 | ✅ |
| **1920 × 1088**（2k） | 200 | 32.7 s | 1920 × 1088 | ✅ |
| **768 × 1376**（768p 竖屏） | 200 | 14.5 s | 768 × 1376 | ✅ |
| 1400 × 780（**非 32 倍数**） | 200 | 15.4 s | **1400 × 776** | ❌ |

三条结论：

1. **图片端点完全按请求出图** —— 五个合规尺寸**逐字节一致**，`OUTPUT_SIZE` 的值就是真实产物 ⇒ §1.2 的「声明 = 真实」在图片侧成立。
2. **错尺寸不会失败，只会静默取整** —— `1400×780` 得 `1400×776`：**按 8 对齐**（776 = 8×97；1400 本是 8 的倍数故原样保留），不是 32。所以「非 32 倍数会报错」这个假设是错的；正确说法是**后端悄悄给你另一个尺寸**。三档全 32 倍数，两道都满足。
3. **`480p` 提速是真的，不是想当然** —— 5.3 s vs 14.5 s vs 32.7 s（约 **1 : 2.7 : 6.2**）。这让「草稿/试拍用低档」这条建议有了实测依据。

### P0-d Drama 视频端点 —— **未得出可用结论** ⚠️

| megapixels | 结果 |
|:--|:--|
| 0.4 | ✅ HTTP 200 / 130.8 s / 真实产物 **864 × 480** |
| 1 | ❌ `fetch failed`（**无 HTTP 状态** = 连接级失败） |
| 2 | ❌ `fetch failed` |

**0.4 那条同时证实了两件事**：`drama.ts` 硬编码的 0.4 MP **确实产出 864×480**（与 H3 表第一行逐字吻合 ✅），以及该端点的真实耗时约 **130 秒**。

**1 / 2 的失败无法归因**，原因是随后的对照实验（`--mp 0.4,1,0.4`，含 0.4 复测作为对照）在第一个 0.4 请求上就**没有返回**，进程随后退出；再测 `GET /api/v1/health` 得到 **`HTTP 000`** —— **后端整体已不可达**。

⇒ 两种解释都无法排除：**（a）** 后端拒收 1.0/2.0 并断开连接；**（b）** 后端在长任务压力下自行崩溃/重启，与取值无关（首轮 0.4 已跑满 130 s，正是压力最大的时刻）。

**因此本轮按「未证实」处理**：不动 `drama.ts`（§3.3），并把复测另立条目。**在证实之前不发未经验证的请求体** —— 若真是 (a)，发出去就是每次生成都打挂后端。

> 复测脚本已就绪（`--only video --mp 0.4,1,0.4`，含对照位 + `err.cause` 根因捕获）。**复测前提是后端恢复可达**，届时可直接跑。

---

## 1. 事实基线（逐项核对结论）

### 1.1 「视频和图片参数不都是传进去的吗」——传的不是同一个参数

| | 视频 | 图片 |
|:--|:--|:--|
| 工具参数 | `resolution` **已存在**（`host-tools.ts:1101/1162`，枚举 `768p\|1080p\|720p\|2k`） | **无**（只有 `aspectRatio`，`host-tools.ts:750`） |
| 到后端的字段 | Drama：`aspect` + `megapixels`（`drama.ts:78/86/97/104`）；fal：`resolution: '768P'`（`fal.ts:174`） | `width` + `height` 像素（`generate.ts:1196 / 1216 / 1231`） |
| 后端契约 | `api-usage.md:219`「fl2va / ref2va 收 **aspect + megapixels**（不是像素）」 | `api-usage.md:215`「txt2image(-anime) / image2image 收 width/height」 |
| 像素从哪来 | megapixels 经 H3 表反推（**不可自由指定**） | `sizeForAspectRatio` 直给（**可自由指定**） |
| 现状 | 链路已全通，但 Drama 不消费（`generate.ts:1278` 回「暂未接入，已忽略」） | **完全没有档位概念** |

结论：差异不在「传参」这个动作，而在**参数的另一端** —— 视频侧是「一个已存在的枚举要收窄 + 让 Drama 真的用上」，图片侧是「一个从未存在的维度要插进一条纯映射链」。

### 1.2 既有缺陷：视频节点的「真实分辨率」记错了

| 事实 | 位置 |
|:--|:--|
| Drama 视频固定发 `megapixels: 0.4` → 真实产物 **864 × 480** | `drama.ts:24` + §0 表 |
| 但节点落盘写 `mediaWidth: size.width, mediaHeight: size.height` = **1280 × 720** | `generate.ts:1398-1399, 1452-1453` |
| 契约写的却是「**真实产物分辨率**」 | `LayerDetailPanel.tsx:123` 注释、`canvas-studio-acceptance-feedback.md:30`（F2） |
| 客户端自然尺寸**只在 `mediaWidth === undefined` 时**回填 → 已有值永不被纠正 | `StudioFrame.tsx:847-849` |

⇒ 详情面板给每个视频显示 `1280 × 720`，真实是 `864 × 480`。**本方案顺带修掉它**：档位像素 = H3 表输出 = 真实产物，三者同源，不再有第三个数字。

### 1.3 「三档不精确等于 16:9」为什么可以接受（撤回上一版的一条误判）

上一版我要求三档必须严格 16:9，理由是 `previewSizeOf`（`canvas-aspect.ts:59-69`）按**精确比例**反算节点框，否则「改档位会改画布几何」。**这个判断是反的。**

三档喂 `frameSizeOf`：

| 档 | 尺寸 | 比例 | `previewSizeOf` | 节点框 |
|:--|:--|:--|:--|:--|
| `480p` | 864×480 | 1.8000 | 480×267 | 480×315 |
| `768p` | 1376×768 | 1.7917 | 480×268 | 480×316 |
| `2k` | 1920×1088 | 1.7647 | 480×272 | 480×320 |

节点框随档位差 5px —— **但这是正确的**：节点框本就该跟随**真实产物**的比例（客户端媒体加载后的自然尺寸校正给出的也是这组数）。反过来，若把框硬钉在精确 16:9 的 480×318，反而与真实媒体不符，且因为 `mediaWidth` 已被写入（§1.2），自然尺寸校正**不会**再纠正它。

所以守卫的正确形态不是「三档输出必须相等」，而是「**档位像素必须等于 H3 表里那行的输出，且宽高均为 32 的倍数**」—— 见 §4.2 H 组。

### 1.4 默认档无法「零变更」——两边现状本来就不同源

| | 现状真实输出 | 默认 = `480p` | 默认 = `768p` |
|:--|:--|:--|:--|
| 视频（Drama） | 864 × 480（0.4 MP） | 不变 | **提升** → 1376×768 |
| 图片 | 1280 × 720（`config.ts:42`） | **变差** → 864×480 | **提升** → 1376×768 |

同一个档位驱动两条链路，而两条链路的现状值本就不同（视频 864×480 / 图片 1280×720），**不存在让两边都不变的默认值**。

> 上一版「Q3 = 默认零变更」的前提因此失效。**已拍板默认 `768p`**：它是参考稿的设计点，也是不降低图片侧画质的选择。
>
> ⚠️ 下表「默认 = 768p」一列的视频格写「提升 → 1376×768」，**该提升依赖 P0-d 证实**（Drama 按档发 megapixels）。P0-d 未证实 ⇒ **本轮视频侧不变**（仍 864×480），只有图片侧真实升到 1376×768。见 §0.5 / §3.3。

### 1.5 顺带收益：图片产物对齐 32 倍数

现状图片 1280×720 的 **720 不是 32 的倍数**（864/480/1376/768/1920/1088 六个值全部是 32 的倍数 ✅）。而图片产物正是本产品视频链路的**首帧**（keyframe → i2v），H3 的 multiple=32 规则意味着非 32 倍数的首帧必然被引擎重采样或补边。改用 `768p`（1376×768）后首帧与视频同规格，消除这道隐性重采样。

**P0 实测（§0.5）已证实这条的必要性，同时纠正了「32 是硬约束」这个假设**：后端对非对齐尺寸**不报错、静默取整**——请求 `1400×780` 实得 `1400×776`（**按 8 对齐**，不是 32；1400 本就是 8 的倍数故原样保留）。也就是说错尺寸不会失败，只会**悄悄给你另一个尺寸**。三档全是 32 的倍数，既满足 H3 规格也满足后端对齐，且 `% 32` 守卫（§4.2 H 组）比后端的 8 更严 —— 这是有意的：8 对齐能让请求通过，但**首帧进 H3 引擎要的是 32**。

---

## 2. 目标数据流

### 改前

```
【视频】
工具参数 resolution?（枚举 4 档，含两个 fal 不存在的档）
   → GenerateParams.resolution → VideoRequest.resolution
        ├─ fal:   RESOLUTION_MAP[4 键] ── '720p'→'768P'(升档+warning) / '1080p'→'2K'(升档+warning)
        └─ drama: **完全忽略** + warning（generate.ts:1278）
   → 真实产物固定 0.4MP = 864×480
   → 节点却记 mediaWidth/mediaHeight = 1280×720   ← §1.2 的缺陷

【图片】
无档位概念
sizeForAspectRatio(aspect) → 1280×720 / 720×1280 / 1024×1024 → 端点 width/height
```

### 改后

```
【视频】
工具参数 resolution? ─┐
                      ├→ resolutionOf() → normalizeResolution()（历史值就地归一）
设置 defaultResolution┘        ↓
                        档位 '480p' | '768p' | '2k'
                          ├─ fal:   RESOLUTION_MAP 三键直通（480P / 768P / 2K），无 warning
                          └─ drama: MEGAPIXELS_MAP → 0.4 / 1.0 / 2.0
                                    ↓ 经 H3 表
                              真实产物 864×480 / 1376×768 / 1920×1088
                                    ↓
【图片】                      sizeForAspectRatio(aspect, 档位) → 同源像素
工具参数 resolution? ─┐                ↓
                      ├→ 同一个档位 ──→ 端点 width/height
设置 defaultResolution┘                ↓
                              节点 mediaWidth/mediaHeight / frameSizeOf（同一组像素）
```

**一个档位、一个词（`'480p' | '768p' | '2k'`）、一张像素表。** 不新增 `low/med/high` 第二套词汇 —— 同一规则只准一份实现。

> 这也回答了上一轮的「分批」问题：两条链路**共用** `sizeForAspectRatio` 这唯一入口，改默认档必然同时改两边输出，**因此拆不开**。能拆的只剩「要不要给 `image_generate` 单独的档位参数」（§6 第 2 点）。

---

## 3. 逐文件改动

### 3.1 `src/providers/types.ts:42-45`

```ts
/**
 * 分辨率档位（3 档）。**标签与像素的对应见 `config.ts` 的 `OUTPUT_SIZE`** ——
 * 那是唯一事实来源（H3 推荐表 2026-09-15）。本类型只承载「档位名」。
 *
 * 收窄理由：删掉 `720p` / `1080p` —— 它们在 H3 无对应档，旧行为是「就近升档」，
 * 会悄悄提高费用；现在直通三档，不再有隐式升档。
 */
export type VideoResolution = '480p' | '768p' | '2k'
```

### 3.2 `src/config.ts` —— 唯一像素表

```ts
import type { VideoResolution } from './providers/types.js'   // 仅类型导入，编译期擦除，无运行时环

/**
 * 三档输出像素（16:9 基准，宽高**均为 32 的倍数**）。
 *
 * 数值 = H3 推荐分辨率表（2026-09-15）的 0.4 / 1.0 / 2.0 行，**不是自由取值**：
 * 视频端点只收 megapixels，像素由这张表反推；填了表外的值（如 1280×720）
 * 会导致「声明的分辨率 ≠ 真实产物」，而客户端不会纠正已定义的 mediaWidth
 * （StudioFrame.tsx:847 只在 undefined 时回填）。
 */
export const OUTPUT_SIZE: Record<VideoResolution, { width: number; height: number }> = {
  '480p': { width: 864,  height: 480  },
  '768p': { width: 1376, height: 768  },
  '2k':   { width: 1920, height: 1088 },
}

/** 默认档位（设置项 defaultResolution 的默认值，两处必须一致）。 */
export const DEFAULT_RESOLUTION: VideoResolution = '768p'

/** 合法档位判定 —— 工具入参 / 设置项 / 历史值归一三处共用（避免校验散落）。 */
export function isVideoResolution(value: unknown): value is VideoResolution {
  return value === '480p' || value === '768p' || value === '2k'
}

/**
 * 宽高比 + 档位 → 像素尺寸。
 *
 * 9:16 反宽高；1:1 恒 1024×1024（三档共用，方形不是 H3 输出规格，无档位意义）。
 * 参数带默认值 ⇒ 既有调用点（唯一：`generate.ts:1047`）与既有测试零改动即可编译。
 */
export function sizeForAspectRatio(
  aspectRatio: string | undefined,
  resolution: VideoResolution = DEFAULT_RESOLUTION,
): { width: number; height: number } {
  switch (aspectRatio) {
    case '9:16': {
      const base = OUTPUT_SIZE[resolution]
      return { width: base.height, height: base.width }
    }
    case '1:1': return { width: 1024, height: 1024 }
    case '16:9':
    default: return { ...OUTPUT_SIZE[resolution] }
  }
}
```

> **为什么把类型导出放 `providers/types.ts` 而不是 config**：该类型是供应商契约（`VideoRequest.resolution`）。`config.ts` 用 `import type` 引用它，编译期擦除、无运行时环（`providers/types.ts` 不 import config）。

### 3.3 `src/providers/drama.ts` —— **本轮不动**（P0-d 未能证实，见 §0.5）

P0-d 实测**未得出「后端接受 > 0.4」的结论**，且首轮实测中后端在 `megapixels=1` 处断开连接、随后整体不可达（详见 §0.5）。**在证实之前不发未经验证的请求体**，因此本文件保持 `MEGAPIXELS = 0.4`。

| P0-d 结果 | 处置 | 本轮 |
|:--|:--|:--|
| 接受 `megapixels` > 0.4 且产物像素随之变化 | 按档发送（`MEGAPIXELS_MAP`）；删「暂未接入」warning | ❌ **未证实** |
| 只认 0.4 | 不改本文件，warning 改文案 | ⏳ 暂按此口径 |
| 后端异常/不可达（**实际发生**） | 不改本文件；warning 保留；**另立条目复测** | ✅ **本轮执行** |

**残余缺陷 → CV-188 已修（改用「实测」，绕开 P0-d gate）**：Drama 视频真实产物恒为 **864×480**（0.4 MP），而节点曾按档位落盘 `mediaWidth/mediaHeight`（默认档 = 1376×768）→ §1.2 那条「声明 ≠ 真实」曾在 **Drama 视频**上存在。修法见 §3.3.1。

> **（已作废）** 原先设想两条路，都要等 P0-d 复测：**①** 后端认 1.0 ⇒ drama 按档发 megapixels（像素自然对齐）；**②** 后端不认 ⇒ drama 侧启用「实际档位恒为 480p」的诚实声明（`OUTPUT_SIZE['480p']`）。两条路的共同问题：**都是在猜后端会输出什么**，猜错只是把「错的数字」换成「另一个错的数字」。CV-188 走第三条 —— 不猜，落盘时直接实测。
>
> 图片侧不受此影响：P0-c 已证实图片端点**逐字节按请求出图**，图片节点的声明值 = 真实产物 ✅。

**（已作废 · 不需实施）** 原先「等 P0-d 复测通过后照此实施」的 `MEGAPIXELS_MAP` 方案：

```ts
/**
 * H3 推荐表：档位 → megapixels。0.4 / 1.0 / 2.0 分别产出 864×480 / 1376×768 / 1920×1088。
 * 未传 resolution 时用默认档 —— **与改造前的固定 0.4 不同**：默认档是 768p（1.0）。
 */
const MEGAPIXELS_MAP: Record<VideoResolution, number> = { '480p': 0.4, '768p': 1.0, '2k': 2.0 }
```

`submit` 内取一次局部变量，四个 body（78 / 86 / 97 / 104）共用：

```ts
const megapixels = MEGAPIXELS_MAP[req.resolution ?? DEFAULT_RESOLUTION]
```

> ⚠️ 删掉 `const MEGAPIXELS = 0.4` 时**不要四处各写一遍** —— 本项目有「同一规则两份实现必分叉」的教训。
> 另：`dramaAspect()`（画幅侧的历史值兜底，`drama.ts:43`）保留不动，它是本方案的写法学长。

### 3.3.1 CV-188 · 视频侧像素改「实测」（本小节已实施）

**结论先行**：`drama.ts` **依旧不动**（P0-d 仍未证实，见 §0.5），但「声明 ≠ 真实」已经修掉了 —— 修在**落盘侧**，不在请求侧。

**为什么不需要动请求体**：视频端点的像素由**供应商**决定，本仓无从保证（Drama 固定 0.4MP，fal 按档）。既然落盘的那一刻产物已经躺在本地磁盘上，**直接问文件**比推演任何一手声明都准。

**实现**（`src/ffmpeg-run.ts` + `src/generate.ts`）：

| 位置 | 改动 |
|:--|:--|
| `ffmpeg-run.ts` | 新增 `probeMediaInfo(path)` → `{ duration, width?, height? }`；`probeMediaDuration` 降为它的薄封装（返回 `.duration`）—— **同一份实现，不另写一遍探测** |
| `generate.ts` 落盘段 | `probeMediaDuration(...)` → `probeMediaInfo(...)`，新增 `let mediaSize = size`，实测成功则换成实测值 |
| `generate.ts` 两处落盘 + `result` | `size.width/height` → `mediaSize.width/height`（节点 `mediaWidth/mediaHeight` 与工具返回值 `width/height` 三处同时改口径） |

**零额外开销**：CV-140 起每次视频落盘**本来就会跑一次** `ffmpeg -i` 探时长，而分辨率就在**同一个 stderr** 里（`parseFfmpegStreams` 早已在解析它，只是此前只给末帧抽取用）。这次只是把同一份输出多读一行。

**几个刻意的选择**：

1. **探测失败不新增 warning** —— 时长与分辨率出自同一次探测，失败时时长侧那条「未能探测产物真实时长」已经说了「探测不可用」。再加一条只是把同一件事说两遍（且会同时出现两条同类提示，噪音翻倍）。回退值是档位声明值（与用户选的档自洽），不是旧的硬编码 1280×720。
2. **图片侧不引入探测** —— P0-c 已证实图片端点逐字节按请求出图（声明 = 真实），探测对图片是「无收益 + 每次多一次进程」。
3. **节点框仍按声明值算比例** —— 媒体分辨率只定比例、不定尺寸；档位之间比例差 <1%（864×480 vs 1376×768 = 0.46%），低于客户端 5% 的校正阈值，不值得为此多探一次再回头改几何。

**顺带修掉的另一件事**：`resultSchema` 的 `width`/`height` 此前描述只有「宽度（像素）」—— agent 无从知道这是真值还是声明值，而它正是用来判断产物规格的字段。现在写明「视频为 ffmpeg 实测的真实产物像素，要判断实际出了多大以此为准」。
（`warnings` 的描述里还残留「占坑参数 model/**resolution**/generateAudio」—— `resolution` 自 CV-187 起已不再是占坑参数，一并更正。）

**守卫（`tests/resolution-tier.test.mjs` I / J / K 组）**：

| 组 | 断言 |
|:--|:--|
| **J** | `probeMediaInfo` 一次给出时长 + 分辨率；失败只回 `duration: 0` 且**尺寸字段缺失**（不得臆造），不抛 |
| **I** | 端到端：桩产物是**真 864×480 mp4**、不传档位（默认 768p）⇒ 落盘 `mediaWidth/mediaHeight` **必须 = 864×480**，且 `assert.notDeepEqual` 明确排除 `OUTPUT_SIZE['768p']`；工具返回值同口径 |
| **K** | 客户端 `handleMediaNatural` 必须做「不一致就纠正」，且**不得**退回「只在 `mediaWidth === undefined` 时回填」（源码闸，剥注释后匹配） |

**反向验证（均已在真机上执行过）**：

| 改坏什么 | 期望 | 实测 |
|:--|:--|:--|
| 注释掉 `generate.ts` 的 `mediaSize = { width: probed.width, ... }` | I 组红 | ✅ `not ok 10`，恢复复绿 |
| 把 `StudioFrame.tsx` 改回 `if (target.mediaWidth === undefined)` | K 组红 | ✅ `not ok 11`，恢复复绿 |

### 3.3.2 客户端自愈 —— 老节点怎么办（本小节已实施）

`mediaSize` 只治**新生成**的节点。已落盘的老视频节点存的是历史假值（`1280×720`，或 CV-187 那批的 `1376×768`），而客户端此前**只在 `mediaWidth` 缺失时**才用自然尺寸回填（CV-013 的原始设计）⇒ **错值永不被纠正**，用户打开老项目看到的仍是假数字。

**修法**：`StudioFrame.handleMediaNatural` 的判据从「缺失就补」改为「**不一致就纠正**」。

```ts
// 改前
if (target.mediaWidth === undefined) { updates.mediaWidth = naturalWidth; ... }
// 改后（CV-188）
if (target.mediaWidth !== naturalWidth || target.mediaHeight !== naturalHeight) {
  updates.mediaWidth = naturalWidth
  updates.mediaHeight = naturalHeight
}
```

**为什么安全**：客户端是唯一知道真实像素的一方（媒体已加载），而写入值**就是自然尺寸本身** ⇒ 第二次加载必然相等，**不会反复写盘**（与 CV-029 那条「修正后各条件不再满足」同一性质）。锁定的节点也照常纠正分辨率（原逻辑本就不受 `locked` 影响，`locked` 只管框）。

**为什么用源码闸而不是行为断言**：这段逻辑跑在浏览器里（React 组件加载媒体后），本仓单测不渲染 React 组件，而预览台（Chrome headless）需要真实项目数据 + 媒体加载时序才能验。**源码闸的局限必须写明**：它只能锁「判据长什么样」，锁不住「真的在加载后跑了」—— 后者靠 §4.3 手测第 1 条（打开老项目看详情面板）兜底。

> ⚠️ **写这两个用例时踩到的坑**（后来者注意）：`findRealFfmpeg()` 若只调 `resolveFfmpegPath()` 会在本机直接返回 null 并**静默软跳过**（用例显示 `ok` 但耗时 0.5ms）—— 两种常见原因都不代表本机没有 ffmpeg：① 进程 PATH 被裁剪（Electron / 沙箱 shell 只继承窄 PATH）；② `ffmpeg-static` 只落了包壳、二进制未下载。故补一层常见安装位置探测（`/opt/homebrew/bin` 等）。**判据：用例耗时应为 ~90ms（真造 mp4 + 探测），若 <5ms 就是跳过了。**
> 另：`generate.ts` 内部按 `resolveFfmpegPath()`（无显式参数）解析，故 I 组用 `FFMPEG_PATH` 环境变量注入（与 `tests/video-provider-fal-refs.test.mjs` 同一手法），J 组直接传显式路径。
>
> **生产侧确认**：登录 shell 的 PATH 含 `/opt/homebrew/bin`，`start-canvas-studio.sh` 继承它 → Electron 子进程能解析到 ffmpeg ✅（故**不**在 `src/` 里加路径兜底 —— 那会掩盖「PATH 没配好」这件事）。

### 3.4 `src/providers/fal.ts:76-81` + `170-176` + 文件头 `18`

```ts
/** 三档直通（fal 原生枚举 480P / 768P / 2K / 4K，本仓只发前三档 —— 与 OUTPUT_SIZE 一一对应）。 */
const RESOLUTION_MAP: Record<VideoResolution, string> = {
  '480p': '480P',
  '768p': '768P',
  '2k':   '2K',
}

/**
 * 历史枚举就地归一 —— 与 `drama.ts` 的 `dramaAspect()` 同一模式（画幅侧先例：
 * 老节点重放 generationPrompt 带着历史 `1:1`，归一为 16:9，绝不把非法值发出去）。
 *
 * 映射是**等义**的：旧 `720p` 的行为就是「升档到 768P」，归一后 `768p` → `768P`，
 * 输出与旧行为完全一致 ⇒ **不需要回 warning**（回了会让老节点重试凭空多一条提示）。
 * 旧 `1080p` → `2K` 同理。
 */
const LEGACY_RESOLUTION: Readonly<Record<string, VideoResolution>> = {
  '720p': '768p',
  '1080p': '2k',
}

/** 把任意来源的 resolution 归一到当前三档；无法识别返回 undefined（不传，走供应商默认）。 */
export function normalizeResolution(raw: string | undefined): VideoResolution | undefined {
  if (raw === undefined) return undefined
  if (isVideoResolution(raw)) return raw
  return LEGACY_RESOLUTION[raw]
}
```

消费点替换（**warning 分支整段删除**）：

```ts
// —— 分辨率：fal 真实生效。先归一（含历史值），未指定则不传，走 fal 默认。
const input: Record<string, unknown> = { duration }
const resolution = normalizeResolution(req.resolution)
if (resolution !== undefined) input.resolution = RESOLUTION_MAP[resolution]
```

同步更新 `fal.ts:18` 注释（现为「resolution 480P/768P/2K/4K（默认 2K）」，补「本仓三档 + 像素对照 OUTPUT_SIZE」）。

### 3.5 `src/generate.ts`

| 行 | 改动 |
|:--|:--|
| 102-103 | 类型收窄为 `resolution?: VideoResolution`；JSDoc 删掉「占坑·待接入」，改为「档位：480p=草稿/768p=默认/2k=交付，像素见 config.ts OUTPUT_SIZE」 |
| 1047 | `const size = sizeForAspectRatio(params.aspectRatio ?? runtime().defaultAspectRatio(), resolutionOf(params))` |
| 1278-1280 | Drama 的「暂未接入」warning：按 §3.3 的 gate 结果**删除**或改文案 |
| 188 | `videoRequestOf` 的 JSDoc 里「`resolution` 是占坑参数」改掉 |

新增档位决策函数（放 `generate.ts` 靠上，与 `clampDuration` 同区）：

```ts
/**
 * 档位决策：工具参数 > 全局设置 > DEFAULT_RESOLUTION。
 * 非法值按缺省处理（与 aspectRatio 在 CV-099 的兜底同构）。
 * **图片与视频共用** —— 两条链路的像素同源，不允许各自解析一遍。
 */
function resolutionOf(params: GenerateParams): VideoResolution {
  if (isVideoResolution(params.resolution)) return params.resolution
  const fromSettings = runtime().defaultResolution?.()
  return isVideoResolution(fromSettings) ? fromSettings : DEFAULT_RESOLUTION
}
```

> **不做项目 plan 层**：`generate.ts:1041` 那段 plan 兜底只处理 `aspectRatio`，本次不动它。理由见 §6。

### 3.6 `src/host-tools.ts`

| 行 | 改动 |
|:--|:--|
| 1101, 1162 | `enum: ['480p', '768p', '2k']` + description 重写（**两处必须逐字一致**） |
| 1113, 1174 | 类型断言 `resolution?: VideoResolution` |
| 749-757 | `image_generate` **新增** `resolution`（同枚举）—— 见 §6 第 2 点 |
| 763-764 | execute 内 `if (a.resolution !== undefined) params.resolution = a.resolution` |
| 529 | `COMPOSED_FALLBACK` 改为 `{ ...OUTPUT_SIZE[DEFAULT_RESOLUTION] }` —— 去掉硬编码 `1280×720`，与默认档同源 |

**video 两处 description 目标文案**（要点：三档 + 像素 + 谁生效 + i2v 实情）：

```
分辨率档位：480p=草稿(864×480)、768p=默认(1376×768)、2k=交付(1920×1088)，宽高均为 32 的倍数。
仅对视频端点生效；Drama 供应商<按 §3.3 gate 结果填：按档换算 megapixels / 固定 0.4MP 不支持>。
⚠️ 首帧图生视频（fal image-to-video）<按 P0-b 结果填：画幅跟随关键帧，本参数不生效 / 正常生效>。
不传则走设置页的「默认分辨率」。
```

**image_generate 的 `resolution` description**：

```
输出分辨率档位：480p(864×480) / 768p(1376×768，默认) / 2k(1920×1088)，16:9 基准，竖屏自动反宽高；
1:1 画幅三档共用 1024×1024。本参数同时决定后续视频首帧的规格，草稿/试拍可用 480p 提速。
除非用户明确要求，不要主动询问。
```

### 3.7 设置层：照 `defaultVideoProvider` 的四处联动

| 文件 | 位置 | 改动 |
|:--|:--|:--|
| `src/host-config.ts` | 42 后 | `defaultResolution: VideoResolution`（接口） |
| `src/host-config.ts` | 89 后 | `defaultResolution: z.union(['480p','768p','2k']).default(DEFAULT_RESOLUTION)` |
| `src/index.ts` | 46 后 | `defaultResolution: DEFAULT_RESOLUTION,`（**必须与 schema default 同源，不写重复字面量**） |
| `src/index.ts` | 106 后 | `defaultResolution: () => source().defaultResolution,` |
| `src/client/SettingsModal.tsx` | 448 后（OutputSection） | 「默认分辨率」下拉（三档 + 像素说明） |
| `src/client/SettingsModal.tsx` | 469-479 | 「视频质量（待接入）」→ 改名「**导出质量（待接入）**」，hint 点明「与上面的生成分辨率无关」 |

> ⚠️ **不要复用 `videoQuality`**。它已在设置页渲染，语义是**导出码率**（`plan.md:139` 标 P3 导出管线）。一个字段两个语义，导出管线接入时必然要拆回来。正确做法是两个字段 + hint 说清区别。

### 3.8 明确不动

| 位置 | 为什么不动 |
|:--|:--|
| `canvas-aspect.ts` 全部（`MEDIA_LONG_SIDE` / `SQUARE_SIDE` / `DEFAULT_MEDIA_BOX` / `previewSizeOf` / `frameSizeOf`） | 画布**显示**尺寸，与输出分辨率无关（参考稿 §4 判断正确）；且按 §1.3，档位变化对它的影响是**正确的** |
| `canvas-placement.ts` / `canvas-view.ts` 的布局常量 | 落点 / 网格步距，与分辨率无关 |
| `compose.ts:24` `COMPOSED_FALLBACK_SIZE` | 走 `DEFAULT_NODE_SIZE`，是**节点框**占位尺寸 |
| `compose.ts` `buildTranscodeArgs` | 直接探针第一个 clip 的真实分辨率 |
| `character_generate` / `character_sheet` | 走 `image2character`，端点只收 `{image}`、不收 width/height（`generate.ts:1245-1247`）→ 档位无意义，**不加参数** |
| `drama.ts` `dramaAspect()` | 画幅侧的历史值兜底，本方案的写法学长，零改动 |

---

## 4. 测试计划

### 4.1 要改的既有断言（共 3 处 —— 默认升到 768p 的代价）

| 文件 | 位置 | 改什么 |
|:--|:--|:--|
| `tests/generate.test.mjs` | 721-722 | `mediaWidth 1280 → 1376`、`mediaHeight 720 → 768` |
| `tests/video-provider-fal.test.mjs` | 133-161 | 改为「三档直通 + **warnings 为空**」；删 720p→768P / 1080p→2K 升档断言 |
| `docs/canvas-studio-api-usage.md` | 30 | 「16:9→1280×720」→ 补三档表（P3 回填，非测试） |

### 4.2 新增 `tests/resolution-tier.test.mjs`

| 组 | 用例 | 断言 |
|:--|:--|:--|
| A fal 直通 | `480p` / `768p` / `2k` | `body.input.resolution` === `'480P'` / `'768P'` / `'2K'`；**`warnings.length === 0`** |
| B **历史值兜底** | `720p` / `1080p` | **不抛**，分别落 `768P` / `2K`（与旧行为等义） |
| C 未知值 | `'4k'` / `'1080P'` | `body.input.resolution === undefined`（不传，走供应商默认）；不抛 |
| D `sizeForAspectRatio` | 3 画幅 × 3 档 = 9 组 | 16:9 → 864×480 / 1376×768 / 1920×1088；9:16 → 反宽高；1:1 → 三档均 1024×1024 |
| E Drama megapixels | `480p` / `768p` / `2k` | `body.megapixels` === `0.4` / `1.0` / `2.0`（P1' 才建） |
| H **表-码对齐守卫** | 见下 | —— |
| F 归一纯度 | `normalizeResolution(undefined)` / 非法输入 | `undefined`；不抛 |

**H 组 · 表-码对齐守卫**（本方案最该有的一条）：

```js
// 期望值硬编码自 H3 推荐表，**不引用实现**（防「两边一起错」的空绿）
const H3_TABLE = { '480p': [864, 480], '768p': [1376, 768], '2k': [1920, 1088] }
for (const [tier, [w, h]] of Object.entries(H3_TABLE)) {
  assert.deepEqual(OUTPUT_SIZE[tier], { width: w, height: h })   // 表对齐
  assert.equal(w % 32, 0); assert.equal(h % 32, 0)               // multiple=32
}
assert.deepEqual(MEGAPIXELS_MAP, { '480p': 0.4, '768p': 1.0, '2k': 2.0 })
```

> 为什么需要它：`OUTPUT_SIZE` 是「声明值 = 真实产物」这条不变式的唯一落点。改成 `1920×1080`（看起来更「标准」）或 `1280×720`（回到旧值）之后，**§4 其余所有断言、以及全仓既有测试照样全绿**，只有画布上多看几 px + 详情面板数字变假。这类静默失败只有断言拦得住。

**G 组 · 反向验证（必做）**：
- 把 `LEGACY_RESOLUTION` 临时置空 → **B 组必须红**；恢复后绿
- 把 `OUTPUT_SIZE['2k']` 改成 `1920×1080` → **H 组必须红**；恢复后绿

> 依据本项目既有教训：类型收窄**不代表数据干净** —— 画布节点里的 `generationPrompt` 是历史数据的真实来源。「断言写用户期望，不写实现现状」。

### 4.3 手测（P4 桌面验收）

| # | 场景 | 期望 |
|:--|:--|:--|
| 1 | **老节点重试**（画布上视频节点，`generationPrompt` 带 `720p`）→ 右键重试 | **不崩**，正常出片，无多余 warning（`normalizeResolution` 归一生效） |
| 2 | 显式传 `resolution: '480p'` 出视频 | 出片，详情面板 **864 × 480** |
| 3 | 不传档位出视频（默认 768p） | 详情面板 **864 × 480** —— Drama 固定 0.4MP 的**真实输出**，**不是**档位声明值 1376×768。⚠️ 这条看似与「我选了 768p」矛盾，但要的就是它：**详情面板说的是真话**（CV-188 的验收条件）。要真拿到 768p 须切 fal 供应商（其按档生效） |
| 4 | 不传档位出图 | 1376×768（**不再是 1280×720**） |
| 5 | 竖屏 + `2k` 出图 | 1088 × 1920（反宽高生效） |
| 6 | 1:1 出图 + 三档各一次 | 三档都是 1024 × 1024 |
| 7 | **三者一致**：详情面板「分辨率」/ 节点右下角角标 / `ffprobe` 真实产物 | **必须一致**（§1.2 缺陷的验收条件） |
| 8 | **打开老项目**（CV-188 之前生成的视频节点） | 媒体加载后详情面板**自动纠正**为真实值（864 × 480），**无需重新生成**（§3.3.2 客户端自愈） |

---

## 5. 施工顺序与验证门

> **本机无 `yarn`**（历史坑），验证链展开成显式路径。

```
node scripts/sync-minimax-skills.mjs && node scripts/clean.mjs \
  && ./node_modules/.bin/tsdown \
  && ./node_modules/.bin/tsc -p tsconfig.json \
  && ./node_modules/.bin/tsc -p tsconfig.client.json --emitDeclarationOnly \
  && node scripts/verify-client-loader.mjs \
  && node --test "tests/*.test.mjs"
```

**P0 执行结果（2026-09-15 实测）**

| 探针 | 状态 | 结果 |
|:--|:--|:--|
| 后端连通 | ✅ | `GET /api/v1/health` → `HTTP 200`，65 ms（基址 `host-config.ts:19`）。⚠️ 探针跑完后后端转为**不可达**（`HTTP 000`） |
| **P0-a / P0-c 图片端点** | ✅ **通过** | 五个合规尺寸**逐字节一致**；非 8 倍数被静默取整（1400×780 → 1400×776）；480p 提速 5.3 s vs 32.7 s。见 §0.5 |
| **P0-d Drama `megapixels` 0.4** | ✅ | `HTTP 200` / 130.8 s / 真实产物 **864×480** —— 与 H3 表第一行逐字吻合 |
| **P0-d Drama `megapixels` 1 / 2** | ⚠️ **未证实** | `fetch failed`（无 HTTP 状态）；对照复测因后端整体不可达而中断 ⇒ 无法区分「后端拒收」与「后端崩溃」。见 §0.5 |
| **P0-b fal 三档真实像素 + i2v 是否吃 `resolution`** | ✅ **按 schema 结案** | 缺 `CANVAS_STUDIO_FAL_API_KEY`，故改用 fal **公开端点 schema**（无需 key）：i2v / t2v / ref2v **都收** `resolution`（枚举 480P/768P/2K/4K、默认 2K）；**i2v 无 `aspect_ratio`**（画幅跟随首帧）。原描述「`480P and 768P are native generation modes; 2K and 4K upscale a 768P base result`」已写进工具描述 |

| 阶段 | 内容 | 验证门 | 状态 |
|:--|:--|:--|:--|
| **P0** | 探针（零代码改动）。产物 `docs/api-probe/resolution-tier-1789462074585/` | 实测落盘；据此定 §3.3 的 gate | ✅ 已跑（P0-d 未证实） |
| **P1** | `types.ts` → `config.ts`（OUTPUT_SIZE + `sizeForAspectRatio` 带档）→ `fal.ts`（直通 + 归一）→ `generate.ts`（`resolutionOf` + 档位驱动像素）→ `host-tools.ts`（enum/断言 + `COMPOSED_FALLBACK`）→ 改既有断言 + 新增 `resolution-tier.test.mjs` | 整链 `fail 0`；**G 组两条反向验证都能红** | ✅ **已落地并复绿** |
| **P1'** | `drama.ts` `MEGAPIXELS_MAP` + 删 Drama「已忽略」warning | 同上 + E 组绿 | ⏳ **阻塞**（等 P0-d 复测，§3.3） |
| **P2** | `image_generate` 的 `resolution` 参数（§6 第 2 点已拍板「给」） | 同上 | ✅ **已落地** |
| **P3** | 设置层四处联动 + 同步面回填（§7）+ `STATUS.md` 登记 **CV-187** | grep 无残留旧枚举（`720p`/`1080p`） | ✅ 本轮完成 |
| **P4** | §4.3 七项手测 | 桌面回归通过；**第 7 项**必须与 ffprobe 一致 | ⏳ 待用户桌面验收 |

---

## 6. 拍板结论（2026-09-15 用户已确认）

| # | 事项 | 结论 |
|:--|:--|:--|
| 1 | **默认档位** | ✅ **`768p`（1376×768）**。理由见 §1.4：两边的现状值不同源（视频 864×480 / 图片 1280×720），**不存在零变更档**；`768p` 是不降低图片侧画质的选择，也是参考稿的设计点。代价 = §4.1 那 3 处断言/文档 |
| 2 | **`image_generate` 是否也给 `resolution`** | ✅ **给**。理由：草稿/试拍阶段出关键帧最费算力，低档能提速（实测 480p 比 2k **快 6.2 倍**）；且首帧规格直接决定视频规格（i2v 画幅跟随首帧），agent 需要能控 |

> ⚠️ **对第 1 条的一处修正（P0 之后）**：原话是「唯一**不降低任何一侧画质**」—— 这个说法依赖「Drama 能按档出 1376×768」。P0-d 未证实该前提（§0.5），故**当前实际收益只有图片侧**（1280×720 → 1376×768）；视频侧在 P1' 落地前仍是 864×480。默认档取值本身不受影响（`768p` 仍是正确的目标档），但**不要对外宣称视频画质已经提升**。

**附：已不成立的旧决策（供追溯）**

| 旧项 | 状态 |
|:--|:--|
| Q3「默认零变更」 | **失效** —— §1.4 前提不成立 |
| Q5「不给 `sizeForAspectRatio` 加 tier」 | **失效** —— 档位必须驱动像素，否则声明值与真实产物脱钩（§1.2） |
| Q6「`COMPOSED_FALLBACK` 不动」 | **改判** —— 改为与默认档同源，去掉硬编码 `1280×720` |
| Q4「不做项目 plan 档位层」 | **保留** —— 只做「工具参数 > 全局设置 > 默认」，plan 层等真有人要「这个项目统一出 2K」再加 |
| Q7「agent 不自选档位」 | **保留** —— 仅允许在草稿/试拍语境下用低档，判据写进 SKILL |
| §5.6「三档必须严格 16:9」 | **撤回** —— §1.3 判断反了；改为「像素必须等于 H3 表输出」 |

---

## 7. 同步面清单（✅ 本轮已全部回填）

| 文件 | 内容 | 状态 |
|:--|:--|:--|
| `docs/api.md` | 新增 **0.2.8 修订说明** + `resolution` 契约行 + 0.2.7 旧句划删 | ✅ |
| `docs/canvas-studio-tools.md` | `image_generate` 新增 `resolution` 行 / `video_generate` 的 `resolution` 行 / `warnings` 行的「占坑」措辞 | ✅ |
| `docs/canvas-studio-api-usage.md` | 两处尺寸行（改档位驱动）+ fl2va 段的 `megapixels` 说明 | ✅ |
| `docs/STATUS.md` | 登记 **CV-187**（全量表首行 + 速览计数 + 编号水位 + 最近更新） | ✅ |
| `docs/plans/video-provider-abstraction.md` | §5.3 映射表**追加勘误块**（原文保留作追溯）+ §10 Q2 标注「已被 CV-187 推翻」 | ✅ |
| `skills-local/canvas-studio-creation/references/toolchain.md` | 技能侧教参数（三档 + 像素 + **仅 fal 生效**） | ✅ |
| `skills-local/z-image-prompt-writing/SKILL.md` | 「画幅与尺寸」表改为 `resolution × aspectRatio` 矩阵 | ✅ |
| `plan.md` | 本地验收步骤 6 的画幅数字 + 新增「默认分辨率」一项 | ✅ |
| `docs/plans/resolution-tier.md` | 状态改为「已落地·待桌面验收」 | ✅ |

> **`skills/` 不是手改对象** —— 它是 `scripts/sync-minimax-skills.mjs` 由 `skills-local/` **生成**的产物（构建时自动同步）；手改 `skills/` 会在下次构建被覆盖。已核实 `tests` 里有「运行时副本 vs 手写源逐字节一致」的漂移护栏，故**必须走 sync**。

> 附：`SKILL.md` 有 15KB 硬闸（加内容要等量删），改 toolchain.md 时注意不要波及总纲。

---

## 附：改动文件总表

| 文件 | 位置 | 改动 | 阶段 |
|:--|:--|:--|:--|
| `src/providers/types.ts` | 42-45 | 枚举收窄为 `480p \| 768p \| 2k` + 注释指向 OUTPUT_SIZE | P1 |
| `src/config.ts` | 新增 | `OUTPUT_SIZE` / `DEFAULT_RESOLUTION` / `isVideoResolution` | P1 |
| `src/config.ts` | 37-44 | `sizeForAspectRatio` 加第 2 参（带默认值） | P1 |
| `src/providers/fal.ts` | 76-81 | `RESOLUTION_MAP` 三键直通（去 warning 字段） | P1 |
| `src/providers/fal.ts` | 新增 | `LEGACY_RESOLUTION` + `normalizeResolution()` | P1 |
| `src/providers/fal.ts` | 18, 170-176 | 注释更新 + 消费点改「先归一后查表」 | P1 |
| `src/generate.ts` | 102-103 | `resolution` 类型收窄 + 注释重写 | P1 |
| `src/generate.ts` | 新增 | `resolutionOf()` 档位决策 | P1 |
| `src/generate.ts` | 1047 | 传档位 | P1 |
| `src/host-tools.ts` | 1101, 1162 | enum + description（两处逐字一致） | P1 |
| `src/host-tools.ts` | 1113, 1174 | 类型断言 | P1 |
| `src/host-tools.ts` | 529 | `COMPOSED_FALLBACK` 改同源默认档 | P1 |
| `tests/generate.test.mjs` | 721-722 | 1280/720 → 1376/768 | P1 |
| `tests/video-provider-fal.test.mjs` | 133-161 | 三档直通断言 | P1 |
| `tests/resolution-tier.test.mjs` | 新增 | A~H 组 | P1 |
| `src/providers/drama.ts` | 24, 78/86/97/104 | `MEGAPIXELS_MAP` 按档（**P0-d gate**） | P1' |
| `src/generate.ts` | 1278-1280 | Drama warning 删除或改文案 | P1' |
| `src/host-tools.ts` | 749-757, 763-764 | `image_generate` 加 `resolution` | P2 |
| `src/host-config.ts` | 42, 89 | `defaultResolution` 接口 + schema | P3 |
| `src/index.ts` | 46, 106 | 默认值 + runtime source | P3 |
| `src/client/SettingsModal.tsx` | 448, 469-479 | 新下拉 + `videoQuality` 改名「导出质量」 | P3 |
| `docs/…` + `skills/…` + `skills-local/…` | §7 | 7 处回填 | P3 |
