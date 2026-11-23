# DramaServer 生成面换代探测报告（2026-11-23）

## 背景

后台更新了 api(12).md 与 generation-client-api.md：把产物下载从旧
`GET /v1/generations/{id}/content/{ordinal}` 换成 `GET /v1/generations/{id}/download/{ordinal}`
取票 → Host 直连短期 Blob/CDN 签名地址，并新增 `result_status` 状态模型。
本目录留档两份后端原文（`dramaserver-api-12-reference.md` / `generation-client-api.md`）；
前端落地见 `docs/api.md` v1.1.0 与 `src/contracts/generation.ts`。

## 与 2026-11-22 文档逐行 diff 的实质变化

| # | 变化 | 客户端影响 |
| --- | --- | --- |
| 1 | 快照新增 `result_status: archiving/ready/failed/expired`，`succeeded` 只代表生成+结算 | 终态不再等于可下载 |
| 2 | `/poll` 在 `succeeded + archiving` 时继续等待 | `followGeneration` 退出条件必须放宽 |
| 3 | 新 `/download/{ordinal}`：200 票据（url/headers/expires_at/size_bytes/mime_type/checksum_sha256）、409 `result_not_ready` | 下载入口整条换代；签名 URL 10 分钟、no-store、401/403 重签一次 |
| 4 | `outputs[]` 增 `download_url`/`size_bytes`/`checksum_sha256`；`/content` 标旧客户端兼容 | 新链路不回退 content |
| 5 | 终态处理、完整时序图、Desktop 验收清单更新 | 失败/过期需独立稳定文案且不自动重生成 |

## 本仓落点

| 层 | 文件 | 改动 |
| --- | --- | --- |
| 契约 | `src/contracts/generation.ts` | `result_status` / `download_url` / `size_bytes` / `checksum_sha256`、票据解析与 URL 安全、轮询退出纯函数 |
| 客户端 | `src/drama-management.ts` | `generationDownload()` / `openGenerationDownload()`；`openGenerationContent` 标 deprecated，不回退 |
| 引擎 | `src/generation-client.ts` | 归档期继续轮询、票据下载 + 409 回轮询、字节强校验、结果不可用独立错误 |
| 调用 | `src/generate.ts` | 图像/音频/视频下载点按 `ready + download_url` 出件，保留 PNG/MP4 结构校验与重试 |
| 错误 | `src/errors/catalog.ts` | CS-GEN-210/211；CS-NET-012 文案与双链路对齐 |
| 测试 | `tests/generation-contract.test.mjs` / `tests/generation-client.test.mjs` / `tests/helpers/generation-stub.mjs` 等 | 状态机、票据、重签、URL 护栏、409 回轮询、完整性、无 content 回退 |

## 本仓决策（沿用 2026-11-22 拍板）

- 不动 `/business/v1` 代理架构，Host 直接调 `/v1/*`（参考项目 reelsbuddy-desktop 只作为实现细节来源）。
- 存量快照没有 `result_status`/`download_url`：按「只修产生路径、不动历史数据」不回填；票据 409 回轮询，不回退 content。
- `failed` / `expired` 用独立错误码 CS-GEN-210/211，不自动重生成（避免二次扣费）。
- 签名票据的 `size_bytes` / `checksum_sha256` 做下载后强校验，保留 PNG/MP4 结构校验作为第二道闸（CV-468 截断事故兜底）。
- URL 安全口径与 presign 上传一致：仅 https 或回环 http、禁 userinfo，签名头原样透传、`redirect:'error'`。

## 现行时序（Desktop）

```text
Client ──create──▶ Host ──POST /v1/generations──▶ DramaServer
Client ◀─202──── Host ◀────────snapshot────────── DramaServer
  loop 直到 !terminal || (succeeded && result_status=archiving)
    Host ──GET /poll?after_version=<version>&wait=25s──▶ DramaServer
    Host ◀──────────── snapshot(version+1) ──────────── DramaServer
  end
  result_status=failed/expired ⇒ CS-GEN-210/211，停止（不重生成）
  result_status=ready ⇒ 选 outputs[].download_url
Host ──GET /v1/generations/{id}/download/{ordinal}──▶ DramaServer
Host ◀── {url, headers, expires_at, size_bytes, checksum_sha256} ──
Host ──GET <signed Blob/CDN URL>（原样带 headers, redirect:error）──▶ Blob/CDN
Host ◀── 字节流 ──，按 size/checksum + PNG(IEND)/MP4(moov) 校验
Client ◀─ object URL / 落盘资产── Host（坏件重试 ×2 后 CS-NET-012，不落盘）
```

## 验收要点（真机）

1. 长轮询：`succeeded` 且 `result_status=archiving` 时继续等，落到 `ready` 才出件；`failed`/`expired` 立即稳定报错且不重新生成。
2. 下载：Host 日志只出现 `/download/{ordinal}` + 签名 Blob/CDN URL，不出现 `/content/`；401/403 重签一次。
3. 完整性：票据 size/checksum 不符或 PNG 缺 IEND / MP4 缺 moov 时重试 ×2 后 CS-NET-012，坏件不落画布。
4. 回归：图像、音乐/配音、视频、VLM 文本、ASR 内联输出各自的既有链路不串味。
