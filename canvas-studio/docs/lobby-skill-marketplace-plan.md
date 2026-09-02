# Lobby 布局 + 技能广场 改造方案

> 立项：2026-09-02 · 拍板方向：C（混合布局）+ F（混合技能广场）
> 关联：需求 1（chat 居中 → 右侧切换）+ 需求 2（技能广场）
> 状态：待审批

---

## 0. 设计原则

1. **最小破坏**——work 态（项目已开）UI 与交互完全不动；只在 lobby 态（无项目）切形态
2. **渐进披露**——lobby 默认只展示 6-8 张推荐 skill；点"浏览全部"才进入全屏广场
3. **激活可观测**——已装载 skill 在 work 态顶部以 chip 形式常驻，用户随时知道当前会话挂载了哪些规范
5. **符合现有规范**——host 侧不动；改动集中在 client + 共享契约

---

## 1. Phase A — Lobby 布局（CV-064）

### 1.1 现状

```css
.csFrame { grid-template-columns: 280px minmax(0,1fr) 480px; }   /* styles.ts:16 */
```
3 栏常驻：无项目时中央是 `StudioEmptyState`（品牌卡 + 双 CTA），右侧一直挂对话。

### 1.2 目标

| 状态 | 左栏（280px） | 中栏 | 右栏（480px） |
|---|---|---|---|
| **lobby**（无项目） | 项目列表（最近项目 + 新建）+ 顶部品牌头 | `LobbyPanel`：居中 chat + 推荐 skill 横滚 + 全部链接 | 隐藏（不渲染） |
| **work**（有项目） | 项目列表 | 画布（surface + 工具栏 + 工作流条 + 时间轴） | 对话（conversation） |

切换靠 CSS class `data-mode` + JSX 条件渲染双保险。

### 1.3 改动清单

| 文件 | 改动 |
|---|---|
| `src/client/StudioFrame.tsx` | 根据 `projectId === null` 给 `.csFrame` 加 `data-mode`；work 渲染路径不变；lobby 改渲染 `<LobbyPanel>` 并隐藏 `csChat` |
| `src/client/styles.ts` | 新增 `.csFrame[data-mode="lobby"]` 覆盖 grid 模板为 `280px minmax(0,1fr)`；`.csChat` 在 lobby 态下 `display:none`；`.csLobby*` 一组样式（布局/chat 容器/skill 横滚区） |
| `src/client/LobbyPanel.tsx`（新） | 接受 `renderSlot`/`onCreate`/`onOpenSkillMarket`/`onActivateSkill` props，组合：品牌欢迎语 + `<section className="csConversation">` 内联渲染 conversation slot + `<SkillCarousel>` 横滚 + "浏览全部" 按钮 |
| `src/client/brand/States.tsx` | `StudioEmptyState` 保留但**不在 lobby 渲染**（逻辑被 LobbyPanel 取代）；保留组件供后续复用 |

### 1.4 Lobby 中栏排版

```
+--------------------------------------------------+
|  品牌 mark + tagline（居中）                       |
|                                                  |
|  +----------------------------------------+      |
|  |  csConversation（居中、最大宽 760px）   |      |
|  |  ↑ chat input 走 conversation slot     |      |
|  +----------------------------------------+      |
|                                                  |
|  ── 推荐技能 ────────────────────────────        |
|  [横滚卡片 × 6-8]                          更多 › |
|                                                  |
|  ── 最近项目 ─────────────────────────────────    |
|  [缩略卡片 × 3-6]                                |
+--------------------------------------------------+
```

### 1.5 验证

- 重启桌面 → 删所有项目 → 应进入 lobby，看到居中 chat + skill 横滚
- 点"新建项目" → 创建后自动切回 work 态（三栏布局回归，chat 在右）
- 切回 lobby（删项目） → 再验证居中布局
- 视觉验收：lobby 与 work 切换有过渡（CSS transition on grid-template-columns 300ms）
- 回归：work 态交互零变化（CV-001~063 全用例通过）

> **一期实现偏差（Phase A 落地时已修正）**：§1.3 原方案要 lobby 态在 `LobbyPanel` 里重渲染 conversation slot——那会让上游 conversation 组件卸载重建（草稿/滚动/会话绑定全丢）。实际改为 `.csChat` 常驻挂载 + CSS grid 重排（见 backlog CV-064 Phase A 行）。
>
> **二期实现偏差（CV-064 二期，2026-09-02）**：§1.1 的两态（lobby / work）扩展为**三态**——用户拍板「新建项目后、未开始对话」应是 lobby 视觉但**无右上角新建 CTA**（CTA 仅无项目时显示）；「输入创意并确认」才切 work。三态：`lobby`（无项目，LobbyHero + 居中 chat + 横滚）/ `lobby-pending`（有项目无对话，无 LobbyHero、居中 chat + 横滚）/ `work`（有对话，三栏）。判据 = `sessionSvc.list` 当前会话 `blank` 字段（首条 prompt ACCEPTED 自动翻转 false，`list.subscribe` 触发，点发送即切 work 不等 agent）。落地细节见 backlog「CV-064 二期三态布局」行。

---

## 2. Phase B — 技能广场数据层（CV-065）

### 2.1 现状

9 个 skill 落盘在 `canvas-studio/skills/`，注册入口 `src/skills/minimax-skills.ts`（`MINIMAX_SKILL_NAMES` 已是公开常量）。SKILL.md frontmatter 只有 `name` + `description`，**缺 category / icon / accent** 等展示元数据。

### 2.2 目标

构建一份客户端可消费的 skill 元数据清单，按 category 分组，附预置 icon + accent 配色（首版走程序化映射，避免动 skill 源文件）。

### 2.3 改动清单

| 文件 | 改动 |
|---|---|
| `src/client/skill-catalog.ts`（新） | 导出 `SKILL_CATALOG: SkillCatalogEntry[]`，每项含 `name` / `category` / `titleZh` / `descriptionZh` / `icon`（emoji 或 inline SVG id） / `accent`（CSS 变量名）/ `featured: boolean`。程序化映射已知 skill 名 → 分类 |
| `src/skills/minimax-skills.ts` | 新增 `getSkillCatalogEntry(name): SkillCatalogEntry \| null` 工具方法（合并 `MINIMAX_SKILL_NAMES` 与 `SKILL_CATALOG`，未覆盖的 skill 返回 null） |

### 2.4 分组映射（程序化首版，hardcode 在 catalog.ts）

| Category | skill 名 |
|---|---|
| 营销广告 | `brand-promo-video-generator`, `minimalist-product-ad-generator` |
| 视频风格 | `3d-animation-short-generator`, `co-op-game-intro-generator`, `handdrawn-live-video-generator`, `paper-collage-explainer-generator`, `papercraft-stop-motion-explainer` |
| 字幕配乐 | `music-video-subtitle-generator` |
| 创作规范 | `canvas-studio-creation`（featured） |
| 提示词技术 | `h3-prompt-writing`（featured） |

未在上表中的 skill 落 `未分类` 分组（仍展示，不报错）。

### 2.5 验证

- 单元测试：`tests/skill-catalog.test.mjs` — 校验 9 个已知 skill 都能从 catalog 取到元数据，未覆盖 skill 返回 null 不崩
- `test:smoke` 全绿（无破坏 skill 注册链路）

---

## 3. Phase C — 技能广场 UI（CV-065 续）

### 3.1 目标

两个交互入口：
- **lobby 横滚卡片**（Phase A 已埋位置，本阶段实现）
- **"浏览全部"全屏广场**（参照图 #2 MiniMaxHub 风格，左侧分类侧栏 + 右侧卡片网格）

### 3.2 改动清单

| 文件 | 改动 |
|---|---|
| `src/client/SkillCard.tsx`（新） | 单卡片：缩略图（程序化渐变 + icon）+ 标题 + 描述（截断 80 字）+ 分类 chip + 「使用」按钮；hover 上浮 + 阴影；props: `entry`, `onActivate`, `isActive` |
| `src/client/SkillCarousel.tsx`（新） | lobby 横滚：横向滚动条（hidden scrollbar） + 左右按钮；props: `entries`, `onActivate`, `activeNames`, `onOpenAll` |
| `src/client/SkillMarket.tsx`（新） | 全屏广场：左栏分类侧栏（按 Phase B 分组）+ 右栏卡片网格 + 顶部分类 Tab + 右上"创建"按钮（**禁用 + 提示"待接入"**，与 reserved 字段原则一致） |
| `src/client/LobbyPanel.tsx` | 接入 `<SkillCarousel>` |
| `src/client/StudioFrame.tsx` | 新增 `skillMarketOpen` 状态；为 true 时整个 csCanvas 区域替换为 `<SkillMarket>`（work 态下通过顶部 toolbar 入口按钮触发，lobby 态通过横滚卡片下方"更多"按钮触发） |
| `src/client/canvas/CanvasToolbar.tsx` | 顶部工具栏新增 "技能" 按钮（图标 + 文字，仅 work 态可见） |
| `src/client/styles.ts` | `.csSkillCard` / `.csSkillCarousel` / `.csSkillMarket*` 一组新样式 |

### 3.3 全屏广场布局

```
+----------------------------------------------------------+
| csBrandHeader                                             |
+--------+--------------------------+-----------------------+
| 项目   | Skill Market              | （隐藏）              |
| (280px)| 推荐 / 营销 / 视频风格 / …  |                       |
|        |                           |                       |
|        | [缩略] [缩略] [缩略]       |                       |
|        | [缩略] [缩略] [缩略]       |                       |
|        |  ...                      |                       |
+--------+--------------------------+-----------------------+
```

进入方式：lobby 横滚右端"更多 ›" / work 态顶部工具栏"技能"按钮
退出方式：左上角"← 返回"按钮

### 3.4 验证

- lobby 看见 6-8 张推荐卡片，能左右滚；点"更多" → 全屏广场
- 全屏广场分类侧栏切换 → 右侧网格过滤；点"使用"→ 详情卡（缩略图大图 + 描述 + "激活到当前会话"按钮）
- work 态工具栏新增"技能"按钮 → 点击进入全屏广场；返回按钮回到 work
- 视觉：暗色主题/亮色主题都正确（遵循现有 token 体系）

---

## 4. Phase D — 激活链路（CV-066）

### 4.1 目标

「激活」按钮的语义：把 skill 名注入当前会话上下文，让 agent 在下一回合能识别并按规范创作。

### 4.2 激活机制（首版，软激活）

1. 用户在 SkillCard 上点"激活"
2. 前端把 skill 名 push 到 `projectStore.activeSkills: string[]`（按项目持久化）
3. 前端通过 conversation API 发一条 system 消息：「User has activated skill: <name>. Load it via skill(name="<name>") and follow its workflow.」
4. agent 在下一回合调 `skill(name=X)` 加载正文，按规范执行
5. 激活态展示：work 态工作流条下方加一行「已装载：X · Y · Z」chip，点击 chip 取消装载

### 4.3 改动清单

| 文件 | 改动 |
|---|---|
| `src/client/project-store.ts` | 新增 `activeSkills: string[]` 字段（按 selectedProjectId 隔离）+ `activateSkill`/`deactivateSkill` action + 持久化（写入 `canvas.json` 同目录） |
| `src/client/api.ts` | 新增 `sendSystemMessage(sessionId, text)` 客户端方法，转发到 host |
| `src/host-tools.ts` 或 `src/routes.ts` | host 侧新增 `send_system_message` 工具或路由，接 session 上下文 |
| `src/client/ActiveSkillChips.tsx`（新） | 工作流条下方一行：横向 chip 列表，每个 chip 「skill 名 ×」可移除；空态隐藏整行 |
| `src/client/StudioFrame.tsx` | 接入 `<ActiveSkillChips>`（仅 work 态显示） |

### 4.4 持久化

`canvas.json` 增加字段：

```json
{
  "activeSkills": ["brand-promo-video-generator"]
}
```

向后兼容：旧项目无字段时按 `[]` 处理。

### 4.5 验证

- 单元测试：`tests/active-skills.test.mjs` — 激活/去激活/持久化往返
- 端到端：lobby 激活 skill → 创建项目 → 项目里看见 activeSkills 持久化 → work 态顶部 chip 可见
- 桌面验收：激活 brand-promo 后，对话里说"做一个品牌片"，agent 应引用 brand-promo skill 的 6 步流程

### 4.6 实现偏差记录（2026-09-02 落地时定稿，状态以 STATUS.md CV-066 为准）

上文 4.3/4.4 是最初方案，落地时两处被推翻（保留原文以记录决策过程）：

1. **持久化独立 `skills.json`，不写 `canvas.json`**：canvas.json 有 merge-protect 与快照串行队列的复杂语义，塞新字段容易踩竞态；`activeSkills` 整表替换是幂等操作，独立文件 + `ProjectRegistry.readActiveSkills/writeActiveSkills`（原子写、去重、类型过滤、缺失/损坏降级空数组）更简单可靠。文件放项目目录 `skills.json`（与 canvas.json 同级）。
2. **不做 `sendSystemMessage` / `send_system_message` host 路由**：客户端已有两条现成通路——`insertReferenceToken` 把「使用技能「X」：」插进对话输入框（Phase C 已复用），用户发送后 agent 自然醒来并按提示词决定是否 `skill(name=X)`；以及 `wakeAgent`（审批动作在用）。**没有「激活即自动注入 system prompt」的语义**——软激活原则：展示装载态（chip），实际加载交给 agent 判断，不伪造已生效。

---

## 5. 不做的事 / 延后

- skill 自动按输入类型选用（agent 侧优化，非 UI 范围）→ 后续可加 "auto-match" toggle
- 技能广场多语言切换（先中文，与现有 brand-copy 一致）
- skill 评分/收藏/历史使用统计 → 等市场体量起来再上
- skill 创建/编辑入口（用户在广场点"+"）→ 暂保留按钮但禁用 + "待接入"角标，与 CV-003 reserved 字段原则一致
- skill 内容预览（详情面板渲染 SKILL.md 正文）→ Phase D 验收后再迭代

---

## 6. 文件影响总览

新增：
- `src/client/LobbyPanel.tsx`
- `src/client/SkillCard.tsx`
- `src/client/SkillCarousel.tsx`
- `src/client/SkillMarket.tsx`
- `src/client/ActiveSkillChips.tsx`
- `src/client/skill-catalog.ts`
- `tests/skill-catalog.test.mjs`
- `tests/active-skills.test.mjs`

改动：
- `src/client/StudioFrame.tsx`
- `src/client/styles.ts`
- `src/client/canvas/CanvasToolbar.tsx`
- `src/client/project-store.ts`
- `src/client/api.ts`
- `src/skills/minimax-skills.ts`
- `src/host-tools.ts` 或 `src/routes.ts`（激活链路用，新增 send_system_message）
- `canvas-studio/docs/STATUS.md`（新增 CV-064/065/066）
- `canvas-studio/docs/canvas-ux-backlog.md`（对应行加方案）

---

## 7. 验收节奏

1. Phase A（lobby 布局）：本机桌面验收
2. Phase B（catalog 数据）：单元测试 + smoke
3. Phase C（UI）：本机桌面验收
4. Phase D（激活链路）：本机桌面端到端验收
5. 全量：回归 test:smoke / verify:loader

每阶段收尾按 `DEV-WORKFLOW.md §四` 改 STATUS.md + 提交。