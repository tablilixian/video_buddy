# DramaServer 业务 API 对接文档（canvas-studio 视角）

> **版本:** 1.0.0（迁移 B1–B4 落地，2026-11-22）
> **背景:** 生成后端从旧 Drama Backend（`http://117.50.108.73:8082`，`/api/v1/generate/*` 同步单任务）
> 整体迁移到 **DramaServer 业务 API**（`businessApiBase` 默认 `http://117.50.108.73`，`/v1/*` 全异步）。
> 旧端口已彻底废弃（拍板 ①），旧契约全文存档于 [api-legacy-8082.md](./api-legacy-8082.md)（仅历史参考）。
> 后端接口的**权威定义**在后台发放的《DramaServer 业务 API》api(12).md —— 本仓留档
> [api-probe/generation-migration-20261122/dramaserver-api-12-reference.md](./api-probe/generation-migration-20261122/dramaserver-api-12-reference.md)；
> 目录实测与字段形状见 [探测报告](./api-probe/generation-migration-20261122/report.md)；
> 迁移方案与拍板见 [DramaServer-生成面迁移方案-20261122.md](./plans/DramaServer-生成面迁移方案-20261122.md)。

## 1. 基址与鉴权

- **基址**：设置项 `businessApiBase`（默认 `http://117.50.108.73`）。生成、素材上传、报价、
  管理面（auth/sync · models · credits · billing）与 LLM 网关（`/v1/llm`）**同源**。
- **鉴权**：全部 `/v1/*` 请求带 `Authorization: Bearer <Supabase access token>`。渲染层持有会话
  （supabase-js PKCE），Host 被动缓存、每请求现取；401 → CS-AUTH-001（客户端静默刷新重推 → 弹登录窗）。
  **例外**：素材直传 `PUT <upload_url>` 只带 presign 返回的 headers，**不带任何鉴权头**（对象存储签名）。
- **无会话 fail-open 收窄**：生成/上传在鉴权开关开启时闸口拦截（CS-AUTH-001，零网络）；
  开关关闭（本地/测试态）仍发请求（token 置空），由服务端 401 裁决再归一 CS-AUTH-001。

## 2. 工具 → operation 映射（模型 code 均为目录实测）

| 工具（agent 面） | 模型 code | operation | 说明 |
| --- | --- | --- | --- |
| `image_generate` 纯文生 | `image.krea2` | `txt2image` | 无文字判据命中时 |
| `image_generate` / `image_generate_withtxt` 含文字 | `image.qwen-image-2.1` | `txt2image` | 引号文字判据（R-P1-03）自动改道 |
| `image_generate` 带参考 1-4 | `image.qwen-image-2.1` | `image2image` | inputs[] image ×1-4（ordinal 1..4） |
| `character_generate` / `character_sheet` | `image.krea2` | `image2character` | 恰 1 张参考、无 prompt |
| `image2vl` | `image.qwen3-vl` | `image2vl` | 文本输出内联快照（不调 content） |
| `video2vl` | `video.qwen3-vl` | `video2vl` | 同上 |
| `asr2txt` | `audio.fast-whisper` | `asr2txt` | **不传 input**；role 必须与素材 MIME 一致 |
| `music_generation` | `audio.yue2` | `txt2audio` | input: prompt/lyrics/duration |
| `tts_voiceover` | `audio.voxcpm2` | `txt2speech` | input: prompt/system_prompt；可选 audio ×1 |
| `video_generate` / `video_composite` | `video.minimax_h3` | `image2videofl2va` / `image2videoref2va` | fl2va ordinal 1=首帧 2=尾帧；ref2va 图≤9+视≤3+音≤3（总≤15） |

**已下线**：`image_fix`（Boogu 改字）——新目录无承载模型（拍板 ①），文字出错走 `image_generate_withtxt` 重出；
`generate_audio` 字段被新 API 拒收（探测报告 §3，待反馈后台），显式传参回 warning 不发送。

## 3. 请求契约（`POST /v1/generations`，202）

```json
{
  "model": "image.qwen-image-2.1",
  "operation": "image2image",
  "input": { "prompt": "…", "width": 1280, "height": 720 },
  "inputs": [{ "asset_id": "…", "role": "image", "ordinal": 1 }]
}
```

- **Idempotency-Key 必填**（1-200 可打印 ASCII）：台账 intent **先于 POST** 落盘；网络重试复用原
  key+body；参数/素材变化必须换新 key；**409 conflict 不自动换键**。
- `X-Client-Run-ID` 可选（排障关联）。
- **未知字段一律拒收**（服务端 400）——本地组装层按 operation 白名单裁剪
  （`src/contracts/generation.ts` 的 `OPERATION_INPUT_FIELDS`）。
- `asr2txt` 不传 `input` 键。视频 operation 只收 `prompt/aspect/megapixels/duration`。
- 图片 `width/height` 1..8192（档位换算 `sizeForAspectRatio`）；`megapixels` 0.01..16；`duration` 1..60。

## 4. 素材上传三段式（`/v1/assets/*`）

1. `POST /v1/assets/presign`（type/filename/content_type/size_bytes）→ 201 `{asset, upload_url, headers}`；
2. `PUT <upload_url>` **只带 presign.headers**（签名 URL 自带鉴权）；
3. `POST /v1/assets/complete`（asset_id + SHA-256 小写 hex + size_bytes）→ `status:'ready'` 才可用。
   限流 30 次/分钟（429 → Retry-After 有界重试一次）；upload_url 出站校验（https/回环、无 userinfo）。

## 5. 轮询与产物下载

- `GET /v1/generations/{id}/poll?after_version=<version>&wait=25s`：**游标只认 `version`**；
  **终态只认 `terminal`**（finalizing/cancel_requested 继续轮）；瞬时错误（网络/429/5xx）
  500ms→12s 退避 + Retry-After 优先；4xx 即停。
- 打断/墙钟超时：**先 `POST /v1/generations/{id}/cancel` 再抛 CS-GEN-207 / CS-PROV-014**
  （新 API 可撤回在途任务，不留孤儿扣费）。
- 版本未推进时按 `poll_after_ms`（默认 500ms）步进——防 microtask 空转饿死事件循环。
- 产物：二进制输出经 `GET /v1/generations/{id}/content/{ordinal}` 流式下载（CR-010 限长）；
  **文本输出（image2vl/video2vl 的 `text`、asr2txt 的 `txt/txt_word/txt_segment`）内联快照，不调 content**。

## 6. 计费与并发

- **quote 硬闸（B4，拍板 ⑤）**：创建前 `POST /v1/generations/quote`（不建任务不冻结）；
  预估 > 可用余额 → CS-BILL-002 提交前拦截；quote 失败 fail-open；G1（余额≤0）保留为兜底；
  预估积分随 warnings 回流 agent。
- **并发宽度** = min(设置页 `maxParallel`，套餐 `concurrent_generations`)，**出厂默认 1**（拍板 ④）；
  套餐值未知时不钳制（硬限制在服务端 409）。语义 = 在途任务数（acquire 创建前 / release 终态）。
- 台账 `jobs.json` v2：`api:'business'` 记录带 intent（幂等重放凭据）与 version 游标；
  Host 重启恢复 = intent 占位重放创建 / 有 id 续轮询 → content 下载 → 共享结算。
  **v1 旧记录原样保留不处置**（拍板 ③）。

## 7. 错误码（本仓映射）

| 场景 | CS 码 |
| --- | --- |
| 素材 presign/直传/complete 失败 | CS-ASSET-001/002/003 |
| checksum 冲突（409）/ upload_url 不安全 | CS-ASSET-004 / CS-ASSET-005 |
| 余额不足预估（quote 硬闸） | CS-BILL-002 |
| 401（登录态） | CS-AUTH-001 |
| 生成失败/参数/幂等冲突 | CS-GEN-206（带 httpStatus 供参考自愈） |
| 打断 / 墙钟超时 | CS-GEN-207 / CS-PROV-014 |
| 网络层（fetch 抛错） | CS-NET-001 |

服务端稳定 `error.code`（not_found / conflict / gone / rate_limited / unauthenticated / unavailable）
按 ApiError 结构化透传，调用侧翻译——不解析文案。

## 8. 限流

- 创建 10 次/分钟/用户；presign+complete 30 次/分钟；其余 600 次/分钟。
- 429 → 遵守 `Retry-After`（引擎内退避 + 有界重试一次），持续失败有界退避 500ms→12s。
