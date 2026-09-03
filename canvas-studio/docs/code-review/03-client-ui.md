# 03 · 客户端 UI 模块审查

> 覆盖：`StudioFrame.tsx` / `client/index.ts` / `ProjectList.tsx` / `UserCard.tsx` / `SettingsModal.tsx` / `ModelSettingsPanel.tsx` / `SkillMarket.tsx` / `SkillCard.tsx` / `SkillIcon.tsx` / `SkillCarousel.tsx` / `ActiveSkillChips.tsx` / `LobbyHero.tsx` / `brand/*` / `brand-inject.ts`
> 条目：CR-040 ~ CR-058。状态总表见 [README.md](./README.md#3-状态总表修复台账)。

---

## 高危

### CR-040｜[高] SettingsModal 的 TinyFish 凭据 effect 缺 `value` 依赖，凭据状态永不刷新
- **位置**：[SettingsModal.tsx#L92-L101](../src/client/SettingsModal.tsx#L92-L101)
- **问题（是什么）**：`useEffect` 依赖只有 `[getCredentials]`，但函数体 `if (value === undefined) return` 提前返回。首次渲染 `value` 为 undefined（`useScope` loading）走 early-return；之后 `value` 变 defined 触发重渲染，但依赖 `[getCredentials]` 未变 → **effect 不会重跑**，`credentials.describe([TINYFISH_REF])` 从不执行。
- **影响**：`tinyfishCred` 恒为 `null`，「已配置/未配置」标签永远显示「未配置」，密码框 placeholder 永不更新——真实功能 bug。
- **解决方案**：第一个 effect 依赖补 `value`（对齐第二个 effect `[getCredentials, value?.dramaApiKey]` 的写法）。
- **验收方式**：已配置 TinyFish key 后打开设置页，「联网搜索」凭据区应显示「已配置」，placeholder 相应变化。
- **状态**：✅ **已修复·待验收**（2026-09-02）——依赖改为 `[getCredentials, value]`（[SettingsModal.tsx](../src/client/SettingsModal.tsx#L92-L101)）。`value` 来自 `useSyncExternalStore`，getSnapshot 在无变更时返回稳定引用，补进依赖安全且与第二个 effect 语义一致。

---

## 中危

### CR-041｜[中] StudioFrame 大量内联回调/派生数组每渲染重建，击穿子组件 memo
- **位置**：[StudioFrame.tsx](../src/client/StudioFrame.tsx)（`deriveTimelineOrder#L462`、`referenceNodes` 过滤、`CanvasToolbar`/`CanvasSurface`/`LayerPanel` 等几十个闭包回调）
- **问题（是什么）**：`timelineOrder`、`referenceNodes` 每渲染生成新数组；传给画布各子组件的回调全为每次新建的闭包。
- **影响**：只要子组件父链用 `React.memo`，这些引用变化会全部击穿 memo 导致整链重渲染；时间轴/图层在大画布下随任何状态变化反复重排。
- **解决方案**：`timelineOrder`/`referenceNodes` 用 `useMemo`（`nodes` 为 store 快照，引用稳定可安全缓存）；对依赖 `projectId`/`nodes` 的回调用 `useCallback` 稳定化。
- **验收方式**：大画布下拖动节点，观察从属面板（时间轴/图层）是否仍整链重渲染；用性能面板确认渲染次数下降。
- **状态**：✅ **已修复·待验收**（2026-09-03）——`timelineOrder`/`referenceNodes` useMemo（[StudioFrame.tsx#L87-L91](../src/client/StudioFrame.tsx#L87-L91)、[#L479-L481](../src/client/StudioFrame.tsx#L479-L481)）；核心处理器（beginEdit/persist/persistAfter/handleViewChange/handleDelete/handleUndo/handleRedo/handleRename/handleUpdateNode/handleRetry/handleTimelineSelect）useCallback（依赖只含 projectId/actions/persistAfter 等稳定引用）；CanvasSurface 绑定回调（select/selectAll/move/copy/paste/linkLayers/nodeTextSubmit/openDetail/openPlayback/openPreview/contextMenu/blankContextMenu/mediaNatural）全部 useCallback，`onMediaNatural` 改经 `nodesRef` 读最新节点（不再闭包 nodes）；CanvasSurface JSX 内联闭包全部替换为命名稳定处理器。配合 CR-063 的 CanvasNode/CanvasEdges memo，拖拽时未移动节点不重渲染。

### CR-042｜[中] `installBrandStyles` cleanup 不移除 DOM，重装累积 `<style>` 元素
- **位置**：[brand-inject.ts#L59](../src/client/brand-inject.ts#L59)
- **问题（是什么）**：cleanup 为 `() => { brandElement = null }`，只断开引用不移除 DOM。effect 重跑（如 `initialBrandPreset` 变化）时 `ensureBrandElement` 检测 `brandElement===null` 会 `createElement` 再 `appendChild` 新 `<style>`，旧元素仍在。
- **影响**：品牌样式元素重复累积，样式冗余/污染。
- **解决方案**：cleanup 移除元素，或 `ensureBrandElement` 重建前 `querySelector` 清理同标记旧元素。
- **验收方式**：反复切换品牌预设/重载，检查 `<head>` 内 `[data-plugin="canvas-studio"]` 标签数量恒为 1。

### CR-045｜[中] LogoMark 铰链/白板硬编码灰，不随明暗主题联动
- **位置**：[LogoMark.tsx#L31-L33](../src/client/brand/LogoMark.tsx#L31-L33)
- **问题（是什么）**：`#E8E8E8`（铰链）、`#F4F4F6`（上白板）为硬编码十六进制，其余用 `--cs-accent`/`--cs-accent-deep` 令牌。
- **影响**：品牌预设或明暗主题切换时这两处灰色不联动，深色主题下视觉突兀。
- **解决方案**：提取为 `--cs-*` neutral 令牌或随主题变量。
- **验收方式**：切到深色主题，logo 铰链/白板灰随主题变化而非固定明灰。

### CR-046｜[中] SkillCard hover 菜单键盘用户可能完全无法触达
- **位置**：[SkillCard.tsx#L57-L74](../src/client/SkillCard.tsx#L57-L74)
- **问题（是什么）**：`.csSkillHover` 依赖 CSS hover 显示。若实现为 `display:none` 而非 `visibility`，键盘焦点无法到达「使用/查看详情」入口。
- **影响**：键盘用户丢失「查看详情」入口。
- **解决方案**：hover 显示 + `:focus-within` 显示双保障（需据 styles.ts 实际实现确认）。
- **验收方式**：仅用 Tab 键盘导航，能聚焦并触发 hover 菜单「查看详情」。

---

## 低危清单

| ID | 位置 | 问题 | 解决方案 |
| --- | --- | --- | --- |
| CR-043 | [SkillMarket.tsx#L101-L108](../src/client/SkillMarket.tsx#L101-L108) | 分级精选时「加入创作者社区」CTA 卡重复（`renderGrid` 内无条件追加，featured+rest 各渲染一次） | 把 CTA 提升到 grid 之外、整区只渲染一次 |
| CR-044 | [States.tsx](../src/client/brand/States.tsx) | `StudioEmptyState` 死代码，全仓库仅注释+自身定义（StudioFrame 已改用 `LobbyHero`） | 连同 `StudioEmptyStateProps` 一起删除 |
| CR-047 | [UserCard.tsx#L38-L47](../src/client/UserCard.tsx#L38-L47) | 渐变 `id="csUserAvatarGrad"` 面板开出时出现两次（bar + 面板头像），违反 HTML 唯一 id | 用 `useId()` 生成渐变 id |
| CR-048 | [UserCard.tsx#L65-L69](../src/client/UserCard.tsx#L65-L69) | `useLayoutEffect` 只在 `open` 时量位置；打开期间 resize/侧栏滚动不重算，fixed 面板错位 | 加 resize/scroll 监听，或用相对按钮 `position:absolute` 替代 JS 量坐标 |
| CR-049 | [SettingsModal.tsx#L240-L245](../src/client/SettingsModal.tsx#L240-L245) | `ThemeSection` 用 `useSyncExternalStore` 但 subscribe 为 no-op，靠手动 `forceTick`——别处改主题本弹窗不响应 | 升级为真实订阅，或明确注释风险 |
| CR-050 | [SettingsModal.tsx#L121](../src/client/SettingsModal.tsx#L121)、#L394、#L457 | 空串 `Number('')===0` 且 `isFinite` 真，清空输入会把 `maxVideoSeconds`/`maxParallel`/`autoSaveInterval` 写成 0 越过 min | `raw.trim()===''` 时跳过 |
| CR-051 | [ProjectList.tsx#L60-L62](../src/client/ProjectList.tsx#L60-L62) | `submit` 用 `await onCreate(name)` 后无条件关闭表单；创建失败时 `setFailed` 置 error 但表单已关 | 仅成功时关闭 |
| CR-052 | [ProjectList.tsx#L203](../src/client/ProjectList.tsx#L203) | 行删除用 `window.confirm` 阻塞线程，与「不用 window.alert」既定风格不一致 | 统一为非阻塞确认 |
| CR-053 | [ProjectList.tsx#L187-L191](../src/client/ProjectList.tsx#L187-L191) | 项目行是 `<div onClick>`，键盘不可 Tab 打开 | 改可聚焦元素或加 `role="button"`+`tabIndex`+Enter |
| CR-054 | [ModelSettingsPanel.tsx#L402](../src/client/ModelSettingsPanel.tsx#L402) | 默认模型选「空」时 `setDefault('', ...)` 回退旧 provider，语义上未真正清空 | 明确空选项语义 |
| CR-055 | [ModelSettingsPanel.tsx#L322-L326](../src/client/ModelSettingsPanel.tsx#L322-L326) | `setDefault` 连续两次异步写 `provider`+`model` 不原子，极端并发下分裂 | 合并为单次 set（若 scope 支持 patch） |
| CR-056 | [ModelSettingsPanel.tsx#L455-L476](../src/client/ModelSettingsPanel.tsx#L455-L476) | `span.csFieldLabel` 包 input 而非 `<label htmlFor>`/包裹，未建 label-input 关联 | 用语义 label 关联 |
| CR-057 | [SkillCarousel.tsx#L31-L55](../src/client/SkillCarousel.tsx#L31-L55) | 左右箭头无 disabled 态，滚到头/尾仍可点；`PAGE_STEP=420` 魔法数 | 按 `onScroll` 判边界禁用；步长取自卡片宽或抽出常量 |
| CR-058 | SettingsModal / UserCard / SkillMarket | 多个弹窗无焦点陷阱、无 autoFocus、关闭不归还焦点；tablist 无方向键导航、无 `aria-controls` | 补焦点管理（focus-trap）+ 方向键导航 |

---

## UI 层的其它观察（已核实为有意设计，勿重复处理）
- `StudioFrame` `handleReferenceToChat`/`handleActivateSkill` 用 `document.querySelector('.csConversation …')` 探测上游 DOM 属刻意稳健降级；建议在走到 fallback 分支时 `console.warn`（可挂 CR-058 同批）。