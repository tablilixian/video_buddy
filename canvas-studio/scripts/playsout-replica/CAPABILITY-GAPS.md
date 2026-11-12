# 能力缺口 → 可扩展路线

> 来源：2026-11-12 的 playsout 60s 宣传片复刻（12 镜头 / 1800 帧 / 174+79 轨）。
> 每条都标了**本次踩到的实证**，以及**扩了之后能做成什么**、**成本**、**优先级**。
> 优先级口径：**P0** = 改动小、收益直接（一次评审就能落）；**P1** = 需要设计决策；**P2** = 依赖外部（web-renderer 升级）或工具链建设。

---

## A. 渲染器层（CSR 捕获路径的能力边界）

| # | 缺口 | 实证 | 扩展方案 | 成本 | 优先级 |
| --- | --- | --- | --- | --- | --- |
| A1 | `backdrop-filter` 整字段无效 ⇒ 磨砂玻璃做不了 | `canvas-studio/AGENTS.md`：4.0.535 像素实证；本次「药丸底板 / 代码面板 / 描边框 / 命中环」全部改走**预生成 PNG** | 三条路：① 预生成资产流水线化（见 C2）② 升级 web-renderer 后按 `scripts/capability-bench/` 回归放行 ③ 若长期不放开，给 DSL 一个 `glass` 原语，内部用 PNG 纹理 + 半透明合成近似 | ①低 ②中 ③中 | P2 |
| A2 | `mix-blend-mode` 无效 ⇒ 发光叠加 / 擦除合成做不了 | 同上（AGENTS.md 明确「blend 别新写」） | ① 同 A1③：新增 `blend` 语义但内部用预乘 alpha 的 PNG 合成 ② 等 web-renderer 升级 | 中 | P2 |
| A3 | 真 3D 会把整棵子树拽进 WebGL 预合成（贵 3–5 倍：14ms/帧 → 77ms/帧）⇒ 相机推镜只能是弱透视 | `animated-style.ts` 注释 + 能力基准 #12 | 给 `group` 提供**静态 `perspective`** 且规定「3D 子树必须是 group」—— 把预合成范围钉死在 group 内，而不是整棵树 | 中 | P1 |
| A4 | CSS `radial-gradient` 平铺被忽略 ⇒ 径向渐变（光晕）无原语 | `timing.ts` 的 `metal` 注释：dotGrid 必须另走 SVG pattern；本次 5 张光晕全是预生成 PNG | 给 `shape.gradient` 加 `radial` 类型（现只有 `linear-gradient(135deg,…)`）—— 一个 case 的量 | 小 | **P0** |
| A5 | 没有灰度原语 ⇒ logo 灰阶版只能预生成（本次 21 张） | `TrackFx` 枚举无 `grayscale`；`fxStyles` 的 `filter` 通路已存在（blur / drop-shadow 在用） | 加 `fx:'grayscale'`：**只需在 `fxStyles` 加一个 case**（`{ filter: 'grayscale(1)' }`），度量与渲染同源，改动面最小 | 极小 | **P0** |
| A6 | 层叠只能靠数组顺序（没有 z-index）⇒ 分层编排要靠「数组位置」表达 | 校验器仍报「z-order 风险：全屏 image 轨排在内容轨之后」 | 给轨加 `zIndex` 字段，渲染前做一次**稳定排序**（同 z 保持原序 ⇒ 老 manifest 逐像素不变） | 小 | P1 |

## B. manifest 原语层（DSL 缺的原语）

| # | 缺口 | 实证 | 扩展方案 | 成本 | 优先级 |
| --- | --- | --- | --- | --- | --- |
| B1 | `shape` 没有圆角 / 描边 / 虚线 ⇒ 药丸、圆角卡、命中环做不了 | `shape` 白名单 = rect/circle/line/gradient/path/arrow/triangle/star/polygon/dotGrid，**无 radius**；本次 4 类预生成 PNG 顶替 | `shape.rect` 加 `radius`、`shape.circle` 加 `stroke` / `dash` —— 一次覆盖 4 处预生成 | 小 | **P0** |
| B2 | 没有逐位 odometer（数字滚轮） | `textCard.title` 基准字号写死 84px、最多 2 行（`text-fit-plan.ts`）；源片 Metrics 是 124px 逐位滚轮 | 给 `textCard` 加 `numeric:'odometer'`（可复用 `count-up.ts` 的帧函数思路） | 中 | P1 |
| B3 | `animate` 没有「段内变速」（speed ramp） | `animate` = 分段 + 缓动白名单（linear/easeIn/…/spring），无自定义曲线 | `animate` 增加可选 `curve`（缓动名或贝塞尔数组） | 小 | P1 |
| B4 | **有 `box` 的轨不能声明 x/y** ⇒ 「从画外飞入」只能绕 `group` | `transform`/`animate`/`exit`/`orbit` 与 `box.x/y` 互斥（校验层 error）；本次 PRISM 汇聚卡 / Outro 合影块 / Compute 推镜全部用 `group` 承担位移 | ① 给 `box` 加 `offset`（盒子中心之上的额外位移）② 或允许 `box` + `animate.x/y`，并把 `animate.x/y` 定义成**相对 box 的偏移**（默认绝对 ⇒ 老 manifest 不变） | 小 | P1 |
| B5 | 文本分色做不到（同一行内多色） | `textCard.title` 分支写死 `#e6edf3`，`accentColor` 只在 dataCard/timecode 生效；本次「The **entertainment**」只能拆两轨 ⇒ **每轨一个矩形底 ⇒ 可见接缝** | 给 title 加 `runs`（一行内多段 + 每段颜色/效果），并把 title 变体硬编码的 `rgba(0,0,0,0.35)` 底改成可选（见 B6） | 中 | P1 |
| B6 | 渲染器不施加 `letter-spacing` ⇒ 源片 -0.022em 紧排无法 1:1 | 实测：「The」@84px 墨迹 147.26px = HarfBuzz **无字距** advance（扣字距应是 141px） | 给 `textCard` 加 `letterSpacing`（px），并同步进 `text-fit-plan.ts` 的度量 —— 度量与渲染同源，扩展点很干净 | 小 | **P0** |
| B7 | SFX 不能从源内起始帧起播 | DSL 的 `audio.sfx[]` 只有 `src`/`startFrame`/`gain`；源片 `impact-cine-big` 从第 55 帧起 | 加 `startFrom`（帧），语义与源工程一一对应 | 极小 | **P0** |
| B8 | 字幕形态只有「产品式词级高亮」 | `caption` 轨自带三态（白 / 青 #5ad2ff / 28% 白）；源片是纯白硬字幕 ⇒ 观感偏差 | 给 caption 加 `highlight:'none' \| 'word'` | 极小 | **P0** |
| B9 | `title` 变体在 box 上硬编码 `rgba(0,0,0,0.35)` 底 ⇒ 有 box 的标题卡永远带一块暗矩形 | 本次 t1/t2/t3 标题卡下方可见矩形（`TextCard.tsx` title 分支） | 加 `plate:'auto' \| 'none'`（缺省沿用旧行为 ⇒ 老 manifest 逐像素不变） | 极小 | **P0** |

## C. 素材链

| # | 缺口 | 实证 | 扩展方案 | 成本 | 优先级 |
| --- | --- | --- | --- | --- | --- |
| C1 | 没有「真实界面截图 → 2.5D 推镜纹理」的采集链 | 源片用 4 张超长页面纹理（`home-full` 6999px 高）做推镜；我们只能用现成图 | 产品加一个工具：Playwright 截图 → 切片纹理 → 落资产目录 → 出 URL 清单（与本次 `stage-assets.mjs` 同构） | 中 | P1 |
| C2 | 预生成资产没流水线化（本次 19 张 PNG 是手写生成函数，散在脚本里） | `stage-assets.mjs` 内的 `glowPng/scrimPng/pillPng/...` | 沉淀成 `scripts/prerender-assets/` 资产包（参数化 + 清单 + 一条命令出全套），并与 A1/A5/B1 的原生化路线**双轨并行**（原生化前先用 PNG 顶） | 中 | **P0** |
| C3 | 展示字体只能走 `global.fonts[].src` 同源 URL | 产品只随包 Noto Sans SC；本次 NBDisplay ExtraBold 走项目 assets 目录 | 已可行，无需扩展；只需把「`.woff2` 走资产路由时 Content-Type 是 `application/octet-stream` + `nosniff`」这条**实测结论**写进契约（实测照样加载成功） | 极小（文档） | **P0** |

## D. 工程与工具

| # | 缺口 | 实证 | 扩展方案 | 成本 | 优先级 |
| --- | --- | --- | --- | --- | --- |
| D1 | 手写大 manifest 必错 | 2026-11-05 有 3h37m 零成片的前车之鉴；本次 174 轨 / 1800 帧靠脚本生成 | 把「规格（spec）→ 产物（manifest）」固化成规范与模板（本次 `lib/spec.mjs` → `build-manifest.mjs`） | 小 | **P0** |
| D2 | 缺「manifest ↔ 像素」的对拍工具 | 本次自建 `scan-ink.mjs`（逐像素量墨迹）才发现旧 manifest 的文字整体右移 70px —— 而 `validateManifest` 当时报 **ok=true** | 产品内置 `scripts/measure-text-layout.mjs`：给定 manifest + 帧号，输出每条文本轨的**墨迹框 vs 期望框** | 中 | **P0** |
| D3 | 校验层对「文字实际落点」无感知 | 同上：落点错了但校验零错零警 | 把浏览器侧已有的 `text-fit-audit.ts`（真实字形测量）升级成「**落点审计**」：box 中心 vs 墨迹中心，超出容差报 warning | 中 | P1 |

---

## 一句话结论

**渲染器层**目前是「CSR 捕获路径不支持的 CSS 一律退化」；能靠**预生成资产**绕开的（A1/A2/A4/A5/B1）都已经绕开了，剩下的是 **web-renderer 版本**决定的长期项。
**manifest 原语层**的缺口最值得补：**B6（letter-spacing）、B7（SFX 起始帧）、B8（字幕形态）、B9（标题底色）、A5（灰度）、B1（圆角）** 六条都是「几十行、零架构风险、当天可落」，补完之后本次这类宣传片**不再需要任何预生成 PNG**（除玻璃拟态外）。
**B4（带 box 元素的位移）+ B5（文本分色）** 是两条真正影响成片观感的（分别导致「绕 group 绕路」和「标题下方可见矩形接缝」），需要一次设计决策，建议优先排期。
