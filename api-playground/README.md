# Drama API Playground

Canvas Studio 用的 **Drama Backend 网页测试台**：把项目实际依赖的 12 个后端端点集中到一个页面，
并且支持「**前面生成的图，直接当后面步骤的素材**」——生成的产物一键转成句柄喂给下游端点，
把 `文生图 → 图生图 → 图生视频 → 文生音频` 整条链路串起来跑。

---

## 快速开始

```bash
cd api-playground

./run.sh start          # ① 手动测试：起服务并自动开浏览器
./run.sh test --fast    # ② 一键自动测试（跳过 2 个慢视频端点，约 5 分钟）
./run.sh test           # ③ 一键自动测试全量（含视频，约 10~15 分钟）
```

两种模式都会产出 **测试报告**：`./run.sh test` 落盘到 `report.html` 并自动打开；
手动模式下也可以点页面顶栏的「**运行全部接口 · 生成测试报告**」，报告直接渲染在右栏。

> 第一次运行 `run.sh` 会自动执行 `npm install`。需要 Node.js 18+（实测 Node 22）。

---

## 一、手动测试

```bash
./run.sh start        # 幂等：已在跑就不会重复启动
```

浏览器打开 **<http://localhost:5188>**（端口 5188 是因为 5173 常被其它本地服务占用）。

界面分三栏：

| 区域 | 作用 |
|---|---|
| **左栏** | 按分组列出 12 个端点，点选即切换 |
| **中栏** | 端点参数表单（由 `src/endpoints.ts` 的 schema 驱动），填完点「发送请求」 |
| **右栏** | 上方是**素材库**（自动收集每次生成结果），下方是响应区（状态码/耗时/媒体预览/原始 JSON） |

### 核心玩法：素材串联

每次请求成功后，右栏素材库会自动收下两类素材：

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

---

## 二、一键自动测试

```bash
./run.sh test          # 全量
./run.sh test --fast   # 跳过 videoFl2va / videoRef2va（这两个单次约 4~5 分钟）
```

脚本会：起服务 → 依次打全部端点 → 跑通「生成图 → 转句柄 → 当下一步素材」链路 → 写报告 → 自动打开。

**测试报告**（`report.html`）：

- 顶部四张卡片：**总用例 / 通过 / 失败 / 跳过**
- 下方表格：分组 · 接口 · HTTP 状态 · 耗时 · 结果 · 摘要
- 每行可**展开查看原始响应体**，失败原因直接可见
- **进程退出码 = 失败数**（`0` 即全绿），可直接接 CI

用例覆盖：`health` → `txt2image` → `fetch-to-upload` → `txt2imageanime` → `image2image` →
`image2character` → `image2fix` → `image2vl` → `promptEnhance` → `txt2audio` →
`upload` → `videoFl2va` → `videoRef2va`。

---

## 三、命令与配置

```bash
./run.sh start     # 启动 dev server（默认 5188），用于手动测试
./run.sh test      # 一键自动测试（全量）
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
npm run smoke      # 直接跑测试套件（需自传 --base / --proxy / --out）
```

---

## 四、端点清单

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
| 分辨率 → 像素 | `480p`→864×480（megapixels 0.4）/ `768p`→1376×768（1.0）/ `2k`→1920×1088（2.0） |

---

## 五、实现说明（为什么需要代理）

- Drama Backend（`117.50.108.73:8082`）**无鉴权，但也不发 CORS 头** → 浏览器直接 fetch 会被拦。
  所以 `vite.config.ts` 起了两个**同源中间件**：

  | 路由 | 作用 |
  |---|---|
  | `/api/proxy?target=<base>&path=<endpoint>` | 通用转发（GET / POST，含 multipart），流式回传 |
  | `/api/fetch-to-upload?target=<base>&url=<mediaUrl>` | 服务端把远端媒体字节拉下来 → `POST /upload` 换句柄，**绕开前端取字节的 CORS** |

- 两个中间件在 `configureServer` **体内同步注册根中间件**（不是 post-hook），
  以保证**先于 Vite 的 SPA fallback** 命中；同时手动剥离沙箱注入的 base 前缀。
  `vite preview` 走 `configurePreviewServer` 同款逻辑，所以 `dist/` 产物也能代理。
- 代理上游超时设为 **30 分钟**，避免长视频生成被中途掐断。

目录结构：

```
api-playground/
├── run.sh                  # 启动 / 测试脚本
├── index.html
├── vite.config.ts          # 两个同源代理中间件 + dev/preview 配置
├── scripts/smoke.mjs       # 无头自动测试套件（产出 report.html）
└── src/
    ├── endpoints.ts        # 12 个端点的唯一 schema 源（表单 + 请求体都由它驱动）
    ├── api.ts              # 请求层：proxy 调用 / 媒体类型推断 / URL→句柄
    ├── App.tsx             # 三栏界面 + 素材库 + 页内测试报告
    └── styles.css
```

---

## 六、排障

| 现象 | 原因 / 处置 |
|---|---|
| `curl localhost:5188` 返回代理错误而非页面 | 本机 shell 注入了 `HTTP_PROXY`，本地访问要加 `--noproxy '*'` |
| 代理返回的是页面 HTML 而不是接口 JSON | Vite 的 cwd 不对（必须在 `api-playground/` 下启动），配置没被加载 |
| 端口被占 | `PORT=5199 ./run.sh start` |
| 视频端点等很久 | 正常，单次约 4~5 分钟；急用就 `--fast` |
| 报告里 `fetch-to-upload` 失败 | 检查目标媒体 URL 是否可直接下载（`/view?filename=...` 返回的是真字节，OK） |
