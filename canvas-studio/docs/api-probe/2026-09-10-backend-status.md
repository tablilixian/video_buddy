# Drama Backend 接口现状（2026-09-10 实测）

> ⚠️ **勘误（2026-09-10 22:20，本文已就地改写）：「带文件端点全挂」的结论已撤回。**
> 误判根因：本文的上传探测使用的是 **1×1 像素、190 字节的占位 PNG** —— 后端能「找到」该文件
> 但**解码即崩** → 500，于是把「素材不可处理」误报成了「接口不可用」。
> 换成真实尺寸参考图后，**同一端点同一参数一律 200**（11 个带文件端点全通过）。
>
> 本文已按复验结果就地改写：§一句话结论、§二 端点矩阵、§四 处置、§五 影响面均已更新；
> 完整证据链与复现命令见 **[2026-09-10-file-endpoint-recheck.md](./2026-09-10-file-endpoint-recheck.md)**。
> 仍然有效的部分：契约表（§一）、422 vs 500 的判别纪律、单任务同步实测（§三）、
> 流量与产能结论（§三）、`resultSchema` 漏字段的立案本身（§四，已修复）。

> 数据来源：一次真实生产会话（`session.jsonl`，71 次工具调用）+ 两轮串行主动探测（21+18 个用例）。
> 生成工具：`scripts/analyze-session.mjs`（离线画像）、`scripts/probe-api-contract.mjs`（在线探测）。
> 后端：`http://117.50.108.73:8082`，单任务同步。

## 一句话结论（已修正）

**后端端点全部可用。** 本文最初判定的「带文件链路全挂」是**探测方法误判**——
当时用内联的 1×1 像素占位图当参考图，后端读取该图即崩；
换成真实尺寸图后，11 个带文件端点**一律 200**（详见 §二，以及勘误指向的复验报告）。

同一轮探测发现的**插件侧本地 bug 属实**（`music_generation` / `compose_video` 的 output schema
漏字段，让 BGM 与成片 100% 失败）——这部分**不是**后端的锅，且已于 22:30 修复（§四）。

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

## 二、端点可用性矩阵（⚠️ 已于 2026-09-10 22:20 复验后重写）

**原表（19:05–20:20）判定「带文件不可用」是误判** —— 当时的参考图是内联的 **1×1 像素占位图**。
换成真实尺寸参考图后，同一端点、同一参数**一律 200**：

| 端点 | 不带文件 | 真实尺寸参考图（复验） | 幽灵文件名 | 判定 |
| --- | --- | --- | --- | --- |
| `image2promptenhance` | 200 / 9.5s | — | — | ✅ 可用 |
| `txt2image` | 200 / 16.3s | — | — | ✅ 可用 |
| `upload` | — | 200 / 2.2s（314KB 图） | — | ✅ 可用 |
| `image2image` | 200 / 33.4s | **200 / 24.8s** | 500 / 34ms | ✅ 可用 |
| `image2vl` | 200 / 12.6–16.6s | **200 / 7.4s** | 500 / 31ms | ✅ 可用 |
| `image2character` | 200 / 72.9s | **200 / 72.7s** | 500 / 33ms | ✅ 可用 |
| `image2styletransfer` | — | **200 / 22.2s** | — | ✅ 可用 |
| `image2ipastyletransfer` | — | **200 / 76.6s** | — | ✅ 可用 |
| `image2storyboard` | — | **200 / 31.3s** | — | ✅ 可用 |
| `image2inpaint` | — | **200 / 31.2s** | — | ✅ 可用 |
| `image2360hdri` | — | **200 / 193.5s** | — | ✅ 可用 |
| `image2splitegrid` | — | **200 / 1.2s** | — | ✅ 可用 |
| `image2videofl2va` | 200 / 151.7s | **200 / 196.6s、136.5s** | — | ✅ 可用（H3） |
| `image2videoref2va` | — | **200 / 125.6s、130.0s** | — | ✅ 可用（H3） |
| `txt2audio` | 未实测（会话里被本地 schema 拦在最后一步，见 CV-146） | — | — | ⚠️ 待验 |

**结论修正（两条都推翻了原来的判读）**

1. **「带文件名入参 → 500」的真实触发条件是「参考图本身不可处理」**（1×1 像素、190 字节），
   而不是「文件消费链路坏了」。真实句柄 500 用 1.2s、幽灵名 500 用 0.06s 的 20 倍差，
   正确解释是「文件被找到了 → 解码时崩」，而**崩溃由探测自选的占位图触发**。
   修掉探测素材后，11 个带文件端点全部 200。
2. **幽灵名仍返回 500（0.03s），这一条成立**：客户端**无法**从状态码区分「文件名拼错」与
   「后端故障」，只能靠上游保证句柄有效（canvas-studio 的 `ref-<uuid>.<ext>` 自造唯一名即为此）。
3. **`image2vl` 的跨请求脏状态成立。** 不传 `image` 时返回的是**某张陈旧缓存图**的描述
   （两次独立探测都描述「穿古装的中国男子」），而**带图时结果可信**——复验中它准确描述出了
   生成的角色三视图（front / side / back 三视角、深蓝双排扣风衣、白底、肩章腰带）。

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

## 四、插件侧 P0（与后端无关）— ✅ 已于 2026-09-10 22:30 修复（CV-146）

| 工具 | 现象 | 根因（复核后） | 处置 |
| --- | --- | --- | --- |
| `music_generation` | 4/4 失败，耗时 26–64s（说明后端真生成了） | 工具**内联**的 output schema 声明了 `additionalProperties:false`，却漏了 `declaredDuration`（以及 `bpm`/`lyrics`/`degradedFields`/`attempts` —— 实为 5 个字段都缺） | 提为具名常量 `musicResultSchema` 并补全字段 |
| `compose_video` | 2/2 失败，耗时 7.5s（ffmpeg 真合成了） | 共享 `resultSchema` 漏了 `audioComposition`（CV-143 新增） | `resultSchema` 补 `audioComposition` |

> 这两处的产物**已经生成**却在返回给模型前被 schema 校验丢弃，是最亏的一类 bug：
> 后端时间照花，用户什么都拿不到。
>
> **防控**：新增**编译期覆盖守卫**（`MusicSchemaCoverage` / `ComposeSchemaCoverage`）——
> 结果类型新增字段而 schema 没跟上时 `tsc` 直接失败，并在错误信息里点名缺失字段。
> 已反向验证：故意加一个 schema 中没有的字段，`tsc` 报 `Type '"__guardProbe"' does not satisfy the constraint 'never'`。

**次要问题**

- `qc_shot`（image2vl）即便后端修好，也受上述「跨请求图片缓存」影响，结果需独立复验。
- 本地预检拦截（H3-Context-IR 句式）2 次，属预期行为（零后端消耗），但应把规则写进工具描述，减少空转。

---

## 五、对 canvas-studio 的直接影响（⚠️ 已按 22:20 复验修正）

依赖「文件入参」的三条能力**全部可用**（复验实测）：

1. **一致性资产卡**（`character_sheet` → image2character 带 image）—— 200 / 72.7s；
   用文生图生成的**角色三视图**作输入同样 200 / 68.9s
2. **首帧图生视频 / 多参考视频**（`video_generate` / `video_composite` 带 filename）——
   H3 两个端点 200（fl2va 196.6s / 136.5s，ref2va 125.6s / 130.0s）
3. **自动 QC**（`qc_shot` → image2vl 带 image）—— 200 / 7.4s，且识别准确

⚠️ 原判断「会话里 agent 撞了 10 次墙后只能退回纯文生图」**不是后端限制**造成的。
真正的教训是**参考图素材纪律**：拿 1×1 / 极小占位图探测，会把「素材不可处理」
误报成「接口不可用」，而这类误判最贵——它会让 agent 主动避开本来可用的链路。

建议动作（按当前状态重排）：

- [x] 复验并撤回 CV-145（本文档 §二 已重写）
- [x] `docs/api.md` 顶部横幅改写为「带文件端点全部可用 + 参考图须为真实尺寸」
- [x] 修正探测脚本：`probe-api-contract.mjs` 不再内联占位图，改用 `--image` 指定真实图，<20KB 拒绝运行
- [x] 修 CV-146（`resultSchema` / `musicResultSchema` 漏字段）+ 加编译期覆盖守卫
- [ ] 后端更新后重跑 `node scripts/probe-file-endpoints.mjs` 复验，产物直接覆盖本文档

---

## 六、复现命令

```bash
cd canvas-studio
# 1. 离线画像：任意会话 jsonl → 接口画像 + 甘特时间线
node scripts/analyze-session.mjs "<session.jsonl>" --out docs/api-probe/session-<date>

# 2. 在线探测：契约 + 必填性 + 文件句柄 + 排队行为（严格串行）
#    ⚠️ 参考图必须是**有意义的真实尺寸图**（默认 ../assets/desktop-preview.png；<20KB 会拒绝运行）
node scripts/probe-api-contract.mjs --repeat 3 --cooldown 1500 --out docs/api-probe/contract-<date>
node scripts/probe-api-contract.mjs --probe-queue                 # 只验排队行为
node scripts/probe-api-contract.mjs --suite full --only image2videofl2va --repeat 2

# 3. 带文件端点复验：把「文件来源」当自变量（真实图 / 1×1 / 旧句柄 / 幽灵名 / 不带文件）
node scripts/probe-file-endpoints.mjs --matrix image2image,image2vl --out docs/api-probe/file-recheck-stage1
node scripts/probe-file-endpoints.mjs --matrix image2character --out docs/api-probe/file-recheck-full

# 4. 生产形态闭环：文生图造素材 → 下载 → 上传拿句柄 → 调用带文件端点
node scripts/probe-generated-refs.mjs --out docs/api-probe/generated-refs-<date>

# 5. H3 视频两个端点（当前唯一在用视频通道）
node scripts/probe-video-refs.mjs --out docs/api-probe/video-refs-<date>

# 注意：本机 Bash 沙箱会拦截 117.50.108.73:8082，需在沙箱外运行；全程严格串行（后端单任务同步）。
```
