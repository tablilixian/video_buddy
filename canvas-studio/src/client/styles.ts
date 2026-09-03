/**
 * Studio frame styles, injected as one style element tagged with the plugin
 * id (the client-modules owner tagging pattern). Product copy lives in the
 * components; this file only carries presentation.
 */
const STUDIO_STYLES = `
/* Presentation follows the official design system: all colors come from the
 * --dsw-alias-* semantic tokens owned by @deepseek-ai/dsh-client-ui-theme
 * (imported into the web shell base.css). Those tokens resolve to light or
 * dark values via body[data-ds-dark-theme], so this panel adapts to the app
 * theme automatically. Never hardcode colors or use currentColor here. */

.csFrame {
  display: grid;
  /* 验收反馈（2026-08-25）：对话区从 380px 加宽到 480px。 */
  grid-template-columns: 280px minmax(0, 1fr) 480px;
  height: 100%;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  /* CV-064：lobby ↔ work 切换时列宽平滑过渡。lobby 态保持 3 列（第三列压到
     0px），列数一致才能插值；列数变化会退化成瞬跳。 */
  transition: grid-template-columns 300ms ease;
}

@media (prefers-reduced-motion: reduce) {
  .csFrame { transition: none; }
}

/* CV-064 lobby 态（无项目）：对话从右栏挪到中栏居中。
 *
 * 实现要点：对话槽（.csChat）**不搬家、不卸载** —— JSX 条件渲染换容器会让
 * 上游 conversation 组件重建，草稿 / 滚动 / 会话绑定全丢。这里只重排 grid：
 * 第三列压 0px，中栏切成「品牌条（auto）/ 聊天（1fr）」两行。
 *
 * 浮层类子元素（.csDetailPanel / .csContextMenu / .csToasts / .csOverlay /
 * 各 Modal）都是 position: fixed，不参与 grid 排布，不受 two-row 影响。 */
.csFrame[data-mode="lobby"],
.csFrame[data-mode="lobby-pending"] {
  grid-template-columns: 280px minmax(0, 1fr) 0px;
  /* 第三行（auto）：CV-065 推荐技能横滚，落在聊天卡片下方。 */
  grid-template-rows: auto minmax(0, 1fr) auto;
}

.csFrame[data-mode="lobby"] .csProjects,
.csFrame[data-mode="lobby-pending"] .csProjects { grid-area: 1 / 1 / 4 / 2; }
.csFrame[data-mode="lobby"] .csCanvas,
.csFrame[data-mode="lobby-pending"] .csCanvas { grid-area: 1 / 2 / 2 / 3; }
/* CV-065：lobby 中栏第三行 —— 推荐技能横滚（work 态不渲染，行塌为 0）。 */
.csFrame[data-mode="lobby"] .csLobbyTail,
.csFrame[data-mode="lobby-pending"] .csLobbyTail { grid-area: 3 / 2 / 4 / 3; }
/* 聊天卡片：居中、限宽限高，浮在中栏下半部分的底色上。 */
.csFrame[data-mode="lobby"] .csChat,
.csFrame[data-mode="lobby-pending"] .csChat {
  grid-area: 2 / 2 / 3 / 3;
  justify-self: center;
  align-self: center;
  width: min(880px, calc(100% - 48px));
  height: min(560px, 100%);
  margin: 0 0 12px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: var(--cs-radius-lg, 12px);
  background: var(--dsw-alias-bg-layer-1);
  box-shadow: var(--cs-shadow-1, none);
}

/* lobby / lobby-pending 态没有画布可操作：工具栏与工作流条整体让位给品牌条
   + 聊天。保持挂载（不条件渲染）以保证 work 态 DOM/交互零变化。 */
.csFrame[data-mode="lobby"] .csToolbar,
.csFrame[data-mode="lobby"] .csWorkflowBar,
.csFrame[data-mode="lobby-pending"] .csToolbar,
.csFrame[data-mode="lobby-pending"] .csWorkflowBar {
  display: none;
}

/* P7 创作工作流条：模式开关 + 审批提示，位于工具栏与画布之间。 */
.csWorkflowBar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-1);
}

.csWorkflowMode {
  display: inline-flex;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 6px;
  overflow: hidden;
}

.csWorkflowMode button {
  padding: 3px 10px;
  font-size: 12px;
  border: none;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}

.csWorkflowMode button + button {
  border-left: 1px solid var(--dsw-alias-border-l2);
}

.csWorkflowMode button.csActive {
  background: var(--dsw-alias-bg-layer-3);
  color: var(--dsw-alias-label-primary);
}

/* CV-052 防御层：当前已激活的模式按钮禁用（路由层已短路，这里是第二道）。 */
.csWorkflowMode button:disabled {
  cursor: default;
}

.csWorkflowMode button.csActive:disabled {
  color: var(--dsw-alias-label-primary);
}

.csWorkflowState {
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
}

.csWorkflowApproval {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}

.csWorkflowApproval .csWorkflowMessage {
  font-size: 12px;
  color: var(--dsw-alias-label-warning, var(--dsw-alias-label-primary));
}

.csWorkflowApproval button {
  padding: 4px 12px;
  font-size: 12px;
  border-radius: 6px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: transparent;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
}

.csWorkflowApproval button.csPrimary {
  background: var(--dsw-alias-bg-layer-3);
}

/* R1（G1）：驳回意见输入框——可选填写不满意点，随驳回消息转述给 agent。 */
.csWorkflowApproval input.csRejectInput {
  width: 260px;
  padding: 4px 8px;
  font-size: 12px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 6px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
}

.csWorkflowApproval input.csRejectInput::placeholder {
  color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary));
}

/* P7 点选式澄清卡片：ask_user_choice 弹出的选择题。 */
.csQuestionCard {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-1);
}

.csQuestionLabel {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
}

/* CV-062：问题头部徽标与操作提示，让点选卡片在对话流里可辨识。 */
.csQuestionIcon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 6px;
  background: var(--dsw-alias-bg-layer-3);
  font-size: 11px;
  font-style: normal;
}

.csQuestionHint {
  margin-left: auto;
  font-style: normal;
  font-size: 10px;
  font-weight: 400;
  opacity: 0.6;
}

.csQuestionOptions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.csQuestionOptions button {
  padding: 6px 16px;
  min-height: 28px;
  font-size: 12px;
  border-radius: 999px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  transition: transform 120ms ease, background 120ms ease, border-color 120ms ease;
}

.csQuestionOptions button:hover:not(:disabled) {
  transform: translateY(-1px);
}

/* hover 配色只作用于未选中项——否则会盖掉选中态的反色配色（深底深字不可读）。 */
.csQuestionOptions button:hover:not(:disabled):not(.csSelected) {
  background: var(--dsw-alias-bg-layer-3);
  border-color: var(--dsw-alias-border-l3, var(--dsw-alias-border-l2));
}

.csQuestionOptions button:disabled {
  opacity: 0.5;
  cursor: default;
}

/* CV-062：选中态——实心填充 + ✓ 前缀，一眼可辨。 */
.csQuestionOptions button.csSelected {
  background: var(--dsw-alias-label-primary);
  border-color: var(--dsw-alias-label-primary);
  color: var(--dsw-alias-bg-base);
}

.csQuestionOptions button.csSelected::before {
  content: "✓ ";
}

/* CV-062：确认按钮（两段式交互的提交步），主按钮样式。 */
.csQuestionConfirm {
  align-self: flex-start;
  padding: 6px 18px;
  font-size: 12px;
  font-weight: 600;
  border-radius: 999px;
  border: 1px solid transparent;
  background: var(--dsw-alias-label-primary);
  color: var(--dsw-alias-bg-base);
  cursor: pointer;
  transition: transform 120ms ease, opacity 120ms ease;
}

.csQuestionConfirm:hover:not(:disabled) {
  transform: translateY(-1px);
}

.csQuestionConfirm:disabled {
  opacity: 0.4;
  cursor: default;
}

/* S3：风格澄清 GIF 预览卡片（ask_user_choice 选项命中风格预设时）。 */
.csStyleDemoGrid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.csStyleDemoCard {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  border-radius: 10px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-base);
  cursor: pointer;
  text-align: left;
}

.csStyleDemoCard:hover:not(:disabled):not(.csSelected) {
  border-color: var(--dsw-alias-border-l3, var(--dsw-alias-border-l2));
  background: var(--dsw-alias-bg-layer-2);
}

.csStyleDemoCard:disabled {
  opacity: 0.5;
  cursor: default;
}

.csStyleDemoCard.csSelected {
  border-color: var(--dsw-alias-label-primary);
}

.csStyleDemoCard.csSelected .csStyleDemoName::before {
  content: "✓ ";
  font-weight: 600;
}

.csStyleDemoImg {
  width: 100%;
  aspect-ratio: 16 / 9;
  object-fit: cover;
  border-radius: 6px;
  background: var(--dsw-alias-bg-layer-2);
}

.csStyleDemoName {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--dsw-alias-label-primary);
}

.csStyleDemoBadge {
  font-style: normal;
  font-size: 10px;
  line-height: 1;
  padding: 2px 6px;
  border-radius: 999px;
  background: var(--dsw-alias-bg-layer-3);
  color: var(--dsw-alias-label-primary);
}

.csQuestionOther {
  opacity: 0.75;
}

.csQuestionFree {
  display: flex;
  gap: 6px;
}

.csQuestionFree input {
  flex: 1;
  padding: 5px 10px;
  font-size: 12px;
  border-radius: 6px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
}

.csQuestionFree button {
  padding: 5px 12px;
  font-size: 12px;
  border-radius: 6px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: transparent;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
}

.csProjects {
  display: flex;
  flex-direction: column;
  /* CV-070：拆出 .csProjectsScroll 让「品牌条 / 段头+列表 / 用户卡」三段分别
     自管 padding；侧栏自身不再 overflow，列表仅在列表区滚动，用户卡固定底部。 */
  border-right: 1px solid var(--dsw-alias-border-l2);
  color: var(--dsw-alias-label-primary);
  min-height: 0;
  overflow: hidden;
}

/* CV-070：列表区独立滚动容器 —— 段头「项目 + 刷新」与项目行共享同一滚动条，
   不会带飞用户卡。min-height:0 是 flex item 在固定高度父下允许收缩的硬条件。 */
.csProjectsScroll {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 12px 12px;
  overflow-y: auto;
  --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2);
  --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2);
}

.csProjectsHeader {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  /* CV-070：与「+ 新建项目」按钮顶部 4px 呼吸，确保刷新按钮不贴边 */
  padding: 4px 0 2px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  font-weight: 600;
  color: var(--dsw-alias-label-tertiary);
}

.csProjectsHeader > span {
  flex: 1 1 auto;
}

.csProjectsHeader button {
  font: inherit;
  font-size: 12px;
  padding: 3px 9px;
  border-radius: 6px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  text-transform: none;
  letter-spacing: 0;
  cursor: pointer;
  transition: background-color 120ms ease, color 120ms ease;
}

.csProjectsHeader button:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}

.csProjectsHeader button:disabled {
  opacity: 0.5;
  cursor: default;
}

.csProjectsEmpty {
  color: var(--dsw-alias-label-tertiary);
  font-size: 13px;
  padding: 24px 8px;
  text-align: center;
}

.csProjectList {
  display: flex;
  flex-direction: column;
  gap: 4px;
  /* CV-070：列表现处于 .csProjectsScroll 滚动容器内，必须按自然高度排布
     （flex:0 0 auto）。若保留 flex:1 1 auto + min-height:0，列表会被压到
     滚动容器高度后再溢出，滚动高度依赖浏览器对 flex item 溢出的计算，
     Chrome/Safari 行为不一致，末尾几行可能滚不到。 */
  flex: 0 0 auto;
}

/* -- CV-069 / CV-070：左栏底部用户卡（固定底部，与上方列表区用顶 border 分隔） -- */
.csUser {
  /* 不再用 margin-top:auto 推底——列表区已独立滚动，卡片始终固定底部，自身
     不参与 flex grow。 */
  flex: 0 0 auto;
  padding: 8px 12px;
  border-top: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-base);
}
/* 单个用户条按钮（点开面板；设置入口在面板内部 .csUserSettings）。 */
.csUserBar {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 8px;
  border: 1px solid transparent;
  border-radius: 10px;
  background: transparent;
  cursor: pointer;
  text-align: left;
}
.csUserBar:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}
.csUserAvatar {
  border-radius: 50%;
  flex-shrink: 0;
}
.csUserBarName {
  font-size: 12px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* CV-069 修复：position:fixed 逃出 .csProjects 的 overflow 裁剪（坐标由组件
   实测内联注入）；background 用真实存在的 --dsw-alias-bg-base（bg-l1 缩写
   令牌在主题包中不存在，此前面板背景透明）。 */
.csUserPanel {
  position: fixed;
  z-index: 90;
  width: 260px;
  max-height: min(480px, 72vh);
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 12px;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  box-shadow: 0 16px 48px rgb(0 0 0 / 28%);
}
.csUserHead {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 4px 10px;
}
.csUserHeadMeta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.csUserName {
  font-size: 13px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
}
.csUserUid {
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.csUserRow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 7px 6px;
}
.csUserRowLabel {
  font-size: 12px;
  color: var(--dsw-alias-label-primary);
}
.csUserValue {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
}
.csUserBadge {
  padding: 1px 6px;
  border-radius: 999px;
  font-size: 10px;
  color: var(--dsw-alias-label-secondary);
  background: var(--dsw-alias-bg-layer-2);
}
.csUserChevron {
  color: var(--dsw-alias-label-tertiary);
}
.csUserGroup {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 6px;
  padding-top: 8px;
  border-top: 1px solid var(--dsw-alias-border-l2);
}
.csUserGroupLabel {
  padding: 0 6px 4px;
  font-size: 10px;
  color: var(--dsw-alias-label-tertiary);
  letter-spacing: 0.05em;
}
.csUserEntry {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  padding: 7px 6px;
  border: none;
  border-radius: 8px;
  background: transparent;
  cursor: pointer;
  text-align: left;
}
.csUserEntry:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
}
.csUserEntry:disabled {
  cursor: default;
}
.csUserSettings {
  margin-top: 6px;
  padding-top: 9px;
  padding-bottom: 9px;
  border-top: 1px solid var(--dsw-alias-border-l2);
  border-radius: 0 0 8px 8px;
}
.csUserThemeRow {
  display: flex;
  gap: 6px;
  padding: 2px 6px 6px;
}
.csUserThemeBtn {
  flex: 1;
  padding: 4px 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  font-size: 11px;
  color: var(--dsw-alias-label-secondary);
  background: transparent;
  cursor: pointer;
}
.csUserThemeBtn:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}
.csUserThemeActive {
  border-color: var(--cs-accent, var(--dsw-alias-border-l2));
  color: var(--cs-accent, var(--dsw-alias-label-primary));
  font-weight: 600;
}

/* CV-088：Lobby 个性化问候（LobbyHero 品牌条内）。 */
.csLobbyGreet {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
}

.csProjectNew {
  font: inherit;
  padding: 6px 10px;
  border-radius: 6px;
  border: 1px dashed var(--dsw-alias-border-l2);
  background: transparent;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  text-align: left;
}

.csProjectNew:disabled {
  opacity: 0.5;
  cursor: default;
}

.csProjectSettings {
  font: inherit;
  padding: 6px 10px;
  border-radius: 6px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: transparent;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  text-align: left;
}

.csProjectSettings:hover {
  background: var(--dsw-alias-bg-hover);
}

.csProjectForm {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 4px 0;
}

/* 一键效果测试：用例勾选行 + 运行进度块（复用侧栏字色与间距节奏）。 */
.csEffectTestCases {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 10px;
}

.csEffectTestCase {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font: inherit;
  cursor: pointer;
}

.csEffectTestProgress {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 6px 8px;
  margin: 2px 0;
  border: 1px solid var(--cs-border, rgba(128, 128, 128, 0.35));
  border-radius: 6px;
  font-size: 12px;
  opacity: 0.9;
}

.csEffectTestTitle {
  font-weight: 600;
}

.csEffectTestFailure {
  color: #e05252;
  word-break: break-all;
}

.csEffectTestSummary {
  opacity: 0.75;
  word-break: break-all;
}


.csProjectNameInput {
  font: inherit;
  padding: 6px 8px;
  border-radius: 6px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
}

.csProjectFormActions {
  display: flex;
  gap: 6px;
}

.csProjectFormActions button {
  font: inherit;
  flex: 1;
  padding: 4px 10px;
  border-radius: 6px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: transparent;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
}

.csProjectFormActions button:disabled {
  opacity: 0.5;
  cursor: default;
}

.csProjectItem {
  font: inherit;
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
  padding: 8px 10px 8px 12px;
  border-radius: 6px;
  /* CV-070：选中态用左侧 accent 边线取代整圈边框，配上轻微底色，活动状态更易扫视。 */
  border: 1px solid transparent;
  border-left: 3px solid transparent;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  text-align: left;
  transition: background-color 120ms ease, border-color 120ms ease;
}

.csProjectItem:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}

.csProjectItemActive {
  border-color: var(--dsw-alias-border-l2);
  border-left-color: var(--cs-accent, #6c5ce7);
  background: var(--dsw-alias-interactive-bg-active);
}

.csProjectItem:focus-visible {
  outline: 2px solid var(--cs-accent, #6c5ce7);
  outline-offset: -2px;
}

.csProjectMeta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1 1 auto;
}

.csProjectName {
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.csProjectDate {
  font-size: 11px;
  line-height: 1.3;
  color: var(--dsw-alias-label-tertiary);
}

.csProjectDelete {
  flex: 0 0 auto;
  width: 22px;
  height: 22px;
  display: grid;
  place-items: center;
  border-radius: 4px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  /* CV-070：默认隐藏 × ，hover/focus 当前行才显出，避免视觉噪音 */
  opacity: 0;
  transition: opacity 120ms ease, background-color 120ms ease, color 120ms ease;
}

.csProjectItem:hover .csProjectDelete,
.csProjectItem:focus-within .csProjectDelete,
.csProjectDelete:focus-visible {
  opacity: 1;
}

.csProjectItemActive .csProjectDelete {
  /* 选中行始终可见 —— 用户已经盯着这一行，需要确切的删除入口 */
  opacity: 1;
}

.csProjectDelete:hover:not(:disabled) {
  color: var(--dsw-alias-state-error-primary);
  background: var(--dsw-alias-interactive-bg-hover);
  border-color: var(--dsw-alias-border-l2);
}

.csProjectDelete:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* -- CV-091：用户自定义分组 + 折叠（沿用 DSW 主题变量，深色/浅色自适应） -- */
.csProjectListActions {
  display: flex;
  gap: 6px;
  padding: 2px 0 4px;
}

.csProjectNewGroup {
  /* 与「+ 新建项目」共用 .csProjectNew 虚线外观，不作额外视觉区分。 */
  flex: 0 0 auto;
}

.csProjectGroup {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 2px;
}

.csProjectGroupHeader {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 2px;
}

.csProjectGroupToggle {
  flex: 0 0 auto;
  width: 20px;
  height: 20px;
  display: grid;
  place-items: center;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  line-height: 1;
  cursor: pointer;
}

.csProjectGroupToggle:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}

.csProjectGroupName {
  flex: 1 1 auto;
  min-width: 0;
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
  font-size: 13px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
  cursor: default;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 可重命名分组的名字（有 title）才显示手型，提示双击改名。 */
.csProjectGroupName[title] {
  cursor: pointer;
}

.csProjectGroupNameInput {
  flex: 1 1 auto;
  min-width: 0;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 4px;
  border: 1px solid var(--cs-accent, #6c5ce7);
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
}

.csProjectGroupCount {
  font-size: 11px;
  font-weight: 400;
  color: var(--dsw-alias-label-tertiary);
}

.csProjectGroupActions {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 2px;
}

.csProjectGroupAdd,
.csProjectGroupDelete {
  width: 22px;
  height: 22px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  font-size: 15px;
  line-height: 1;
  cursor: pointer;
  transition: opacity 120ms ease, background-color 120ms ease, color 120ms ease;
}

.csProjectGroupAdd:hover:not(:disabled),
.csProjectGroupDelete:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}

/* 删组按钮：默认隐藏，hover/focus 分组头才显出（与项目行 × 同惯例）。 */
.csProjectGroupDelete {
  opacity: 0;
}

.csProjectGroupHeader:hover .csProjectGroupDelete,
.csProjectGroupHeader:focus-within .csProjectGroupDelete,
.csProjectGroupDelete:focus-visible {
  opacity: 1;
}

.csProjectGroupDelete:hover:not(:disabled) {
  color: var(--dsw-alias-state-error-primary);
  border-color: var(--dsw-alias-border-l2);
}

.csProjectGroupDelete:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.csProjectGroupEmpty {
  padding: 4px 10px 4px 26px;
  font-size: 12px;
  color: var(--dsw-alias-label-tertiary);
}

.csProjectFormInline {
  padding: 2px 0 2px 22px;
}

.csProjectRowActions {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 4px;
}

.csProjectMove {
  font: inherit;
  font-size: 11px;
  max-width: 92px;
  padding: 2px 4px;
  border-radius: 4px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  /* 默认隐藏，hover/focus 当前行才显出（与 × 同惯例，减少噪音）。 */
  opacity: 0;
  transition: opacity 120ms ease, background-color 120ms ease;
}

.csProjectItem:hover .csProjectMove,
.csProjectItem:focus-within .csProjectMove,
.csProjectMove:focus-visible {
  opacity: 1;
}

/* 选中行始终显出移动入口，与选中行 × 常驻一致。 */
.csProjectItemActive .csProjectMove {
  opacity: 1;
}

.csProjectMove:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.csProjectError {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  font-size: 13px;
  color: var(--dsw-alias-state-error-primary);
}

.csProjectError button {
  font: inherit;
  align-self: flex-start;
  padding: 4px 10px;
  border-radius: 6px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: transparent;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
}

.csCanvas {
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
  background: var(--dsw-alias-bg-base);
}

/* Middle region between the top toolbar and the bottom timeline: the pannable
 * surface plus the floating layer-list overlay share this positioned box. */
.csCanvasBody {
  position: relative;
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

/* Infinite canvas surface: grid background pans/zooms with the layer. */
.csCanvasSurface {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  cursor: grab;
  touch-action: none;
  background-color: var(--dsw-alias-bg-base);
  /* CV-035：网格线降到 45% 不透明度。原样用 border-l2 时网格与节点描边同色，
     40px 密格在放大后压过内容。color-mix 保持跟随明暗主题（Chromium 111+，
     桌面 Electron 43 满足）。格子尺寸（40px）不变。 */
  background-image:
    linear-gradient(to right, color-mix(in srgb, var(--dsw-alias-border-l2) 45%, transparent) 1px, transparent 1px),
    linear-gradient(to bottom, color-mix(in srgb, var(--dsw-alias-border-l2) 45%, transparent) 1px, transparent 1px);
  background-repeat: repeat;
}

.csCanvasSurface:active {
  cursor: grabbing;
}

/* CV-089：marquee 期间切到 crosshair。覆盖 :active 的 grabbing 优先级，因为
   框选是该手势的目的态而不是平移状态。 */
.csCanvasSurface[data-mode="marquee"] {
  cursor: crosshair;
}
.csCanvasSurface[data-mode="marquee"]:active {
  cursor: crosshair;
}

.csCanvasLayer {
  position: absolute;
  top: 0;
  left: 0;
  width: 0;
  height: 0;
  will-change: transform;
}

.csEdges {
  position: absolute;
  top: 0;
  left: 0;
  overflow: visible;
  pointer-events: none;
}

.csEdge {
  fill: none;
  stroke: var(--dsw-alias-interactive-bg-active);
  stroke-width: 2;
  opacity: 0.8;
}

.csNode {
  position: absolute;
  /* CR-081：位移走 transform（CanvasNode 用 translate3d 定位），提升为合成层，
     拖拽/微调不触发布局重绘。 */
  will-change: transform;
  border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-base);
  overflow: hidden;
  cursor: grab;
  box-shadow: 0 1px 4px rgb(0 0 0 / 12%);
}

.csNode:active {
  cursor: grabbing;
}

/* CV-089：选中态用实色 accent 描边 + 外光晕，去掉「半透明蓝蒙层」观感。
   旧实现用 --dsw-alias-interactive-bg-active（带透明度的浅蓝），在大节点上
   视觉上像「蒙了一层蓝」；改用 --cs-accent 实色双层 box-shadow（外描边 +
   外光晕），节点内容不被覆盖、视觉上明显是「被选中」而非「被蒙层」。
   --cs-accent-soft 在深色主题下 = accentSoft（同色稍降饱和），浅色主题
   下 = accentSoftLight，保证光晕在两种主题里都可见。 */
/* CV-089：主被拖动节点 —— z-index 抬到最上层，避免拖动时被其他选中节点的
   box-shadow 外光晕遮住；同时用更明显的描边宽度区分它与一般选中成员。
   （多选拖拽时所有选中节点都会拿到 csNodeSelected，但只有"用户按下的
   那个"再拿到 csNodePrimary；这样视觉上「主」与「随从」一眼可分。） */
.csNodePrimary.csNodeSelected {
  z-index: 3;
  box-shadow:
    0 0 0 2px var(--cs-accent, #6c5ce7),
    0 0 0 6px var(--cs-accent-soft, transparent);
}

/* CV-089：连线和 resize 把手只在 hover/选中 显 —— 之前 link handle 常驻，
   每个媒体节点右缘都挂一个 12px 圆点，叠加在大批节点上视觉上像"蒙了一层"。
   现改为 hover 当前节点或该节点被选中才显出。 */
.csNodeLinkHandle {
  position: absolute;
  right: -9px;
  top: 50%;
  transform: translateY(-50%);
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 2px solid var(--dsw-alias-bg-base);
  background: var(--dsw-alias-interactive-bg-active);
  cursor: crosshair;
  z-index: 4;
  opacity: 0;
  transition: opacity 100ms ease;
}

.csNode:hover .csNodeLinkHandle,
.csNodeSelected .csNodeLinkHandle {
  opacity: 1;
}

.csNodeLinkHandle:hover {
  box-shadow: 0 0 0 2px var(--dsw-alias-interactive-bg-active);
}

/* CV-089：选中态 —— 实色 accent 描边 + 外光晕。
   【已移除 dim】曾在这里挂过 .csCanvasSurface[data-dragging="true"] 规则，
   把「非被拖节点」压到 opacity 0.55 / 0.85。那是错的：dim 的合理语义是
   「框选时区分命中/未命中」，而 data-dragging 是在**节点拖动**时置上的，
   于是点选单张图拖动会把整屏其他节点压暗，看上去像"蒙了一层"。
   现在拖动节点不改任何节点的不透明度，只给被拖的那个抬 z-index + 加粗描边。 */
.csNodeSelected {
  border-color: var(--cs-accent, #6c5ce7);
  box-shadow:
    0 0 0 1.5px var(--cs-accent, #6c5ce7),
    0 0 0 4px var(--cs-accent-soft, transparent);
  transition: box-shadow 80ms ease, opacity 80ms ease, border-color 80ms ease;
}

.csNodeMedia {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  background: var(--dsw-alias-bg-base);
}

/* Images stay inert so node dragging owns every pointer; the video keeps
   native controls (play/seek/volume) interactive. */
img.csNodeMedia {
  pointer-events: none;
}

.csNodeText {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px;
  height: 100%;
  box-sizing: border-box;
  overflow: hidden;
}

.csNodeKind {
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary);
}

.csNodeBody {
  margin: 0;
  font-size: 13px;
  color: var(--dsw-alias-label-primary);
  overflow: hidden;
  text-overflow: ellipsis;
}

/* CV-081：文本类节点选中态正文可滚动（长分镜表/脚本不再截断）。
   滚轮豁免在 CanvasSurface 的 wheel handler 里按「可滚」判定。 */
.csNodeSelected .csNodeBody {
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
}

/* CV-001：文本类节点内联正文编辑（双击进入，替换只读正文）。 */
.csNodeBodyEdit {
  flex: 1 1 auto;
  min-height: 0;
  resize: none;
  border: 1px solid var(--dsw-alias-interactive-bg-active);
  border-radius: 4px;
  padding: 4px 6px;
  font: inherit;
  font-size: 13px;
  line-height: 1.4;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  box-sizing: border-box;
}

.csTimeline {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 6px;
  padding: 8px 12px;
  border-top: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-base);
  --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2);
  --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2);
}

/* P9.3 合成工具条：片段计数 + 导出按钮。 */
.csTimelineToolbar {
  display: flex;
  align-items: center;
  gap: 10px;
}

.csTimelineCount {
  font-size: 12px;
  color: var(--dsw-alias-label-tertiary);
}

/* 片段条横向滚动（工具条固定不滚）。 */
.csTimelineStrip {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding-bottom: 2px;
}

.csTimelineEmpty {
  border-top: 1px solid var(--dsw-alias-border-l2);
  padding: 10px 12px;
  font-size: 13px;
  color: var(--dsw-alias-label-tertiary);
  background: var(--dsw-alias-bg-base);
}

.csTimelineItem {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 0 0 auto;
  padding: 4px;
  border-radius: 6px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
}

.csTimelineItem:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}

.csTimelineItemActive {
  border-color: var(--dsw-alias-interactive-bg-active);
  background: var(--dsw-alias-interactive-bg-active);
}

/* P9.1 拖拽排序的插入落点提示。 */
.csTimelineItemTarget {
  outline: 2px dashed var(--dsw-alias-interactive-bg-active);
  outline-offset: 1px;
}

.csTimelineThumb {
  display: grid;
  place-items: center;
  width: 96px;
  height: 60px;
  border-radius: 4px;
  overflow: hidden;
  background: var(--dsw-alias-bg-base);
  border: 1px solid var(--dsw-alias-border-l2);
}

.csTimelineThumb img,
.csTimelineThumb video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.csTimelineKind {
  font-size: 13px;
  color: var(--dsw-alias-label-secondary);
}

.csTimelineTime {
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary);
}

.csConversation {
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.csOverlay {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 40;
}

.csOverlay > * {
  pointer-events: auto;
}

/* ---- Canvas toolbar (floating strip above the surface) ---- */
.csToolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-base);
  z-index: 5;
}

.csToolbarGroup {
  display: flex;
  align-items: center;
  gap: 2px;
  padding-right: 8px;
  margin-right: 4px;
  border-right: 1px solid var(--dsw-alias-border-l2);
}

.csToolbarGroup:last-child {
  border-right: none;
  padding-right: 0;
  margin-right: 0;
}

.csToolbarButton {
  font: inherit;
  font-size: 12px;
  padding: 3px 8px;
  border-radius: 6px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  white-space: nowrap;
}

.csToolbarButton:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}

.csToolbarButton:disabled {
  opacity: 0.4;
  cursor: default;
}

.csToolbarZoomValue {
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
  padding: 0 4px;
  min-width: 40px;
  text-align: center;
  white-space: nowrap;
}

/* ---- Snap alignment guides ---- */
.csGuide {
  position: absolute;
  background: var(--dsw-alias-interactive-bg-active);
  pointer-events: none;
  z-index: 3;
}

.csGuideVertical {
  top: 0;
  bottom: 0;
  width: 1px;
}

.csGuideHorizontal {
  left: 0;
  right: 0;
  height: 1px;
}

/* ---- Node visual states ---- */
.csNodeLocked {
  opacity: 0.75;
  cursor: not-allowed;
}

.csNodeError {
  border-color: var(--dsw-alias-state-error-primary);
}

.csNodeLoading {
  border-style: dashed;
  border-color: var(--dsw-alias-interactive-bg-active);
}

.csNodeMediaBox {
  position: relative;
  width: 100%;
  height: 100%;
}

/* CV-083：视频时长角标（左下角 m:ss，metadata 就绪后显示）。 */
.csNodeDuration {
  position: absolute;
  left: 8px;
  bottom: 8px;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 11px;
  line-height: 1.4;
  color: #fff;
  background: color-mix(in srgb, #000 62%, transparent);
  pointer-events: none;
}

/* CV-089：分辨率角标（右下角，图片视频都用；与左下时长角标对称）。
   字号/字号族与时长保持一致，便于左右扫读。 */
.csNodeMediaDims {
  position: absolute;
  right: 8px;
  bottom: 8px;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 11px;
  line-height: 1.4;
  font-variant-numeric: tabular-nums;
  color: #fff;
  background: color-mix(in srgb, #000 62%, transparent);
  pointer-events: none;
}

.csNodeGroup {
  display: flex;
  align-items: flex-start;
  padding: 8px;
  height: 100%;
  box-sizing: border-box;
  border: 1px dashed var(--dsw-alias-interactive-bg-active);
  border-radius: 8px;
  background: rgb(99 102 241 / 6%);
}

.csNodeResize {
  position: absolute;
  z-index: 4;
}

.csNodeResizeN {
  top: -4px;
  left: 8px;
  right: 8px;
  height: 8px;
  cursor: ns-resize;
}

.csNodeResizeS {
  bottom: -4px;
  left: 8px;
  right: 8px;
  height: 8px;
  cursor: ns-resize;
}

.csNodeResizeE {
  top: 8px;
  bottom: 8px;
  right: -4px;
  width: 8px;
  cursor: ew-resize;
}

.csNodeResizeW {
  top: 8px;
  bottom: 8px;
  left: -4px;
  width: 8px;
  cursor: ew-resize;
}

.csNodeResizeNW {
  top: -4px;
  left: -4px;
  width: 10px;
  height: 10px;
  cursor: nwse-resize;
}

.csNodeResizeNE {
  top: -4px;
  right: -4px;
  width: 10px;
  height: 10px;
  cursor: nesw-resize;
}

.csNodeResizeSW {
  bottom: -4px;
  left: -4px;
  width: 10px;
  height: 10px;
  cursor: nesw-resize;
}

.csNodeResizeSE {
  bottom: -4px;
  right: -4px;
  width: 10px;
  height: 10px;
  cursor: nwse-resize;
}

.csNodeResizeN, .csNodeResizeS, .csNodeResizeE, .csNodeResizeW {
  opacity: 0;
}

.csNode:hover .csNodeResize,
.csNodeSelected .csNodeResize {
  opacity: 1;
}

.csNodeLinkHandle {
  position: absolute;
  right: -9px;
  top: 50%;
  transform: translateY(-50%);
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 2px solid var(--dsw-alias-bg-base);
  background: var(--dsw-alias-interactive-bg-active);
  cursor: crosshair;
  z-index: 4;
}

.csNodeLinkHandle:hover {
  box-shadow: 0 0 0 2px var(--dsw-alias-interactive-bg-active);
}

.csNodeOverlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: var(--dsw-alias-bg-base);
  opacity: 0.92;
}

.csNodeOverlayLabel {
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
}

.csNodeProgress {
  width: 70%;
  height: 4px;
  border-radius: 2px;
  overflow: hidden;
  background: var(--dsw-alias-border-l2);
}

.csNodeProgressBar {
  display: block;
  width: 40%;
  height: 100%;
  border-radius: 2px;
  background: var(--dsw-alias-interactive-bg-active);
  animation: csProgressSlide 1.2s ease-in-out infinite;
}

/* CV-010：loading 超时（>3 分钟）的可打断提示。 */
.csNodeOverlayHint {
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary);
}

@keyframes csProgressSlide {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(350%); }
}

.csNodeBadge {
  position: absolute;
  top: -8px;
  left: -8px;
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 11px;
  max-width: 80%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  background: var(--dsw-alias-bg-base);
  border: 1px solid var(--dsw-alias-border-l2);
  color: var(--dsw-alias-label-secondary);
}

.csNodeBadgeError {
  border-color: var(--dsw-alias-state-error-primary);
  color: var(--dsw-alias-state-error-primary);
}

/* CV-018：可重试的失败徽章 —— 保持错误配色，叠加可点 affordance。 */
.csNodeBadgeRetry {
  cursor: pointer;
  font: inherit;
  font-size: 11px;
  z-index: 2;
}

.csNodeBadgeRetry:hover {
  background: var(--dsw-alias-state-error-primary);
  color: var(--dsw-alias-bg-base);
}

/* CV-011：参考图角色角标（左上角，色点按角色区分，避开错误徽章的位置放底部）。 */
.csNodeRefBadge {
  position: absolute;
  bottom: -8px;
  left: -8px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 11px;
  white-space: nowrap;
  background: var(--dsw-alias-bg-base);
  border: 1px solid var(--dsw-alias-border-l2);
  color: var(--dsw-alias-label-secondary);
  z-index: 2;
}

.csNodeRefDot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--dsw-alias-border-l3);
}

/* 角色色点：构图=蓝 / 角色=红 / 风格=紫 / 首末帧=青。 */
.csNodeRefBadge[data-role='image'] .csNodeRefDot { background: #4d9fff; }
.csNodeRefBadge[data-role='character'] .csNodeRefDot { background: #ff6b6b; }
.csNodeRefBadge[data-role='style'] .csNodeRefDot { background: #b58cff; }
.csNodeRefBadge[data-role='frame'] .csNodeRefDot { background: #38c9b8; }

.csNodeBadgeLock {
  left: auto;
  right: -8px;
}

.csNodeRename {
  position: absolute;
  top: 4px;
  left: 4px;
  right: 4px;
  z-index: 5;
  font: inherit;
  font-size: 12px;
  padding: 2px 6px;
  border-radius: 4px;
  border: 1px solid var(--dsw-alias-interactive-bg-active);
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
}

/* ---- Edge draft line + chip text ---- */
.csEdgeDraft {
  stroke-dasharray: 6 4;
  stroke: var(--dsw-alias-interactive-bg-active);
}

.csEdgeChipText {
  font-family: inherit;
  user-select: none;
}

/* ---- Minimap ---- */
.csMinimap {
  position: absolute;
  left: 10px;
  bottom: 10px;
  padding: 6px;
  border-radius: 8px;
  background: var(--dsw-alias-bg-base);
  border: 1px solid var(--dsw-alias-border-l2);
  cursor: grab;
  user-select: none;
}

.csMinimap:active {
  cursor: grabbing;
}

.csMinimap svg {
  display: block;
}

/* ---- Right column (conversation only) ---- */
.csChat {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border-left: 1px solid var(--dsw-alias-border-l2);
}

/* ---- Floating layer-list overlay (inside the canvas body) ---- */
.csCanvasLayers {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 10;
  width: 260px;
  border-radius: 10px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-base);
  box-shadow: 0 8px 28px rgb(0 0 0 / 18%);
  overflow: hidden;
  color: var(--dsw-alias-label-primary);
  --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2);
  --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2);
}

.csCanvasLayers .csLayerPanel {
  max-height: 320px;
  border-bottom: none;
}

/* ---- Layer panel ---- */
.csLayerPanel {
  display: flex;
  flex-direction: column;
  max-height: 320px;
  border-bottom: 1px solid var(--dsw-alias-border-l2);
  color: var(--dsw-alias-label-primary);
  --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2);
  --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2);
}

.csLayerPanelHeader {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  font-weight: 600;
  font-size: 13px;
}

.csLayerSearch {
  font: inherit;
  font-size: 12px;
  flex: 0 0 120px;
  padding: 3px 6px;
  border-radius: 6px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
}

.csLayerList {
  overflow-y: auto;
  padding: 0 6px 8px;
}

.csLayerRow {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
}

.csLayerRow:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}

.csLayerRowActive {
  background: var(--dsw-alias-interactive-bg-active);
}

.csLayerThumb {
  flex: 0 0 40px;
  height: 28px;
  display: grid;
  place-items: center;
  border-radius: 4px;
  overflow: hidden;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-base);
}

.csLayerThumb img,
.csLayerThumb video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.csLayerThumbKind {
  font-size: 10px;
  color: var(--dsw-alias-label-tertiary);
}

.csLayerTitle {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-primary);
}

.csLayerActions {
  display: flex;
  gap: 1px;
  flex: 0 0 auto;
}

.csLayerAction {
  width: 18px;
  height: 18px;
  display: grid;
  place-items: center;
  border-radius: 4px;
  border: 1px solid transparent;
  background: transparent;
  font-size: 11px;
  line-height: 1;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
}

.csLayerAction:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}

.csLayerActionActive {
  color: var(--dsw-alias-label-primary);
}

.csLayerActionDanger:hover {
  color: var(--dsw-alias-state-error-primary);
}

.csLayerEmpty {
  padding: 16px 8px;
  text-align: center;
  font-size: 12px;
  color: var(--dsw-alias-label-tertiary);
}

/* ---- Layer detail panel (overlay) ---- */
.csDetailPanel {
  position: fixed;
  top: 64px;
  right: 12px;
  z-index: 30;
  width: 320px;
  max-height: calc(100% - 80px);
  display: flex;
  flex-direction: column;
  border-radius: 10px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  box-shadow: 0 8px 28px rgb(0 0 0 / 18%);
  overflow: hidden;
  --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2);
  --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2);
}

.csDetailPanelHeader {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  font-weight: 600;
  font-size: 13px;
  border-bottom: 1px solid var(--dsw-alias-border-l2);
}

.csDetailPanelClose {
  font: inherit;
  width: 22px;
  height: 22px;
  display: grid;
  place-items: center;
  border-radius: 5px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
}

.csDetailPanelClose:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}

.csDetailPanelBody {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  overflow-y: auto;
  font-size: 12px;
}

.csDetailRow {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* CV-001：多行控件（正文 textarea）所在行，标签与内容顶对齐。 */
.csDetailRowTop {
  align-items: flex-start;
}

.csDetailRowTop > .csDetailLabel {
  padding-top: 4px;
}

/* CV-001：详情面板正文编辑区。 */
.csDetailTextarea {
  flex: 1 1 auto;
  min-width: 0;
  resize: vertical;
  padding: 4px 8px;
  font: inherit;
  font-size: 12px;
  line-height: 1.5;
  border-radius: 6px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  box-sizing: border-box;
}

.csDetailLabel {
  flex: 0 0 72px;
  color: var(--dsw-alias-label-tertiary);
}

.csDetailValue {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-primary);
}

.csDetailValueClickable {
  cursor: pointer;
  text-decoration: underline dotted;
  text-underline-offset: 2px;
}

.csDetailInput {
  font: inherit;
  font-size: 12px;
  flex: 1 1 auto;
  min-width: 0;
  padding: 4px 8px;
  border-radius: 6px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
}

.csDetailRange {
  flex: 1 1 auto;
  accent-color: var(--dsw-alias-interactive-bg-active);
}

.csDetailButton {
  font: inherit;
  font-size: 12px;
  padding: 3px 8px;
  border-radius: 6px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}

.csDetailButton:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}

.csDetailButtonActive {
  border-color: var(--dsw-alias-interactive-bg-active);
  color: var(--dsw-alias-label-primary);
}

.csDetailButtonDanger {
  border-color: transparent;
  color: var(--dsw-alias-state-error-primary);
}

.csDetailPrompt {
  flex: 1 1 auto;
  min-width: 0;
  margin: 0;
  font-size: 11px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-all;
  color: var(--dsw-alias-label-secondary);
}

/* 详情面板：生成参数结构化展示（提示词/参考图缩略图/原始 JSON 折叠）。 */
.csDetailRefThumbs {
  flex: 1 1 auto;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  min-width: 0;
}

.csDetailRefThumb {
  width: 56px;
  height: 56px;
  object-fit: cover;
  border-radius: 4px;
  border: 1px solid rgba(128, 128, 128, 0.35);
}

.csDetailRaw {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 11px;
  color: var(--dsw-alias-label-secondary);
}

.csDetailRaw summary {
  cursor: pointer;
  user-select: none;
}

.csDetailError {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 11px;
  color: var(--dsw-alias-state-error-primary);
  white-space: pre-wrap;
  word-break: break-all;
}

.csDetailActions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  flex: 1 1 auto;
  justify-content: flex-end;
}

.csDetailSteer {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border-top: 1px solid var(--dsw-alias-border-l2);
}

/* ---- Node context menu ---- */
.csContextMenu {
  position: fixed;
  z-index: 50;
  min-width: 160px;
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 4px;
  border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-base);
  box-shadow: 0 8px 24px rgb(0 0 0 / 16%);
}

.csMenuAction {
  font: inherit;
  font-size: 12px;
  text-align: left;
  padding: 6px 10px;
  border-radius: 5px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
}

.csMenuAction:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
}

.csMenuAction:disabled {
  opacity: 0.4;
  cursor: default;
}

.csMenuActionDanger {
  color: var(--dsw-alias-state-error-primary);
}

.csMenuActionDanger:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
}

/* CV-016：空白处右键菜单（复用 csContextMenu 骨架，仅调宽度）。 */
.csBlankMenu {
  min-width: 140px;
}

/* CV-015：非阻塞 toast（底部居中，逐条堆叠）。 */
.csToasts {
  position: fixed;
  left: 50%;
  bottom: 28px;
  transform: translateX(-50%);
  z-index: 80;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  pointer-events: none;
  max-width: min(480px, calc(100vw - 48px));
}

.csToast {
  padding: 10px 16px;
  border-radius: 10px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  line-height: 1.5;
  white-space: pre-line;
  box-shadow: 0 8px 24px rgb(0 0 0 / 16%);
  animation: csToastIn 160ms ease-out;
}

.csToast-success { border-color: var(--dsw-alias-state-success-primary, var(--dsw-alias-border-l2)); }
.csToast-error { border-color: var(--dsw-alias-state-error-primary); color: var(--dsw-alias-state-error-primary); }

@keyframes csToastIn {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

/* ---- Reference tray (floating overlay on the canvas, not the project list) ---- */
.csReferenceFloat {
  position: absolute;
  top: 12px;
  left: 12px;
  z-index: 20;
  width: 260px;
  max-height: calc(100% - 24px);
  display: flex;
  flex-direction: column;
  pointer-events: auto;
}
.csReferenceTray {
  margin: 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 10px;
  background: var(--dsw-alias-bg-base);
  overflow: hidden;
}

/* CV-011：参考托盘空态引导卡片。 */
.csReferenceEmpty {
  margin: 8px;
  padding: 10px 12px;
  border: 1px dashed var(--dsw-alias-border-l2);
  border-radius: 10px;
  background: var(--dsw-alias-bg-base);
}

.csReferenceEmptyTitle {
  margin: 0 0 6px;
  font-size: 12px;
  color: var(--dsw-alias-label-primary);
}

.csReferenceEmptyHint {
  margin: 0;
  font-size: 11px;
  line-height: 1.6;
  color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary));
}
.csReferenceHeader {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  font-size: 13px;
  font-weight: 500;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  user-select: none;
}
.csReferenceToggle {
  font-size: 16px;
  line-height: 1;
  color: var(--dsw-alias-label-secondary);
}
.csReferenceList {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px;
  max-height: 320px;
  overflow-y: auto;
}
.csReferenceItem {
  display: flex;
  gap: 8px;
  padding: 6px;
  border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-base);
}
.csReferenceThumb {
  width: 56px;
  height: 40px;
  object-fit: cover;
  border-radius: 6px;
  flex: 0 0 auto;
  background: #e9e9e9;
}
.csReferenceMeta {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.csReferenceTitleRow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}
.csReferenceTitle {
  font-size: 12px;
  color: var(--dsw-alias-label-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.csReferenceChip {
  flex: 0 0 auto;
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-secondary);
}
.csReferenceRange {
  width: 100%;
}
.csReferenceActions {
  display: flex;
  gap: 6px;
}
.csReferenceButton {
  flex: 1 1 auto;
  font-size: 12px;
  padding: 4px 6px;
  border-radius: 6px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
}
.csReferenceButton:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
}

/* ---- Detail panel reference section ---- */
.csDetailSection {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--dsw-alias-border-l2);
}
.csDetailSelect {
  flex: 1 1 auto;
  font-size: 13px;
  padding: 4px 6px;
  border-radius: 6px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
}

/* ---- Canvas toolbar settings button (opens the settings popup) ---- */
.csToolbarGroupEnd {
  margin-left: auto;
}

/* CV-059：右侧图标组按钮（整理布局 / 图层 / 小地图）。 */
.csToolbarIconButton {
  display: grid;
  place-items: center;
  padding: 3px 8px;
  color: var(--dsw-alias-label-secondary);
}
.csToolbarIconButton:hover {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-interactive-bg-hover);
}
/* 开关态（图层 / 小地图展开时高亮，等价于原「隐藏图层」文案语义）。 */
.csToolbarIconActive {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-layer-3);
}

.csToolbarSettings {
  display: grid;
  place-items: center;
  padding: 3px 8px;
  color: var(--dsw-alias-label-secondary);
}

.csToolbarSettings:hover {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-interactive-bg-hover);
}

/* ---- Settings popup (self-contained; not the desktop global panel) ---- */
.csModalBackdrop {
  position: fixed;
  inset: 0;
  z-index: 70;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgb(0 0 0 / 40%);
}

.csModal {
  width: min(440px, 100%);
  max-height: calc(100% - 48px);
  display: flex;
  flex-direction: column;
  border-radius: 12px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  box-shadow: 0 16px 48px rgb(0 0 0 / 28%);
  overflow: hidden;
}

.csModalHeader {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--dsw-alias-border-l2);
}

.csModalHeader h2 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}

/* CV-089：标题栏文本区（标题 + 元信息条两行）。 */
.csModalHeaderText {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1 1 auto;
}
.csModalHeaderMeta {
  margin: 0;
  font-size: 11px;
  line-height: 1.4;
  color: var(--dsw-alias-label-tertiary);
  font-variant-numeric: tabular-nums;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.csModalHeaderMetaSep {
  color: var(--dsw-alias-label-tertiary);
  opacity: 0.6;
}

.csModalClose {
  font: inherit;
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  border-radius: 6px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
}

.csModalClose:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}

.csModalBody {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px;
  overflow-y: auto;
}

.csField {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.csFieldLabel {
  font-size: 13px;
  color: var(--dsw-alias-label-secondary);
}

.csFieldInput {
  font: inherit;
  font-size: 13px;
  padding: 7px 10px;
  border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
}

.csFieldInput:focus {
  outline: none;
  border-color: var(--dsw-alias-interactive-bg-active);
}

.csFieldRow {
  display: flex;
  gap: 8px;
}

.csFieldRow .csFieldInput {
  flex: 1 1 auto;
  min-width: 0;
}

.csFieldButton {
  font: inherit;
  font-size: 13px;
  flex: 0 0 auto;
  padding: 7px 14px;
  border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: transparent;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
}

.csFieldButton:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
}

.csFieldButton:disabled {
  opacity: 0.5;
  cursor: default;
}

.csFieldError {
  margin: 0;
  font-size: 12px;
  color: var(--dsw-alias-state-error-primary);
}

/* ---- Settings popup tab bar (通用 / 主题 / 模型) ---- */
.csModalTabs {
  display: flex;
  gap: 4px;
  padding: 8px 16px 0;
  border-bottom: 1px solid var(--dsw-alias-border-l2);
}

.csTab {
  font: inherit;
  font-size: 13px;
  padding: 7px 14px;
  border: none;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}

.csTab:hover:not(.csTabActive) {
  color: var(--dsw-alias-label-primary);
}

.csTabActive {
  color: var(--dsw-alias-label-primary);
  border-bottom-color: var(--dsw-alias-interactive-bg-active);
  font-weight: 600;
}

/* ---- Theme option chips (主题分区) ---- */
.csThemeOptions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.csThemeOption {
  font: inherit;
  font-size: 13px;
  padding: 7px 16px;
  border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: transparent;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
}

.csThemeOption:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}

.csThemeOptionActive {
  border-color: var(--dsw-alias-interactive-bg-active);
  background: var(--dsw-alias-interactive-bg-active);
  color: var(--dsw-alias-label-primary);
}

/* ---- Inline hint text under a settings field ---- */
.csFieldHint {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--dsw-alias-label-tertiary);
}

/* ---- Select control (输出/工作流分区) ---- */
.csFieldSelect {
  font: inherit;
  font-size: 13px;
  padding: 7px 10px;
  border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
}

.csFieldSelect:focus {
  outline: none;
  border-color: var(--dsw-alias-interactive-bg-active);
}

/* ---- CV-092：新建项目弹窗 ---- */
/* 分组选择行：文件夹图标 + 下拉，对齐截图里的「📁 项目 / 选择」。 */
.csCreateGroupRow {
  display: flex;
  align-items: center;
  gap: 8px;
}

.csCreateGroupIcon {
  font-size: 15px;
  line-height: 1;
  flex: 0 0 auto;
}

.csCreateGroupRow .csFieldSelect {
  flex: 1 1 auto;
  min-width: 0;
}

/* 弹窗底部操作区（取消 / 创建）。 */
.csModalFooter {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--dsw-alias-border-l2);
}

.csModalBtnSecondary {
  font: inherit;
  font-size: 13px;
  padding: 7px 16px;
  border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: transparent;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
}

.csModalBtnSecondary:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
}

.csModalBtnSecondary:disabled {
  opacity: 0.5;
  cursor: default;
}

.csModalBtnPrimary {
  font: inherit;
  font-size: 13px;
  padding: 7px 18px;
  border-radius: 8px;
  border: 1px solid transparent;
  background: var(--cs-accent, var(--dsw-alias-interactive-bg-active));
  color: #fff;
  cursor: pointer;
}

.csModalBtnPrimary:hover:not(:disabled) {
  filter: brightness(1.12);
}

.csModalBtnPrimary:disabled {
  opacity: 0.5;
  cursor: default;
}

/* ---- Toggle row (checkbox + label, 工作流/存储分区) ---- */
.csToggle {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
}

.csToggle input {
  width: 16px;
  height: 16px;
  accent-color: var(--dsw-alias-interactive-bg-active);
  cursor: pointer;
}

/* ---- "待接入" 标记：字段已落 schema 但当前管线尚未消费 ---- */
.csReserved {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 6px;
  border: 1px solid var(--dsw-alias-border-l2);
  color: var(--dsw-alias-label-tertiary);
  vertical-align: middle;
}

/* ---- Model settings panel (provider-aware, complete) ---- */
.csModelPanel {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.csModelDefault {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--dsw-alias-border-l2);
}

.csModelProviders {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.csModelCard {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border-radius: 10px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-1);
}

.csModelCardHead {
  display: flex;
  align-items: center;
  gap: 8px;
}

.csModelCardTitle {
  font-size: 14px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
}

.csModelBadge {
  font-size: 11px;
  padding: 1px 8px;
  border-radius: 999px;
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-secondary);
}

.csModelBadgeOn {
  background: var(--dsw-alias-state-success-bg, var(--dsw-alias-interactive-bg-active));
  color: var(--dsw-alias-label-primary);
}

.csModelDiscovered {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  border-radius: 8px;
  border: 1px dashed var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-base);
}

.csModelDiscoveredList {
  margin: 0;
  padding-left: 18px;
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
  max-height: 140px;
  overflow-y: auto;
}

.csModelCardActions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.csModelPrimary {
  border-color: var(--dsw-alias-interactive-bg-active);
  background: var(--dsw-alias-interactive-bg-active);
  color: var(--dsw-alias-label-primary);
}

.csModelDanger {
  border-color: transparent;
  color: var(--dsw-alias-state-error-primary);
}

.csModelDanger:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
}

.csModelCustom {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* 精简模式：未使用官方 provider 的折叠开关条 */
.csModelFold {
  display: flex;
  margin: 8px 0;
}

.csModelFoldToggle {
  width: 100%;
  justify-content: center;
  border-style: dashed;
}

.csModelCustomForm {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border-radius: 10px;
  border: 1px dashed var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-1);
}

/* ---- CV-044：视频 / 图片全尺寸预览浮层 ---- */
/* 撑大至接近应用窗口尺寸（max-width 1280 / calc(100vw - 48px)）；视频以真实比例渲染，
   按容器 max-* 自动钳制并保持宽高比，stage 黑底衬出任意比例的 letterbox/pillarbox。 */
.csVideoModalCard {
  width: auto;
  max-width: min(1280px, calc(100vw - 48px));
}
/* CV-044：浮层播放器不挂原生控件（避免原生「双击=全屏」），改点击画面切换
   播放/暂停；stage 相对定位承载居中播放图标。 */
.csVideoStage {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #000;
  cursor: pointer;
  min-height: 240px;
}
.csVideoModalVideo {
  display: block;
  /* 浏览器按内在尺寸保持宽高比：max-width 限制宽度，max-height 扣除标题栏(49)
     + 控制条(56) + 上下安全边距(≈35) ≈ 140；剩余空间由浏览器等比缩放。 */
  max-width: 100%;
  max-height: calc(100vh - 140px);
  width: auto;
  height: auto;
  background: #000;
}
.csVideoPlayIcon {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 56px;
  color: rgb(255 255 255 / 85%);
  text-shadow: 0 4px 16px rgb(0 0 0 / 60%);
  pointer-events: none;
}

/* ---- CV-057：视频浮层自绘控制条 ---- */
.csVideoControls {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-top: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-1);
}
.csVideoControlButton {
  display: grid;
  place-items: center;
  padding: 4px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}
.csVideoControlButton:hover {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-interactive-bg-hover);
}
.csVideoTime {
  min-width: 44px;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--dsw-alias-label-secondary);
  text-align: center;
  user-select: none;
}
/* 进度条：轨道 + 已播填充；pointer capture 拖动 seek。 */
.csVideoProgress {
  position: relative;
  flex: 1 1 auto;
  height: 6px;
  border-radius: 3px;
  background: var(--dsw-alias-bg-layer-3);
  cursor: pointer;
  touch-action: none;
}
.csVideoProgressFill {
  height: 100%;
  border-radius: 3px;
  background: var(--dsw-alias-brand, #4f7cff);
  pointer-events: none;
}
.csVideoVolume {
  width: 72px;
  accent-color: var(--dsw-alias-brand, #4f7cff);
}

/* CV-044 扩展：图片大图预览浮层（与视频浮层同尺寸规则，黑底衬托图片）。 */
.csImagePreviewStage {
  display: flex;
  align-items: center;
  justify-content: center;
  background: #000;
  min-height: 240px;
}
.csImagePreviewImg {
  display: block;
  max-width: 100%;
  max-height: calc(100vh - 49px);
  width: auto;
  height: auto;
  object-fit: contain;
}

/* 媒体预览（视频 / 图片）加深背景遮罩，与参考 #1 的暗化预览观感一致；不挂在
   .csModalBackdrop 上以免影响 Settings/SkillMarket 等普通弹窗。 */
.csMediaPreviewBackdrop {
  background: rgb(0 0 0 / 78%);
}

/* ===== 品牌层（--cs-* 令牌由 src/brand.ts 注入，见 brand-inject.ts；叠加 --dsw-alias-*） ===== */

/* 左侧栏品牌条：场记板 logo + Canvas Studio（创意工厂）。 */
.csBrandHeader {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 12px 10px;
  border-bottom: 1px solid var(--dsw-alias-border-l2);
}
.csLogoMark {
  display: block;
  flex: 0 0 auto;
}
.csBrandMeta {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}
.csBrandName {
  font-size: 14px;
  font-weight: 500;
  line-height: 1.25;
  color: var(--dsw-alias-label-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.csBrandSub {
  font-size: 11px;
  color: var(--cs-accent, var(--dsw-alias-label-tertiary));
}

/* 首启欢迎屏（画布区）。 */
.csWelcome {
  display: grid;
  place-items: center;
  height: 100%;
  padding: 32px;
  background:
    radial-gradient(60% 50% at 50% 40%, var(--cs-accent-soft, transparent), transparent 70%),
    var(--cs-canvas-bg, var(--dsw-alias-bg-base));
}
.csWelcomeCard {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  max-width: 460px;
  text-align: center;
  padding: 36px 40px;
  border-radius: var(--cs-radius-lg, 12px);
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-1);
  box-shadow: var(--cs-shadow-2, none);
}
.csWelcomeTitle {
  margin: 0;
  font-size: 22px;
  font-weight: 500;
  letter-spacing: 0.2px;
  color: var(--dsw-alias-label-primary);
}
.csWelcomeNameZh {
  margin-left: 8px;
  font-size: 14px;
  font-weight: 400;
  color: var(--cs-accent, var(--dsw-alias-label-secondary));
}
.csWelcomeTagline {
  margin: 0;
  font-size: 13px;
  font-style: italic;
  color: var(--cs-accent, var(--dsw-alias-label-secondary));
}
.csWelcomePositioning {
  margin: 0;
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
}
.csWelcomeActions {
  display: flex;
  gap: 10px;
  margin-top: 8px;
}
.csWelcomeActions button {
  padding: 7px 16px;
  font-size: 13px;
  border-radius: var(--cs-radius-md, 8px);
  cursor: pointer;
}
.csWelcomeActions .csPrimary {
  border: 1px solid transparent;
  background: var(--cs-accent, var(--dsw-alias-bg-layer-3));
  color: #fff;
}
.csWelcomeActions .csPrimary:hover:not(:disabled) {
  background: var(--cs-accent-strong, var(--dsw-alias-bg-layer-3));
}
.csWelcomeSample {
  border: 1px solid var(--dsw-alias-border-l2);
  background: transparent;
  color: var(--dsw-alias-label-primary);
}
.csWelcomeSample:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
}
.csWelcomeSample:disabled {
  opacity: 0.55;
  cursor: default;
}
.csWelcomeSampleHint {
  margin: 4px 0 0;
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary);
}

/* CV-064：Lobby 态中栏顶部品牌条（横向紧凑版，与下方居中的聊天卡片配套）。
   与 .csWelcome*（整屏欢迎卡）分开：后者会把聊天挤出视口。 */
.csLobbyHero {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 22px 32px 18px;
  background:
    radial-gradient(70% 130% at 50% 0%, var(--cs-accent-soft, transparent), transparent 70%),
    var(--cs-canvas-bg, var(--dsw-alias-bg-base));
}
.csLobbyBrand {
  display: flex;
  align-items: center;
  gap: 14px;
  min-width: 0;
}
.csLobbyBrandMeta {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}
.csLobbyTitle {
  margin: 0;
  font-size: 20px;
  font-weight: 500;
  letter-spacing: 0.2px;
  color: var(--dsw-alias-label-primary);
}
.csLobbyNameZh {
  margin-left: 8px;
  font-size: 13px;
  font-weight: 400;
  color: var(--cs-accent, var(--dsw-alias-label-secondary));
}
.csLobbyTagline {
  margin: 0;
  font-size: 12px;
  font-style: italic;
  color: var(--cs-accent, var(--dsw-alias-label-secondary));
}
.csLobbyHint {
  margin: 3px 0 0;
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
}
.csLobbyActions {
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
}
.csLobbyButtons {
  display: flex;
  gap: 10px;
}
.csLobbyActions button {
  padding: 7px 16px;
  font-size: 13px;
  border-radius: var(--cs-radius-md, 8px);
  cursor: pointer;
}
.csLobbyActions .csPrimary {
  border: 1px solid transparent;
  background: var(--cs-accent, var(--dsw-alias-bg-layer-3));
  color: #fff;
}
.csLobbyActions .csPrimary:hover:not(:disabled) {
  background: var(--cs-accent-strong, var(--dsw-alias-bg-layer-3));
}
.csLobbyActions .csWelcomeSample {
  border: 1px solid var(--dsw-alias-border-l2);
  background: transparent;
  color: var(--dsw-alias-label-primary);
}
.csLobbyActions .csWelcomeSample:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
}
.csLobbyActions .csWelcomeSample:disabled {
  opacity: 0.55;
  cursor: default;
}
.csLobbySampleHint {
  margin: 0;
  font-size: 11px;
  text-align: right;
  color: var(--dsw-alias-label-tertiary);
}

/* 画布中心空态引导（不挡画布交互）。 */
.csCanvasEmptyHint {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: min(420px, 80%);
  padding: 18px 22px;
  border-radius: var(--cs-radius-md, 8px);
  border: 1px dashed var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-1);
  text-align: center;
  pointer-events: none;
  box-shadow: var(--cs-shadow-1, none);
}
.csCanvasEmptyHintTitle {
  margin: 0 0 6px;
  font-size: 14px;
  font-weight: 500;
  color: var(--dsw-alias-label-primary);
}
.csCanvasEmptyHintText {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--dsw-alias-label-secondary);
}

/* 通用加载卡。 */
.csLoadingCard {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  border-radius: var(--cs-radius-md, 8px);
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-secondary);
}
.csLoadingText {
  font-size: 12px;
}
.csLogoMarkPulse {
  animation: csLogoPulse 1.6s ease-in-out infinite;
}
@keyframes csLogoPulse {
  0%, 100% { opacity: 0.55; }
  50% { opacity: 1; }
}

/* 错误三级处置卡。 */
.csErrorCard {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px 16px;
  border-radius: var(--cs-radius-md, 8px);
  border: 1px solid var(--dsw-alias-state-error-border, var(--dsw-alias-border-l2));
  background: var(--dsw-alias-bg-layer-1);
}
.csErrorTitle {
  margin: 0;
  font-size: 13px;
  font-weight: 500;
  color: var(--dsw-alias-state-error-primary, var(--dsw-alias-label-primary));
}
.csErrorMessage {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--dsw-alias-label-secondary);
  word-break: break-all;
}
.csErrorHint {
  margin: 0;
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary);
}
.csErrorActions {
  display: flex;
  gap: 8px;
  margin-top: 2px;
}
.csErrorAction {
  padding: 5px 14px;
  font-size: 12px;
  border-radius: var(--cs-radius-sm, 6px);
  border: 1px solid var(--dsw-alias-border-l2);
  background: transparent;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
}
.csErrorAction:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}
.csErrorActionPrimary {
  border-color: transparent;
  background: var(--cs-accent, var(--dsw-alias-bg-layer-3));
  color: #fff;
}
.csErrorActionPrimary:hover {
  background: var(--cs-accent-strong, var(--dsw-alias-bg-layer-3));
}

/* 设置页「外观」区：品牌配色预设 swatch。 */
.csBrandSwatches {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.csBrandSwatch {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px 6px 6px;
  border-radius: var(--cs-radius-sm, 6px);
  border: 1px solid var(--dsw-alias-border-l2);
  background: transparent;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
}
.csBrandSwatch:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}
.csBrandSwatchActive {
  border-color: var(--cs-accent, var(--dsw-alias-border-l2));
  box-shadow: 0 0 0 1px var(--cs-accent-soft, transparent);
}
.csBrandSwatchChip {
  width: 18px;
  height: 18px;
  border-radius: 5px;
  border: 1px solid rgb(0 0 0 / 25%);
  display: inline-block;
}
.csBrandSwatchName {
  font-size: 12px;
}

/* ==================== CV-065 技能广场 ====================
   组件：SkillCarousel（lobby 横滚）/ SkillMarket（全屏）/ SkillCard（卡）。
   「使用」= 提示词插进对话输入框，不做其它副作用。 */

/* -- lobby 第三行：推荐技能横滚 -- */
.csLobbyTail {
  padding: 4px 24px 18px;
  overflow: hidden;
}
.csLobbyTailHead {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 8px;
}
.csLobbyTailHead > span:first-child {
  font-size: 13px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
}
.csLobbyTailHint {
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary);
}

/* -- 横滚条 -- */
.csSkillCarousel {
  display: flex;
  align-items: center;
  gap: 10px;
}
.csCarouselTrack {
  display: flex;
  gap: 12px;
  overflow-x: auto;
  scrollbar-width: none;
  padding: 2px 2px 6px;
  scroll-behavior: smooth;
}
.csCarouselTrack::-webkit-scrollbar {
  display: none;
}
.csCarouselItem {
  flex: 0 0 auto;
  width: 264px;
}
.csCarouselNav {
  flex: 0 0 auto;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-secondary);
  font-size: 15px;
  line-height: 1;
  cursor: pointer;
}
.csCarouselNav:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
}
.csCarouselMore {
  flex: 0 0 auto;
  margin-left: 4px;
  padding: 6px 12px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: var(--cs-radius-md, 8px);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
}
.csCarouselMore:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
}

/* -- 技能卡 -- */
.csSkillCard {
  display: flex;
  flex-direction: column;
  height: 100%;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: var(--cs-radius-lg, 12px);
  background: var(--dsw-alias-bg-layer-1);
  overflow: hidden;
}
.csSkillCard:hover {
  border-color: var(--cs-accent-soft, var(--dsw-alias-border-l2));
  box-shadow: var(--cs-shadow-1, none);
}
.csSkillThumb {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 110px;
  color: rgb(255 255 255 / 92%);
}

/* CV-070：默认显示的动态演示 GIF（盖在渐变缩略图上；无 demo 则不渲染）。
   prefers-reduced-motion 降级为静态渐变（不动画敏感用户不强制播）。 */
.csSkillThumbGif {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

@media (prefers-reduced-motion: reduce) {
  .csSkillThumbGif {
    display: none;
  }
}

/* CV-076：H3 能力角标（左上角，真实信息）。 */
.csSkillH3 {
  position: absolute;
  top: 6px;
  left: 6px;
  padding: 0 5px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 700;
  line-height: 1.5;
  letter-spacing: 0.04em;
  color: #fff;
  background: color-mix(in srgb, var(--cs-accent, #6c5ce7) 82%, transparent);
  pointer-events: none;
}

/* CV-071：hover 浮层「查看详情」。 */
.csSkillHover {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: color-mix(in srgb, #000 45%, transparent);
  opacity: 0;
  transition: opacity 120ms ease;
  pointer-events: none;
}
.csSkillCard:hover .csSkillHover,
.csSkillCard:focus-within .csSkillHover {
  opacity: 1;
  pointer-events: auto;
}
.csSkillHoverBtn {
  padding: 4px 12px;
  border: none;
  border-radius: 999px;
  font-size: 12px;
  color: #fff;
  background: color-mix(in srgb, var(--cs-accent, #6c5ce7) 90%, transparent);
  cursor: pointer;
}
/* CV-071：次要操作（查看详情）用 ghost 变体，避免与主操作「使用」抢视觉。 */
.csSkillHoverGhost {
  background: color-mix(in srgb, rgb(255 255 255 / 14%) 100%, transparent);
  border: 1px solid color-mix(in srgb, #fff 42%, transparent);
}
.csSkillHoverGhost:hover {
  background: color-mix(in srgb, rgb(255 255 255 / 24%) 100%, transparent);
}
.csSkillHoverBtn:hover {
  filter: brightness(1.1);
}

/* CV-072：广场右上搜索框。 */
.csSkillSearch {
  width: 200px;
  padding: 5px 10px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  font-size: 12px;
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-layer-1);
}
.csSkillSearch:focus {
  outline: none;
  border-color: var(--cs-accent, var(--dsw-alias-border-l2));
}

/* CV-074：官方精选 / 其他技能 分区标题。 */
.csSkillSectionTitle {
  margin: 4px 0 10px;
  font-size: 13px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
}

/* CV-077：仅显示未装载 过滤行。 */
.csSkillOnlyInactive {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 0 10px;
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  user-select: none;
}

/* CV-073：我的 Skill 清单。 */
.csSkillContent {
  flex: 1;
  overflow-y: auto;
  padding: 4px 4px 16px;
}
.csSkillMine {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.csSkillMineRow {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-1);
}
.csSkillMineTitle {
  font-size: 13px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
}
.csSkillMineName {
  flex: 1;
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.csSkillMineRemove {
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  line-height: 1;
  color: var(--dsw-alias-label-secondary);
  background: transparent;
  cursor: pointer;
}
.csSkillMineRemove:hover {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-border-l2);
}
.csSkillEmpty {
  padding: 32px 0;
  font-size: 12px;
  color: var(--dsw-alias-label-tertiary);
  text-align: center;
}

/* CV-078：创作者社区收尾卡（reserved 纯展示）。 */
.csSkillCommunity {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 140px;
  border: 1px dashed var(--dsw-alias-border-l2);
  border-radius: var(--cs-radius-lg, 12px);
  color: var(--dsw-alias-label-tertiary);
  text-align: center;
  padding: 12px;
}
.csSkillCommunity h3 {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--dsw-alias-label-secondary);
}
.csSkillCommunity p {
  margin: 0;
  font-size: 11px;
}
.csSkillCommunityIcon {
  font-size: 16px;
}

/* CV-071：技能详情弹窗。 */
.csSkillDetailBackdrop {
  position: fixed;
  inset: 0;
  z-index: 90;
  display: flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, #000 50%, transparent);
}
.csSkillDetail {
  display: flex;
  gap: 14px;
  width: min(460px, calc(100vw - 48px));
  padding: 18px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 14px;
  background: var(--dsw-alias-bg-layer-1);
  box-shadow: var(--cs-shadow-2, none);
}
.csSkillDetailThumb {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 84px;
  height: 84px;
  border-radius: 12px;
  color: rgb(255 255 255 / 92%);
}
.csSkillDetailBody {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
.csSkillDetailTitle {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
}
.csSkillDetailTitle .csSkillH3 {
  position: static;
}
.csSkillDetailCategory {
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary);
}
.csSkillDetailSummary {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--dsw-alias-label-secondary);
}
.csSkillDetailName {
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.csSkillDetailActions {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}
.csSkillDetailUse {
  padding: 5px 14px;
  border: none;
  border-radius: 8px;
  font-size: 12px;
  color: #fff;
  background: var(--cs-accent, #6c5ce7);
  cursor: pointer;
}
.csSkillDetailClose {
  padding: 5px 14px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
  background: transparent;
  cursor: pointer;
}
.csSkillBody {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px 12px;
  flex: 1;
}
.csSkillTitle {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.csSkillSummary {
  margin: 0;
  font-size: 12px;
  line-height: 1.45;
  color: var(--dsw-alias-label-secondary);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.csSkillFoot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: auto;
}
.csSkillCategory {
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary);
  padding: 1px 7px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 999px;
}
.csSkillUse {
  padding: 4px 14px;
  font-size: 12px;
  border: 1px solid transparent;
  border-radius: var(--cs-radius-md, 8px);
  background: var(--cs-accent, var(--dsw-alias-bg-layer-3));
  color: #fff;
  cursor: pointer;
}
.csSkillUse:hover:not(:disabled) {
  background: var(--cs-accent-strong, var(--dsw-alias-bg-layer-3));
}

/* -- 全屏技能广场（覆盖层） -- */
.csSkillMarket {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  flex-direction: column;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
}
.csSkillMarketBar {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 10px 18px;
  border-bottom: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-1);
}
.csSkillMarketBack {
  padding: 5px 12px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: var(--cs-radius-md, 8px);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  cursor: pointer;
}
.csSkillMarketBack:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
}
.csSkillMarketTitle {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}
.csSkillMarketCount {
  font-size: 12px;
  color: var(--dsw-alias-label-tertiary);
}
.csSkillMarketSpacer {
  flex: 1;
}
.csSkillMarketCreate {
  position: relative;
  padding: 5px 12px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: var(--cs-radius-md, 8px);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  cursor: default;
  opacity: 0.6;
}
.csSkillMarketCreate .csReserved {
  margin-left: 6px;
}
.csSkillMarketBody {
  display: flex;
  flex: 1;
  min-height: 0;
}
.csSkillRail {
  flex: 0 0 190px;
  padding: 10px 8px;
  border-right: 1px solid var(--dsw-alias-border-l2);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.csSkillRailItem {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 7px 10px;
  border: none;
  border-radius: var(--cs-radius-md, 8px);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}
.csSkillRailItem:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
}
.csSkillRailActive {
  background: var(--cs-accent-soft, var(--dsw-alias-bg-layer-2));
  color: var(--cs-accent, var(--dsw-alias-label-primary));
  font-weight: 600;
}
.csSkillRailCount {
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary);
}
.csSkillRailActive .csSkillRailCount {
  color: inherit;
}
.csSkillGrid {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 16px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  gap: 14px;
  align-content: start;
}

/* CV-008 / CV-089：marquee 框选矩形（屏幕坐标层，pointer-events 关闭）。
   旧实现 1px 实线 + 10% 蒙层在深色画布上太弱；改为 1.5px dashed + 加深蒙层
   + 一道外发光，整体观感与选中节点统一，强化「正在框选」的反馈。 */
.csMarquee {
  position: absolute;
  z-index: 30;
  border: 1.5px dashed var(--cs-accent, #6c5ce7);
  background: color-mix(in srgb, var(--cs-accent, #6c5ce7) 14%, transparent);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--cs-accent, #6c5ce7) 22%, transparent);
  border-radius: 2px;
  pointer-events: none;
}

/* -- CV-066：work 态已装载技能 chip 行 -- */
.csSkillChips {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-1);
}
.csSkillChipsLabel {
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary);
  margin-right: 2px;
}
.csSkillChip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 4px 2px 10px;
  border: 1px solid var(--cs-accent-soft, var(--dsw-alias-border-l2));
  border-radius: 999px;
  background: var(--cs-accent-soft, var(--dsw-alias-bg-layer-2));
  color: var(--cs-accent, var(--dsw-alias-label-primary));
  font-size: 12px;
}
.csSkillChipName {
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.csSkillChipRemove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: inherit;
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
}
.csSkillChipRemove:hover {
  background: rgb(0 0 0 / 12%);
}
`

/** Inject the studio stylesheet once per browser lifetime. */
export function installStudioStyles(): () => void {
  const element = document.createElement('style')
  element.setAttribute('data-plugin', 'canvas-studio')
  element.textContent = STUDIO_STYLES
  document.head.appendChild(element)
  return () => { element.remove() }
}