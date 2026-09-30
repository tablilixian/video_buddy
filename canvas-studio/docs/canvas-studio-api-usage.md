# Canvas Studio × Drama Backend 接口使用要点（薄索引）

> **本文已收缩（2026-09-30）**。原「接线状态 + 使用方式」活文档的大片内容已失效或并入权威文档：端点教学（含已删除的 msr / mkr / mkrgrid / storyboard / inpaint / style_transfer 工具）、「drama.ts 固定发 0.4 MP」等论断均已过时。收缩前的完整历史版本见 git（本文件上一次全量提交）。
>
> **现在的分工**：
> - 接口契约（请求/响应/端点清单）的唯一权威 → **[api.md](./api.md)**（v0.3.1，2026-09-24 修订，已含后端 0.5.0 异步视频任务 / `video2vl` / `image2fix` / `txt2audio`）。
> - Host 工具层（24 个真实工具 + 2 占位）与端点、参数、返回的对应关系 → **[canvas-studio-tools.md](./canvas-studio-tools.md)**（有测试守卫强制对账）。
> - 超时 / 队列 / 异步任务的调度语义 → **[../../docs/canvas-studio-task-timeout-spec.md](../../docs/canvas-studio-task-timeout-spec.md)**。
>
> 本文只保留**散落在以上文档之外、仍然有效**的画布侧调用纪律。

## 1. 调用链路（Host 侧，规避浏览器 CORS）

```
工具(host-tools.ts)
  ├─ 同步接口（image / text / video2vl / 上传 / 探活）→ generate.ts dramaPost/callDramaRaw → Drama Backend（同步 HTTP）
  └─ 视频生成（video_generate / video_composite）→ providers/drama.ts 三段式：submit（202 + job_id，60s 短档）→ 30s 间隔轮询 /api/v1/jobs/{id} → executor 整体墙钟 2400s 兜底
→ 产物下载落盘 ~/.videobuddy/canvas-studio/projects/<id>/assets/<uuid>.<ext>
→ webServer /canvas-studio/assets/<projectId>/<file> 托管给画布
```

- 基址：`config.ts → DRAMA_API_BASE`，env `CANVAS_STUDIO_DRAMA_API_BASE` 覆盖，默认 `http://117.50.108.73:8082`。
- 鉴权：`DRAMA_API_KEY` 未随任何请求发送；实测后端当前无鉴权。是否挂请求头仍待后端确认（CR-012）。
- 生成类 Drama 调用（含视频 submit）都排宿主单槽队列（CV-220）：并发只排队、墙钟不变，排队不计入客户端占位截止。详见超时规格 §1/§3.1。

## 2. 上传标准流程（CV-137，一切「以文件名为入参」的接口的前置）

```
本地文件 ──POST /api/v1/generate/upload（form-data: file）──▶ {"name":"xxx.png"}
把 name 填进下游参数 ◀──────────────────────────────────────────┘
```

- **唯一端点** `POST /api/v1/generate/upload`，图片/视频/音频通用；旧 `uploadimage` 已下线（404），勿改回去。
- **响应取 `name` 字段**（不是 `filename`）；本仓已兼容 `{name}` / `{filename}` / `{data:{filename}}` / `{data:{url}}` 四种形态。
- 字段名必须是 `file`（错写 422）；文件名唯一且只含 `[\w.\-]`，本仓统一 `ref-<8位uuid>.<ext>`。
- 耗时随体积线性（≈9.6ms/KB），无 1MB 悬崖（旧「溢写阈值」说法已证伪）；大文件仍应压缩（3MB ≈ 30s）。
- `/view?filename=` **只对生成产物有效**，对上传文件回读 500——别拿它校验上传。

## 3. 画幅与画质档位（`config.ts`）

| 档位 | OUTPUT_SIZE（16:9） | MEGAPIXELS（视频端点） |
| --- | --- | --- |
| 480p | 864×480 | 0.4 |
| 736p（默认） | 1280×736 | 0.9 |
| 2k | 1920×1088 | 2.0 |

- `drama.ts` 按当前档位发 `MEGAPIXELS_BY_RESOLUTION[resolution]`（`drama.ts:171`），**不再写死 0.4**（CV-190a）。
- 图像类端点收 `width/height` 像素（`sizeForAspectRatio`：9:16 反宽高、1:1 恒 1024×1024）；fl2va/ref2va 收 `aspect`（"16:9"/"9:16"）+ `megapixels`，两种风格勿混传。
- 一切图片输入只认 Drama 服务器文件名，不认 URL；产物名（`MiniMax_H3_*` / `boogu_*` / `krea2_*` 等）**不可直接入参**（500 快失败），走 `@ref` 引用或 `upload_image` 换句柄（CV-155 纪律；video2vl / image_fix 工具已自带换名自愈）。

## 4. image2fix 文字修复纪律（CV-202/218/212）

修复 prompt **只写「文字规格段」**：每段文字 + 位置/字体/字号/颜色/排版关系，末段加「逐字准确还原、不得替换增删」约束；**删掉画幅/材质/光线/配色/气质等美术描述**。
⚠️ 实测反证：只喂字符清单（CV-212 自动模板形态）会修错字并凭空多字；喂完整文字规格段则全部修正、排版零漂移。取证：[api-probe/image2fix-20260920-text-spec](./api-probe/image2fix-20260920-text-spec/report.md)（对照 [image2fix-20260918](./api-probe/image2fix-20260918/report.md)）。

## 5. health 与队列深度语义（CV-219）

`GET /api/v1/health` 的 `queue_task_count` **含正在执行的那个**（实测序列 0/1/2/5/回落 0）：判「有活在跑」用 `> 0`，判「空闲」用 `=== 0`，**不要写 `<= 1`**。已落 `src/generate.ts#queueDepthOf`。
另：**health 返 4xx/5xx ≠ 后端不可达**——「服务是否活着」只看有没有拿到 HTTP 响应；健康接口坏掉只降低可观测性，不拦业务请求（`ensureDramaReachable` 语义）。

## 6. 仍开放的待后端确认（原 §5 存留项）

1. `deduction` 端点 404：是否废弃/迁移。
2. 鉴权规划：是否引入 API key 校验（决定 `DRAMA_API_KEY` 发送或移除；CR-012）。
3. image2fix 对「本来没有文字」的图会不会凭空加字？决定 CV-212 自动模板的「误触发收紧」是可选优化还是必须项。
4. image2fix 修复 prompt 的长度上限 / 最佳区间（真实正例 ≈ 400 字，CV-212 模板 ≈ 60 字）。
5. 根路径 `GET /` 返回 500 是否符合预期。
6. 视频/音频 roadmap：参考视频条件生成、TTS/BGM 端点是否规划。

---

*变更记录（收缩前）随原文见 git 历史；主要节点：2026-08-24 初版 → 2026-08-25 视频收敛 fl2va/ref2va → 2026-09-10 CV-137 上传端点反转 → 2026-09-16 CV-191 Krea2 全线 + 参考图 9 张 → 2026-09-18/20/21 CV-202/218/219/220 → 2026-09-24 api.md 收录 0.5.0 异步任务。此后接线状态一律以 api.md 修订记录为准。*
