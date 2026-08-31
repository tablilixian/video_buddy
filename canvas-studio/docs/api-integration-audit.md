# API 集成核查报告

**日期:** 2026-08-31
**核查对象:** `docs/plans/api.md`（v0.2.1）中列出的全部接口 × `canvas-studio` 代码集成
**结论:** 已集成的端点**使用全部正确**；但 api.md 与代码存在 **2 类不一致**，需修订。

---

## 一、逐端点集成矩阵

| # | api.md 端点 | api.md 状态 | canvas-studio 集成 | 调用点 | 使用正确性 |
|---|---|---|---|---|---|
| 1 | `GET /` | 在用 | ❌ 未集成 | — | 非必需（仅用 `/health` 探针） |
| 2 | `GET /api/v1/health` | 在用 | ✅ | `generate.ts:147` `ensureDramaReachable` | ✅ 正确（只看 `response.ok`） |
| 3 | `POST /api/v1/generate/txt2image` | 在用 | ✅ | `generate.ts:664` `image_generate`（无参考图时） | ✅ 请求 `prompt/width/height`；读 `full_url` |
| 4 | `POST /api/v1/generate/txt2imageanime` | 在用 | ⚠️ **仅 config 声明，无工具** | `config.ts:18`（孤儿键） | 不可达（无调用点） |
| 5 | `POST /api/v1/generate/image2image` | 在用 | ✅ | `generate.ts:650` `image_generate`（有参考图时，image1–image3） | ✅ 读 `full_url` |
| 6 | `POST /api/v1/generate/image2promptenhance` | 在用 | ✅ | `generate.ts:526` `prompt_enhance` | ✅ 读 `output` |
| 7 | `POST /api/v1/generate/image2character` | 在用 | ❌ 未集成 | — | 后端有、canvas-studio 无工具 |
| 8 | `POST /api/v1/generate/image2styletransfer` | 在用 | ✅ | `generate.ts:735` `style_transfer`（image1=目标, image2=风格） | ✅ 映射正确 |
| 9 | `POST /api/v1/generate/image2ipastyletransfer` | 在用 | ❌ 未集成 | — | 后端有、canvas-studio 无工具 |
| 10 | `POST /api/v1/generate/uploadimage` | 在用 | ✅ | `generate.ts:270` `uploadBytesToDrama` | ✅ 实测 `{name}` 已正确解析（兼容 `filename` 兜底） |
| 11 | `GET /view` | 在用 | 间接使用 | 经 `full_url` 下载产物（`generate.ts:764`） | ✅ 不自己拼 URL，直接用响应 `full_url` |
| 12 | `POST /api/v1/generate/image2storyboard` | 在用 | ✅ | `generate.ts:748` `storyboard_generate` | ✅ 读 `full_url` + `filename` |
| 13 | `POST /api/v1/generate/image2splitegrid` | 在用 | ✅ | `generate.ts:894` `storyboard_split` | ✅ 读 `images[].url` |
| 14 | `POST /api/v1/generate/image2inpaint` | 在用 | ⚠️ **仅 config 声明，无工具** | `config.ts:26`（孤儿键） | 不可达（无调用点） |
| 15 | `POST /api/v1/generate/image2vl` | 在用 | ✅ | `generate.ts:537` `image2vl` | ✅ 读 `output` |
| 16 | `POST /api/v1/generate/image2360hdri` | 在用 | ❌ 未集成 | — | 后端有、canvas-studio 无工具 |
| 17 | `POST /api/v1/generate/image2videomsr` | 在用 | ❌ **未集成（config 无此键）** | — | 与"收敛 fl2va+ref2va"决策冲突 |
| 18 | `POST /api/v1/generate/image2videomkr` | 在用 | ❌ **未集成（config 无此键）** | — | 同上 |
| 19 | `POST /api/v1/generate/image2videomkrgrid` | 在用 | ❌ **未集成（config 无此键）** | — | 同上 |
| 20 | `POST /api/v1/generate/image2videofl2va` | 在用 | ✅ | `generate.ts:681,704` `video_generate` / `video_composite`(2 图) | ✅ `aspect/megapixels/duration/image1/image2` 与文档一致 |
| 21 | `POST /api/v1/generate/image2videoref2va` | 在用 | ✅ | `generate.ts:726` `video_composite`(≥3 图，最多 6) | ✅ `image1–image6` 映射正确 |

> 注：`compose_video` 工具是 Host 侧 ffmpeg 拼接，**不走 Drama 端点**，使用正确，无需 api.md 条目。

---

## 二、使用正确性细节（已集成的 11 个，逐项核对请求/响应）

- **uploadimage**：`form.append('file', …)` 字段名正确；响应解析 `data.filename ?? data.name ?? data.data?.filename ?? data.data?.url`，实测 ComfyUI 的 `{name}` 分支命中 ✅
- **fl2va / ref2va**：`aspect`（仅 16:9/9:16）、`megapixels:0.4`、`duration`（钳制 ≤15s）、`image1`/`image2`(fl2va) 与 `image1–image6`(ref2va，`sliceToMax(filenames,6)`) 全部与文档字段对齐 ✅
- **style_transfer**：`image1=params.filename`(目标) / `image2=params.styleFilename`(风格)，与 api.md「image1 目标、image2 风格参考」一致 ✅
- **storyboard / splitegrid**：请求体字段与文档一致；splitegrid 解析 `images[]` 逐张下载 ✅
- **txt2image / image2image / promptenhance / image2vl / storyboard**：统一读 `full_url`（或 raw `output`），与文档响应示例吻合 ✅

**小瑕疵（非阻断）：**
- `image_generate` 在 `params.negativePrompt` 存在时发送 `negative_prompt` 字段，但 api.md 的 `txt2image`/`image2image` 请求表未收录该字段。建议确认后端支持后补进文档，或移除该字段。

---

## 三、需修订的不一致（共 3 项）

1. **api.md 仍把 3 个视频端点列为"在用"** — `image2videomsr` / `image2videomkr` / `image2videomkrgrid`。
   canvas-studio 从未集成（config 无键、无调用点），且先前决策已"收敛为 fl2va+ref2va"。
   应改为与 `upload` 同款处理：`~~…~~ ❌ 未集成` + 说明收敛原因。**这是文档错误，会误导后人照着调用坏端点。**

2. **config.ts 有 2 个孤儿端点键** — `txt2imageanime`、`inpaint`。
   声明了但无工具、无调用点（全目录仅出现在 config 与编译产物）。若近期不开发对应工具，应删除，避免误以为已可用。

3. **api.md 有 5 个端点 canvas-studio 无工具暴露** — `image2character` / `image2ipastyletransfer` / `image2360hdri` / `txt2imageanime` / `image2inpaint`。
   属于"后端能力在、工具未暴露"的 scope gap，不是 bug。需确认是有意暂不暴露，还是在 api.md 加注「canvas-studio 当前未暴露」。

---

## 四、核查方法

- 端点清单来自 `api.md` v0.2.1（21 个，含 1 个已移除 `upload` 不含在内）。
- 集成核对：`src/config.ts`（端点表）→ `src/generate.ts`（请求构造+响应解析）→ `src/host-tools.ts`（工具→端点映射）。
- 孤儿端点判定：在 `src/`、`lib/`、`tests/` 全量 `grep`，仅在 `config.ts`+`lib/config.js` 出现即判定为无调用点。
- 后端可达性未在线复测（上午压测后 `117.50.108.73:8082` 仍未恢复），故响应解析正确性基于代码与 api.md 字段对账，未做新一轮实调。
