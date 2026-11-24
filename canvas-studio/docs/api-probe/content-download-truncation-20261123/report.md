# Content 端点下载截断探针报告（2026-11-23）

> 起因：2026-11-23 创作会话中，3 个 H3 视频产物有 3 个在下载后缺 `moov`、无法解码；
> 同会话 1080p 出图连续两次「产物下载不完整」，降到 720p 即成功。本探针只读实测
> `/v1/generations/{id}/content/{ordinal}`，不建任务、不扣积分。
> 脚本：`scripts/probe-download-limits.mjs`（token 从渲染层 Local Storage 按 UTF-16LE
> 提取，仅存内存、只进 Authorization 头，不落盘不回显）。

## 0. 结论

**服务端问题，客户端修不了根。** content 端点以 ~55 KB/s 恒定限速传输，并在响应开始后
**约 31 秒硬断流**（HTTP 200 + chunked 正常收尾，不是报错）。两者相乘 ⇒ 单次响应上限
**约 1.7 MB**。任何大于 1.7 MB 的产物必然截断；1.36 MB 的产物完整。这不是 Node fetch
的锅——curl 对照完全同速、同截断点、同字节量级。

## 1. 实测数据

同一 token、同一时刻、Node fetch 与 curl 交叉验证（4 个 generation id，每 id 2 轮）：

| 产物 | 声明大小 | 实测实收 | 耗时 | 速度 | moov | 结果 |
| --- | --- | --- | --- | --- | --- | --- |
| 分镜1 `0fd345dc` | 2,474,836 | 1,747,692 / 1,701,028 | 31.8s / 31.0s | 53.7 / 53.6 KB/s | ❌ | 截断 |
| 分镜2 `5868a2e5` | 2,082,428 | 1,714,472 / 1,758,744 | 31.3s / 31.7s | 53.6 / 54.2 KB/s | ❌ | 截断 |
| 分镜3 `29a84c4a` | 1,353,743 | 1,363,338 / 1,363,338 | 24.1s / 24.1s | 55.2 KB/s | ✅ | 完整 |
| 重出镜1 `50cd97a6` | 2,629,528 | 1,761,200 / 1,743,556 | 31.7s / 35.1s | 54.3 / 48.5 KB/s | ❌ | 截断 |

curl 对照：`55,074 / 56,142 / 56,689 / 55,605 B/s`，耗时 `31.4 / 31.5 / 24.0 / 31.5s`，
截断产物 moov 全部缺失，完整产物 moov 存在。与 Node 一致。

进度采样（每 5 秒）：`5s:0.2MB → 10s:0.47MB → 15s:0.75MB → 20s:1.03MB → 25s:1.31MB → 31s:断`。
线性、恒速，没有先快后慢的拥塞特征。

响应头：`HTTP/1.1 200 OK`、`Content-Type: video/mp4`、`Transfer-Encoding: chunked`、
**无 `Content-Length`**、**无 `Accept-Ranges`**、`X-RateLimit-Limit: 600 / Remaining: 599`
（请求数配额，与本次无关）、`X-Request-Id`。

## 2. 区分「30 秒超时」还是「1.7MB 限量」

两个实验都指向**时间断流**：

1. **慢速读取实验**：客户端每次 `read()` 后 sleep 150ms，总耗时和实收字节几乎不变
   （31.8s / 1,775,096B vs 正常 31.6s / 1,760,424B）。客户端降速不会延长连接，说明
   断流由服务端时钟驱动。
2. **字节量不恒定、时间恒定**：实收在 1.70–1.76 MB 间波动（±3%），耗时稳定在 31–32s
   （±1.5s）。若是字节上限，实收应恒定而耗时应波动，实测正好相反。

`55 KB/s × 31 s ≈ 1.7 MB`，算术也对得上。

补充对照：`GET /v1/models`（6,795B JSON）耗时 2.71s（首字节延迟约 2.5s），同机
`8082 /api/v1/health`（36B）0.16s。业务 API 整条链路本身就慢，但只有 content 流式
响应触发 30 秒断流。

## 3. Range / 断点续传

`Range: bytes=0-1023` 返回 **HTTP 200 + 完整响应体**（1.78MB），没有 206、没有
`Content-Range`、`Accept-Ranges` 缺失。服务端**完全忽略 Range**。

⇒ **客户端重试无效**：每次重下都从 0 开始，31 秒后仍断在同一位置。会话里「重出前两镜」
的做法是错的——每次重出扣 72 积分，新产物 2.6MB 更容易截断。

## 4. 根因判定

| 层 | 判定 | 依据 |
| --- | --- | --- |
| 服务端 content serving | **根因** | 恒定 55KB/s + 31s 硬断流；curl 复现；无 Range；无 Content-Length |
| 客户端下载实现 | 非根因，但有次生缺陷 | Node 与 curl 数据一致；`readBodyLimited` 只读到正常 EOF，无异常可抛 |
| 网络链路 | 非主因 | 同机 8082 响应 0.16s；限速发生在业务 API 应用层（有 X-RateLimit 头） |

次生缺陷：`src/media-download.ts:70` 的 `mp4LooksIntact()` 是死代码，视频下载
（`src/generate.ts:1090` `downloadBusinessMedia()`）不做完整性校验，截断文件被当成功
落盘、job 记 `settled`、积分已扣。图片链路（`:1025-1038`）有 PNG 校验 + 重试，所以
图片至少会报错，视频却静默坏掉。

## 5. 解决方案

### 服务端（根治，必须做）

1. **查 content 端点的 ~30s 响应超时**：常见来源是网关 `proxy_read_timeout` /
   `proxy_send_timeout`、ASGI 服务器的响应时长上限、或流式生成器被外层 `wait_for(30)`
   包住。调到 ≥5 分钟。
2. **查 ~55KB/s 限速**：确认是带宽限制、令牌桶，还是流式写入每段固定 sleep。
   注意 `X-RateLimit-*` 是请求数配额（600/min），不是带宽，别查错方向。
3. **实现 Range**：返回 `206 + Content-Range + Accept-Ranges: bytes`，客户端才能分段
   下载/断点续传。这是让 512MB 上限可用的前提。
4. **返回 `Content-Length`**（或至少 `X-Content-Length`）：让客户端能在下载前判断体积、
   下载后校验字节数。

### 客户端（兜底，仍必须做）

1. 在 `downloadBusinessMedia()` 接上 `mp4LooksIntact()`，失败重试 ×2，仍失败抛
   `CS-NET-012`；对齐图片链路。**校验失败不得记 `settled`、不得算成功产出。**
2. 用户提示改成「产物下载被截断，请稍后重试并联系服务端」——不要再说「请直接重新
   生成」，重出要二次扣费且大概率再截断。
3. 服务端支持 Range 后，下载器改为分段拉取 + 逐段校验拼接；在那之前，客户端重试
   没有意义。
4. 对 >1.7MB 的图片（如 1080p PNG）同样加结构校验——本会话 1080p 出图两次失败
   就是同一阈值表现。

## 6. 复现

```bash
node canvas-studio/scripts/probe-download-limits.mjs --rounds 2 --timeout 90 --range --curl
# 可选 --ids <逗号分隔的 generation id>
```

需要先在桌面端登录（token 从渲染层分区 Local Storage 提取）。有效 token 过期后可重跑；
脚本不落盘 token。
