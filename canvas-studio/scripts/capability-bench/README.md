# capability-bench —— Remotion 能力基准（L1 独立合成）

> 一条命令：`bundle → 静态服务 → Electron → renderMediaOnWeb → 5 条硬检查 → contact sheet → verdict/README/probe`。
> **产品代码零改动**，新代码只在本目录；产物落 repo 外（`~/Desktop/job/VideoOut/remotion-capability-<date>/NN-axis/`）。

**当前进度（2026-10-30 凌晨，十项全部完成）**：**10/10 出片、H1~H5 全绿**（`--repeat=2` 逐帧 md5 全等）。目视分：#04 #05 #06 #07 #10 = 5；#01 #02 #08 #09 = 4（各扣 1 处渲染器已知边界）；#03 = 3（全量捕获丢 WebGL canvas 内容）。产物根 `~/Desktop/job/VideoOut/remotion-capability-20261029/`（REPORT/metrics/INDEX/DECISIONS 齐），repo 内索引 `docs/plans/remotion-capability-20261029/INDEX.md`。收尾汇总脚本：`NODE_OPTIONS= node scripts/capability-bench/summarize.mjs`。
**四个新实证的渲染器边界（复跑前先读）**：① `mix-blend-mode` 无视（A9）；② clock 的 conic mask 无视 + flipX 的 perspective 丢失（A2，clip-path polygon 修法已演示）；③ 全量捕获丢 WebGL canvas 内容（默认模式反而正常，#01 证据）；④ `useVideoTexture` 的 `<video>` 永不 loaded（#01 降级记录）。写法约束：图片用 `<Img>` 不用 `background-image: url()`；`<Audio>/<Video>` 从 `@remotion/media` 导入。

## 一、怎么跑

```bash
cd canvas-studio

# 1) 单条（最常用）
NODE_OPTIONS= node scripts/capability-bench/run.mjs --only=10

# 2) 带可复现比对（H4 要求渲两次）
NODE_OPTIONS= node scripts/capability-bench/run.mjs --only=10 --repeat=2

# 3) 换窗口档 / 开 Chromium 能力开关
NODE_OPTIONS= node scripts/capability-bench/run.mjs --only=03 --window=hidden --flags=CanvasDrawElement

# 4) 只验能不能打包（2–5s，不启 Electron）
NODE_OPTIONS= node scripts/capability-bench/run.mjs --only=10 --bundle-only

# 5) 跑所有已完成项（status=done）
NODE_OPTIONS= node scripts/capability-bench/run.mjs --all --repeat=2

# 6) 强制开/关全量捕获（A/B 对照用；不给就跑 spec.allowHtmlInCanvas）
NODE_OPTIONS= node scripts/capability-bench/run.mjs --only=03 --flags=CanvasDrawElement --html=1
NODE_OPTIONS= node scripts/capability-bench/run.mjs --only=03 --html=0
```

- `NODE_OPTIONS=` 必须留空：父 shell 的注入项会干扰 esbuild/webpack。
- 跑完看 `~/Desktop/job/VideoOut/remotion-capability-<date>/NN-axis/README.md` 与 `verdict.json`。
- **判定"这次真渲了"只看 mp4 的 mtime**，不信脚本打印的清单。

## 二、加一条新能力项（4 步，别多做）

1. `compositions/NN-<axis>.tsx`：导出 `meta`（含 `durationInFrames` / `expect` / `stills` / `assets`）与 `Composition` 组件。
2. `compositions/entry.tsx`：`import * as capNN from './NN-<axis>.js'`，在 `REGISTRY` 里加 `'NN': capNN`。
3. `specs.mjs`：把该项 `status` 改成 `done`（或 `substitute`）。
4. `NODE_OPTIONS= node scripts/capability-bench/run.mjs --only=NN --repeat=2`。

**不要**为每条单独 bundle、不要把源码拷进产物目录（D4：单 bundle 多 composition，10 条只 webpack 一次）。

## 三、目录职责

| 路径 | 干什么 | 能不能手改 |
|---|---|---|
| `run.mjs` | 驱动：打包 → 服务 → Electron → 检查 → 落盘 → 索引 | 可以 |
| `specs.mjs` | 十项规格表（**唯一的"要测什么"来源**）+ 素材池绝对路径 | 可以 |
| `compositions/NN-*.tsx` | 每条的合成（画面） | 可以 |
| `compositions/shared.tsx` | 规格 / 字体 / 调色 / 角标 / 画布框 | 可以 |
| `lib/server.mjs` | 同源静态服务（bundle + `/pool/*` + `/fonts/*` + `/__config` + `/__save`） | 少动 |
| `lib/electron.mjs` | spawn Electron：**删 `ELECTRON_RUN_AS_NODE`**、解析 `[bench]` 事件 | 少动 |
| `lib/checks.mjs` | H1~H5 + contact sheet | 少动（改判据要同步文档 §9.4） |
| `lib/report.mjs` | verdict / README / source / probe / INDEX | **产物文件不许手写** |
| `.bundle/` | webpack 产物（可删，会重建） | 别提交 |

## 四、五条硬检查（机械判，不看感觉）

| # | 判据 | 门槛 | 实测校准值 |
|---|---|---|---|
| H1 | 逐帧 Y 跨度 ≤8 记为"平帧"，看占比 | ≤20% | 真渲片 0/299；**注意：角标自身有对比，H1 只能证明"画布上有东西"** |
| H2 | 首末帧 SSIM | <0.98 | #10 实测 0.76 |
| H3 | `duration ≈ 帧数/fps ±1 帧`、fps 精确 | — | 10.069s vs 10.000s @30fps |
| H4 | 两次渲染逐帧 md5 | 全等 | **772/772 全等**（含音频包） |
| H5 | codec / 分辨率 / 音轨 | 与 `spec.expect` 一致 | h264 1920×1080 + aac |

`autoScore` = 通过条数（H1 或 H5 红直接 0）。`humanScore`（0–5）与 `missing`（归因编号 A1~A10）由**目视后手填**，填进 `verdict.json`。

## 五、已知坑（都会让"看起来成功"其实是假的）

| 坑 | 现象 | 处置 |
|---|---|---|
| 产物目录在 repo 外 | `unlink EPERM`（受管 shell 拒删） | 代码已 try/catch；**判据靠 mtime**，不靠"删干净" |
| `probe.mjs --out` 指向条目目录 | 会套一层 `NN-axis/NN-axis` | 已修（`basename` 相同则直接用） |
| 单条复跑 | 会把 `INDEX.md` 只写成一行 | 已修（`INDEX.json` 按 id 合并） |
| 素材暗场 | contact sheet 某格全黑，像"没渲" | 挑 trim 时避开；源片 21–24s 是暗场 |
| `--repeat=1` | H4 记 `not-run`，autoScore 掉到 4 | 交最终产物时用 `--repeat=2` |
| 字体 | 不注入就回退系统字体，换机 tofu / 不可复现 | `entry.tsx` 已注入 `@font-face` 并等 `document.fonts.ready` |
| `--flags=CanvasDrawElement` | 带 flag 时 `loadURL` 偶发 `ERR_FAILED`（约 2/9） | 重试一次；仍失败就记 `A10` |
