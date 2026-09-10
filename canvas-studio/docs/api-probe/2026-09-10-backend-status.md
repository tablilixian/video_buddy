# Drama Backend 接口现状（2026-09-10 实测）

> 数据来源：一次真实生产会话（`session.jsonl`，71 次工具调用）+ 两轮串行主动探测（21+18 个用例）。
> 生成工具：`scripts/analyze-session.mjs`（离线画像）、`scripts/probe-api-contract.mjs`（在线探测）。
> 后端：`http://117.50.108.73:8082`，单任务同步。

## 一句话结论

**纯文本链路全通，带文件的链路全挂。** 当前（9/10 晚）后端所有「以文件名为入参」的端点
（`image2image` / `image2vl` / `image2character` / `image2videofl2va`）**一律 500**，
与文件名是否有效无关；去掉文件参数后同一端点立刻 200。同时插件侧有两个本地 bug
（`music_generation` / `compose_video` 的 output schema）让 BGM 与成片 100% 失败——
这部分**不是**后端的锅。

---

## 一、必填性与参数校验（可直接照抄进客户端）

契约来自 `GET /openapi.json`（后端自述，唯一权威），行为已实测验证。

| 端点 | 必填 | 可选（默认值） |
| --- | --- | --- |
| `txt2image` / `txt2imageanime` | **prompt** | width=1024, height=768 |
| `image2image` | **prompt** | width, height, image1/2/3="" |
| `image2character` | （无） | image="" |
| `image2vl` | **system_prompt**, **prompt** | image="" |
| `image2promptenhance` | **prompt** | （无） |
| `image2videofl2va` | **prompt** | aspect="16:9", megapixels=0.4, duration=5, image1/2="" |
| `image2videoref2va` | **prompt** | aspect, megapixels, duration, image1–9, video1–3, audio1–3 |
| `txt2audio` | **caption_prompt**, **lyrics_prompt** | duration=30, bpm=128, keyscale, language, timesignature |
| `image2styletransfer` / `image2360hdri` / `image2splitegrid` | （无） | 见 openapi |

**校验行为（实测，全端点一致）**

| 输入错误 | HTTP | 响应形态 | 客户端该怎么做 |
| --- | --- | --- | --- |
| 缺必填字段 | **422** | `{"detail":[{"type":"missing","loc":["body","prompt"],"msg":"Field required"}]}` | 可回显给用户，字段名精确可定位 |
| 类型错（int 传字符串、string 传数字、float 传字符串） | **422** | `{"type":"int_parsing" / "string_type" / "float_parsing"}` | 可回显 |
| 业务错误（文件不存在 / 文件读不了 / 生成中崩） | **500** | `Internal Server Error`，**无任何原因** | 无法从响应推断，只能靠上游保证 + 重试策略 |

> **最重要的一条**：`422` = 入参问题（可信、可修复、可回显）；`500` = 后端问题（无信息）。
> 所以「参数格式错误」这类问题**不会**表现为 500——反过来说，看到 500 就别再查参数格式了，
> 要么换链路，要么重试。

**耗时参考（校验路径，几乎零成本）**：422 响应 25–70ms；`/openapi.json` 106ms；上传 55–64ms。

---

## 二、端点可用性矩阵（2026-09-10 19:05–20:20，三轮复测）

| 端点 | 纯文本（不带文件） | 带真实上传句柄 | 带幽灵文件名 | 判定 |
| --- | --- | --- | --- | --- |
| `image2promptenhance` | 200 / 9.5s | — | — | ✅ 可用 |
| `txt2image` | 200 / 16.3s | — | — | ✅ 可用 |
| `upload` | — | 200 / 60ms | — | ✅ 可用（但不落可消费位置，见下） |
| `image2image` | **200 / 33.4s** | 500 ×3（~1.2s） | 500 ×3（~0.06s） | ❌ 带文件不可用 |
| `image2vl` | **200 / 12.6–16.6s** | 500 ×3（~0.1s） | 500 ×3（~0.06s） | ❌ 带文件不可用 |
| `image2character` | **200 / 72.9s** | 500（1.2s） | 500（0.06s） | ❌ 带文件不可用 |
| `image2videofl2va` | **200 / 151.7s（duration=5）** | 500（1.3s） | 500（0.06s） | ❌ 首帧图生视频不可用 |
| `txt2audio` | 未实测（会话里被本地 schema 拦在最后一步） | — | — | ⚠️ 待验 |

**两个关键细节**

1. **真实句柄 500 要 1.2s，幽灵名 500 只要 0.06s。** 说明上传的文件后端**找得到**
   （走了更远才崩），崩在读取/解码环节；而幽灵名在入口就被拒。所以这不是
   「文件名拼错」，是**文件消费链路坏了**——别再在文件名唯一化上找原因。
2. **`image2vl` 不传 image 也会返回图片描述。** 两次独立探测都描述了「一个穿古装的中国男子」，
   而我们只上传过 1×1 红点 PNG → 后端/ComfyUI 复用了**上一次请求的图片输入**。
   即：这个后端有跨请求隐式状态，**VL 结果不可信**，修好文件链路后也要独立复验。

---

## 三、排队与产能（单任务）

实测：并发 2 个 `image2promptenhance` → A **9.4s**、B **18.7s**、墙钟 **18.7s**。
B 的耗时 ≈ A 的执行 + 自己的执行 → **确认串行排队**（不是并发，也不是拒单）。

推论：

- 并发请求**只会变慢**，不会加速；客户端应串行提交，别指望并发提吞吐。
- 探测/压测必须串行，否则测到的是排队时间。
- 生产会话实测：后端占用 60.4min / 会话墙钟 79min（占用率 76%），其中
  `video_generate` 9 个镜次占 43min——**视频是唯一瓶颈**。

**耗时基线（独占后端时）**

| 端点 | 耗时 |
| --- | --- |
| promptenhance | 9.5s（注意：文档写的 1.23s 已过时，慢了 8 倍） |
| txt2image | 16.3s |
| image2image（无图） | 33.4s |
| image2vl（无图） | 12.6–16.6s |
| image2character（无图） | 72.9s |
| fl2va duration=5（无图） | 151.7s |
| fl2va duration=8–12（会话期，含负载） | 264–403s |

排期公式：**镜数 × p95（≈340s）**，9 镜 ≈ 50min。

---

## 四、插件侧 P0（与后端无关，但当前 100% 失败）

| 工具 | 现象 | 根因 | 修法 |
| --- | --- | --- | --- |
| `music_generation` | 4/4 失败，耗时 26–64s（说明后端真生成了） | 工具 output schema `additionalProperties:false` 漏了 `declaredDuration` | `src/host-tools.ts` 的 `resultSchema` 补字段 |
| `compose_video` | 2/2 失败，耗时 7.5s（ffmpeg 真合成了） | 同上，漏了 `audioComposition` | 同上 |

> 这两处的产物**已经生成**却在返回给模型前被 schema 校验丢弃，是最亏的一类 bug：
> 后端时间照花，用户什么都拿不到。修 schema 即刻恢复，无需动后端。

**次要问题**

- `qc_shot`（image2vl）即便后端修好，也受上述「跨请求图片缓存」影响，结果需独立复验。
- 本地预检拦截（H3-Context-IR 句式）2 次，属预期行为（零后端消耗），但应把规则写进工具描述，减少空转。

---

## 五、对 canvas-studio 的直接影响

依赖「文件入参」的三条能力当前**全部不可用**：

1. **一致性资产卡**（`character_sheet` → image2character 带 image）
2. **首帧图生视频 / 多参考视频**（`video_generate` / `video_composite` 带 filename）
3. **自动 QC**（`qc_shot` → image2vl 带 image）

会话里的 agent 在撞了 10 次墙后自行退回「纯文生图 + 纯文生视频」，最终 9 镜全部出片成功
（p50 322.9s）——**这条路是当前唯一可靠路径**，建议在文档/工具描述里显式标注降级策略，
而不是让 agent 每次重试 10 次才发现。

建议动作：

- [ ] 修 `resultSchema`（P0，半小时）
- [ ] `docs/api.md` 顶部加「2026-09-10 状态横幅：带文件端点全 500，走纯文本链路」
- [ ] 工具层对「带文件参数」的请求做**前置降级**：文件链路失败 N 次后自动转纯文本并提示，
      而不是让模型盲重试（本次会话为此浪费了 10 次调用、约 3 分钟）
- [ ] 后端恢复后重跑 `scripts/probe-api-contract.mjs` 复验，产物直接覆盖本文档

---

## 六、复现命令

```bash
cd canvas-studio
# 1. 离线画像：任意会话 jsonl → 接口画像 + 甘特时间线
node scripts/analyze-session.mjs "<session.jsonl>" --out docs/api-probe/session-<date>

# 2. 在线探测：契约 + 必填性 + 文件句柄 + 排队行为（严格串行）
node scripts/probe-api-contract.mjs --repeat 3 --cooldown 1500 --out docs/api-probe/contract-<date>
node scripts/probe-api-contract.mjs --probe-queue                 # 只验排队行为
node scripts/probe-api-contract.mjs --suite full --only image2videofl2va --repeat 2

# 注意：本机 Bash 沙箱会拦截 117.50.108.73:8082，需在沙箱外运行；且要挑后端空闲时段。
```
