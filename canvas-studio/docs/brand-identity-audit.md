# 品牌与识别度审计 + 专家介入简报

> 目的：把 canvas-studio 从"能跑的插件原型"推向"成熟 App 产品"的第一阶段交付物。
> 范围：品牌与识别度（用户选定优先级）。工程锚点：SeniorDeveloper。待介入：产品/UX 专家 + 品牌/视觉专家。

---

## 1. 现状事实（代码核查结论）

### 1.1 技术标识 — 自洽，无需改
- Cordis plugin `name = 'canvas-studio'` — `src/index.ts:27`（注释明确要求与 bundle patch 行一致，改名会打断桌面启动，**不可动**）
- package `name: "canvas-studio"` — `package.json:2`
- settings namespace `'canvas-studio'` — `src/client/SettingsModal.tsx:71/232/289/351`
- 路由前缀 `/canvas-studio/...` — `src/client/api.ts`（projects / workflow / canvas / compose / generate / upload）
- DOM 钩子 `data-plugin='canvas-studio'` — `src/client/styles.ts:2127`（可用于主题隔离）

### 1.2 面向用户的品牌层 — 完全缺失（核心缺口）
| 维度 | 现状 | 成熟产品应有 |
|---|---|---|
| 产品名 / 标题 | 无 `displayName`；桌面侧边栏/标题栏大概率直接显示开发代号 `canvas-studio` | 对外品牌名 + 一句话 tagline |
| Logo / 图标 / favicon | 自有资源为零（仅 `node_modules` 内第三方 brand 文件 + `assets/style-demos/*.gif` 演示素材） | 自有 SVG 图标 + favicon |
| 设计令牌 | 直接沿用 `@deepseek-ai/dsh-client-ui-theme` 默认；无自有 accent / 字体 / 间距 / 圆角 / 阴影体系 | 自有 brand tokens 叠加在 dsh theme 之上 |
| 状态视觉 | 无成套 empty / loading / error 视觉语言与文案 | 三态视觉 + 微文案规范 |
| 首体验 | 无 onboarding / 首屏引导 / 示例项目 | 引导流程 + 模板工程 |

### 1.3 生态命名（仅文档/注释层，非运行冲突）
- `WL-AI-Director`：上游 CineGen-AI fork（参考来源，非本插件）
- `AI 漫剧工场 / BigBanana`：产品线统称（出现在 README / plan / 注释）
- `canvas-studio`：本 DSH 插件包名
- ⚠️ 误区澄清：`dsh-plugin-video-studio` 是**另一个独立插件**（用户手动验收对象），与本插件无关，不算命名分裂。

---

## 2. 成熟产品品牌必做项（待产品+品牌专家主导）

1. **定名**：对外产品名 + tagline。建议二选一或融合：
   - 保留 `Canvas Studio` 作品牌名（与内部 plugin id 解耦，零改造成本）
   - 或落定 `AI 漫剧工场` 作对外品牌（需同步所有文档/注释的统一说法）
   - 内部 Cordis `name` 保持 `canvas-studio` 不变
2. **视觉识别**：Logo（SVG）、应用图标、favicon、accent 主色 + 辅助色板
3. **设计令牌**：在 canvas-studio 内建 `brand` tokens（颜色 / 字体 / 间距 / 圆角 / 阴影 / 动效时长），叠加 dsh theme 默认之上
4. **产品外壳**：桌面侧边栏 / 标题栏显示品牌名 + 图标；设置面板露出品牌信息
5. **状态语言**：empty / loading / error 三态视觉 + 微文案规范（当前散装）
6. **首体验**：onboarding 引导 + 示例/模板工程

---

## 3. 待专家决策的关键开放问题

- **Q1 对外品牌名用哪个？** Canvas Studio / AI 漫剧工场 / 其他
- **Q2 视觉方向？** 专业暗色工具风 / 明亮创作风 / 其他参考
- **Q3 accent 主色与辅助色板？**
- **Q4 字体策略？** 沿用 dsh 默认 / 引入自有品牌字体
- **Q5 图标隐喻？** 画布 / 胶片 / 导演 / 其他

---

## 4. 工程侧就绪度（SeniorDeveloper 负责落地）

已就绪：
- `data-plugin` DOM 钩子（`styles.ts:2127`）— 可做品牌级样式隔离
- 现有 `installStudioStyles()`（`src/client/styles.ts:365`）— token 注入挂载点
- dsh theme 体系（`dsh-client-ui-theme` peer dep）— 可作基底

待补（专家规范到位后执行）：
- `displayName` / 产品标题设置点
- `assets/brand/` 资源目录（logo / icon / favicon）
- `src/brand.ts` 设计令牌定义 + 注入机制
- 三态视觉组件 + 文案常量
- onboarding 入口

---

## 5. 专家介入方式
- 左侧「专家」→ 产品/UX 专家、品牌/视觉专家，各开独立对话
- 本简报作为两个专家对话的起点事实基盘
- SeniorDeveloper 作为工程锚点，承接专家产出的 token / 规范并落地到代码
- 决策（Q1–Q5）由用户 + 专家拍板，不在此文档预设答案

---

## 6. 关联文档（专家应一并参阅）
- `docs/canvas-studio.md`（产品总览）
- `docs/canvas-studio-handoff.md`（交接状态）
- `docs/canvas-studio-optimization-backlog.md`（优化 backlog）
- `docs/next-steps-review.md`
- `plan.md`（开发计划）
