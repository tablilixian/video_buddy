# 带文件端点复验 —— CV-145 撤回（2026-09-10 22:00-22:20）

> 上一轮结论：**「带文件名入参的端点一律 500」（CV-145，P0）**。
> 本轮复验：**该结论不成立，已撤回。** 带文件端点实测全部可用，误判根因是**探测用了 1×1 像素的 PNG**。
> 复验工具：`scripts/probe-file-endpoints.mjs`（文件来源作自变量）、`scripts/probe-generated-refs.mjs`（文生图造素材）、`scripts/probe-video-refs.mjs`（H3 视频补验）。

---

## 一、误判是怎么产生的

上一轮 `probe-api-contract.mjs` 里的上传探测用的是内联常量：

```js
/** 1×1 红色 PNG（190B 量级），用于上传探测，避免依赖本地素材。 */
const TINY_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB...', 'base64')
```

上传流程本身**完全正确**（上传 → 取 `name` → 当参数传），问题出在**图本身**：
1×1 像素、190 字节的图，后端能"找到"（耗时 1.1s，比幽灵名的 0.03s 长得多，所以当时判断"文件被找到了"是对的），
但**解码/预处理阶段直接崩** → 500。

上一轮把「1.2s vs 0.06s 的 20 倍差」解释成「文件消费链路坏了」，**方向对了一半**：
文件确实被找到了，但崩的原因不是链路，是**这张图后端处理不了**。
正确的解释是「找到了 → 读取时崩」，而「读取时崩」的触发条件恰好是探测自己选的图。

---

## 二、决定性对照（同一端点，只换图）

| 端点 | 真实尺寸图（2654×1838, 314KB） | 1×1 小图 | 旧句柄 | 幽灵名 | 不带文件 |
| --- | --- | --- | --- | --- | --- |
| `image2image` | **200 / 24.8s** | 500 / 1.15s | **200 / 10.5s** | 500 / 34ms | 200 / 10.5s |
| `image2vl` | **200 / 7.4s** | 500 / 1.08s | **200 / 3.2s** | 500 / 31ms | 200 / 3.2s |
| `image2character` | **200 / 72.7s** | 500 / 56ms | **200 / 57.4s** | 500 / 33ms | 200 / 57.4s |

**判据**：同一端点、同一参数、只把"1×1 小图"换成"真实尺寸图"，500 立刻变 200。
`nofile`（不带文件）也 200 → 端点本身健康。

---

## 三、全端点复验结果（严格串行）

| 端点 | HTTP | 耗时 | 判定 |
| --- | ---: | ---: | --- |
| `image2image` | 200 | 25.0s | ✅ 可用 |
| `image2vl` | 200 | 7.3s | ✅ 可用 |
| `image2character` | 200 | 72.7s | ✅ 可用 |
| `image2styletransfer` | 200 | 22.2s | ✅ 可用 |
| `image2ipastyletransfer` | 200 | 76.6s | ✅ 可用 |
| `image2storyboard` | 200 | 31.3s | ✅ 可用 |
| `image2inpaint` | 200 | 31.2s | ✅ 可用 |
| `image2360hdri` | 200 | 193.5s | ✅ 可用 |
| `image2splitegrid` | 200 | 1.2s | ✅ 可用（返回多图数组） |
| `image2videofl2va` | 200 | 196.6s / 136.5s | ✅ 可用（H3） |
| `image2videoref2va` | 200 | 125.6s / 130.0s | ✅ 可用（H3） |
| `image2videomkrgrid` | 200 | 137.8s | ✅ 可用（非 H3，已不用） |
| ~~`image2videomsr`~~ | 500 | 1.1s | ⚠️ 语义未明，**已不用，不追** |
| ~~`image2videomkr`~~ | 422 | 25ms | ⚠️ `images` 须传对象数组，**已不用，不追** |

`image2videomkr` 的 422 是**参数形状错**，不是后端问题 —— openapi 里 `images` 的类型是
`array<ImageFrameItem>`，而 `ImageFrameItem = { image: string, frame_index: number }`，
传字符串数组（`["ref-x.png"]`）会被拒。已确认，此后不再测。

---

## 四、按生产形态复验（文生图造素材，完整闭环）

为贴住真实生产链路，用 `txt2image` 生成**有意义的素材**再走一遍：

```
txt2image 生成角色三视图（1024×768, 550KB）
  → 从 full_url 下载到本地
  → 上传回后端拿 ref-sheet-6ed6b279.png
  → 用该句柄调用带文件端点
```

| 环节 | 端点 | 结果 |
| --- | --- | --- |
| 生成三视图 | `txt2image` | 200 / 20.4s → `z-image_00839_.png` |
| 上传 | `upload` | 200 / 5.0s → `ref-sheet-6ed6b279.png` |
| 认图 | `image2vl` | **200 / 6.7s，准确识别** |
| 改图 | `image2image` | 200 / 25.1s |
| 建资产卡 | `image2character` | 200 / 68.9s → `img_01272_.png` |

`image2vl` 对三视图的原始输出（证明"图真的被读进去了"）：

> "The image displays a man wearing a navy blue double-breasted trench coat **from three different angles—front, side, and back**—against a plain white background. He is dressed formally with a shirt, tie, trousers, and black shoes, showcasing the coat's tailored design and features like epaulets and a waist belt."

三个角度、双排扣、白底、肩章、腰带全部说对。**带文件链路不但通，而且识图质量正常。**

三视图素材留存：`docs/api-probe/generated-refs-20260910/assets/sheet-z-image_00839_.png`

---

## 五、H3 视频链路（当前唯一在用的视频通道）

| 端点 | 第 1 次 | 第 2 次 | 产物 |
| --- | --- | --- | --- |
| `image2videofl2va`（首帧图生视频） | 200 / 196.6s | 200 / 136.5s | `MiniMax_H3_00302_.mp4` / `MiniMax_H3_00304_.mp4` |
| `image2videoref2va`（全能参考） | 200 / 125.6s | 200 / 130.0s | `MiniMax_H3_00303_.mp4` / `MiniMax_H3_00305_.mp4` |

两次复验、两种素材（桌面截图 / 生成的角色单帧）均成功。**首帧图生视频与全能参考链路可用。**

---

## 六、复验顺带确认的三件事

### 1. 响应 `duration` = 服务端生成耗时（秒），不是媒体时长

逐条与 HTTP 耗时吻合，无一例外：

| 端点 | 响应 duration | HTTP 耗时 |
| --- | ---: | ---: |
| `image2image` | 24.99 | 25019ms |
| `image2character` | 72.64 | 72676ms |
| `image2videomkrgrid` | 137.68 | 137842ms |
| `image2videofl2va` | 196.56 | 196594ms |
| `image2videoref2va` | 125.44 | 125597ms |
| `image2360hdri` | 193.43 | 193484ms |

CV-134 里「响应 `duration` 疑似又是生成耗时 → 不可当视频长度」的怀疑，**此处实证确认**。
客户端不得把它当媒体时长使用；视频真值必须靠 ffprobe 探测（CV-140 已落地的 `probeMediaDuration`）。

### 2. 大文件上传偶发连接重置

974KB 的图上传时出现 `ERR socket hang up`（重试后成功）；314KB、550KB 未复现。
生产侧上传建议保留重试（当前 `promoteAssetFile` 已有 in-flight 去重，重试策略需确认）。

### 3. 跨请求脏状态确认（原结论成立）

`image2vl` 不传 `image` 时返回的仍是**某张陈旧缓存图**的描述（本次返回"古装男子/房间烛光"），
而非空或报错。**VL 结果在带图情况下可信（本次准确描述了三视图），不带图时不可信。**

---

## 七、对文档与工单的影响

| 位置 | 原内容 | 处置 |
| --- | --- | --- |
| `docs/api.md` 顶部横幅 | 「带文件名入参的端点当前全部 500」 | **删除/改写** —— 该横幅会让 agent 主动放弃带文件链路 |
| `STATUS.md` CV-145 | P0「带文件端点全挂」 | **撤回**，改记为探测方法误判 |
| `STATUS.md` CV-146 | `resultSchema` 漏字段 | **保留**（实打实的插件 bug，与本次无关） |
| 上一轮产物 `api-probe/2026-09-10-backend-status.md` | 整篇结论 | 加勘误头，指向本文 |

**方法论教训**（值得写进探测工具的注释）：
参考图素材必须是**有意义的真实尺寸图**。
用程序生成的最小占位图（1×1、纯色、极小字节）做接口探测，会把「素材本身不可处理」误报成「接口不可用」——
这类误判最贵，因为它会让后续 agent 主动避开本来可用的链路。

---

## 八、复现命令

```bash
cd canvas-studio

# 1. 文件来源对照（真实图 / 1×1 / 旧句柄 / 幽灵名 / 不带文件）
node scripts/probe-file-endpoints.mjs --matrix image2image,image2vl --out docs/api-probe/file-recheck-stage1

# 2. 全端点（每个用真实尺寸图）
node scripts/probe-file-endpoints.mjs --matrix image2character --out docs/api-probe/file-recheck-full

# 3. 文生图造素材 → 完整生产闭环
node scripts/probe-generated-refs.mjs --out docs/api-probe/generated-refs-<日期>

# 4. H3 视频两个端点
node scripts/probe-video-refs.mjs --out docs/api-probe/video-refs-<日期>

# 注意：本机 Bash 沙箱会拦截 117.50.108.73:8082，须在沙箱外运行；全程严格串行（后端单任务同步）。
```
