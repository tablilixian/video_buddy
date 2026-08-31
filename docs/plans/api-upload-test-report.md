# Drama Backend 上传接口实测报告

**被测文档：** `docs/plans/api.md`（测试时版本 0.2.0，测试后修订为 0.2.1）
**被测接口：** `POST /api/v1/generate/uploadimage`、`POST /api/v1/generate/upload`
**测试时间：** 2026-08-31 14:39 – 14:52
**测试目标：** `http://117.50.108.73:8082`（WL-AI-Director 的 Vite dev 通过 `/drama-api` 代理到该地址，见 `vite.config.ts:14-17`）

---

## 结论速览

| 接口 | 文档描述是否准确 | 判定 | 处置（2026-08-31 已落盘） |
|---|---|---|---|
| `POST /api/v1/generate/uploadimage` | 请求准确，**响应示例完全错误** | ⚠️ 部分准确 | ✅ 保留，api.md 响应示例改为实测结构 |
| `POST /api/v1/generate/upload` | 端点存在但**任何调用方式均 500**，成功响应从未出现 | ❌ 不可用 | ❌ 从 api.md 可用接口清单**移除**，保留「已移除」说明条目 |

> **决策：** 上传能力只保留 `uploadimage` 一个接口。大文件不再依赖流式端点，改为客户端先压缩。

---

## 测试准备

连通性基线（测试开始时服务正常）：

```
GET /api/v1/health        -> 200 {"status":"ok"}          与文档一致
GET /api/v1/generate/uploadimage  (GET)  -> 未测到即服务中断
GET /                     -> 500 Internal Server Error    与文档不符（文档称返回 {"message":"dramabackend"}）
GET /openapi.json         -> 500 Internal Server Error    无法用 schema 佐证契约
```

测试素材：

| 文件 | 大小 | 说明 |
|---|---|---|
| `small.png` | 3,029 B | 32×32 噪点 PNG |
| `big.png` | 1,629,152 B | 2000×2000 噪点 PNG，用于验证 1MB 溢写 |

所有请求均加 `--noproxy '*'` 绕过本机 Privoxy（否则 localhost 与外网 IP 都会被代理拦截，返回 Privoxy 500 页面，易误判为接口故障）。

---

## 接口 1：`POST /api/v1/generate/uploadimage`

### 用例与结果

| # | 用例 | 期望（按文档） | 实际 | 判定 |
|---|---|---|---|---|
| 1 | form-data `file=@small.png` | `{"success":true,"filename":"..."}` | `200` `{"name":"small.png","subfolder":"","type":"input"}` | ❌ 响应结构不符 |
| 2 | form-data `file=@big.png`（1.6MB） | 同上 | `200` `{"name":"big.png","subfolder":"","type":"input"}`，**耗时 14.21 秒** | ❌ 结构不符；⚠️ 性能异常 |

### 准确的描述

- ✅ **请求方式**：form-data，不手工填 `Content-Type`（由客户端生成 boundary）— 准确
- ✅ **字段名 `file`** — 准确
- ✅ **必填** — 准确（FastAPI 会做参数校验）
- ❌ **响应示例错误**

实际返回的是 **ComfyUI `UploadImage` 节点的原生响应格式**，不是文档里那套自定义结构：

```json
{
  "name": "small.png",
  "subfolder": "",
  "type": "input"
}
```

差异对照：

| 文档声称 | 实际 |
|---|---|
| `success: boolean` | **不存在**该字段 |
| `filename: string` | 实际字段名为 **`name`** |
| — | 多出 `subfolder`（空字符串） |
| — | 多出 `type`（固定 `"input"`） |

**影响面核查（2026-08-31 完成）：** 任何按文档写 `resp.filename` 的调用方都会拿到 `undefined`。
已核查全部调用点，**无实际故障**：

| 调用方 | 取字段逻辑 | 结论 |
|---|---|---|
| `canvas-studio` `upload_image` | 兼容 `{filename}` / `{name}` / `{data:{filename}}` 三种形态（见 `docs/plans/canvas-studio-tools.md`） | ✅ 实测结构可直接消费，代码无需改 |
| `WL-AI-Director` `services/adapters/imageAdapter.ts:429` | 仅调用 `uploadimage`，未消费流式端点 | ✅ 不受影响 |
| `canvas-studio/src/config.ts` | 端点表只登记 `uploadimage` | ✅ 无流式端点引用 |

### 性能警告

1.6MB 图片上传耗时 **14.21 秒**，而 3KB 图片仅 0.095 秒。这个非线性劣化与文档中「Starlette 的 1MB 自动溢写限制」的描述吻合——超过 1MB 后走临时文件溢写路径。上传完成后服务失去响应（见下节），**大文件上传走此接口有稳定性风险**。

---

## 接口 2：`POST /api/v1/generate/upload`

### 用例与结果

| # | 请求方式 | 实际响应 | 判定 |
|---|---|---|---|
| 1 | `GET` | `405 {"detail":"Method Not Allowed"}` | 端点**已注册**，仅接受 POST |
| 2 | form-data `file=@small.png` | `500 Internal Server Error` | ❌ |
| 3 | form-data `file=@big.png`（1.6MB） | `500` | ❌ |
| 4 | form-data `image=@small.png` | `500` | ❌ |
| 5 | form-data `filename=@small.png` | `500` | ❌ |
| 6 | form-data `file=@small.png;type=image/png` | `500` | ❌ |
| 7 | raw body `Content-Type: application/octet-stream` | `500` | ❌ |
| 8 | raw body `Content-Type: image/png` | `500` | ❌ |
| 9 | 空 body | `500` | ❌ |
| 10 | `POST /api/v1/generate/upload/`（带尾斜杠） | `307` 重定向 | — |

### 判定

**不可用，已从文档移除。**

- 端点存在（GET 返回 405 而非 404），但 **POST 路径实现始终抛异常**。
- 穷举了 3 种 form 字段名 + 2 种 raw body 格式 + 空 body，无一成功，且**连参数校验都没走到**（空 body 也是 500 而非 422），说明异常发生在流读取的最开始阶段——**不是调用姿势问题，是端点本身坏了**。
- 文档声称的成功响应 `{"status":"success"}` **从未出现**。
- `/openapi.json` 也返回 500，无法从 schema 侧反查它期望的真实入参。

### 文档表述问题

> 采用 form-data 形式，直接发送文件流

这句话没有给出字段名，无法据此构造请求。即便端点日后修复，这段描述也应补上字段名说明。

---

## 服务中断说明

测试进行到「uploadimage 错误场景补测」阶段时，`117.50.108.73:8082` 开始拒绝 TCP 连接（`curl` exit 7 = Connection refused，非超时）。轮询约 5 分钟未恢复：

```
尝试间隔 3/6/9/12/15/18s  -> 全部 HTTP=000
等待 60s 后              -> HTTP=000
等待 90s 后 × 3          -> HTTP=000
等待 30s × 6             -> HTTP=000
```

时间线上紧接 1.6MB 文件上传（14.21s）之后，但不能排除服务端自身维护或重启。**已完成的用例不受影响**，均为服务正常期间取得的结果。

### 因中断未完成的补测

- `uploadimage` 缺少 `file` 字段时应返回 `422`（FastAPI 校验）— 未取得
- `uploadimage` 上传非图片文件（如 `.txt`）的响应 — 未取得
- `uploadimage` 使用 GET 方法应为 `405` — 未取得

---

## 文档修订（已落盘 2026-08-31）

| 文件 | 改动 |
|---|---|
| `docs/plans/api.md` | 版本 0.2.0 → **0.2.1**；`uploadimage` 响应示例改为实测 `{name, subfolder, type}` 并补响应字段表与性能说明；「流式文件上传」章节改为**「流式文件上传（已移除）」**，保留移除原因与实测证据；目录锚点同步 |
| `docs/plans/canvas-studio-api-usage.md` | §1 端点表第 9/10 行更正（uploadimage 响应结构；upload 标为 ❌ 停用）；§3.6 上传小节重写（取 `name`、禁用 upload、大文件改压缩）；§5 待确认清单第 2 条由「契约不明」改为「后端是否修复」；§6 追加五次修订记录 |
| `docs/plans/canvas-studio-phase2.md` | 待后端确认清单第 2 条同上更正 |
| `docs/plans/api-upload-test-report.md` | 本文件：结论加「处置」列，补影响面核查表，原「建议的文档修订」转为已落盘清单 |

**未改动：** `WL-AI-Director/docs/03-api-reference/api.md`（另一仓库，仍为 0.2.0 描述；若需同步请单独确认）。

---

## 待办

- [ ] 后端恢复后补做「因中断未完成的补测」三项（缺 `file` 应 422 / 非图片文件 / GET 应 405）
- [ ] 向后端确认 `/api/v1/generate/upload` 是否修复：若修复需同步给出入参契约、成功响应结构、下游如何取文件名
- [ ] 确认 `GET /` 与 `/openapi.json` 返回 500 是否为已知问题
- [x] 修订 `docs/plans/api.md`（2026-08-31 已完成，版本 0.2.1）
- [x] 同步 `canvas-studio-api-usage.md` / `canvas-studio-phase2.md`（2026-08-31 已完成）
