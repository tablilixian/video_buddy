# OpenChatCut 单模板接入方案（2026-11-13 · 方案稿，不含实现）

> **回答的问题**：把 OpenChatCut 里的**一个模板**接到我们项目中，完整要做哪些事。
> **性质**：方案文档。**本文不附实现**——实现等你拍板选型后另起批次。
> **前置阅读**：`2026-11-13-openchatcut-借鉴方案.md`（资产盘点）与
> `2026-11-13-openchatcut-技术路线对标.md`（路线红线）。

---

## 0. 先把"接"字说清楚：三种语义，只有一种可行

| 路径 | 做法 | 判定 |
| --- | --- | --- |
| **直装** | 把它的模板 JSON/JSX 原样装进我们的渲染链 | ❌ **不可行**。它的模板本体是 **JSX 代码**（`code` 字段），依赖 React + babel 沙箱运行时（`@babel/standalone` 在它依赖里）；我们的渲染器吃 **manifest JSON 数据**（REQ-038 非目标 1：对方产出代码，我们产出数据）。直装 = 引入 React 运行时沙箱 + 代码资产管线，同时破坏红线②（DSL 数据面）与红线③（零打包） |
| **翻译式接入** ★ | 把选定模板**当作设计规格**，按我们既有译法（SSR 消化批已验证）翻译成我们的模板五件套 | ✅ **推荐**。与 `press/ink-open` 翻译 Ink Press 工程同一模式，成本已知、风险已知 |
| **参考式借鉴** | 只读它的参数表/节拍，不产出模板 | ⚪ 适用于它的模板不合适时（见 §2 选型） |

---

## 1. 源对象剖析：OpenChatCut 侧"一个模板"长什么样

### 1.1 实体形态（查证结果）

它仓内**没有内置 MG 模板实体文件**——MG 模板是流动形态：

```
用户/agent 在编辑器会话里创作 MG（JSX + 可编辑属性）
  → 导出为 openchatcut-plugin@1 JSON 包（plugins/export.ts，产物必须过 validatePack）
  → 经资源中心（ExtensionCenter）分发，官方资源 MIT 许可
  → 安装后由 pluginTemplateCatalog.ts 映射成编辑器 Tpl 供拖放使用
```

单个模板条目的完整 schema（`src/plugins/types.ts:51-64`）：

```ts
{
  type: 'mg-template',
  id: string, name: string, desc?: string, thumb?: string,
  code: string,                    // ★ 模板本体：一段 React JSX（运行时进沙箱编译）
  width?: number, height?: number, durationInFrames?: number,
  props?: Record<string, unknown>, // 缺省值
  propSchema?: Array<{             // 可编辑属性合同
    key: string, type: string,     // text | number | color | boolean | select
    defaultValue?: unknown, label?: string,
    min?: number, max?: number, step?: number,   // 数值软范围
    options?: Array<string | {label, value}>,    // select 选项
  }>,
}
```

编辑器侧应用形态（`src/types.ts:15` 的 `Tpl`）：`{id, name, category, width, height, fps,
durationInFrames, props, propSchema, thumb, code}` → `addMotionGraphic(tpl)` 把 **code 快照**
写进时间线 item，运行时沙箱编译。

### 1.2 拿到模板实体的三个渠道（步 0 的选项）

| 渠道 | 做法 | 备注 |
| --- | --- | --- |
| ① 资源中心下载 | 在它的桌面版 ExtensionCenter 里选官方模板卡（MIT 许可），导出插件包 JSON | 许可最干净；模板质量有官方背书 |
| ② 用户提供插件包 | 拿别人分享的 `openchatcut-plugin@1` JSON | 需先看包内许可标注（社区贡献者自选许可） |
| ③ 会话内现做再导出 | 起 OpenChatCut，用它的 agent 创作/改造一个 MG，导出插件包 | 最灵活——可以刻意挑"我们 DSL 拼不出来的形态"来测翻译边界 |

**许可注意**：官方资源 MIT；社区包自选许可——**接入前必须确认包内/来源页的许可标注**，
与我们音效库"无法溯源不收"同纪律。

---

## 2. 翻译式接入的完整工序（七步）

> 角色约定：**A** = 执行 agent（我）；**U** = 你（拍板与真机）。
> 每步标了耗时（合计 **0.5–1 天/模板**，首模板取上限）。

### 步 0 · 选定模板并拿到实体（U 决策 + A 执行 · 0.5h）

- **U 拍板**：接哪一类（产品字卡 / 数据展示 / 转场包装 / 列表动效——建议从**纯文字+图形类**选起，
  翻译保真度最高；含 WebGL/shader 的跳过）。
- **A 执行**：按 §1.2 渠道拿到 `openchatcut-plugin@1` JSON，`validatePack` 语义核对
  （字段/大小/试编译的包级校验我们复刻为只读检查），确认许可标注。
- **产出**：选型记录（模板名/来源/许可/一条 `mg-template` 条目）。

### 步 1 · code(JSX) 结构化解读 → 翻译工作底稿（A · 1–2h）

把 `code` 字段当**设计规格**读，产出一份底稿（贴在模板 README 里）：

1. **组件树清单**：每个 JSX 元素 → 视觉角色（底板/标题/图形/高亮框）；
2. **props → 槽位候选表**：每个 `propSchema` 条目标注「进 slots 还是烘死」——
   文案类（text）→ slots；数值范围类（number+min/max）→ slots（数值约束）；主题色（color）→
   slots 或 accentColor；布局常量 → 烘死；
3. **节拍提取**：所有 `interpolate(frame, [a,b], …)` / `spring(...)` → 帧位/时长/缓动表；
4. **渲染依赖清单**：用了哪些 React 特性/动画库/canvas——标出"必须预烘焙"与"必须降级"的项
   （对照 §3 降级清单）。

### 步 2 · 槽位设计 → `slots.json`（A · 1h）

- 每个「进 slots」的 prop → 一个槽位：`maxChars` 按 JSX 里字号×盒宽估算；
  数值型写 `type:'number'` + `min/max/step`（来自 propSchema）；枚举（select）→
  **拆成多卡或烘死**（我们的 slots 暂无 select 型，见 §4 扩展项）；
- 全部槽位带 `default`（取 props 缺省值）——保持"缺省可出样片"惯例；
- 文案中文化（去它的品牌词），`semantic` 写清这个槽在画面里干什么。

### 步 3 · 轨道翻译 → `manifest.template.json`（A · 2–4h，最重的一步）

按组件树逐元素翻成轨，映射表：

| 它的 JSX/CSS | 我们的 DSL 原语 | 备注 |
| --- | --- | --- |
| `<div>` 底色/色块 | `shape:'rect'` | box 百分比中心语义，x/y=中心 |
| 圆角 | `shape:'rect'` + `radius`（RQ-04 原语） | |
| 描边框/虚线环 | `stroke/strokeWidthPx/dash`（RQ-04） | |
| 径向光晕/聚光 | `shape:'gradient'` + `gradientType:'radial'`（RQ-06） | CSS radial 在 web-renderer 被忽略——必须走我们 SVG 通路 |
| 标题/字幕文本 | `textCard`（variant + `color` + `letterSpacingEm` + `plate:'none'`） | "别把整句上屏"纪律照守 |
| 逐词/逐字入场 | `anim`（fadeUp/maskReveal/typewriter/wordStagger） | 非等间隔 per-char 降级为等间隔（已知边界） |
| `interpolate` 位移/缩放 | `animate` 数组多段折线 | **注意：box 轨禁 animate x/y**（位移类演出改 scale/opacity，或改用 shape 轨）——SSR 消化批守卫实测的高频坑 |
| 相机推拉（若有） | `image.camera.keys`（RQ-23） | 换算 `x=(960−cx)×zoom` |
| 同构元素组 | `logoWall/assetGrid/chipRow`（RQ-22） | |
| `Math.random()` 装饰形态 | **制作期预烘焙**（mulberry32 同款算法跑一次写死） | 确定性纪律 |
| 运行期每帧数学图形 | 制作期预烘焙静态 `d`/常量 | gauge 模板先例 |
| 动画库（spring/gsap 类） | `easing:'spring'` + 物理参数，或白名单档位就近 | |
| **WebGL/shader/canvas 每帧绘制** | 无对位 → **步 0 就该跳过这类模板** | 红线③ |

### 步 4 · 音频与装饰（A · 0.5h）

- 上游 SFX 钉点（若有）→ `audio.json` 的 `sfx[]`，**换用我们包内 fx 音效库**
  （`/canvas-studio/remotion/fx/`，31 支，不许带它的音频文件——许可与打包双原因）；
- 需要 BGM → 写 `bgm` 配乐位（prompt/音量/淡入淡出/时长）；
- 装饰构件（进度条/括线）→ `furniture.json`（可选构件：progressBar/cornerBrackets/starfield/cardWall）。

### 步 5 · 五件套落盘 + 命名（A · 0.5h）

- 目录：`assets/templates/<family>/<id>/`（family 按+体裁取：如 `promo/`、`data/`、`press/`）；
- 五件套：`meta.json`（含 `lintSuppress` 如需）+ `slots.json` + `manifest.template.json` +
  `furniture.json` + `audio.json` + `README.md`；
- **README 必含翻译对照表**（它的字段/节拍/降级项逐条列出——SSR 消化批的既有惯例，也是
  "SSR 模板学习"的验证记录）。

### 步 6 · 验证链（A · 0.5h）

```sh
# ① 全部 JSON 可解析
# ② 编译（缺省值出样片）：
node --input-type=module -e "compileTemplate(loadTemplateBundle('<family>/<id>').bundle, …)"
# ③ 产物过 validateManifest：0 error；0 warning（或 lintSuppress 已声明）
# ④ 全卡守卫若做成卡（非模板）同样要过：tests/req038-cards-catalog.test.mjs
# ⑤ 全量门禁：
corepack yarn typecheck && corepack yarn build && corepack yarn test:smoke
```

期望：10+1 个模板、`problems: []`、smoke `失败 0 条 / 名单外新增 0 条`。

### 步 7 · 登记与注册（A · 0.5h）

- `tests/remotion-template.test.mjs` 的 `REAL_TEMPLATES` 数组 +1；
- 模板 README 的翻译对照表定稿（含"降级项"与"未还原项"如实记录）；
- 本文档的执行记录小节回填（实际耗时/遇到的新降级模式）；
- 提交（`git commit -- <精确路径>`），**真机验收由 U 安排**（`scaffold_manifest` + 缺省样片）。

---

## 3. 已知降级清单（翻译时对照，避免现场纠结）

| 它的 JSX 能力 | 我们的处置 | 性质 |
| --- | --- | --- |
| 每帧任意计算（表达式动画） | 制作期预烘焙（逐帧采样写常量/keys） | 已验证译法 |
| 伪随机装饰形态 | 制作期预烘焙（同 seed 算法） | 已验证译法 |
| 非等间隔 per-char 时序 | `anim` 等间隔近似 | 已知边界 |
| 动态模糊/辉光滤镜 | 省略 / 预生成资产 / fx:'glow' 近似 | 已知边界 |
| per-word/per-clip 分色 | 整行单色（或拆多轨） | 已知边界 |
| 自定义贝塞尔曲线 | easing 白名单就近档位 | 已知边界 |
| WebGL/shader | **跳过该模板** | 红线 |
| React 状态/交互逻辑 | 模板是纯帧函数——状态类"模板"（可拖拽的 UI mock）不适用 | 红线 |

---

## 4. 顺带的两个小扩展（可选，非本任务必需）

1. **slots 数值约束**：它的 `propSchema.min/max/step` 比我们 slots 合同细——若接的这个模板
   有数值槽位，顺手给 `slots.json` 加可选 `min/max/step` 并让 `template-compile` 消费
   （借鉴方案 M-4，1 天，可独立做也可合并进本任务）；
2. **`lintSuppress`**：若翻译产物的节拍属"上游原拍"（如多元素同时蒸发），在 meta.json
   声明豁免编号（机制已就位，不新增代码）。

---

## 5. 验收标准（什么叫"接好了"）

- [ ] 选型记录三要素齐全（模板名 / 来源渠道 / 许可标注）；
- [ ] 五件套 + README 翻译对照表入库；
- [ ] 编译出样片：缺省槽位直接 `compileTemplate` 成功、`validateManifest` 0 error、
      warnings 为 0 或已 `lintSuppress` 声明；
- [ ] 全量门禁绿（typecheck/build/verify:loader/test:smoke）；
- [ ] `REAL_TEMPLATES` 注册表 +1，`listTemplateSummaries().problems` 仍为空；
- [ ] README 如实列出**未还原项**（保真度对照不得只写还原项）；
- [ ] 真机 `scaffold_manifest({ templateId })` 出片由 U 目检（待 U 排期）。

---

## 6. 工作量 / 时间 / 角色

| 项 | 估计 |
| --- | --- |
| 单模板合计（步 0–7） | **0.5–1 天**（首模板取上限 1 天，含底稿与映射表冷启动；后续同族模板 0.5 天） |
| A 的工作 | 步 1–7 全部 |
| U 的工作 | 步 0 选型拍板 + 渠道①的桌面版操作（或给包文件）+ 步 7 真机目检 |
| 并行性 | 翻译链路已全部验证过（SSR 消化批 5 模板 + 46 卡），无探索成本 |

## 7. 风险与回滚

| 风险 | 缓解 |
| --- | --- |
| 选到的模板重度依赖 shader/React 状态 | 步 1 底稿阶段即识别，**步 0 重选**（沉没成本 ≤1h） |
| 翻译产物有未还原项引发观感落差 | README 保真度表如实标注 + U 真机目检决定取舍；模板独立可整体回滚（`git rm` 目录 + 注册表 -1） |
| 它的许可标注不明 | 渠道②的社区包按红线直接放弃，换渠道① |

## 8. 需要你拍板的三件事

1. **选哪个模板**（建议：先从它资源中心的**官方 MIT 模板**里挑一个纯文字+图形类；
   若你想要"测我们翻译边界"的，选渠道③刻意做一个含复杂动画的）；
2. **接入后的 family/命名**（建议按体裁进现有 family：`promo/`、`data/`、`press/`…，不新开 family）;
3. **是否顺带做 slots 数值约束**（§4 扩展 1；做了以后所有数字/颜色槽位都有 min/max/step——
   1 天，独立可回滚；不做则本模板数值槽位走"校验器手写"的既有方式）。

> 你拍板后，说一声"按方案执行"，我按步 0–7 走完并交付验收清单。
