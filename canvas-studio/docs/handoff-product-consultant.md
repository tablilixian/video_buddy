# 交接提示词（复制以下全部内容，粘贴到「产品顾问 刘小排」的新对话即可开始）

---

你作为产品顾问，帮我把手头的 **canvas-studio** 从"能跑的插件原型"升级为**成熟、专业、健壮、识别度高**的 App 产品。下面是一段自包含简报，无需前置上下文即可接手。

## 一、项目是什么
- **canvas-studio**：DeepSeek Harness（dsh）桌面插件（Cordis 架构），把 AI 文生视频生产流水线做成单页、agent 驱动的工作台。
- **生产链路**：创意 idea → 分镜 → 角色/场景 → 关键帧 → 视频 → 成片剪辑，全链路 agent 自动执行，支持 HITL 人工介入与实时进度展示。
- **技术栈**：Host（Node + Cordis）承载工具/资产服务；Client（browser）渲染 UI；React 18 + TypeScript + tsdown 构建。
- **已具备能力**：20 个生产工具（15 完整实现 + 2 暂不可用 + 3 占坑待接入）、与 drama-api 后端集成、HITL 介入、实时进度。
- **已知短板（供你了解全貌，本次不修）**：P0 缺陷 A1 自动保存竞态 / A2 WebGL context 泄漏 / A3 blob:URL 写入持久化；147 处 `catch(...:any)`；e2e 测试被 gitignore。

## 二、成熟度框架（4 支柱，本次聚焦第 1 项）
1. **品牌与识别度**（本次重点）
2. 架构与健壮性（还技术债、错误/重试/可观测）
3. UX 与首体验（onboarding / 空态加载态 / 快捷键 / 设置持久化）
4. 工程与质量（补全 e2e / CI / 性能基线 / 文档）

## 三、品牌与识别度 — 现状审计结论（已核查代码）
- **内部命名自洽、不可动**：Cordis plugin id、package name、settings namespace、路由前缀 `/canvas-studio/...`、DOM 钩子 `data-plugin='canvas-studio'` 全部统一为 `canvas-studio`。改名会打断桌面启动。
- **面向用户的品牌层完全缺失（核心缺口）**：
  - 无 `displayName` / 产品标题，桌面侧边栏大概率直接显示开发代号 `canvas-studio`；
  - 无 Logo / 图标 / favicon（自有资源为零）；
  - 无设计令牌体系，直接沿用 `@deepseek-ai/dsh-client-ui-theme` 默认，无自有 accent / 字体 / 间距 / 圆角 / 阴影；
  - 无成套 empty / loading / error 视觉语言与文案；
  - 无 onboarding / 首屏引导 / 示例项目。
- **生态命名（仅文档/注释层，非运行冲突）**：`WL-AI-Director`（上游 fork）、`AI 漫剧工场 / BigBanana`（产品线统称）、`canvas-studio`（本插件）。需确定对外统一说法。

## 四、需要你主导决策的关键问题
- **Q1 对外品牌名**：Canvas Studio / AI 漫剧工场 / 其他（内部 plugin id 保持 canvas-studio 不变）
- **Q2 视觉方向**：专业暗色工具风 / 明亮创作风 / 参考案例
- **Q3 accent 主色 + 辅助色板**
- **Q4 字体策略**：沿用 dsh 默认 / 引入自有品牌字体
- **Q5 图标隐喻**：画布 / 胶片 / 导演 / 其他

## 五、技术约束（必须遵守）
- 内部 Cordis plugin `name='canvas-studio'` **不可改名**（与 bundle patch 行绑定，改则桌面启动中断）。
- 视觉基底是 `@deepseek-ai/dsh-client-ui-theme`，自有 token 须**叠加**其上，不推翻。
- Host/Client 分层：品牌与 UI 改动落在 Client 侧（src/client/*）。
- DOM 已有 `data-plugin='canvas-studio'` 钩子（src/client/styles.ts）可做品牌级样式隔离。

## 六、期望你产出
1. 品牌策略：命名 + tagline + 一句话定位。
2. 视觉方向提案：色板、字体、图标方向（含参考）。
3. 设计令牌草案：颜色 / 间距 / 圆角 / 阴影 / 动效时长。
4. 状态视觉与首体验框架：empty / loading / error 三态 + onboarding 流程。
5. 一份可评审的方案文档（建议落在 canvas-studio/docs/）。

## 七、协作方式
- 我方工程锚点（SeniorDeveloper）负责把你的规范**落地到代码**：`displayName`/标题、`assets/brand/` 资源目录、`src/brand.ts` 设计令牌 + 注入、`data-plugin` 隔离、三态组件、onboarding 入口。
- **你定方向，我来实现**；Q1–Q5 的最终决策由你 + 我方用户拍板。
- 详细审计见本地文件 `canvas-studio/docs/brand-identity-audit.md`（若你可访问该仓库）。

请先就 Q1–Q5 给出你的产品判断与提案框架，我们再细化落地。

---

# 交接提示词结束（以上为可粘贴内容）
