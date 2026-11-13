# PlaysOut 5 分钟汇报片 · 一次性脚本归档（2026-11-13）

这批脚本用于把外部数据源 `playsoutapi/ops-dashboard/build-5min/` 的 manifest 渲成静帧 / 成片，以及抽查具体元素在 DOM 里的几何。**是一次性取证工具，不是产品代码。**

## 为什么放在 `docs/archive/` 而不是 `scripts/`

1. **不进 npm 包**：`canvas-studio/package.json` 的 `files` 只含 `cordis.patch.yml` / `assets/**` / `lib/**` / `skills/**` / `README.md`，`docs/` 与 `scripts/` 都不打包 —— 但放 `docs/` 语义上明确是「归档」，不会被当成可复用工具。
2. **硬编码只用这台机器**：数据源绝对路径、Chrome 可执行路径、`/tmp` 输出位置全部写死，换机器 / 换片子就得改。
3. **相对路径自洽**：所有脚本按同目录取 entry（`new URL('./entry-test.tsx', import.meta.url)`），所以本目录必须保持扁平，别再分子目录。

## 文件清单

| 文件 | 用途 |
| --- | --- |
| `entry-test.tsx` | 主入口：加载 5 分钟片的完整 `manifest.json`，composition id = `studio-composition` |
| `chart-entry.tsx` | 图表验收入口：加载 `chart-acceptance.json`（10 条 chart 轨），id = `chart-acceptance` |
| `entry.tsx` | 最早的最小入口（同 `entry-test`，无 webpack alias） |
| `entry-debug.tsx` | 探针入口：渲染时用 `delayRender` + DOM 查询打印某一行的 `getBoundingClientRect` / computed style，用于查「元素到底在不在画面上」 |
| `render.mjs` | 批量静帧（16 个关键帧，`scale: 0.5`）→ `build-5min/stills/` |
| `still.mjs` | 单帧排查（固定 3 个帧号 → `/tmp/off-*.png`） |
| `one.mjs` | 全分辨率单帧（`scale: 1` → `/tmp/one-*.png`），用于裁切看局部 |
| `recheck.mjs` | 改完代码后重渲指定帧号 → `build-5min/stills/`（最常用） |
| `chart-still.mjs` | 验收件静帧（`chart-entry.tsx`，`scale: 0.75` → `/tmp/chart-acc-*.png`） |
| `render-mp4.mjs` | 整片或帧段渲成 mp4（`renderMedia`，h264） |
| `make-chart-acceptance.mjs` | 从 5 分钟片里抽 10 条 chart 轨，重排成 50 秒验收带 → `chart-acceptance.json` |
| `debug.mjs` / `dbg2.mjs` / `dbg3.mjs` | 早期单帧调试（固定帧号 + `onBrowserLog` 过滤浏览器日志），已被 `one.mjs` / `entry-debug.tsx` 取代，保留作历史 |

## 复现

前置：`canvas-studio` 已构建（`yarn build` 或 `tsdown` + `tsc`，脚本 import 的是 `src/`，但组件依赖 `lib/` 的产物）；本机装有 `/Applications/Google Chrome.app`。

```bash
cd canvas-studio/docs/archive/2026-11-13-playsout-5min-scripts

node recheck.mjs 1500 2050 5900          # 重渲指定帧（0.5 倍分辨率，看图用）
node one.mjs 2050                        # 全分辨率单帧 → /tmp/one-2050.png
node chart-still.mjs 75 1125             # 渲图表验收件的指定帧
node render-mp4.mjs 1500 1620 /tmp/a.mp4 # 只渲某段（起点含、终点不含）
node render-mp4.mjs                      # 整片 → build-5min/out/5min.mp4
```

脚本默认吃 `MANIFEST` 常量指向的文件；要换片子，改对应 `entry-*.tsx` 里的 import 路径或复制一份新 entry。

## 已知坑（都是真机踩出来的）

1. **`renderMedia` 会因音效 404 硬失败**，`renderStill` 只打警告不中断。
   `manifest.audio.sfx` 里的 `src` 是宿主相对路径 `/canvas-studio/remotion/fx/*.mp3`，脚本 bundle 的静态服务器没有这个目录 ⇒ `Received a status code of 404`，整条渲染挂掉。
   解法二选一：① `bundle()` 传 `publicDir`，目录内造 `canvas-studio/remotion/fx/` 并塞入 `assets/audio/sfx/*.mp3`；② 把 manifest 的 `audio` 整段删掉（`make-chart-acceptance.mjs` 用的这招）。注意 sfx 的键在 `manifest.audio.sfx`，**不是**顶层 `sfx`。
2. **静帧看不出动效**。`countUp`、gauge 扫针、入场位移都只在中段帧之后才落定，抓帧要取 `startFrame + 60` 之后。
3. **`scale: 0.5` 的字号观感与成片不一致**。判断「字号是否压线」必须用 `one.mjs` 的全分辨率帧再裁切看。
4. 这些脚本走 `@remotion/renderer`（headless Chrome，约 90ms/帧），与真机 `renderMediaOnWeb`（CSR，约 13ms/帧）不是同一条通道；**组件代码是同一份**，像素结果应当一致，渲染耗时不可直接比。

## 相关

- 数据源与讲解稿：`~/Desktop/job/git/playsout/playsoutapi/ops-dashboard/all-time-5min-video-plan.md`
- 本轮修的图表几何：`canvas-studio/src/remotion/chart-layout.ts`、`components/Chart.tsx`，守卫 `tests/chart-axis-scale.test.mjs`
- 提交：`9fd5437f3c`
