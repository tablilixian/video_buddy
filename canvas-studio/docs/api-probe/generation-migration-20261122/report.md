# 生成面业务 API 迁移探针报告（2026-11-22）

> 目的：迁移方案 B3 开工前，用登录态实测 `/v1/models` 目录、quote 报价与 `generate_audio`
> 字段接受度（拍板 ①② 的实证输入）。方法：从桌面端渲染层分区 Local Storage 提取当前
> 会话 access token（不落盘不回显），对 `http://117.50.108.73`（businessApiBase）发只读请求。
> 产物：本目录 `models.json` / `credits-balance.json` / `generations-list.json` / `quote-*.json`。

## 1. 模型目录（GET /v1/models，全模态）

11 个模型，`available=true && entitled=true` 的 10 个（starter_monthly 套餐）：

| code | modality | capabilities.operations | 我方用途 |
| --- | --- | --- | --- |
| `image.krea2` | image | `["txt2image","image2character"]` | 纯文生图 + **角色四视图** |
| `image.qwen-image-2.1` | image | `["txt2image","image2image"]` | **文字渲染 + 图生图**（image2image 只有 Qwen 声明） |
| `image.qwen3-vl` | image | `["image2vl"]` | 图像理解 |
| `video.qwen3-vl` | video | `["video2vl"]` | 视频理解 |
| `video.minimax_h3` | video | `["image2videofl2va","image2videoref2va"]` | 视频（fl2va/ref2va） |
| `audio.fast-whisper` | audio | `["asr2txt"]` | ASR |
| `audio.voxcpm2` | audio | `["txt2speech"]` | 语音合成 |
| `audio.yue2` | audio | `["txt2audio"]` | 文生音乐 |
| `agnes-flash` / `deepseek-flash` | text | 无 operations 声明 | 走 /v1/llm 网关（modality=text），不进生成矩阵 |
| `image.nano_banana.pro` | image | 无 operations 声明 | 按纪律不可提交（未声明 operation） |

**模型路由定案（B3 的 `MODEL_ROUTE_TABLE` 换血）**：
- 纯文生图（无文字）→ `image.krea2` @ `txt2image`
- 文字渲染（引号文字判据命中）→ `image.qwen-image-2.1` @ `txt2image`
- 图生图（带 1-4 参考）→ `image.qwen-image-2.1` @ `image2image`（与旧「图生图维持 Qwen」一致，正好同模型）
- 角色四视图 → `image.krea2` @ `image2character`
- 理解/ASR/音乐/语音/视频 → 各取唯一声明该 operation 的模型 code（表如上）

## 2. quote 报价抽样（POST /v1/generations/quote，不建任务不冻结）

| 请求 | 响应 |
| --- | --- |
| txt2image · 1280×720 | `{"estimated_credits": 18.432}`（与 api(12).md §3.7 示例同值，公式吻合） |
| image2videofl2va · 16:9 · 0.4MP · 5s | `{"estimated_credits": 30}` |
| image2videofl2va · **1:1** · 0.4MP · 5s | `{"estimated_credits": 30}` —— **1:1 被报价层正常接受**（拍板③背景：1:1 官方支持，与 16:9 同价） |

## 3. `generate_audio` 字段试探（拍板②的实证）

```json
POST /v1/generations/quote
{ "model": "video.minimax_h3", "operation": "image2videofl2va",
  "input": { "prompt": "probe", "aspect": "16:9", "megapixels": 0.4, "duration": 5, "generate_audio": true } }

→ HTTP 400 {"error": {"code": "invalid_argument", "message": "request body is invalid"}}
```

**结论：`generate_audio` 被新 API 拒收（未知字段校验生效）。** 代码侧处置（拍板②已定）：新链路
不发送该字段；`video_generate` 的 `generateAudio` 参数保留但回「当前后台版本不支持音轨开关」
warning。**请把本节反馈后台**：H3 原生音轨开关在新业务 API 无对应字段，若后台后续支持，
需在 input 白名单里放开（届时我方摘掉 warning 即可恢复）。

## 4. 其余只读探针

- `GET /v1/credits/balance` → 200，余额 976.1001 / frozen 0（topup 批次）。
- `GET /v1/generations?limit=1` → 200，`{"generations": []}`（列表路由可用）。
- entitlement：`{"plan_code":"starter_monthly","features":{"concurrent_generations":2}}`
  → 拍板④落地值：队列宽度出厂 = min(maxParallel(默认 1), 2) = **1**。

## 5. 拍板①收口：image_fix（Boogu 改字）下线

目录里**没有** boogu/fix 类模型，也没有能承载「只改文字不动画面」特化语义的 operation
（image2image 只有 Qwen 图生图，是整图重生成不是文字修复）。按拍板「不能承载则直接下线，
老端口彻底废弃」：B3 删除 `image_fix` 工具、CV-212 自动修复链、`MODEL_ROUTE_TABLE.textFix`；
文字出错的替代路径 = `image_generate_withtxt`（Qwen 文字渲染，逐字正确）重出。

## 6. B3 前置条件状态

- [x] 模型 code 定案（§1 表）
- [x] concurrent_generations 实值 = 2
- [x] generate_audio 结论（§3）
- [x] image_fix 结论（§5）
- [ ] 端到端 roundtrip（创建→轮询→content 下载）——B3 落码后随真机验收清单（方案 §10.2+）执行
