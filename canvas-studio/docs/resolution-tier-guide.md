# 分辨率三档分级调整参考

> **⚠️ 本文档是 2026-09-15 的原始参考稿，已被取代 —— 请勿照它施工。**
> 它描述的「改这 7 个文件」有 **3 处会真出事**（最严重的一处会让老节点重试**直接崩**：`resolution` 随 `generationPromptOf` 落进画布节点，历史节点里存着 `720p`，删掉该键后查表得 `undefined`），且把「视频侧枚举收窄」与「图片侧全新维度」写成了同一件事。
> **施工口径与实际结论见 [`docs/plans/resolution-tier-dev.md`](./plans/resolution-tier-dev.md)**（对应 **CV-187**）。本文档保留仅作决策追溯 —— 唯一仍被沿用并被实测证实的是下面这张**三档取值表**（它来自 H3 官方推荐分辨率表）。
> 注：下表的「中 1.06 MP」在实现口径里写作 **1.0 MP** = `768p`；三档已定名为 **`480p` / `768p` / `2k`**（不采用「低/中/高」，避免两套词汇并存）。

## 三档分辨率总览

| 档位 | 分辨率 | Megapixels | 用途 |
|:---|:---|:---|:---|
| **低** | 864 × 480 | 0.4 MP | 快速预览、草稿 |
| **中** | 1376 × 768 | 1.06 MP | 默认生成 |
| **高** | 1920 × 1088 | 2.0 MP | 高质量输出 |

> 所有分辨率均为 **16:9** 横屏，宽高均为 **32 的倍数**（multiple=32）。
> 竖屏 9:16 反转宽高即可（480×864 / 768×1376 / 1088×1920）。

---

## 一、需要修改的文件清单

| 文件 | 行号 | 当前值 | 说明 |
|:---|:---|:---|:---|
| `src/config.ts` | 39–42 | `{1280,720}` / `{720,1280}` / `{1024,1024}` | 宽高比→分辨率映射 |
| `src/providers/drama.ts` | 24 | `MEGAPIXELS = 0.4` | Drama 请求像素量 |
| `src/providers/fal.ts` | 76–81 | `RESOLUTION_MAP` | fal 分辨率档位映射 |
| `src/host-tools.ts` | 529 | `COMPOSED_FALLBACK = {1280, 720}` | 成片合成兜底 |
| `src/providers/types.ts` | 45 | `VideoResolution = '768p' | '1080p' | '720p' | '2k'` | 分辨率枚举 |
| `src/generate.ts` | 103 | `resolution?: '768p' | '1080p' | '720p' | '2k'` | 工具参数枚举 |
| `src/host-tools.ts` | 1101, 1162 | `enum: ['768p', '1080p', '720p', '2k']` | 工具 schema 枚举 |

---

## 二、逐文件修改指引

### 2.1 `src/config.ts` — 宽高比→分辨率映射

**当前代码（行 37–44）：**

```ts
export function sizeForAspectRatio(aspectRatio: string | undefined): { width: number; height: number } {
  switch (aspectRatio) {
    case '9:16': return { width: 720, height: 1280 }
    case '1:1': return { width: 1024, height: 1024 }
    case '16:9':
    default: return { width: 1280, height: 720 }
  }
}
```

**建议改为（引入三档常量）：**

```ts
// 三档分辨率常量（16:9）
export const RESOLUTION_LOW = { width: 864, height: 480 } as const    // 0.4MP
export const RESOLUTION_MED = { width: 1376, height: 768 } as const   // 1.06MP
export const RESOLUTION_HIGH = { width: 1920, height: 1088 } as const // 2.0MP

/** 宽高比 → 像素尺寸（默认中档）。 */
export function sizeForAspectRatio(
  aspectRatio: string | undefined,
  tier: 'low' | 'med' | 'high' = 'med',
): { width: number; height: number } {
  const base = tier === 'low' ? RESOLUTION_LOW
    : tier === 'high' ? RESOLUTION_HIGH
    : RESOLUTION_MED
  switch (aspectRatio) {
    case '9:16': return { width: base.height, height: base.width }
    case '1:1': return { width: 1024, height: 1024 }
    case '16:9':
    default: return { ...base }
  }
}
```

> **要点：** 默认档位从原来的 `1280×720`（约 0.92MP）改为 `1376×768`（约 1.06MP），
> 画质略有提升。如需保持原画质不变，可将默认改为 `'low'`。

---

### 2.2 `src/providers/drama.ts` — Drama 像素量

**当前代码（行 23–24）：**

```ts
/** Drama 固定 0.4 兆像素（与改造前请求体一致）。 */
const MEGAPIXELS = 0.4
```

**建议改为：**

```ts
/** Drama 默认像素量（低档 0.4MP ≈ 864×480）。 */
const MEGAPIXELS_DEFAULT = 0.4

/** 三档 Megapixels 映射。 */
const MEGAPIXELS_MAP: Record<string, number> = {
  low: 0.4,
  med: 1.0,
  high: 2.0,
}
```

> **注意：** Drama 后端实际是否接受 `megapixels` 参数值大于 0.4 需要验证。
> 如果后端只认 0.4，则此处只能保持不变，分辨率提升只能通过 fal 通道实现。

---

### 2.3 `src/providers/fal.ts` — fal 分辨率映射

**当前代码（行 76–81）：**

```ts
const RESOLUTION_MAP: Record<NonNullable<VideoRequest['resolution']>, { value: string; warning?: string }> = {
  '768p': { value: '768P' },
  '2k': { value: '2K' },
  '720p': { value: '768P', warning: '...' },
  '1080p': { value: '2K', warning: '...' },
}
```

**建议改为：**

```ts
const RESOLUTION_MAP: Record<NonNullable<VideoRequest['resolution']>, { value: string; warning?: string }> = {
  '480p': { value: '480P' },   // 低档 → 864×480
  '768p': { value: '768P' },   // 中档 → 1376×768
  '2k':   { value: '2K' },     // 高档 → 1920×1088
}
```

> **要点：** fal 原生支持 `480P / 768P / 2K / 4K`。
> 删除 `720p→768P` 和 `1080p→2K` 的升档逻辑，新增 `480p` 直通。

---

### 2.4 `src/providers/types.ts` — 分辨率类型枚举

**当前代码（行 45）：**

```ts
export type VideoResolution = '768p' | '1080p' | '720p' | '2k'
```

**建议改为：**

```ts
export type VideoResolution = '480p' | '768p' | '2k'
```

---

### 2.5 `src/generate.ts` — 工具参数

**当前代码（行 102–103）：**

```ts
/** 【占坑·待接入】分辨率指定（768p/1080p/720p/2k） */
resolution?: '768p' | '1080p' | '720p' | '2k'
```

**建议改为：**

```ts
/** 分辨率档位：low=480p, med=768p（默认）, high=2k */
resolution?: '480p' | '768p' | '2k'
```

---

### 2.6 `src/host-tools.ts` — 工具 schema + 兜底

**行 529 兜底尺寸：**

```ts
// 当前
const COMPOSED_FALLBACK = { width: 1280, height: 720 }
// 改为
const COMPOSED_FALLBACK = { width: 1376, height: 768 }
```

**行 1101 / 1162 schema 枚举：**

```ts
// 当前
resolution: { enum: ['768p', '1080p', '720p', '2k'], ... }
// 改为
resolution: { enum: ['480p', '768p', '2k'], description: '分辨率档位：480p=低(864×480), 768p=中(1376×768, 默认), 2k=高(1920×1088)' }
```

---

## 三、生图 vs 生视频：分辨率参数流向

> **核心结论：** `config.ts` 的 `sizeForAspectRatio` 是生图和生视频共用的唯一入口，
> 但两条链路消费它的方式不同。

### 3.1 统一入口（`generate.ts:1047`）

```ts
const size = sizeForAspectRatio(params.aspectRatio ?? runtime().defaultAspectRatio())
```

这个 `size` 同时供给生图和生视频，但后续分叉：

### 3.2 生图链路（`image_generate`）

```
sizeForAspectRatio → size = {width, height}
       ↓
  直接传给 Drama 后端作为 width / height 参数
```

涉及三个端点，**全部传 `width` / `height`**：

| 端点 | 代码行 | 传参 |
|:---|:---|:---|
| `txt2imageanime`（卡通文生图） | `generate.ts:1196–1197` | `{ prompt, width: size.width, height: size.height }` |
| `image2image`（图生图） | `generate.ts:1216–1217` | `{ prompt, width: size.width, height: size.height, image1~3 }` |
| `txt2image`（写实文生图） | `generate.ts:1232–1233` | `{ prompt, width: size.width, height: size.height }` |

**结论：改 `sizeForAspectRatio` 的返回值，生图输出分辨率立刻跟着变。**

### 3.3 生视频链路（`video_generate` / `video_composite`）

生视频走供应商适配器，**不直接用 `size` 的 width/height**：

| 供应商 | 传参方式 | 代码位置 |
|:---|:---|:---|
| **Drama** | `megapixels: 0.4`（固定，不用 width/height） | `drama.ts:78,86,97,104` |
| **fal** | `resolution` 枚举（`480P` / `768P` / `2K`） | `fal.ts:172–176` |

**结论：改 `sizeForAspectRatio` 对生视频**无效**。视频分辨率需要分别改 `drama.ts` 的 `MEGAPIXELS` 和 `fal.ts` 的 `RESOLUTION_MAP`。

### 3.4 两条链路对比

| | 生图 (`image_generate`) | 生视频 (`video_generate`) |
|:---|:---|:---|
| **分辨率来源** | `sizeForAspectRatio()` → `width`/`height` | Drama: 固定 `megapixels`；fal: `resolution` 枚举 |
| **改 `config.ts` 生效？** | **是**，立刻生效 | **否**，需要改各自适配器 |
| **Drama 传参** | `width` + `height` | `megapixels`（不传 width/height） |
| **fal 传参** | 不走 fal | `resolution` 枚举 |
| **三档适配方式** | 改 `sizeForAspectRatio` 的 `tier` 参数 | Drama: 改 `MEGAPIXELS`；fal: 改 `RESOLUTION_MAP` |

---

## 四、不需要修改的部分（UI / 布局）

| 文件/常量 | 原因 |
|:---|:---|
| `src/canvas-aspect.ts` 的 `MEDIA_LONG_SIDE = 480` | 这是画布卡片**显示**尺寸，不是视频输出分辨率，与三档无关 |
| `src/canvas-aspect.ts` 的 `SQUARE_SIDE = 420` | 同上，1:1 卡片显示尺寸 |
| `src/canvas-aspect.ts` 的 `DEFAULT_MEDIA_BOX = {260, 180}` | 占位卡片尺寸，不影响输出 |
| `src/canvas-view.ts` 的 `ARRANGE_GAP / ORIGIN` | 布局间距，与分辨率无关 |
| `src/canvas-placement.ts` 的 `PLACEMENT_GRID` | 落点网格步距，与分辨率无关 |
| `src/compose.ts` 的 `buildTranscodeArgs` | 成片合成直接探针第一个 clip 的真实分辨率，不走 `sizeForAspectRatio` |

---

## 五、三档分辨率 × 画幅 完整矩阵

| 画幅 | 低档 (0.4MP) | 中档 (1.06MP) | 高档 (2.0MP) |
|:---|:---|:---|:---|
| **16:9** 横屏 | 864 × 480 | 1376 × 768 | 1920 × 1088 |
| **9:16** 竖屏 | 480 × 864 | 768 × 1376 | 1088 × 1920 |
| **1:1** 方屏 | 1024 × 1024 | 1024 × 1024 | 1024 × 1024 |

> 1:1 方屏三档共用 1024×1024（若后续需要区分可另行扩展）。

---

## 六、修改顺序建议

1. `src/providers/types.ts` — 先改类型枚举（其他文件依赖它）
2. `src/config.ts` — 加三档常量 + 改 `sizeForAspectRatio`
3. `src/providers/drama.ts` — 改 `MEGAPIXELS`
4. `src/providers/fal.ts` — 改 `RESOLUTION_MAP`
5. `src/generate.ts` — 改参数类型
6. `src/host-tools.ts` — 改 schema 枚举 + `COMPOSED_FALLBACK`
7. 跑 `corepack yarn typecheck` 确认无类型错误
8. 跑 `corepack yarn test` 确认单测通过
