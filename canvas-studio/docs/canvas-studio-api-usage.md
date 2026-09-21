# Canvas Studio × Drama Backend 接口使用指南

> 本文是 canvas-studio 视角的**接线状态 + 使用方式**活文档：每个接口在创作流程中什么时候用、怎么用、有什么坑。原始请求/响应细节以 `api.md`（后端 API 参考，v0.2.0）为准，本文不复制、只引用。
>
> **维护约定**：每完成一项接线，更新 §2 状态列并在 §6 追加一行。状态标记：✅ 已接线 / ⚠️ 已声明未接线（`config.ts` 有常量、无调用代码）/ 🆕 待接线（api.md 有、配置缺）/ ❓ 存疑待确认。
>
> 最后核对：2026-08-24（含首轮真实探测，见 `canvas-studio-phase2.md` §8）。

## 1. 基础约定

### 1.1 配置与调用链路

- 基址：`config.ts → DRAMA_API_BASE`，env `CANVAS_STUDIO_DRAMA_API_BASE` 覆盖，默认 `http://117.50.108.73:8082`
- 鉴权：`DRAMA_API_KEY` 目前**未随任何请求发送**；实测后端当前无鉴权（health 无 key 通过）。去留待后端确认（§5-3）
- 调用链路（全部在 Host 侧，规避浏览器 CORS）：
  ```
  工具(host-tools.ts) → generate.ts callDrama/callDramaRaw
    → Drama Backend（同步 HTTP）
    → 产物下载落盘 ~/.dsh/canvas-studio/projects/<id>/assets/<uuid>.<ext>
    → webServer /canvas-studio/assets/<projectId>/<file> 托管给画布
  ```
- 上传链路：产物 URL 先经 `upload_image` 工具（内部走 `resolveImageUrl` 换算本机托管地址再转发）→ `POST /api/v1/generate/upload` → 得服务器文件名（响应 **`name`** 字段）→ 才能作为其他工具的文件名入参（CV-137：上传端点已统一，旧 `uploadimage` **已下线 404**）

### 1.2 调用语义与坑

| 事项 | 说明 |
| --- | --- |
| 同步阻塞 | 所有生成接口同步返回；一次调用可能持续数秒到数十秒。「打断」只是本地中断 fetch，服务端任务不回收 |
| 错误码 | 400 参数错误 / 500 后端内部错误 / 502 后端不可用（P10 将映射为中文提示并加超时+重试） |
| 尺寸 | 本地 `sizeForAspectRatio(aspect, resolution)` 查 `config.ts` 的 `OUTPUT_SIZE`（CV-187）：480p→864×480、736p→**1280×736**（默认）、2k→1920×1088；9:16 取反宽高，1:1 三档共用 1024×1024。**务必显式传宽高**——多个视频端点默认仅 640×320 |
| aspect 参数差异 | 图像类端点收 `width/height` 像素；fl2va/ref2va 收 `aspect`（"16:9"/"9:16"）+ `megapixels`，两种风格不要混传 |
| filename | 一切图片输入只认 Drama 服务器文件名，不认 URL |

## 2. 接线总览表

| # | 端点 | 状态 | 使用方（工具/路由） | 关键参数 | 备注 |
| --- | --- | --- | --- | --- | --- |
| 1 | `GET /api/v1/health` | 🆕→P10 | 健康探针 | — | 实测 ✅ 正常 |
| 2 | `POST /generate/txt2image` | ✅ | image_generate（写实档） | prompt, width, height | Krea2 Turbo（`krea2_workflow`，CV-191；此前 z-image-turbo），steps=8 / cfg=1.0 / 随机种子，width/height 覆盖默认 |
| 3 | `POST /generate/txt2imageanime` | ⚠️→P11 | image_generate `style:anime` | 同上 | **Krea2 Turbo**（2026-09-16 实测确认，文档未更新；产物前缀仍 `Z-Anime_*`），steps=8 / cfg=1.0 |
| 4 | `POST /generate/image2image` | ✅ | image_generate 图生图 | prompt, width, height, image1~4 | krea2_edit，steps=9、cfg=1.0（CV-189 起 4 张参考；此前 qwen_image_edit_3_image_ref / steps=4 仅 image1~3） |
| 5 | `POST /generate/image2promptenhance` | ✅ | prompt_enhance | prompt | 返回 `output` 字段 |
| 6 | `POST /generate/image2character` | 🆕→P11 | character_sheet（新工具） | image | 四视图立绘（正面特写/正面全身/侧面全身/背面全身），白底；CV-191 起 `krea2_quadview`，steps=10 |
| 7 | `POST /generate/image2styletransfer` | ✅ | style_transfer | image1 目标图, image2 风格图, prompt?, enhance? | Klein Transfer Style |
| 8 | `POST /generate/image2ipastyletransfer` | 🆕→P11 | IPA 精细风格迁移 | prompt, image1~3, ref_image, enhance | 多参考融合 |
| 9 | `POST /generate/upload` | ✅ **唯一上传端点**（CV-137，2026-09-10） | upload_image / P8 本地上传 / 视频抽帧帧图 | form-data `file`（图片/视频/音频通用） | 实测返回 **`{name, subfolder, type}`**（无 `success`、文件名键是 `name`）；耗时随体积**线性**（≈9.6ms/KB ≈100KB/s），**无 1MB 悬崖**；重名自动加 ` (1)` 后缀 |
| 10 | `POST /generate/uploadimage` | ❌ **已下线**（2026-09-10 起 404） | — | — | 后端路由表与 openapi 均不再注册；对任何文件返回 `404 {"detail":"Not Found"}`。**勿改回去** |
| 11 | `GET /view?filename=` | ✅ | generate.ts 下载产物 | filename | ComfyUI 取图 |
| 12 | `POST /generate/image2storyboard` | ✅ | storyboard_generate | prompt（每行一镜）, gridnum=4, width, image? | 格子分镜 |
| 13 | `POST /generate/image2splitegrid` | 🆕→P8 | storyboard_split（新工具） | row, column, target_width/height, image | 分镜拆单镜的关键 |
| 14 | `POST /generate/image2inpaint` | 🆕→P11 | inpaint_image（新工具） | prompt, image | 移除/添加元素智能填充 |
| 14b | `POST /generate/image2fix` | ✅（2026-09-18 接入，CV-202） | image_fix | prompt, image | Boogu Edit 文字修复特化：Krea2 出图后图内文字出错的修复通道；**prompt 只写文字部分**（从原出图 prompt 提取）；产物 `boogu_*.png`（后端文档示例写 `boogu_edit_*`，以实测为准）；探针实测 200 / 68.5s、修复生效（SALLE→SALE）；产物名不可直接入参（直用 500 快失败，CV-155 同型） |
| 15 | `POST /generate/image2vl` | ✅ | image2vl | system_prompt, prompt, image? | VLM 画面分析 |
| 16 | `POST /generate/image2360hdri` | 🆕（低优） | — | image | 全景环境贴图彩蛋 |
| 17 | `POST /generate/image2videomsr` | ❌ 停用（2026-08-25 起弃用，改走 fl2va） | video_generate（旧） | prompt, width, height, duration=5, fps=30, image1~4, background(**必填**) | 后端 ltx_msr_workflow 崩溃返回 500，临时停用；单图/文生改走 fl2va |
| 18 | `POST /generate/image2videomkr` | ❌ 停用（2026-08-25 起弃用，改走 ref2va） | video_composite（≥3 图旧路径） | prompt, width, height, duration=10, fps=30, images[{image, frame_index}]≤5 | 多关键帧精确控帧位；改为 ref2va 多参考（后端自动排布，丢帧位控制） |
| 19 | `POST /generate/image2videomkrgrid` | ⚠️→P11 | video_generate mode=mkrgrid | gridtype∈{4,6,9}, frame_indexs 长度=gridtype | 宫格视频 |
| 20 | `POST /generate/image2videofl2va` | ✅（2026-08-24 起；2026-08-25 扩展至 video_generate 首帧/文生） | video_generate（首帧/文生）+ video_composite 双图 | aspect(16:9\|9:16), megapixels=0.4, duration=5, image1 首帧, image2 尾帧（均可选） | 首尾帧插值；两图合成**优先走此接口**；video_generate 不传 filename 即纯文生、传则首帧；1:1 画幅就近落 16:9 |
| 21 | `POST /generate/image2videoref2va` | ✅（2026-08-25 接线） | video_composite ≥3 图（+ video_generate 可扩展） | aspect, megapixels, duration, image1~9 | 多参考一致性最强；≥3 图统一走此接口，**最多 9 张**（CV-191：后端具名槽位 `image1`–`image9`，此前本仓误截 6），超出保留首尾+中间采样并回 warning |
| 22 | `GET /` | ❓ | — | — | api.md 称返回 message，实测 500 |
| ★ | `/generate/deduction` | ❌ | deduction 工具（一期） | — | **不在 api.md，实测 404，端点已不存在**；skill 已停止教学，待后端澄清 |

## 3. 分场景使用指南

### 3.1 分镜拆解（P8 闭环后）

```
storyboard_generate(prompt=每行一个场景, gridnum=N)
  └─► 得网格分镜图 URL
storyboard_split(该图上传后 filename, row×column 由 N 推导: 4→2x2 / 6→2x3 / 9→3x3)
  └─► images[] 每格一张 → 自动落画布为独立单镜节点
```

- prompt 必须每行一个场景，行数 = gridnum
- 单镜节点可独立：重试 / inpaint(P11) / 作视频首帧

### 3.2 定妆与一致性

| 手段 | 用法 | 适用 |
| --- | --- | --- |
| 定妆照（现状） | image_generate 出主角图，后续镜头以其 filename 作参考 | 通用 |
| 真·四视图（P11） | character_sheet(image=定妆照) → 三视角立绘白底图作全片锚点 | 角色一致性要求高 |
| 风格统一 | style_transfer(image1=新镜, image2=首图) | 逐镜风格漂移时 |
| IPA 精细控制（P11） | ipastyletransfer(prompt, ref_image=风格基准, image1~3=内容参考) | 姿态+外观双控 |

### 3.3 逐镜出图

- 写实：txt2image；动漫：txt2imageanime（P11 起 via `style` 参数）
- 要角色一致：image2image 带 image1=定妆照 filename（CV-189 起可带至 4 张参考）
- 画幅全程统一（16:9 / 9:16 / 1:1），不要混用

### 3.4 视频生成接口详解（5 个）

选型速查：

| 场景 | 端点/mode | 输入要点 |
| --- | --- | --- |
| 单镜动态（默认） | fl2va（首帧/文生） | 不传 filename 纯文生；传则 image1 首帧；aspect 选画幅 |
| 两张图之间过渡 | fl2va | image1 首帧 + image2 尾帧，aspect 选画幅 |
| 多参考保角色 | ref2va | 最多 9 张参考（CV-191；只需 2~4 张即可达到一致性效果） |
| 多关键帧精确控节奏 | mkr（❌ 2026-08-25 停用，改 ref2va） | images≤5，frame_index=时间点×fps |
| 宫格多机位 | mkrgrid | gridtype 4/6/9，frame_indexs 数量须等于 gridtype |

#### 3.4.1 `image2videomsr` —— 图生视频（单镜动态；❌ 2026-08-25 起停用，改走 fl2va）

```json
{
  "prompt": "…",
  "width": 1280, "height": 720,
  "duration": 5, "fps": 30,
  "image1": "参考图.png", "image2": "", "image3": "", "image4": "",
  "background": "背景图.png"
}
```

- **background 必填**（单镜首图），image1~4 可选参考
- 默认 640×320，**必须显式传宽高**（本地 `sizeForAspectRatio`：查 `config.ts` 的 `OUTPUT_SIZE`，480p→864×480 / 736p→1280×736 / 2k→1920×1088；9:16 反宽高、1:1 恒 1024×1024）
- duration 整数，默认 5；本地钳制 ≤15s（建议 8–10）
- prompt 按 H3 规范写首帧锚点式结构（规范蒸馏在 creation-spec skill，原文见 MiniMax-AI/MiniMax-H3 仓库）

#### 3.4.2 `image2videofl2va` —— 首尾帧插值（`video_composite` 双图路径在用 ✅）

```json
{
  "prompt": "…",
  "aspect": "16:9", "megapixels": 0.4,
  "duration": 5,
  "image1": "首帧.png", "image2": "尾帧.png"
}
```

- **用 aspect + megapixels，不传宽高**（与 msr/mkr 的参数风格不同，勿混）
- **`megapixels` 是视频侧唯一的画质旋钮** —— 像素**只能由 H3 推荐分辨率表反推**，不可自由指定：0.4 → 864×480、0.9 → 1280×736、2.0 → 1920×1088（16:9）。本仓把这三种取值命名为档位 `480p` / `736p` / `2k`（`config.ts` 的 `OUTPUT_SIZE`）。⚠️ 实测记录：**0.4 已确认产出 864×480**（2026-09-15，ffprobe 实量）；`1` / `2` 的实测因后端连接中断**尚未证实**，故 `drama.ts` 目前仍固定发 `0.4`（见 `docs/plans/resolution-tier-dev.md` §0.5）
- aspect 仅 `16:9` / `9:16`；1:1 画幅就近落 16:9
- 偏好单镜头连续插值；prompt 描述首帧→尾帧的运动路径（H3 FL2VA 结构）

#### 3.4.3 `image2videomkr` —— 多关键帧合成（❌ 2026-08-25 起停用，改走 ref2va）

```json
{
  "prompt": "…", "width": 1280, "height": 720,
  "duration": 10, "fps": 30,
  "images": [
    { "image": "a.png", "frame_index": 0 },
    { "image": "b.png", "frame_index": 150 },
    { "image": "c.png", "frame_index": -1 }
  ]
}
```

- 最多 5 个关键帧；`frame_index` = 时间点×fps（整数），**末帧固定 -1** 标记结束
- 本地按时间轴均分：`round(index/(n-1) × duration×fps)`

#### 3.4.4 `image2videomkrgrid` —— 宫格视频（未接线，P11）

```json
{
  "prompt": "…", "width": 640, "height": 320,
  "duration": 12, "fps": 30,
  "image": "输入图.png",
  "gridtype": 4, "frame_indexs": [0, 90, 180, 360]
}
```

- gridtype 仅 4/6/9；`frame_indexs` 长度必须等于 gridtype

#### 3.4.5 `image2videoref2va` —— 多参考一致性视频（✅ 2026-08-25 已接线）

```json
{
  "prompt": "…", "aspect": "16:9", "megapixels": 0.4, "duration": 5,
  "image1": "定妆.png", "image2": "场景.png", "image3": "", "image4": "", "image5": "", "image6": ""
}
```

- 最多 9 张参考（CV-191 起；定妆+场景+道具，一般 2~4 张即够），角色/场景一致性最强；aspect 风格同 fl2va

#### 3.4.6 通用注意

- 全部**同步阻塞**；错误码 400/500/502（客户端已有超时+一次重试+错误体透出）
- 时长统一钳制 ≤15s（`clampDuration`）；长片走 P9 本地拼接
- 输入 filename 一律来自统一上传端点 `POST /api/v1/generate/upload`（CV-137 前是 `uploadimage`，该端点已 404）；上传表单文件名必须唯一且只含 `[\w.\-]`（带空格括号的后端去重名会导致下游 500，已修复）
- 请求体契约有自动化测试守护（`tests/generate.test.mjs` "api.md 契约" 4 例）

### 3.5 辅助

- prompt_enhance：创意阶段打磨描述；输出取 `output` 字段
- image2vl：分析画面/归纳参考帧风格（P8 参考视频路线用它做风格归纳）
- **image2fix**（Boogu Image Edit）：图内文字出错时的专用修复通道，产物 `boogu_*.png`。
  **修复 prompt 只写「文字规格」**：每段文字 + 它在画面里的位置/字体/字号/颜色/排版关系，
  外加末段「逐字准确还原、不得替换增删」约束；**删掉画幅/材质/光线/配色/气质等美术描述**。
  ⚠️ **实测反证**：只喂字符清单（CV-212 自动模板形态）会把 `武仔` 修成 `武传`（仍错）并凭空多出文字；
  喂完整文字规格段（真实成功案例）则 8 处错字全对、排版零漂移 —— 详见
  [api-probe/image2fix-20260920-text-spec](./api-probe/image2fix-20260920-text-spec/report.md)
  （对照 [image2fix-20260918](./api-probe/image2fix-20260918/report.md) 的 SALLE→SALE 探针）。
- ~~deduction~~：❌ 端点已 404，不要调用

### 3.6 上传（标准流程）

**标准流程**：一切「以文件名为入参」的接口，都必须先把文件上传拿名字，再填参数。

```
本地文件 ──POST /api/v1/generate/upload（form-data: file）──▶ {"name":"xxx.png"}
把 name 填进下游参数 ◀──────────────────────────────────────────┘
```

- **唯一端点**：`POST /api/v1/generate/upload`（form-data `file` 字段），图片 / 视频 / 音频通用。
  旧端点 `POST /api/v1/generate/uploadimage` **已下线**（2026-09-10 起对任何文件返回 `404`），不要再调用。
- **响应取 `name` 字段，不是 `filename`**。实测返回 `{"name":"small.png","subfolder":"","type":"input"}`，
  没有 `success` 字段。canvas-studio 已兼容 `{name}` / `{filename}` / `{data:{filename}}` / `{data:{url}}` 四种形态。
- 字段名必须是 `file`：写错会得到 `422 field required`。
- 文件名要**唯一且只含 `[\w.\-]`**：后端按名去重会加 ` (1)` 后缀，带空格/括号的名字会让下游 500。
  本仓统一用 `ref-<8位uuid>.<ext>`（`uploadBytesToDrama`）。
- **耗时随体积线性（≈9.6ms/KB ≈100KB/s），没有 1MB 悬崖**（旧文档的「溢写阈值」说法已证伪）；
  所以压缩仍然必要——3MB 手机照片 ≈ 30s。
- 下游句柄可用性已端到端实证：上传 → `image2vl.image` ✅、上传 → `ref2va` 的 `image1`/`video1`/`audio1` ✅。
- `/view?filename=` **只对生成产物有效**，对上传的文件回读 500——别拿它校验上传。

## 4. 参数速查

| 端点族 | 参考图上限 | 画幅参数 | 时长/帧 |
| --- | --- | --- | --- |
| image2image | image1~4 | width/height | krea2_edit，steps 固定 9、cfg 固定 1.0 |
| txt2image(-anime) | — | width/height | steps 固定 8 |
| videomsr（❌ 2026-08-25 停用） | image1~4 + background(必填) | width/height（默认 640×320！） | duration 默认 5s, fps 30 |
| videomkr（❌ 2026-08-25 停用） | images ≤5 关键帧 | width/height | duration 默认 12s；frame_index=duration×fps |
| videomkrgrid | 单图宫格 | width/height | gridtype∈{4,6,9} |
| fl2va / ref2va | fl2va 2 帧 / ref2va ≤9 张 | **aspect + megapixels**（不是像素） | duration 默认 5s |
| storyboard | image 可选 | width（单项宽） | gridnum 默认 4 |
| splitegrid | image | target_width/target_height | row/column 任意组合 |

## 5. 待后端确认清单

1. `deduction` 是否废弃/迁移？一期工具有 UI 入口但端点 404
2. ~~流式上传 `/generate/upload` 响应只有 `{status}`，下游如何拿到 filename？~~
   → **2026-09-10 已闭环（CV-137）**：`/generate/upload` 现为**唯一**上传端点，响应
   `{name, subfolder, type}`，`name` 即下游文件名；反过来 `uploadimage` 已下线（404）。
   ~~2026-08-31 的「任何形态 500、端点已坏」~~是当时的故障态，现已修复。
3. 鉴权规划：是否将引入 API key 校验（决定 `DRAMA_API_KEY` 发送或移除）
   → **2026-09-03（CR-033）已落地半侧**：`resolveDramaApiKey` 未配置时返回空串而非报错、空 key 判缺——对齐「后端当前无鉴权」现状；**是否把 key 挂到请求头（CR-012）仍待后端确认**（不臆造 Bearer 方案以免破坏现网）。
4. 视频/音频 roadmap：参考视频条件生成（两步走的 b 步）、TTS/BGM 端点是否规划
5. 根路径 `GET /` 返回 500是否符合预期
6. **image2fix 对「本来没有文字」的图会不会凭空加字？** —— 决定 CV-212 自动模板的「误触发收紧」
   是**可选优化**还是**必须项**（实测依据见 [image2fix-20260920-text-spec](./api-probe/image2fix-20260920-text-spec/report.md)）
7. image2fix 的修复 prompt 是否有**长度上限 / 最佳区间**？（真实正例 ≈ 400 字，CV-212 模板 ≈ 60 字）
8. ~~`/api/v1/health` 稳定 500~~ → **2026-09-20 21:07 已恢复**：`200 {"status":"ok","queue_task_count":0}`（0.04s）。
   ~~仍待明确 `queue_task_count` 语义~~ → **2026-09-21 已由实测确定：含正在执行的那个**。
   观测序列：空闲 `0` / 我们的单个请求在跑 `1` / 此时再提交一个 `2` / 他人并发占满 `5` /
   任务结束后回落 `0`。⇒ **判「有活在跑」用 `> 0`，判「空闲」用 `=== 0`，不要写 `<= 1`**
   （写成 `<= 1` 会让最常见的「独跑」忙态静默）。已落到 `src/generate.ts#queueDepthOf`（CV-219）。
   ⚠️ **同批次新发现的那条已修复**：`POST /api/v1/generate/upload` 于 **2026-09-21** 实测恢复
   （1.36MB 原图 200 / 17.1s；复用句柄复跑亦正常）⇒ CV-218 的真机 A/B 已跑完，见
   `api-probe/image2fix-20260921-ab/`（含 `analysis.md` 人判读）。旧记录：2026-09-20 该端点
   3/3 次稳定 500（~50ms 快失败，125KB 小图同样 ⇒ 非体积），当时阻塞了 CV-218 的真机验证。

## 6. 变更记录

- 2026-09-21 补记（**health 语义定案 + 探针分层**；CV-219）：`queue_task_count` 语义由实测**确定＝含正在执行的那个**（观测序列 0 / 1 / 2 / 5 / 回落 0）⇒ 判忙 `> 0`、判闲 `=== 0`，**不要写 `<= 1`**（§5 第 8 条结案）；`POST /api/v1/generate/upload` 实测恢复（1.36MB / 17.1s）⇒ CV-218 真机 A/B 已跑完。**新增一条接口纪律**：**`/api/v1/health` 返 4xx/5xx 不等于后端不可达** —— 「服务是否活着」只看**有没有拿到 HTTP 响应**；健康接口坏掉只该降低可观测性（读不到队列深度），不该拦下所有业务请求。已据此重写 `ensureDramaReachable`（返回 `DramaQueueDepth`，可达即缓存 30s 含「活着但健康未知」，拿不到响应才抛「不可达」）。

- 2026-09-20 补记（**image2fix 修复 prompt 的正确形态**）：收录用户提供的真实成功案例（海报「山见茶事」，12 处文字中 8 处错 → 全部修正、排版零漂移），取证留档 `api-probe/image2fix-20260920-text-spec/`。**规则提炼：修复 prompt = 原 prompt 的「文字规格段」（每段文字 + 位置/字体/字号/颜色/排版关系）+「逐字约束段」，删掉画幅/材质/光线/配色/气质等美术描述段**。据此反证 CV-212 自动模板（只喂字符列表）为何失败：丢位置锚点 ⇒ 模型按形近字猜（`武仔`→`武传`）、祈使式动词 + 无「不得增删」约束 ⇒ 凭空补字。§3.5 同步补 image2fix 条目（2026-09-18 接入时漏登），§5 新增 3 条待后端确认。
- 2026-09-18 七次修订（**CV-202**，收录并接入后端新增端点）：后端新增 `POST /generate/image2fix`（Boogu Image Edit，`boogu_image_edit.json` 工作流）——Krea2 出图后图内文字出错的专用修复通道，修复后产物 `boogu_*.png`（后端文档示例写 `boogu_edit_*`，探针实测为准）。**用法纪律（后端同事交代）：修复 prompt 只写「文字」那部分描述**（从原出图 prompt 提取），其余画面描述不带。**探针实测**（`scripts/probe-image2fix.mjs`，产物 `api-probe/image2fix-20260918/`）：200 / 68.5s，SALLE→SALE 修复生效；产物名直用作入参 500 快失败（CV-155 同型复证）。**已接入**：新工具 `image_fix`（工具 23→24，`generate.ts` 分支 + `pngSizeOf` 实测产物尺寸）；skill 侧 6 处同步（krea2-turbo / krea2-edit / prompt-writing / toolchain / music-video-subtitle / co-op-game-intro）。
- 2026-08-24 初版：按 api.md v0.2.0 全量盘点 22 端点 + deduction 存疑项；首轮探测（health ✅、deduction 404、其余新端点已路由）；确定 P8 抽帧路线绕开流式上传。
- 2026-08-24 二次修订：video_composite 双图路径接通 **fl2va**（首尾帧插值优先）；全部视频生成**时长钳制 ≤15s**（默认 10，建议 8–10，长片走 P9 本地拼接）；callDrama 加超时（图片 360s / 视频 600s / 文本 60s，验收反馈后翻倍）与一次性自动重试；后端视频模型确认为开源 **MiniMax H3**（`h3_*` 工作流），官方提示词规范已蒸馏进 creation-spec skill（原文属第三方材料，按 .gitignore reference/ 规则仅存本地不入库）。
- 2026-08-24 三次修订：§3.4 扩写为五个视频端点的完整参数/示例详解；修复上传文件名缺陷（表单名唯一化 `ref-xxxxxxxx.png`，杜绝后端去重产生带空格括号的 filename 导致下游 500）；错误信息透出后端响应体片段；新增 4 个 api.md 请求体契约测试（31 项全绿）。
- 2026-09-16 五次修订（**CV-191**，对齐后端 0.3.0）：图像侧换 Krea2 全线（txt2image → Krea2 Turbo、image2image → Krea2 Edit〔槽位 4，CV-189〕、image2character → krea2_quadview 四视图）；**ref2va 参考图上限 6 → 9**（`drama.ts` 代码同步，超限回 warning 不再静默）；`aspect` 明确 `16:9` / `9:16` 两档（0.2.8 的疑虑结案）；补 `txt2audio` 契约（`music_generation`）。
- 2026-08-25 四次修订：视频生成收敛为仅 **fl2va + ref2va** 两个接口（msr 后端 500 停用、mkr 改 ref2va）；video_generate 走 fl2va（支持文生视频 / 首帧两种模式），video_composite 双图走 fl2va 首尾帧、≥3 图走 ref2va（最多 9 张，超出自动采样保首尾）；config 移除 videoMsr/videoMkr/videoMkrGrid、新增 videoRef2va；契约测试 msr/mkr 断言改为 fl2va/ref2va。
- 2026-08-31 五次修订（上传接口实测校准）：直连 `http://117.50.108.73:8082` 实测两个上传端点——
  ① `uploadimage` 可用，但**响应是 ComfyUI UploadImage 原生结构 `{name, subfolder, type}`**，无 `success`、
  文件名键是 `name`（§1 第 9 行、§3.6 同步更正；canvas-studio `upload_image` 已兼容 `{name}`，代码无需改）；
  ② `generate/upload` **任何请求形态均 500**（含空 body），判为坏端点，从 api.md 移除并在此标为停用，
  大文件出路改为客户端先压缩。§5 待确认清单第 2 条由"契约不明"改为"后端是否修复"。
- 2026-09-10 六次修订（CV-137，上传端点反转 + 耗时定性纠正）：
  ① `POST /generate/upload` 现为**唯一**上传端点（openapi.json 22 条路径里含 upload 的仅此一条），
  图片/视频/音频通用，响应仍为 `{name, subfolder, type}`；② `uploadimage` **已下线**——任何文件
  均 `404 {"detail":"Not Found"}`，两行总览表（§2 第 9/10 行）与 §3.6、§5-2 全部反转；
  ③ 「>1MB 触发 Starlette 溢写、耗时陡增」**证伪**：实测 105KB/293KB/577KB/872KB/1.21MB →
  0.21s/2.85s/5.48s/8.35s/12.1s，**线性 ≈9.6ms/KB（≈100KB/s）**，当年「1.6MB≈14s」就是传输时间；
  ④ 下游句柄端到端实证：`image2vl.image` ✅（模型如实描述出上传图内容）、
  `ref2va` 的 `image1`+`video1`+`audio1` ✅（产出 `MiniMax_H3_00290_.mp4`，127.1s）；
  ⑤ 新坑：`/view?filename=` 只对生成产物有效，上传文件回读 500。
  代码侧同步：`src/config.ts` 端点常量换名、`uploadBytesToDrama` 注释/文案更新，
  新增契约测试 `tests/upload-endpoint.test.mjs`（端点 + 请求形态 + 响应解析 + 错误提示）。
