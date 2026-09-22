# 参考视频通道（`image2videoref2va` 的 `video1`–`video3`）取证报告

**日期**：2026-09-22 ｜ **后端**：`117.50.108.73:8082`（无鉴权、单任务串行）
**触发**：CV-226「参考视频接线」—— 接线前要确认后端接受什么形态的 `videoN` 入参。
**结论一句话**：**通道本来就在**（历史已有 200 实证）；本轮补齐的是「产物名 vs 上传句柄」这半条对照，并**复证「视频可作唯一输入」**。

---

## 一、先说历史：这个问题在 2026-09-10/11 已被回答过

`docs/api.md:658`（原始记录 `docs/api-probe/file-recheck-full/recheck.md`）：

> 上传 `tiny.png` / `tiny.mp4` / `tiny.mp3` → `image2videoref2va` 的 `image1` / `video1` / `audio1`
> → **200**，产出 `MiniMax_H3_00290_.mp4`（耗时 **127.1s**）→ **三类文件的句柄全部被消费**。

⇒ **`video1` 可入参、且能与图/音频同场** —— 早在三个月前就实证过了。

> ⚠️ **本轮的教训**：动手写探针前应先 Grep `docs/api-probe/`。本轮绕了一圈才发现这半条已有答案。好消息是补给的那半条（产物名被拒）确实是空白。

---

## 二、本次三个探针（串行，脚本 `/tmp/probe-video-ref.mjs` 与 `probe-video-ref3.mjs`）

| # | 入参形态 | 结果 | 判读 |
|---|---|---|---|
| ping | `{}` 空体 | `422` + `{"detail":[{"loc":["body","prompt"]}]}` | 后端可达；**本 agent shell 不拦该地址**（`probe-api-contract.mjs` 头部「沙箱会拦」的注释已过时） |
| 1 | `video1` = **生成产物名** `MiniMax_H3_ref2va_00020_.mp4`，**无图** | `500`，**0.1s** | **前置拒绝** —— 与 CV-155 对图片的结论同型：产物名不可入参 |
| 2 | `video1` = **上传句柄** `ref-probe-*.mp4`，**无图** | 跑满 **301.4s** 后 `fetch failed` | **未被前置拒绝** ⇒ 句柄被接受、且**视频可作唯一输入** |
| 3a | `image1` = 图句柄 + `video1` = 视频句柄 | 跑满 **301.9s** 后 `fetch failed` | 同上（图 + 视频并存被接受） |
| 3b | 同 3a，但注入长超时 dispatcher（900s） | 跑满 **900.1s** 被自己的 `AbortSignal` 掐断 | **仍未返回** —— 见下「未决项」 |

**关键判据**：探针 1 是 **0.1s 前置拒绝**，探针 2/3 是**跑满传输层上限才被掐** —— 两者差别只有 `filename` 形态，故「产物名不可入参 / 上传句柄可入参」成立。

### ⚠️ 301s 不是后端的错

`301.4s` / `301.9s` 恰好是 **undici 内置 `headersTimeout` / `bodyTimeout` 默认 300s** 先于 `AbortSignal` 触发（CV-133 同一个坑，见 `src/long-request.ts`）。产品代码在 `dramaPost` 里注入了 `longRequestDispatcher()`，**不受影响**；探针第一版没注入才被掐。

### ⚠️ 探针副产物：dispatcher 的 symbol 要等首次请求之后才存在

```
发请求前: undefined
ping status: 200
发请求后: [object Object] | ctor: Agent
```

`globalThis[Symbol.for('undici.globalDispatcher.1')]` 在**全新进程里发请求前是 `undefined`**。探针 3 第一版因此在开头就取不到 dispatcher、静默退回 300s。产品侧因探活请求垫在前面而可用，但这是**隐式时序依赖**，已写进 `src/long-request.ts` 的 JSDoc。

---

## 三、未决项：带参考视频的生成耗时

- 探针 3b 跑到 **900s（15 分钟）仍未返回**，无错误、无超时提示 —— 说明后端**在做事**（不是拒绝、不是立即失败）。
- 对照：历史那次（`tiny.*` 三个小文件）是 **127.1s** 返回 200。
- 差异可能在：① 素材体积（本图 2.6MB / 视频 1.65MB）② 后端当时的排队情况（**单任务串行**）③ 带参考视频的推理本身更慢。
- **本轮未能区分**，故**不写结论**。产品侧影响面有限（`DRAMA_TIMEOUT_MS.video` = 600s，超时会被如实报出而非误判），但若验收费时明显偏长，这是一个独立的排期项。

---

## 四、可直接复现的命令

```bash
# 探针 1：产物名 + 无图（预期 0.1s 500）
node /tmp/probe-video-ref.mjs --only 1

# 探针 2：上传本地视频拿句柄 + 无图
node /tmp/probe-video-ref.mjs --only 2

# 探针 3：上传图 + 视频，带长超时 dispatcher（注意：需先发一次请求再取 symbol）
node /tmp/probe-video-ref3.mjs
```

`DRAMA_API_BASE` 可覆盖后端地址。**后端是单任务串行** ⇒ 务必串行跑、避开用户使用时段。

---

## 五、本次取证带来的产品改动

| 结论 | 落到代码 |
|---|---|
| `video1`–`video3` 字段名 | `drama.ts` 落 `video${n}`（openapi 实证）；fal 侧字段名未经实测 ⇒ **明确 throw** |
| 视频可作唯一输入（与音频相反） | `video-reference.ts` **不收 `visualCount`**；而音频侧判定的 `visualCount` **必须含参考视频**（官方原文 at least one reference_image **or reference_video**） |
| 官方规格（≤3 段 / 单段 2–15s / 合计 ≤15s / MP4·MOV / ≤50MB / 跨模态 ≤12） | `video-reference.ts` + `validateH3ReferenceBudget`，发出前拦下 |
| **产物名不可入参** | 工具的 `videoRefs` description 写明（与图片 CV-155 同一纪律）；`isDramaProductName` 的形态盲区（`..._00011-audio.mp4`）**有意保持** —— 漏判由 `healReferenceFilename` 自愈兜底，**前提是本批把 `videoRefs` 纳入了自愈名字表** |
