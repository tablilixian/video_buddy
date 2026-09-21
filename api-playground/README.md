# Drama API Playground

Canvas Studio 用的 **Drama Backend 网页测试台**：把项目实际依赖的 12 个后端端点集中到一个页面。

两大能力：

- **素材串联**：前面生成的图，直接当后面步骤的素材（产物一键转句柄喂给下游），
  `文生图 → 图生图 → 图生视频 → 文生音频` 整条链路可纯鼠标点完；
- **一键批量**：自动跑完整链路（**自动上传、无需人工选文件**），逐条记录输入/输出/耗时，
  产出分析数据、耗时统计图、运行产物与可对比的历史记录。

---

## 快速开始

```bash
cd api-playground

./run.sh start          # ① 手动测试：起服务并自动开浏览器
./run.sh test --fast    # ② 一键自动测试（跳过 2 个慢视频端点，约 5 分钟）
./run.sh test           # ③ 一键自动测试全量（含视频，约 10~15 分钟）
```

`./run.sh test` 走无头脚本 `scripts/smoke.mjs`，落盘 `report.html` 并自动打开；
手动模式（`./run.sh start`）下，也可以点页面顶栏的「**运行全部接口**」，报告直接渲染在右栏。

> 第一次运行 `run.sh` 会自动执行 `npm install`。需要 Node.js 18+（实测 Node 22）。

---

## 一、手动测试

```bash
./run.sh start        # 幂等：已在跑就不会重复启动
```

浏览器打开 **<http://localhost:5188>**（端口 5188 是因为 5173 常被其它本地服务占用）。

界面分五块：

| 区域 | 作用 |
|---|---|
| **顶栏** | 后端 base URL（可临时改）、**选择端点**、**运行全部接口** |
| **角色栏** | **全局角色入口**（见下）——选定后，所有「角色驱动」的提示词都用它 |
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

### 表单：示例提示词 + 一键填入

- 提示词类字段**默认就带示例**，可直接发送；
- 标签右侧「**填入示例**」按钮可一键复位成示例文本。

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

> ⚠️ **后端陷阱**：生成响应里的 `filename` 是**产品名**（`img_*` / `z-image_*` / `krea2_*`），
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

**自动依赖解析**：若勾了下游端点（图生图 / 角色 / 修复 / VL / 视频）却没勾前置，
会自动补跑 `写实文生图 + 上传` 来拿句柄，并在报告里标注「（自动前置）」——不会因缺句柄而失败。

### 一键全量

点顶栏「**运行全部接口**」跑全部 12 个端点，链路：

```
health → txt2image → upload（自动）→ txt2imageanime
       → image2image → image2character → image2fix → image2vl
       → videoFl2va → videoRef2va → promptEnhance → txt2audio
```

### 自动上传（不再需要人工选文件）

批量时的 `upload` 步骤是全自动的：

1. 取回 `txt2image` 生成图的字节（经同源代理 `/api/fetch-media`，绕开浏览器 CORS）；
2. 以 `multipart` 走**真实 `/upload` 端点**上传，拿到句柄；
3. 该句柄直接喂给下游 `image2image / image2character / …`。

> 想跳过两个慢视频端点（每个约 4~5 分钟），用「仅快速」勾选，或 `./run.sh test --fast`。

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

---

## 四、命令与配置

```bash
./run.sh start     # 启动 dev server（默认 5188），用于手动测试
./run.sh test      # 一键自动测试（全量，走 scripts/smoke.mjs）
./run.sh test --fast   # 同上，跳过两个视频端点
./run.sh stop      # 停止 dev server
./run.sh build     # 构建生产包（dist/）
./run.sh help      # 帮助
```

环境变量：

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `5188` | dev server 端口 |
| `BASE` | `http://117.50.108.73:8082` | Drama Backend 地址（页面顶栏也可临时改） |
| `SKIP_VIDEO` | — | 置 `1` 等价于 `--fast` |

npm script 等价入口：

```bash
npm run dev        # = ./run.sh start 的裸 vite
npm run typecheck  # tsc --noEmit
npm run build      # 生产构建
npm run smoke      # 直接跑无头测试套件（需自传 --base / --proxy / --out）
```

---

## 五、端点清单

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

---

## 六、实现说明（为什么需要代理）

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
├── run.sh                  # 启动 / 测试脚本
├── index.html
├── vite.config.ts          # 三个同源代理中间件 + dev/preview 配置
├── scripts/smoke.mjs       # 无头自动测试套件（产出 report.html）
└── src/
    ├── endpoints.ts        # 12 个端点的唯一 schema 源（表单 + 请求体 + 角色模板 + 依赖声明）
    ├── api.ts              # 请求层：proxy 调用 / 媒体类型推断 / URL→句柄 / 取媒体字节
    ├── App.tsx             # 界面：角色栏 + 三栏 + 选择端点 + 分析/耗时图 + 产物 + 历史 + 灯箱
    └── styles.css
```

---

## 七、排障

| 现象 | 原因 / 处置 |
|---|---|
| `curl localhost:5188` 返回代理错误而非页面 | 本机 shell 注入了 `HTTP_PROXY`，本地访问要加 `--noproxy '*'` |
| 代理返回的是页面 HTML 而不是接口 JSON | Vite 的 cwd 不对（必须在 `api-playground/` 下启动），配置没被加载 |
| 端口被占 | `PORT=5199 ./run.sh start` |
| 视频端点等很久 | 正常，单次约 4~5 分钟；急用就「仅快速」或 `--fast` |
| 报告里 `upload` 失败 | 检查生成图 `full_url` 是否可直接下载；自动上传依赖 `/api/fetch-media` 能取回字节 |
| 报告里 `fetch-to-upload` 失败 | 检查目标媒体 URL 是否可直接下载（`/view?filename=...` 返回的是真字节，OK） |
| 生成图里出现多个人物 | 角色描述未严格单人物；用内置模板（带 `one person only, solo`）或在角色框补上该约束 |
