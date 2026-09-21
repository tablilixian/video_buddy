# Drama API Playground

Canvas Studio 用的 **Drama Backend 网页测试台**：把项目实际依赖的 12 个后端端点集中到一个页面。

四大能力：

- **素材串联**：前面生成的图，直接当后面步骤的素材（产物一键转句柄喂给下游），
  `文生图 → 图生图 → 图生视频 → 文生音频` 整条链路可纯鼠标点完；
- **一键批量**：自动跑完整链路（**自动上传、无需人工选文件**），逐条记录输入/输出/耗时，
  产出分析数据、耗时统计图、运行产物与可对比的历史记录；**随时可停**（停止后已完成部分照样入库）；
- **判定不止看 HTTP**：`PASS = HTTP 2xx 且响应结构断言通过` ——
  后端返回 200 但响应里没有产物 URL / 没有文本输出，同样判 FAIL；
  另有**告警**第三档（契约漂移、队列深度之类「不影响客户端」的观察：记录但不判失败）；
- **参数矩阵 + 负向用例**：分辨率 × 宽高比 × 时长做笛卡尔积批量跑；
  另有 9 条固定坏请求，验证后端**确实挡得住**并**指得准**做错的字段。

---

## 快速开始

```bash
cd api-playground

./run.sh start                      # ① 手动测试：起服务并自动开浏览器
./run.sh unit                       # ② 纯逻辑单测（秒级，不联网）
./run.sh offline                    # ③ 离线全链路（mock 后端，不碰真实 Drama）
./run.sh test --fast                # ④ 真实回归：跳过 2 个慢视频端点，约 5 分钟
./run.sh test --fast --with-negative # ⑤ 真实回归 + 负向用例
./run.sh test                       # ⑥ 全量（含视频，约 10~15 分钟）
```

`./run.sh test` 走无头脚本 `scripts/smoke.mjs`，落盘 `report.html` 并自动打开；
手动模式（`./run.sh start`）下，也可以点页面顶栏的「**运行全部接口**」，报告直接渲染在右栏。

> 第一次运行 `run.sh` 会自动执行 `npm install`。
> **`./run.sh test`（无头套件）需要 Node ≥ 22.18** —— 它直接 `import '../src/endpoints.ts'` 复用同一份 schema，
> 依赖 Node 原生 TS 类型剥离；低于该版本会明确报错退出（`run.sh start` / `build` 不受此限）。

---

## 一、手动测试

```bash
./run.sh start        # 幂等：已在跑就不会重复启动
```

浏览器打开 **<http://localhost:5188>**（端口 5188 是因为 5173 常被其它本地服务占用）。

界面分五块：

| 区域 | 作用 |
|---|---|
| **顶栏** | 后端 base URL（可临时改）、**选择端点**、**参数矩阵**、**负向用例**、**运行全部接口**（运行中变为红色的「**停止测试**」） |
| **进度条** | 运行期间显示「第 N/M 步 · 已耗时 Xs · 当前步」（长任务不再像卡死） |
| **角色栏** | **全局角色入口**（见下）——选定后，所有「角色驱动」的提示词都用它 |
| **文字场景栏** | **全局文字场景入口**——文字修复链路的**基图**提示词（中文 + 远近景） |
| **左栏** | 按分组列出 12 个端点，点选即切换（视频端点带「慢」标记） |
| **中栏** | 端点参数表单（由 `src/endpoints.ts` 的 schema 驱动），填完点「发送请求」 |
| **右栏** | 素材库（自动收集生成结果）＋ 响应区 ＋ 测试报告区 |

### 角色栏：全局角色入口

顶栏下方一行是**全局角色**（一个总入口）：

- 6 个**单人物**模板一键切换：`通用角色 / 泳装美女 / 中世纪武士 / 中国古代神仙 / 动漫人造人 / 赛博朋克特工`；
- 右侧输入框即**角色描述**，可自由改写（自定义角色）；
- 选定后自动同步到所有**角色驱动**字段（`写实文生图` / `卡通文生图` 的提示词），换端点也会带上；
- 后续环节（角色四视图 / 图生图 / 视频）通过**生成出的角色图句柄**继承同一个角色，不用重复填。

> ⚠️ 角色描述纪律：**必须是单个人物**。模板统一带 `one person only, solo, full body, standing pose, centered`，
> 避免出现多人同框，或「角色设定集 / 多姿势」被画成好几个人的情况。自定义时也请保持单人物。

### 文字场景栏：中文文字修复的基图

`image2fix`（图内文字修复）的输入是**一张图**，所以测试结果取决于基图里有什么文字。
为了把「中文」和「远近景」固定成可复现的用例，顶栏第二行是**全局文字场景**：

- 4 个中文场景模板一键切换：`街道广告牌·远近景 / 店铺门头·远近景 / 地铁指示牌·远近景 / 夜市横幅·远近景`；
- 每个场景都**显式约束景深**：近处的标牌清晰可辨，远处的标牌被虚化；
- 右侧输入框可自定义场景提示词。

默认修复用例（`src/endpoints.ts` 的 `SAMPLES.image2fix`）：

> 把近景广告牌上的「朝阳街道」改成「朝阳大街」，保持字体、字号、颜色、位置不变；远景模糊的文字保持不变。

**验证点两条**：① 近景文字**改对了**；② 远景虚化文字**没有被误改**（这是文字修复最容易翻车的地方）。

为什么一定要远近景：只放一块平面标牌，只能验证「改没改」；带上虚化的远景，
才能验证模型**不会顺手把不该动的字也一起重画**。

用法：

- **批量**：勾选 `图内文字修复` 即可 —— 会自动前置 `文生图（文字场景基图）+ 上传（文字场景基图）`，
  与角色基图**各自独立生成**，互不覆盖；
- **手动**：切到「图内文字修复」，点「**准备参考图**」→ 自动生成中文远近景基图并填入句柄 → 点「发送请求」。

> 若手上有真实街景照片（中文更自然），直接用 `upload` 端点选本地文件拿句柄，再「用作输入」喂给 `image2fix`。
> 生成式基图的价值是**全自动、可复现**，适合做回归。

### 表单：示例提示词 + 一键填入

- 提示词类字段**默认就带示例**，可直接发送；
- 标签右侧「**填入示例**」按钮可一键复位成示例文本；
- 端点含参考位（`image1…` / `filename`）时，按钮行多一个「**准备参考图**」：
  按当前全局入口生成基图 → 上传 → 自动填入第一个空参考位（文字修复用「文字场景」，其余用「角色」）。

### 素材串联

每次请求成功后，素材库自动收下两类素材：

- **句柄**（`{"name": "xxx.png"}` —— 后端真正能当输入用的东西）
- **媒体 URL**（响应里的 `full_url`，直接预览）

点素材上的「**用作输入**」按钮：

- 若素材已是句柄 → 直接填进当前端点**第一个空的参考位**（`image1…image9` / `filename` 等）
- 若素材只有 URL → 先调 `/api/fetch-to-upload` 把它**转成句柄**再填入

于是典型链路可以纯鼠标点完：

```
upload / txt2image  →  产出 full_url
        ↓（点「用作输入」，自动 fetch-to-upload）
     得到句柄 name
        ↓
image2image / image2character / image2fix / videoFl2va / videoRef2va  →  继续往前推
```

> ⚠️ **后端陷阱**：生成响应里的 `filename` 是**产品名**（`img_*` / `z-image_*` / `krea2_*` / `boogu_*`），
> **不能**直接当下一环的输入。必须先 `upload`（或用页面的 fetch-to-upload）换成句柄才行。

### 双击放大 + 看提示词

素材库与「本次运行产物」里的 **图 / 视频 / 音频都可双击放大**，灯箱中同时展示：

**放大的媒体 + 来源端点 + 句柄 + 生成该产物的提示词 + 原始 URL**。

- 图片/视频鼠标悬停为放大镜（`zoom-in`）；
- **点遮罩**或按 **Esc** 关闭灯箱；
- 无提示词的端点（如「角色四视图」是纯图输入）会显示「（无提示词；以图片为输入）」。

---

## 二、选择性 / 一键批量测试

### 选择端点

点顶栏「**选择端点 N/12**」展开勾选面板：

- 按分组勾选，可 `全选 / 全不选 / 仅当前 / 仅快速(非视频)`；
- 点「**运行选中 N 项**」只跑勾中的端点。

**自动依赖解析**：勾了下游端点却没勾前置时，会自动补跑基图步骤拿句柄，并在报告里标注「（自动前置）」。
基图分两类，**各自独立生成、互不覆盖**：

| 基图 | 自动前置步骤 | 供哪些端点用 |
|---|---|---|
| **角色基图** | `txt2image` + `upload` | `image2image` / `image2character` / `videoFl2va` / `videoRef2va` |
| **文字修复基图** | `txt2image#fix` + `upload#fix`（中文远近景） | `image2fix` |

`image2vl` 任意图皆可（优先角色基图，缺失时回退文字修复基图）。
只勾 `图内文字修复` 时，**不会**顺带生成角色基图，不浪费一次生成。

批量运行读的是**当前表单里的草稿**：你在参数表单里改过的值（提示词、分辨率、时长…）
会被带进批量，不用重填。

### 一键全量

点顶栏「**运行全部接口**」跑全部 12 个端点，链路：

```
health → txt2image → upload（自动）→ txt2image#fix → upload#fix（自动）
       → txt2imageanime
       → image2image → image2character      （角色基图）
       → image2fix                          （文字修复基图，中文）
       → image2vl
       → videoFl2va → videoRef2va           （角色基图，最慢，放最后）
       → promptEnhance → txt2audio
```

### 自动上传（不再需要人工选文件）

批量时的 `upload` 步骤是全自动的：

1. 取回 `txt2image` 生成图的字节（经同源代理 `/api/fetch-media`，绕开浏览器 CORS）；
2. 以 `multipart` 走**真实 `/upload` 端点**上传，拿到句柄；
3. 该句柄直接喂给下游 `image2image / image2character / …`。

**取字节失败会自动重试 2 次**（退避 300ms → 600ms），重试次数会写进状态提示；
仍失败才记 FAIL。`fetch-to-upload` 同理。

> 想跳过两个慢视频端点（每个约 4~5 分钟），用「仅快速」勾选，或 `./run.sh test --fast`。

### 参数矩阵（分辨率 × 宽高比 × 时长）

点顶栏「**参数矩阵**」展开：

- 三行勾选：**分辨率档位**（`480p / 736p / 2k`）、**宽高比**（`16:9 / 9:16 / 1:1（图片）`）、**时长**（`5s / 8s / 10s`）；
- 标题实时显示 `N 组 × M 端点 = K 次调用`，**K 就是你要等的次数**（后端同步单任务，不会更快）；
- 「**运行矩阵（K 次调用）**」按笛卡尔积逐组跑；「**单次运行（不用矩阵）**」= 原来的行为。

几条硬规则：

- **只覆盖端点真的有该字段**才注入。`image2fix` / `image2character` / `image2vl` / `promptEnhance` 没有分辨率字段，勾了也不受影响；
- **优先级**：注入值 > 矩阵 > 表单草稿 > 默认值；
- 每个组合都会**重跑一遍前置**（档位/宽高比变了，基图必须重出），所以组合数会成倍放大调用次数；
- 组合会以 `#736p/9:16/5` 这样的后缀出现在报告里，便于横向对照；
- ⚠️ 视频端点只收 `16:9` / `9:16`；勾了 `1:1（图片）` 时视频端点那一组会被后端 **422 挡下**（这是预期，不是 bug）。

> 想先看看矩阵会发出什么请求体、又不想真的调用后端：
> `npm run matrix`（= `node scripts/preview-matrix.mjs`）—— 干跑并打印全部请求体，
> 顺带校验不变量（档位→像素 / megapixels / duration 类型 / 字段归属 / 句柄非空）。

### 负向用例（坏请求必须被挡下）

点顶栏「**负向用例 9**」跑 9 条**固定坏请求**：

| 用例 | 期望 | 为什么这么期望 |
|---|---|---|
| 产品名当句柄（`image2fix`） | 500 | 后端只认上传句柄，产品名读不到文件 |
| 产品名当句柄（`image2vl`） | 500 | 同上 |
| 不存在的句柄 | 500 / 404 / 400 | 文件不存在 |
| 缺 `prompt` | 422 · `prompt` | 必填字段 |
| 缺 `system_prompt` | 422 · `system_prompt` | `image2vl` 的必填字段（下划线） |
| 缺 `lyrics_prompt` | 422 · `lyrics_prompt` | `txt2audio` 必填；**空串 `""` 是合法的**，只有缺字段才 422 |
| 非法 `aspect=1:1` | 422 · `aspect` | 视频端点枚举只 `16:9` / `9:16` |
| `duration` 类型错 | 422 · `duration` | 应为数字 |
| 上传不带文件 | 422 · `file` | multipart 缺必填文件 |

判定是**镜像**的：**2xx = 用例失败**（后端没挡住）；状态码不在期望集合 = 失败；
422 但 `detail[].loc` 没命中预期字段 = 失败（**指错字段也算失败**，这才是用户真正会踩的坑）。

> 无头套件等价入口：`./run.sh test --fast --with-negative`（或在 `smoke.mjs` 上加 `--with-negative`）。

### 随时停止

一轮全量可能跑 5~15 分钟（两个视频端点各 4~5 分钟），所以**运行期间顶栏的「运行全部接口」会变成红色的「停止测试」**：

- 点「**停止测试**」或按 **`Esc`** —— 在途请求立即中断，后续步骤不再发起；
- **已完成的部分不会丢**：照常入库，报告与历史里仍能看到每步的输入 / 输出 / 耗时与产物；
- **没跑到的端点**标为「**已停止**」，计入「跳过」而非「失败」—— 一眼看出跑到哪一步了；
- 手动模式下发单次长请求（如视频）时，按钮行也会出现「停止」。

> ⚠️ 停止只中断**我们这一端**的 HTTP 请求。Drama 后端是**单任务同步队列**，
> 已被后端接手的那一次生成**可能仍在后台跑完**并占住队列 —— 这是后端行为，客户端取消不了。
> 所以「停止 → 立刻再跑」时，新请求要等前一个真正结束才会开始。

无头套件同样可随时停止：

```bash
./run.sh test          # 运行中按 Ctrl+C

# ⏹ 收到 SIGINT，正在写出已完成部分的报告…（再按一次 Ctrl+C 强制退出）
# === 汇总 ===
# ⏹ 已手动中断 —— 报告只含已跑完的 3 个用例
# 用例 3  通过 3  失败 0  跳过 0
```

中断时**退出码 130**，`report.html` 照样落盘（顶部带「本次运行被手动中断」横幅），只含已跑完的用例。

---

## 三、结果、产物与分析

批量跑完后，右栏「测试报告」区提供：

| 板块 | 内容 |
|---|---|
| **分析数据条** | 用例 / 通过 / 失败 / 跳过 / 通过率 / **总耗时 / 平均 / 最快 / 最慢**，并单列「最慢步骤」 |
| **耗时统计图** | 内联 SVG 横向条形图，每步一条，PASS 绿 / FAIL 红，标注毫秒 |
| **本次运行产物** | 本次产出的图 / 视频 / 音频 / 句柄缩略图集中展示（双击可放大看提示词） |
| **历史记录** | 每次运行自动存本地，可「查看」某次报告的完整结果＋产物，或「对比」把当前与历史耗时图并排 |
| **明细表** | 分组 · 接口 · HTTP · **耗时** · **服务端** · **输入** · **输出** · 摘要；输入/输出可展开看完整请求体/响应体 |

- **历史持久化**：`localStorage`（key `drama-playground-history`，上限 20 次）；
- **「服务端」列** = 后端返回的 `duration`（**生成耗时秒数**，不是媒体时长）。

### 判定口径：PASS = HTTP 2xx **且** 响应结构断言通过

断言定义在 `src/endpoints.ts` 的 `expect`，判定逻辑在 `src/verdict.ts`，**页面与无头套件共用同一份**：

| 断言 | 用于 | 要求 |
|---|---|---|
| `artifactUrl` | 6 个生成端点 | `full_url` 或 `data[0].url` 非空 |
| `uploadHandle` | `upload`、`fetch-to-upload` | `name` 非空（`subfolder` 允许空串） |
| `textOutput` | `image2vl` / `promptEnhance` | `output` 或 `msg` 非空 |
| `health` | `health` | 是个非空对象，且 `status === "ok"` |

于是这些情况会**正确地判 FAIL**（而不是傻乐着报 PASS）：

- 后端返回 `200 {}` 却没产物 URL —— 实际表现就是页面报「未找到产物 URL」；
- 文本端点 200 但 `output` 为空；
- `fetch-to-upload` 走的是 upload 的断言（它拿不到句柄，下游整条链路就断了）。

失败原因会直接写在报告里，例如：

```
image2fix  HTTP 200  缺少产物 URL：full_url 与 data[0].url 均为空（客户端会报「未找到产物 URL」）
image2vl   HTTP 422  参数校验失败 → filename: Field required [missing]
```

**422 会被翻译成人话**：抽 `detail[].loc`、去掉 `body` 前缀、去重后回显字段名与原因，
不用再去 `detail` 数组里翻。

### 软告警：值得记一笔，但不判失败

除了「通过 / 失败」，还有第三档：**告警**（琥珀色，`⚠`）。分界线只有一条 ——
**这件事会不会让客户端拿不到东西**：

| 档位 | 含义 | 判定 | 例子 |
|---|---|---|---|
| 断言失败 | 客户端必然报错 | **FAIL** | 200 但缺 `full_url` |
| 软告警 | 客户端不受影响，但值得知道 | 记录，**不影响 PASS** | 后端多回了一个类型不符的字段 |

目前唯一挂告警的是 `health`。起因是真机回归时发现它报「含 1 个非字符串值」——
后端 2026-09-21 起返回：

```json
{"status":"ok","queue_task_count":1}
```

`queue_task_count` 是 `number`，确实违反 OpenAPI 声明的 `additionalProperties: string`。
但**没有任何客户端代码读它**，用它判 FAIL 就是误报。所以改成两条告警：

```
⚠ 契约漂移：queue_task_count 是 number，OpenAPI 声明 additionalProperties: string（客户端不读该字段，仅记录）
⚠ 后端队列还有 1 个任务在跑：同步单任务队列，此刻发新请求只会排队等它
```

- 第一条是**漂移留痕**：后端悄悄改接口时，这是最早的信号；
- 第二条把队列深度**翻成人话** —— 它就是「点了停止、重跑却还要等」的原因，摆在报告里比让人猜有用。

告警不影响退出码（`run.sh test` 仍是 0），在页面、JSON 导出、Markdown 导出（独立小节）与
无头报告里都能看到。

### 导出报告

报告区右上角两个按钮：

- **导出 JSON** → `drama-report-YYYYMMDD-HHMMSS.json`（结构化：每步行、判定口径、产物清单、base URL）；
- **导出 Markdown** → `drama-report-YYYYMMDD-HHMMSS.md`（用例表 + 失败明细 + 产物小节，**可直接贴群 / PR**）。

Markdown 里的 `|` 会被转义、多行请求体/响应体会压成单行并标注截断 —— 表格不会错位。

---

## 四、命令与配置

```bash
./run.sh start                   # 启动 dev server（默认 5188），用于手动测试
./run.sh test                    # 一键自动测试（全量，走 scripts/smoke.mjs）
./run.sh test --fast             # 同上，跳过两个视频端点
./run.sh test --fast --with-negative   # 追加 9 条负向用例
./run.sh unit                    # 纯逻辑单测（秒级，不联网、不需要后端）
./run.sh offline                 # 离线夹具全链路（mock 后端，含负向用例）
./run.sh stop                    # 停止 dev server
./run.sh build                   # 构建生产包（dist/）
./run.sh help                    # 帮助
```

> `./run.sh test` 会把参数**透传**给 `smoke.mjs`，所以 `--skip-video` / `--with-negative` /
> `--timeout-ms` 等都能直接跟在后面。

环境变量：

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `5188` | dev server 端口 |
| `BASE` | `http://117.50.108.73:8082` | Drama Backend 地址（页面顶栏也可临时改） |
| `SKIP_VIDEO` | — | 置 `1` 等价于 `--fast` |
| `MOCK_PORT` | `5189` | 离线夹具端口（`./run.sh offline` 用） |

npm script 等价入口：

```bash
npm run dev        # = ./run.sh start 的裸 vite
npm run typecheck  # tsc --noEmit
npm run build      # 生产构建
npm test           # 5 个纯逻辑测试套件（判定层 / 负向包 / 矩阵 / 重试 / 导出）
npm run smoke      # 直接跑无头测试套件（需自传 --base / --proxy / --out）
npm run mock       # 起离线夹具后端（MOCK_PORT 可改）
npm run matrix     # 干跑参数矩阵，打印全部请求体并校验不变量
```

---

## 五、离线夹具（不碰真实后端）

真实回归要等后端（单任务队列，视频一次 130~200s）。想在**秒级**验证整条链路与判定逻辑，
用离线夹具 —— 它把 **Drama 后端 + 同源代理两跳合并**，`--base` 与 `--proxy` 都指向它：

```bash
MOCK_PORT=5189 node scripts/mock-backend.mjs        # 或 npm run mock

# 另开一个终端
node scripts/smoke.mjs \
  --base http://127.0.0.1:5189 --proxy http://127.0.0.1:5189 \
  --skip-video --with-negative --out mock-report.html
```

一条命令版：`./run.sh offline`（夹具自动起、跑完自动收）。

**故障注入**（用来验证「判定层真的拦得住」）：

| 环境变量 | 作用 |
|---|---|
| `MOCK_DELAY_MS` | 每一步人为延迟 N 毫秒（验证进度条 / 停止） |
| `MOCK_FAIL_ON=a,b` | 路径含 a 或 b 的请求直接 500（验证失败呈现） |
| `MOCK_BAD_200=image2fix` | 该路径返回 **200 空对象**（静默坏响应）→ 断言层应判 FAIL |
| `MOCK_QUEUE=3` | 伪装后端队列有 3 个任务（`health` 回 `queue_task_count:3`）→ 验证告警通道 |

自省路由：`GET /__log` 返回收到的全部请求（含 proxy 中转的请求体）；`GET /__reset` 清空。

> 夹具**只通过 `/api/proxy` 提供服务**，裸路径（如 `/api/v1/health`）是 404 —— 这是设计如此，
> 因为真实链路里前端从不直连后端。

---

## 六、端点清单

| # | id | 分组 | 方法 | 路径 |
|---|---|---|---|---|
| 1 | `health` | 系统 | GET | `/api/v1/health` |
| 2 | `txt2image` | 文生图 | POST | `/api/v1/generate/txt2image` |
| 3 | `txt2imageanime` | 文生图 | POST | `/api/v1/generate/txt2imageanime` |
| 4 | `image2image` | 图生图 | POST | `/api/v1/generate/image2image` |
| 5 | `image2fix` | 图生图 | POST | `/api/v1/generate/image2fix` |
| 6 | `image2character` | 图生图 | POST | `/api/v1/generate/image2character` |
| 7 | `videoFl2va` | 图生视频 | POST | `/api/v1/generate/image2videofl2va` |
| 8 | `videoRef2va` | 图生视频 | POST | `/api/v1/generate/image2videoref2va` |
| 9 | `upload` | 工具 | POST | `/api/v1/generate/upload` |
| 10 | `promptEnhance` | 工具 | POST | `/api/v1/generate/image2promptenhance` |
| 11 | `image2vl` | 工具 | POST | `/api/v1/generate/image2vl` |
| 12 | `txt2audio` | 工具 | POST | `/api/v1/generate/txt2audio` |

### 已实测纠正的接口契约（易踩）

| 端 | 要点 |
|---|---|
| `txt2audio` | 必填 **`caption_prompt` + `lyrics_prompt`**（歌词可传空串 `""`），不是 `prompt` |
| `image2vl` | 必填 `filename` + `prompt` + **`system_prompt`**（下划线），返回文本在 **`output`** 字段 |
| `promptEnhance` | 返回文本也在 **`output`** 字段（不是 `text`） |
| 图片生成响应 | 响应里的 `duration` 是**生成耗时（秒）**，不是媒体时长 → 判媒体类型必须**先看扩展名**，否则 `.png` 会被误判成视频 |
| 分辨率档位 | 图片端点用 `width/height`；视频端点用 `megapixels`。档位：`480p`=864×480(0.4) / `736p`=1280×736(0.9) / `2k`=1920×1088(2.0)；`9:16` 交换宽高，`1:1`=1024×1024（与 `canvas-studio/src/config.ts` 同源） |
| 参考图字段 | `image1…imageN` / `filename` **只收上传句柄**，不收产品名（`img_*` / `z-image_*`），否则 500 |
| 422 与 500 的分工 | **422 = 参数问题**（`detail[].loc` 精确到字段，可直接回显用户）；**500 = 文件/生成崩了**（无任何原因）。看到 500 就别再查参数格式 |

---

## 七、实现说明（为什么需要代理）

- Drama Backend（`117.50.108.73:8082`）**无鉴权，但也不发 CORS 头** → 浏览器直接 fetch 会被拦。
  所以 `vite.config.ts` 起了三个**同源中间件**：

  | 路由 | 作用 |
  |---|---|
  | `/api/proxy?target=<base>&path=<endpoint>` | 通用转发（GET / POST，含 multipart），流式回传 |
  | `/api/fetch-to-upload?target=<base>&url=<mediaUrl>` | 服务端把远端媒体字节拉下来 → `POST /upload` 换句柄，**绕开前端取字节的 CORS** |
  | `/api/fetch-media?target=<base>&url=<mediaUrl>` | 服务端只把远端媒体**字节**回传（前端拿到 Blob），供批量测试**自动多部件上传**用 |

- 中间件在 `configureServer` **体内同步注册根中间件**（不是 post-hook），
  以保证**先于 Vite 的 SPA fallback** 命中；同时手动剥离沙箱注入的 base 前缀。
  `vite preview` 走 `configurePreviewServer` 同款逻辑，所以 `dist/` 产物也能代理。
- 代理上游超时设为 **30 分钟**，避免长视频生成被中途掐断。

目录结构：

```
api-playground/
├── README.md
├── run.sh                  # 启动 / 测试脚本（start / test / unit / offline / stop / build）
├── index.html
├── vite.config.ts          # 三个同源代理中间件 + dev/preview 配置
├── scripts/
│   ├── smoke.mjs           # 无头自动测试套件（产出 report.html）；import ../src/endpoints.ts 复用同一份 schema
│   ├── mock-backend.mjs    # 离线夹具：Drama + 同源代理两跳合并，支持故障注入
│   ├── preview-matrix.mjs  # 干跑参数矩阵，打印请求体 + 校验不变量
│   └── test-*.mjs          # 5 个纯逻辑测试套件（verdict / negative / batch / retry / report）
└── src/
    ├── endpoints.ts        # 唯一 schema 源（表单 + 请求体 + 角色模板 + 文字场景 + 依赖声明 + 响应断言）
    ├── verdict.ts          # 判定层：PASS/FAIL 口径、422 翻译、断言解析（页面与 smoke 共用）
    ├── negative.ts         # 负向用例包 + 镜像判定
    ├── batch.ts            # 参数矩阵展开、表单草稿合并、调用数估算
    ├── report.ts           # 报告导出（JSON / Markdown）
    ├── api.ts              # 请求层：proxy 调用 / 媒体类型推断 / URL→句柄 / 取媒体字节 / 退避重试
    ├── App.tsx             # 界面：角色栏 + 文字场景栏 + 三栏 + 选择端点 + 参数矩阵 + 分析/耗时图 + 产物 + 历史 + 灯箱
    └── styles.css
```

> 纯逻辑都在独立 `.ts` 模块里（不在 `.tsx` 里），因为 Node 原生 TS 类型剥离**不支持 `.tsx`** ——
> 这样才能用 `node scripts/test-*.mjs` 直接跑，不需要构建。

---

## 八、排障

| 现象 | 原因 / 处置 |
|---|---|
| `curl localhost:5188` 返回代理错误而非页面 | 本机 shell 注入了 `HTTP_PROXY`，本地访问要加 `--noproxy '*'` |
| 代理返回的是页面 HTML 而不是接口 JSON | Vite 的 cwd 不对（必须在 `api-playground/` 下启动），配置没被加载 |
| 端口被占 | `PORT=5199 ./run.sh start`；夹具用 `MOCK_PORT=5190 ./run.sh offline` |
| 视频端点等很久 | 正常，单次约 4~5 分钟；急用就「仅快速」或 `--fast` |
| 报告里 `upload` 失败 | 检查生成图 `full_url` 是否可直接下载；自动上传依赖 `/api/fetch-media` 能取回字节（已自动重试 2 次） |
| 报告里 `fetch-to-upload` 失败 | 检查目标媒体 URL 是否可直接下载（`/view?filename=...` 返回的是真字节，OK） |
| 报告显示 `HTTP 200` 却判 FAIL | **这是断言层在工作**：响应里没有产物 URL / 没有文本输出。看摘要里的具体原因 |
| 报告里出现琥珀色 `⚠ 告警` | **不是失败，不用管**：契约漂移或队列深度之类「不影响客户端」的观察。见「软告警」一节 |
| `health` 报「契约漂移：queue_task_count 是 number」 | 后端 2026-09-21 起在 health 里多回了队列深度，违反 OpenAPI 的 `additionalProperties: string`；客户端不读它，故记为告警而非失败 |
| 422 报错看不出哪个字段 | 摘要已翻译成「参数校验失败 → 字段: 原因」；仍不够就看明细里展开的原始响应 |
| `image2fix` 用的是角色基图而非文字场景基图 | 文字场景基图生成/上传失败，已自动回退；看报告里 `txt2image#fix` / `upload#fix` 两行的失败原因 |
| 文字修复把远景虚化文字也改了 | 修复指令里要显式写「远景模糊文字保持不变」；默认用例已带该约束 |
| 矩阵跑起来比预期慢很多 | 组合数 × 端点数的乘积就是调用次数；每个组合都要重跑前置基图。后端同步单任务，不会更快 |
| 矩阵里视频端点报 422 | 勾了 `1:1（图片）`。视频只收 `16:9` / `9:16`，这是预期 |
| 点了「停止」但后端还在跑 | 后端单任务同步队列，已被接手的生成无法从客户端取消；等它跑完再重试 |
| `run.sh test` 报「需要 Node >= 22.18」 | 无头套件直接复用 `src/endpoints.ts`（依赖 Node 原生 TS 类型剥离），升级 Node 即可 |
| 生成图里出现多个人物 | 角色描述未严格单人物；用内置模板（带 `one person only, solo`）或在角色框补上该约束 |
