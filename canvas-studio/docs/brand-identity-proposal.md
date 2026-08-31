# Canvas Studio 品牌与识别度方案（v0.2 定案稿）

> 定位：品牌方案，Q1–Q5 已由用户拍板（2026-08-31，见 §8 决策记录）；工程锚点（SeniorDeveloper）按 §7 清单落地。
> 前置事实基盘：`docs/brand-identity-audit.md`（代码核查结论，本稿不重复）。
> 技术红线：Cordis plugin `name='canvas-studio'` 不可改名；token 叠加 `@deepseek-ai/dsh-client-ui-theme` 之上；品牌 UI 改动全部落在 `src/client/*`。

---

## 1. 品牌策略

### 1.1 命名分层（对外统一说法）

| 层级 | 名称 | 性质 | 是否可变 |
|---|---|---|---|
| 产品（本插件对外品牌） | **Canvas Studio**（英文主名） | 面向用户的品牌 | 已定案 |
| 产品（中文运营名） | **创意工厂** | 中文语境推广名 | 已定案（2026-08-31） |
| 产品线统称 | AI 漫剧工场 / BigBanana | 大方向统称，仅文档/注释层 | 保留，不对外主打 |
| 技术代号 | `canvas-studio` | Cordis id / package / 路由 / DOM 钩子 | **永不可变** |

统一说法规则：对外一切界面、文档、宣传说 **Canvas Studio（创意工厂）**；「AI 漫剧工场」仅作产品线背景提及；开发代号 `canvas-studio` 只出现在代码与工程文档。

### 1.2 一句话定位

> **Agent 驱动的 AI 视频生产工作台：你定方向，AI 执导全程。**
> 英文版：*The agent-directed AI video studio — you set the vision, your agent directs the production.*

### 1.3 Tagline（已定案 2026-08-31）

- **主 Tagline：From idea to final cut.（从创意到成片）** — 与中文名「创意工厂」同构：输入创意（idea），工厂产出成片（final cut）。
- **副语**：*Let your agent direct.* — 保留，一句话点破差异化（agent 是导演、用户是监制），与场记板隐喻同源。
- 使用场合：定位句用于正式场合（README / 设置页 About）；tagline 用于侧边栏标题 / 欢迎屏 / 首启欢迎屏主视觉。

### 1.4 为什么否决「AI 漫剧工场」作对外品牌

1. **赛道锁死**：名字锚定"漫剧"。产品未来扩展到 AI 广告片、短视频、电影分镜时，名字成为天花板。
2. **与上游绑定**：该名字是 WL-AI-Director 的产品线统称，而 WL-AI-Director 是 **CC BY-NC-SA 非商业许可**的上游参考——对外品牌挂非商业许可以及 fork 生态的名字，有定位与法律联想双重包袱。
3. **认知桥接为零**：与内部代号 `canvas-studio` 无关联，改名成本高、收益低。
4. 保留为"产品线"层级说法即可，不冲突。

### 1.5 为什么保留「Canvas Studio」作英文主名

1. **零改名成本**：与内部代号一致，认知桥接最强，桌面侧边栏/标题栏直接可用。
2. **"Studio"承载创作感**：对标 Runway Studio / Adobe Studio 系列，语义正确。
3. 名字普通的问题（"Canvas"在 AI 圈泛滥）**由视觉系统补**——识别度押在 logo、accent、排版上，不押在名字本身。
4. 中文名与英文名不直译属正常品牌惯例（抖音/TikTok、快手/Kuaishou），语义由 tagline 与定位句桥接；不推荐为统一而改英文名。

### 1.6 中文名（已定案：创意工厂）

- **创意工厂**：产品解释力强——"创意"点明输入（idea），"工厂"点明自动化生产（agent 流水线），与 tagline *From idea to final cut.* 同构；与产品线「AI 漫剧工场」共享"工厂/工场"家族感。
- 中文名与英文主名 Canvas Studio 不直译（品牌惯例），语义由 tagline 与定位句桥接；如后续希望英中一致，可考虑以 "Idea Factory" 作英文副名（不推荐现在动）。

---

## 2. 视觉方向

### 2.1 结论：专业暗色工具风为基底，注入"电影感"accent

**决策理由：**
1. **宿主决定基底**：Canvas Studio 嵌在 DeepSeek Harness（agent 开发桌面）内，右侧就是官方对话区。视觉必须与宿主融合——宿主是深色工具，插件做成明亮风会像贴了一块白补丁。
2. **内容决定取舍**：画布是内容展示区（图/视频产物）。暗色基底 = 画廊效应，图像与视频最突出；明亮风会稀释内容。
3. **用户群匹配**：DSH 用户是开发者/深度 agent 用户，偏好克制、高信息密度的工具审美；明亮创作风（如 Canva 类）与宿主气质冲突。

**气质关键词**：克制 · 高对比 · 精密 · 电影感（cinematic）。不是"黑得压抑"，是"暗得专注"。

### 2.2 参考案例

| 参考 | 借鉴点 |
|---|---|
| **Linear** | 暗色工具的标杆：克制的边框、精细层级、单一 accent 点睛、动效线性干脆 |
| **DaVinci Resolve** | 内容区暗底 + 节点面板 + 时间线的"专业剪辑室"气质（画布区底色比宿主再深一档的思路） |
| **Runway / Luma** | AI 视频创作工具的紫色 accent 语义（已被行业验证为"AI 创作"色） |
| **即梦 / 可灵** | 中文 AI 视频工具的深色主视觉与创作引导 |

### 2.3 三层视觉结构

1. **宿主层**：沿用 dsh `--dsw-alias-*` 全量语义 token（背景/文字/边框/交互态/语义色）——**不动**。
2. **品牌层（本次新增）**：`--cs-*` 品牌 token，叠加在宿主之上，用于 accent、品牌点缀、画布专属底色、glow。
3. **内容层**：画布区底色比宿主 bg 深一档 + 网格点阵，把"创作台"与"工具壳"视觉区隔。

---

## 3. 设计令牌草案（src/brand.ts）

> 命名空间 `--cs-*`（cs = canvas-studio），全部经 `data-plugin='canvas-studio'` 钩子隔离注入。暗色为主轨道，明色轨道仅需 accent 反色。

### 3.1 颜色（可切换 Preset 机制，2026-08-31 拍板）

**架构**：`src/brand.ts` 定义 `BRAND_PRESETS: Record<PresetId, BrandPreset>`，每套含完整 accent 色族；运行时经 `[data-cs-brand="<id>"]` 作用域切换 CSS 变量值，选择持久化到 settings。**默认 cinema-violet；切换只动 accent 族，功能色（gold/teal）与宿主语义色全局不变。**

| Preset | 方向 | accent | strong | deep | soft |
|---|---|---|---|---|---|
| `cinema-violet`（默认） | 电影紫 · AI 创作行业色 | `#7C6CFF` | `#9D8DFF` | `#5B4BD6` | `rgba(124,108,255,0.14)` |
| `ocean-blue` | 偏蓝 · 贴近 DeepSeek 宿主 | `#5B7CFF` | `#7E9BFF` | `#3E5CD6` | `rgba(91,124,255,0.14)` |
| `ember-violet` | 更紫 · 高饱和戏剧感 | `#8B5CF6` | `#A78BFA` | `#6D28D9` | `rgba(139,92,246,0.14)` |
| `amber-creative` | 暖金 · 创作激情/胶片方向 | `#F0A94B` | `#F5C273` | `#C97F2E` | `rgba(240,169,75,0.14)` |

固定功能色（不随预设切换）：`--cs-gold #E8B45A`（HITL 审批）、`--cs-teal #35C2A6`（播放预览）、画布底 `#0F1117` / 网格 `rgba(255,255,255,0.045)`。

明色轨道：各预设 accent 取 deep 值、soft 用对应 12% alpha、画布底 `#F7F7FA`。

**切换入口**：SettingsModal 新增「外观」区（swatch 组或下拉），选择即重注入 + 持久化。

**语义边界（重要）**：成功 / 错误 / 警告等**功能性语义继续走 dsh `--dsw-alias-state-*`**，品牌色不碰语义色，避免双色语义冲突。品牌色只做"创作态"点缀：选中（accent）、审批提醒（gold）、播放预览（teal）。

### 3.2 间距

基数 4px：`4 / 8 / 12 / 16 / 24 / 32 / 48`。
现状代码为 6/8/12 混合，**增量执行**：新组件按此规范；存量样式只改影响品牌感知的关键处（面板内边距、工具栏间距），不逐行重写。

### 3.3 圆角

| Token | 值 | 用途 |
|---|---|---|
| `--cs-radius-sm` | `6px` | 按钮、输入框、小元素 |
| `--cs-radius-md` | `8px` | 面板、卡片 |
| `--cs-radius-lg` | `12px` | 模态、大浮层 |
| `--cs-radius-pill` | `999px` | 标签、审批选项胶囊 |

### 3.4 阴影（暗色低透明度多层）

| Token | 值 | 用途 |
|---|---|---|
| `--cs-shadow-1` | `0 1px 2px rgba(0,0,0,0.4)` | 悬停抬升 |
| `--cs-shadow-2` | `0 4px 12px rgba(0,0,0,0.45)` | 浮层 / 菜单 |
| `--cs-shadow-3` | `0 12px 32px rgba(0,0,0,0.55)` | 模态 / 播放浮层 |
| `--cs-glow-accent` | `0 0 0 1px var(--cs-accent-soft), 0 0 16px rgba(124,108,255,0.25)` | 选中节点光环（画布焦点感） |

### 3.5 动效

| Token | 值 | 用途 |
|---|---|---|
| `--cs-duration-fast` | `120ms` | 悬停 / 按压 |
| `--cs-duration-base` | `200ms` | 面板 / 浮层开合 |
| `--cs-duration-slow` | `320ms` | 模态入场 / 节点生成浮现 |
| `--cs-ease` | `cubic-bezier(0.2, 0, 0, 1)` | 全局曲线（Linear 式线性干脆，工具感） |

---

## 4. 字体策略

**结论：两步走，不引入中文 webfont。**

| 阶段 | 动作 | 理由 |
|---|---|---|
| v1（本次） | 沿用 dsh 默认字体栈，建立**字体层级规范**：标题 / 正文 / 代码 / 数字 token 化；进度、时长、坐标等数字一律 `font-variant-numeric: tabular-nums` | 零成本；识别度先由 logo 与色板承担 |
| v2（已后置 2026-08-31） | 引入 **Space Grotesk**（OFL 许可，仅拉丁）作 display 字体，用于 logo / 品牌标题 / 数字 | 品牌感主要来自拉丁字母的几何气质；中文 webfont 体积与许可都是坑，**不引入** |

令牌草案：
- `--cs-font-display: "Space Grotesk", "Inter", system-ui`（v2）
- 正文/UI 字体继承宿主 `--dsw-*` 字体变量，不重复定义。

---

## 5. 图标隐喻

**结论：场记板（clapperboard）为核心隐喻，画布网格为次级隐喻。**

- **场记板 = "agent 是导演，你喊 Action"**：把产品的人机关系视觉化——agent 编排全链路（导演），用户掌控节奏与审批（监制/总导演）。同时自带"影视生产"语义，与 HITL 介入点完美对应。
- 否决项分析：
  - **画布**：与产品名绑定但概念太泛（OpenAI / Notion / Figma 都在用 canvas），作 logo 无差异化；
  - **胶片**：老派，"胶片"是模拟时代意象，与"AI 生成"气质不符。
- **次级隐喻（UI 装饰层）**：画布网格点阵、节点=镜头、血缘边=剪辑关系——这些已存在于产品形态，空态与引导文案借用"导演/镜头"语汇统一叙事。

**Logo 概念**（供视觉专家细化）：
1. 场记板上半白板内嵌画布网格点阵（连接品牌名与产品形态）；
2. 下半斜条纹用品牌紫 `#7C6CFF`；
3. 极简几何风，favicon 取同款单色简化形（16px 下可辨识：两块斜条即可）。

---

## 6. 状态视觉与首体验框架

### 6.1 三态视觉 + 微文案（文案统一借用"导演/镜头"语汇）

| 状态 | 场景 | 视觉 | 主文案示例 |
|---|---|---|---|
| **empty** | 无项目（首启） | 品牌 logo + 渐变光晕 + 大标题 + 双 CTA | 「从一句话创意开始」/ 副文案：AI 会为你完成分镜、定妆、场景与成片 / CTA：新建项目 · 加载示例项目 |
| **empty** | 有项目无节点 | 画布网格 + 居中引导卡 | 「画布空空如也——在右侧对话描述你的创意，agent 替你排好一切」 |
| **empty** | 未选中项目 | 画布网格 + 提示 | 「从左侧选择一个项目，或新建一个」 |
| **loading** | 项目/画布载入 | 骨架屏（行占位 + 网格淡入） | — |
| **loading** | 生成中（节点级，已有） | 节点占位 + 不确定进度条 + 按 `operationType` 阶段文案 | 「分镜推演中…」「角色定妆中…」「镜头渲染中…」 |
| **error** | 工具失败 / 后端不通 / 项目损坏 | 统一错误卡（图标 + 主因 + 处置建议 + 重试按钮），错误分三级：可重试 / 配置缺失（引导去设置）/ 服务不可达（显示配置来源） | 「生成失败——检查 Drama 服务是否可达后重试」 |

现状：loading/error 已散装存在于节点级，本次任务是把**空态与文案**成体系，并把 error 升级为三级处置。

### 6.2 Onboarding（首体验）

1. **首启检测**：无任何项目 → 欢迎屏（品牌名 + tagline + 定位句 + 双 CTA）。
2. **三步引导**：① 新建项目命名 → ② 选择工作流模式（全自动 / HITL 审批）→ ③ 示例话术提示（"试试：一个少女在雨夜的城市屋顶寻找失踪的猫"）+「加载示例项目」。
3. **示例项目**：预置 5–7 节点（分镜 → 定妆照 → 场景概念 → 视频片段 → 合成视频），带血缘连线，展示全链路形态；用户可一键删除重建。
4. **设置页品牌区**：品牌名 + 版本号 + 许可信息（已有 SettingsModal，追加 About 区）。

### 6.3 产品外壳

- 桌面侧边栏 / 标题栏：品牌名 **Canvas Studio** + 场记板图标（`displayName` 设置点，由工程锚点定位宿主注入点）。
- 设置弹窗标题区：品牌化。

---

## 7. 落地清单（映射工程锚点）

| # | 任务 | 落点 |
|---|---|---|
| 1 | `displayName` / 产品标题 + 侧边栏图标 | 插件 manifest / client 入口 |
| 2 | `assets/brand/`：`logo.svg`、`favicon.svg`、`icon-*.png` | 新增资源目录 |
| 3 | `src/brand.ts`：§3 Preset 机制（4 套 + 默认）+ 注入（`data-plugin` 隔离 + `[data-cs-brand]` 切换） | 新增模块，`installStudioStyles()` 挂载点扩展 |
| 4 | 三态组件（empty/loading/error）+ 文案常量表 | `src/client/` 新增组件 + 文案常量 |
| 5 | Onboarding 入口 + 示例项目 | client 入口 + Host 种子数据 |
| 6 | 设置页品牌 About 区 | `SettingsModal.tsx` 扩展 |
| 7 | SettingsModal「外观」区：预设切换 + settings 持久化 | `SettingsModal.tsx` 扩展（复用 settingsScope） |

> **追加（第二轮，2026-08-31 桌面验收后）**：发现品牌缺口**对话区定制**。顶部 `DSH Desktop v2.0.3 兼容模式` 是 dsh 桌面壳的宿主标识（`dsh-plugin-desktop` 硬编码 Electron title + GUI 顶栏），插件层**不可改也不应改**（寄生产品的常识）；但右侧对话区空态 Hero 的**小鱼 logo 有官方扩展点** `conversation.hero.brand.mark`（`kind: 'single', scope: 'root'`，`dsh-client-ui-conversation` 的 HeroShell 渲染时给的 fallback 是 FishLogo），正是设计给插件贡献品牌标识的。新增 `src/client/brand/HeroBrandMark.tsx`，把对话空态"探索未至之境"前的小鱼替换为场记板。注册走 `ctx.slots` 框架（不在 inject 数组里），与 ui-conversation **不成环**；augment SlotMap 在 `slots-contracts.ts` 加 owner props 声明；`HeroBrandMarkOwnerProps` 本地复制（与上游同名定义保持同步）以避免依赖上游运行时类型导出。桌面验收重启后那条小鱼立刻变场记板，hero 文案与"预览版"徽标不动（属 dsh 通用对话框架文案，不归插件管）。

**执行纪律**：令牌与三态组件为新代码，按规范写；存量样式不逐行重写，只改品牌感知关键处；验证链照旧 `check` + `test:smoke` + 桌面人工验收。

---

## 8. 决策记录（2026-08-31 用户拍板）

| # | 议题 | 决策 |
|---|---|---|
| 1 | 对外品牌名 | 英文主名 **Canvas Studio**；中文运营名 **创意工厂**；AI 漫剧工场降级为产品线背景说法 |
| 2 | Tagline | **From idea to final cut.（从创意到成片）**；*Let your agent direct.* 保留为副语 |
| 3 | 配色 | **可切换 Preset 机制**（默认 cinema-violet + 3 备选），后续在设置页切换定稿一套 |
| 4 | 字体 | Space Grotesk **后置**（v2 再引入） |
| 5 | 图标隐喻 | **场记板认可**，进入 Logo 细化 |

下一步：
1. 视觉专家按场记板概念细化 logo（含 favicon 简化形）；
2. 工程锚点按 §7 清单落地（需用户审批 step plan 后执行）；
3. 用户后续可在设置页「外观」区切换 preset，定稿配色。

---

## 9. 落地状态（2026-08-31 已执行，待桌面验收）

§7 清单已按 step plan 顺序全部落地并通过本地验证链（typecheck Host+Client / tsdown / tsc emit / test:smoke **130/130** / verify:loader）：

| # | 任务 | 落点 | 状态 |
|---|---|---|---|
| 1 | `src/brand.ts`：4 套 preset + `--cs-*` 令牌 + 明暗双轨 CSS 生成 | `src/brand.ts`（纯逻辑，可单测）+ `src/client/brand-inject.ts`（DOM 单例注入，`data-plugin` + `data-cs-brand` 双属性隔离） | ✅ |
| 2 | displayName：品牌名 + 图标 | 左侧栏品牌条 `csBrandHeader`（LogoMark + Canvas Studio / 创意工厂）；package.json description 品牌化；favicon（data: URL 注入） | ✅ |
| 3 | `assets/brand/`：logo.svg + favicon.svg（场记板初稿） | `canvas-studio/assets/brand/`（已加入 package files） | ✅ |
| 4 | SettingsModal「外观」区：4 套预设切换 + 持久化 | `BrandSection`（swatch 组，`applyBrandPreset` 即时应用 + settings `brandPreset` 字段持久化）；tab「主题」更名「外观」 | ✅ |
| 5 | 三态组件 + 文案常量 | `src/brand-copy.ts`（文案）+ `src/error-kind.ts`（错误分级纯函数）+ `src/client/brand/States.tsx`（欢迎屏 / 画布空引导 / 加载卡 / 错误三级处置） | ✅ |
| 6 | Settings About 区 | 设置弹窗标题已是品牌名；欢迎屏展示品牌定位 | ✅（简化并入欢迎屏） |
| 7 | 示例项目（onboarding） | 欢迎屏「创建示例项目」→ `createSampleProject`（建/复用 + `seedProjectIfEmpty` 预置节点） | ✅ |

新增配置：`CanvasStudioConfig.brandPreset`（默认 `cinema-violet`，Host base 层同步）。

**待桌面人工验收**：重启 `corepack yarn dev` → ① 左侧栏品牌条 + favicon；② 欢迎屏（无项目时）与「创建示例项目」；③ 设置 → 外观 → 4 套 swatch 即时切换（深色主题下验证 accent 变化）与重启保持；④ 空画布引导卡；⑤ 项目列表加载/错误卡（含配置缺失引导）。

**后续（非本次）**：Logo 视觉专家细化正式稿；字体 v2（Space Grotesk）后置；配色定稿后在提案内固化一套。
