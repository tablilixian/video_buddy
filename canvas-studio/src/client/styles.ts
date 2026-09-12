/**
 * Studio frame styles, injected as one style element tagged with the plugin
 * id (the client-modules owner tagging pattern). Product copy lives in the
 * components; this file only carries presentation.
 */
const STUDIO_STYLES = `
/* Presentation follows the official design system: structural / interaction
 * colors come from the --dsw-alias-* semantic tokens owned by
 * @deepseek-ai/dsh-client-ui-theme (imported into the web shell base.css).
 * Those tokens resolve to light or dark values via body[data-ds-dark-theme],
 * so this panel adapts to the app theme automatically.
 *
 * DD-01/DD-02 起是**两层令牌**：宿主语义令牌（文字 / 交互态 / 滚动条）之上，
 * 叠插件自有品牌命名空间 --cs-*（定义在 src/brand.ts，随 body 继承），
 * 承载宿主不表达的概念 —— 制作现场的空间三档（壳 / 画布 / 节点 / 浮层）。
 * 命名空间仍是「语义」而非「色值」：换预设或换明暗主题时令牌自己变，本文件
 * 不出现任何十六进制或 rgb() 字面量。Never hardcode colors or use currentColor. */

.csFrame {
  display: grid;
  /* 验收反馈（2026-08-25）：对话区从 380px 加宽到 480px。 */
  grid-template-columns: 280px minmax(0, 1fr) 480px;
  height: 100%;
  /* DD-02：壳层 —— 整机最外层底色，与画布拉开一档。 */
  background: var(--cs-shell, var(--dsw-alias-bg-base));
  color: var(--dsw-alias-label-primary);
  /* CV-064：lobby ↔ work 切换时列宽平滑过渡。lobby 态保持 3 列（第三列压到
     0px），列数一致才能插值；列数变化会退化成瞬跳。 */
  transition: grid-template-columns var(--cs-duration-slow, 300ms) var(--cs-ease, ease);
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
  border-bottom: 1px solid var(--cs-line, var(--dsw-alias-border-l2));
  /* DD-02：工作流条属于「壳层」的第二档 —— 比工具栏略亮，与画布区分。 */
  background: var(--cs-shell-2, var(--dsw-alias-bg-layer-1));
}

.csWorkflowMode {
  display: inline-flex;
  /* 顺带修的既有缺陷（不属 DD-02 设计范围，DD-05 仍会整体重做该条）：
     .csWorkflowApproval 带 margin-left:auto，中栏变窄时会把可收缩的模式组一起挤扁，
     按钮文字折成两行（实测中栏 920px 时按钮高 40px = 两行，1100px 起恢复 23px 单行）。
     模式组是固定文案的小控件，不该参与收缩。 */
  flex: 0 0 auto;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 6px;
  overflow: hidden;
}

.csWorkflowMode button {
  padding: 3px 10px;
  font-size: 12px;
  white-space: nowrap;
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
  font-size: var(--cs-fs-sm, 12px);
  color: var(--dsw-alias-label-secondary);
}

/* DD-05：五阶段行进指示（需求 → 剧本 → 分镜 → 关键帧 → 制作）。
   只有「行进」语义、不可点击 —— 六阶段轨道可跳转需要阶段模型，工程暂无
   （visual-direction-plan 还原度判定）。方块节点读成一格一格的胶片孔。 */
.csWorkflowStages {
  display: inline-flex;
  align-items: center;
  gap: var(--cs-space-2, 8px);
  flex: 0 0 auto;
}

.csWorkflowStage {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: var(--cs-fs-xs, 11px);
  color: var(--dsw-alias-label-tertiary);
  white-space: nowrap;
}

.csWorkflowStage i {
  width: 7px;
  height: 7px;
  border-radius: 2px;
  border: 1px solid var(--cs-line-hi, var(--dsw-alias-border-l2));
  background: transparent;
  flex: 0 0 auto;
}

.csWorkflowStage.csStageDone i {
  background: var(--cs-line-hi, var(--dsw-alias-border-l2));
}

.csWorkflowStage.csStageNow {
  color: var(--dsw-alias-label-primary);
}

.csWorkflowStage.csStageNow i {
  background: var(--cs-accent, #6c5ce7);
  border-color: var(--cs-accent, #6c5ce7);
  box-shadow: 0 0 6px color-mix(in srgb, var(--cs-accent, #6c5ce7) 60%, transparent);
}

/* DD-05：审批条 = 场记板形态 —— 金色拍板条压左缘、顶缘斜纹待打板，
   体块用壳二档托住；gold = HITL 审批的固定功能色（不随预设切换）。 */
.csWorkflowApproval {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
  position: relative;
  padding: 5px 10px 5px 12px;
  border-radius: 6px;
  border-left: 3px solid var(--cs-gold, #e8b45a);
  background: color-mix(in srgb, var(--cs-gold, #e8b45a) 7%, var(--cs-shell-2, var(--dsw-alias-bg-layer-1)));
}

/* 场记板顶缘的打板斜纹：3px 高、gold/透明交替，纯装饰。 */
.csWorkflowApproval::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  border-radius: 6px 6px 0 0;
  background: repeating-linear-gradient(
    -45deg,
    color-mix(in srgb, var(--cs-gold, #e8b45a) 85%, black) 0 5px,
    transparent 5px 10px
  );
  pointer-events: none;
}

/* DD-05：审批消息走 gold 调（向 label 混 25% 保明暗双轨可读）。 */
.csWorkflowApproval .csWorkflowMessage {
  font-size: 12px;
  color: color-mix(in srgb, var(--cs-gold, #e8b45a) 75%, var(--dsw-alias-label-primary));
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

/* DD-05：批准主按钮 = 打板动作，gold 实底 + 深色字（明暗双轨都成立）。 */
.csWorkflowApproval button.csPrimary {
  background: var(--cs-gold, #e8b45a);
  border-color: var(--cs-gold, #e8b45a);
  color: color-mix(in srgb, var(--cs-gold, #e8b45a) 16%, black);
}

.csWorkflowApproval button.csPrimary:hover {
  background: color-mix(in srgb, var(--cs-gold, #e8b45a) 88%, white);
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

/* CV-116：风格已注册但无 GIF 素材时的占位，尺寸与预览图一致以免布局跳动 */
.csStyleDemoFallback {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  aspect-ratio: 16 / 9;
  border-radius: 6px;
  border: 1px dashed var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
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
      /* DD-02：左栏属壳层，与中栏画布拉开明度。 */
      background: var(--cs-shell, var(--dsw-alias-bg-base));
      border-right: 1px solid var(--cs-line, var(--dsw-alias-border-l2));
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
  font-size: var(--cs-fs-lg, 14px);
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
  border: 1px solid var(--cs-line, var(--dsw-alias-border-l2));
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
  /* DD-02：中栏是「制作现场」——整机最暗一档，让节点与浮层浮起来。 */
  background: var(--cs-canvas-bg, var(--dsw-alias-bg-base));
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
  /* DD-02：中栏最暗档，节点与浮层因此「浮」起来。 */
  background-color: var(--cs-canvas-bg, var(--dsw-alias-bg-base));
  /* DD-02 网格：由「两条 1px 直角线」改为**点阵**，并叠出主次两层 ——
     细格 24px 走 --cs-canvas-grid，主格 120px（5 格一跳）走
     --cs-canvas-grid-major。点阵比直角线更弱化网格本身的存在感：直角线在
     大画布上会读成「表格」，点阵则读成「制图台」，节点成为画面主角。
     同时退休 CV-035 的 color-mix 降透明 workaround —— 原实现让网格线与节点
     描边同源（border-l2），只能靠降到 45% 不透明度绕过同色冲突，等于同一件
     事有两套逻辑；现在网格有自己的令牌，绕路直接消失。 */
  background-image:
    radial-gradient(var(--cs-canvas-grid-major, var(--dsw-alias-border-l2)) 1px, transparent 1px),
    radial-gradient(var(--cs-canvas-grid, var(--dsw-alias-border-l2)) 1px, transparent 1px);
  background-size: 120px 120px, 24px 24px;
  background-position: 0 0, 0 0;
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
  border-radius: var(--cs-radius-md, 8px);
  border: 1px solid var(--cs-line, var(--dsw-alias-border-l2));
  /* DD-02：节点是空间三档里**最亮**的一档 —— 高于壳层与画布，形成「浮在
     制图台上」的层次。这是本轮的核心改动：改前 .csFrame / .csCanvas /
     .csCanvasSurface / .csNode 四层全部 background: var(--dsw-alias-bg-base)，
     整界面只靠 1px border-l2 切分，节点读起来像「画在纸上的框」而不是
     「摆在台上的卡」。 */
  background: var(--cs-node, var(--dsw-alias-bg-base));
  overflow: hidden;
  cursor: grab;
  box-shadow: var(--cs-shadow-1, 0 1px 4px rgb(0 0 0 / 12%));
  /* DD-03：不透明度**只有一条算式**。三个来源各写各的乘数：
     数据层 --cs-node-opacity（inline，来自 node.opacity）
     状态层 --cs-node-state（locked 0.75 / retired 0.45）
     血缘层 --cs-node-dim（聚光生效时为 --cs-dim）
     为什么要改：改前数据层是把 opacity 直接写在 inline style 上的，inline
     永远赢，于是 .csNodeLocked / .csNodeRetired 的 opacity 一直是**死代码**
     —— CV-108 号称「失效版本灰显」，实际只有 grayscale(1) 生效，透明度从未
     降到 0.45。改成变量链后三层按乘法叠加，语义与代码终于一致。 */
  opacity: calc(var(--cs-node-opacity, 1) * var(--cs-node-state, 1) * var(--cs-node-dim, 1));
  transition:
    background-color var(--cs-duration-base, 200ms) var(--cs-ease, ease),
    border-color var(--cs-duration-base, 200ms) var(--cs-ease, ease),
    box-shadow var(--cs-duration-base, 200ms) var(--cs-ease, ease),
    opacity var(--cs-duration-base, 200ms) var(--cs-ease, ease);
}

/* DD-03：悬停 = 节点抬高一档（面 + 描边一起亮），是「这张卡是活的」的最短反馈。
   改前 .csNode 没有任何 hover 规则，鼠标扫过整屏卡片毫无回应。 */
.csNode:hover {
  background: var(--cs-node-hi, var(--dsw-alias-bg-base));
  border-color: var(--cs-line-hi, var(--dsw-alias-border-l2));
}

.csNode:active {
  cursor: grabbing;
  box-shadow: var(--cs-shadow-2, 0 4px 12px rgb(0 0 0 / 45%));
}

/* DD-03：成片节点（kind=video + toolName=compose）—— 用青（--cs-teal，品牌里
   「播放 / 预览」的功能色）描出一道细边，把「已经拼好的成品」和「待用的素材」
   分开。描边很淡：成片只是一个身份标记，不该比选中态还跳。 */
.csNodeFilm {
  border-color: color-mix(in srgb, var(--cs-teal, #35c2a6) 38%, var(--cs-line, transparent));
}

.csNodeFilm:hover {
  border-color: color-mix(in srgb, var(--cs-teal, #35c2a6) 60%, var(--cs-line, transparent));
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
/* DD-03：主节点 = 2px 实色环 + 同一枚光晕令牌（不再手抄一遍 box-shadow）。
   改前这里有 4 处硬编码 var(--cs-accent, #6c5ce7) 兜底 —— #6c5ce7 是旧
   预设的紫，四个品牌预设下都在悄悄用错色。现在全部走令牌。 */
.csNodePrimary.csNodeSelected {
  z-index: 3;
  box-shadow:
    0 0 0 2px var(--cs-accent, #6c5ce7),
    var(--cs-glow-accent, 0 0 0 1px var(--cs-accent-soft, transparent));
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
  border: 2px solid var(--cs-node, var(--dsw-alias-bg-base));
  background: var(--dsw-alias-interactive-bg-active);
  cursor: crosshair;
  z-index: 4;
  opacity: 0;
  transition: opacity var(--cs-duration-fast, 100ms) var(--cs-ease, ease);
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
  /* DD-03：选中光晕收敛到单一令牌 --cs-glow-accent。
     此前它**只在暗色块里定义**（浅色轨完全没有），浅色主题下 var() 一路退到
     空值 → 选中态只剩 border-color 一根 1px 线；而 DD-02 又把「四层同色 + 处处
     描边」拆掉了，于是浅色下「选中」几乎读不出来。现在两条明暗轨都有值。 */
  box-shadow: var(--cs-glow-accent, 0 0 0 1px var(--cs-accent-soft, transparent));
}

/* DD-03：血缘聚光压暗 —— 见 src/canvas-lineage.ts 的判定口径（唯一实现）。
   只写乘数，不写 opacity，与数据层/状态层相乘而不是互相覆盖。 */
.csNodeDimmed {
  --cs-node-dim: var(--cs-dim, 0.42);
}

.csNodeMedia {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  /* DD-03：媒体窗口的底色 = **画布最深档**，不是壳层底色。图的四周（letterbox
     或加载中）露出的是「工作台面」而不是「卡片面」，这才是片门该有的读数。 */
  background: var(--cs-canvas-bg, var(--dsw-alias-bg-base));
}

/* Images stay inert so node dragging owns every pointer; the video keeps
   native controls (play/seek/volume) interactive. */
img.csNodeMedia {
  pointer-events: none;
}

/* CV-128/130：音频节点卡片（画布就地播放）。节点尺寸 260×116（契约常量
   AUDIO_NODE_WIDTH/HEIGHT）：标题行 + 波形 + 播放/进度 + 歌词摘要。颜色走主题
   token，深色/浅色自适应（与 .csNode 一致）。overflow:hidden 是必要的——
   老项目里还留着 84 高的节点，内容超出时不能溢出到其它节点上。 */
.csNodeAudioBox {
  display: flex;
  flex-direction: column;
  gap: var(--cs-space-1, 4px);
  padding: var(--cs-space-2, 8px) var(--cs-space-3, 12px);
  height: 100%;
  box-sizing: border-box;
  overflow: hidden;
  /* DD-03：跟随节点面（改前是宿主 bg-base，与 .csNode 的 --cs-node 不同源，
     音频卡比旁边的图/视频卡整低一档）。 */
  background: var(--cs-node, var(--dsw-alias-bg-base));
}

.csNodeAudioHead {
  display: flex;
  align-items: center;
  gap: var(--cs-space-1, 4px);
  min-width: 0;
}

.csNodeAudioIcon {
  font-size: var(--cs-fs-lg, 14px);
  line-height: 1;
  color: var(--cs-accent, #6c5ce7);
  flex-shrink: 0;
}

.csNodeAudioTitle {
  flex: 1;
  min-width: 0;
  font-size: var(--cs-fs-sm, 12px);
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.csNodeAudioTime {
  flex-shrink: 0;
  font-size: var(--cs-fs-xs, 11px);
  font-variant-numeric: tabular-nums;
  color: var(--dsw-alias-label-tertiary);
}

.csNodeAudioWave {
  display: flex;
  align-items: center;
  gap: 2px;
  height: 22px;
  overflow: hidden;
}

.csNodeAudioBar {
  flex: 1 1 auto;
  min-width: 2px;
  border-radius: 1px;
  background: var(--cs-accent, #6c5ce7);
  transition: opacity 120ms ease;
}

.csNodeAudioControls {
  display: flex;
  align-items: center;
  gap: 8px;
}

.csNodeAudioPlay {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: none;
  background: var(--cs-accent, #6c5ce7);
  color: #fff;
  font-size: 11px;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.csNodeAudioPlay:hover {
  filter: brightness(1.08);
}

.csNodeAudioProgress {
  flex: 1;
  height: 4px;
  border-radius: 2px;
  background: var(--dsw-alias-border-l2);
  overflow: hidden;
  /* CV-130：进度条可拖动 —— 命中区比 4px 视觉高度大一圈（上下各 5px 隐形
     内边距），否则 4px 的目标根本点不准。 */
  padding: 5px 0;
  margin: -5px 0;
  box-sizing: content-box;
  background-clip: content-box;
  cursor: pointer;
  touch-action: none;
}

.csNodeAudioProgress:hover .csNodeAudioProgressFill {
  filter: brightness(1.15);
}

.csNodeAudioProgressFill {
  height: 100%;
  background: var(--cs-accent, #6c5ce7);
  border-radius: 2px;
  pointer-events: none;
}

/* CV-130：歌词摘要行（卡片只有一行位置，全文在播放器窗口/详情面板）。
   纯器乐时显示「纯器乐 · 无歌词」，两种情况都占位 → 卡片高度不跳动。 */
.csNodeAudioLyrics {
  font-size: 10px;
  line-height: 1.4;
  color: var(--dsw-alias-label-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 隐藏的 <audio> 元素：仅作播放引擎，不渲染控件（控件由上面的按钮+进度条自绘）。 */
.csNodeAudioEl {
  display: none;
}

/* 详情面板音频试听控件 + 图层列表音频缩略图。 */
.csDetailAudio {
  width: 100%;
  max-width: 320px;
  height: 32px;
}

.csLayerThumbAudio {
  font-size: 18px;
  color: var(--cs-accent, #6c5ce7);
}

.csNodeText {
  display: flex;
  flex-direction: column;
  gap: var(--cs-space-1, 4px);
  padding: var(--cs-space-3, 12px);
  height: 100%;
  box-sizing: border-box;
  overflow: hidden;
}

.csNodeKind {
  font-size: var(--cs-fs-xs, 11px);
  letter-spacing: 0.02em;
  color: var(--dsw-alias-label-tertiary);
}

.csNodeBody {
  margin: 0;
  font-size: var(--cs-fs-md, 13px);
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
  border: 1px solid var(--cs-line-hi, var(--dsw-alias-interactive-bg-active));
  border-radius: var(--cs-radius-sm, 4px);
  padding: var(--cs-space-1, 4px) var(--cs-space-2, 8px);
  font: inherit;
  font-size: var(--cs-fs-md, 13px);
  line-height: 1.4;
  background: var(--cs-node, var(--dsw-alias-bg-base));
  color: var(--dsw-alias-label-primary);
  box-sizing: border-box;
}

.csTimeline {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 6px;
  padding: 8px 12px;
  border-top: 1px solid var(--cs-line, var(--dsw-alias-border-l2));
  /* DD-02：时间轴归壳层 —— 与上方画布拉开一档，读成「台面下的导播条」。 */
  background: var(--cs-shell, var(--dsw-alias-bg-base));
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

/* DD-04a：旧「等宽 chip 列表」横向滚动条已由三轨时间轴取代（csTlBody 内自管滚动）。 */

.csTimelineEmpty {
  border-top: 1px solid var(--dsw-alias-border-l2);
  padding: 10px 12px;
  font-size: 13px;
  color: var(--dsw-alias-label-tertiary);
  background: var(--dsw-alias-bg-base);
}

/* ==== DD-04a：真时间轴（标尺 + 三轨 + 可拖播放头） ====
   设计稿 docs/visual-direction-preview.html 的 .tl* 规格落到工程令牌：
   片段宽度 = 真实 duration 比例（src/timeline-layout.ts 唯一权威），
   多轨 = 视频轨 / BGM 轨 / 参考·产物轨。标签列宽 56px 与播放头 left 公式同源。 */
.csTlBody {
  padding: 2px 4px 4px;
}

.csTlLanes {
  position: relative;
}

.csTlRuler {
  position: relative;
  height: 14px;
  margin-left: 56px;
  border-bottom: 1px solid var(--cs-line, var(--dsw-alias-border-l2));
  cursor: ew-resize;
}

.csTlTick {
  position: absolute;
  top: 0;
  font-size: var(--cs-fs-xs, 11px);
  font-variant-numeric: tabular-nums;
  color: var(--dsw-alias-label-tertiary);
}

.csTlTick::after {
  content: '';
  position: absolute;
  left: 0;
  bottom: 0;
  width: 1px;
  height: 3px;
  background: var(--cs-line-hi, var(--dsw-alias-border-l2));
}

.csTlTrack {
  display: flex;
  align-items: center;
  gap: var(--cs-space-2, 8px);
  margin-top: var(--cs-space-1, 4px);
}

.csTlTrkLabel {
  flex: 0 0 56px;
  width: 56px;
  box-sizing: border-box;
  padding-right: 8px;
  font-size: var(--cs-fs-xs, 11px);
  color: var(--dsw-alias-label-tertiary);
  text-align: right;
  white-space: nowrap;
}

/* 轨道底：用 --cs-line（明暗双轨）做极淡的槽底，不引入新令牌也自动跟主题。 */
.csTlLane {
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
  height: 26px;
  border-radius: var(--cs-radius-sm, 6px);
  background: color-mix(in srgb, var(--cs-line, var(--dsw-alias-border-l2)) 22%, transparent);
}

.csTlLaneTall {
  height: 38px;
}

.csTlLaneEmpty {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  font-size: var(--cs-fs-xs, 11px);
  color: var(--dsw-alias-label-tertiary);
  white-space: nowrap;
  overflow: hidden;
}

/* 片段 = 定位容器（left/width 由 timeline-layout 算出的百分比）。
   勾选区是它的兄弟绝对定位元素——兄弟互不穿透，点勾选不触发选中/拖拽。 */
.csTlClipWrap {
  position: absolute;
  top: 3px;
  bottom: 3px;
}

.csTlClip {
  position: absolute;
  inset: 0;
  border-radius: var(--cs-radius-sm, 6px);
  overflow: hidden;
  background: var(--cs-node, var(--dsw-alias-bg-base));
  border: 1px solid var(--cs-line, var(--dsw-alias-border-l2));
  cursor: grab;
  transition: border-color var(--cs-duration-fast, 120ms) var(--cs-ease, ease),
    box-shadow var(--cs-duration-fast, 120ms) var(--cs-ease, ease);
}

.csTlClip:hover {
  border-color: var(--cs-line-hi, var(--dsw-alias-border-l2));
  background: var(--cs-node-hi, var(--dsw-alias-bg-base));
}

/* 选中：与画布节点同一份 --cs-glow-accent 光晕（明暗双轨都有定义）。 */
.csTlClipSel {
  border-color: var(--cs-accent, #6c5ce7);
  box-shadow: var(--cs-glow-accent, 0 0 0 1px var(--cs-accent-soft, transparent));
}

/* 播放头正压着的片段：teal 行进高亮（teal = 播放 / 预览的固定功能色）。 */
.csTlClipHot {
  border-color: color-mix(in srgb, var(--cs-teal, #35c2a6) 70%, transparent);
}

.csTlClipExcluded {
  opacity: 0.4;
}

/* P9.1：拖拽排序的插入落点提示。 */
.csTlClipTarget {
  outline: 2px dashed var(--cs-accent, #6c5ce7);
  outline-offset: 1px;
}

.csTlClipArt {
  position: absolute;
  inset: 0;
  opacity: 0.5;
  pointer-events: none;
}

.csTlClipArt img,
.csTlClipArt video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.csTlClipLbl {
  position: absolute;
  left: 5px;
  bottom: 3px;
  max-width: calc(100% - 10px);
  font-size: var(--cs-fs-xs, 11px);
  font-variant-numeric: tabular-nums;
  color: var(--dsw-alias-label-primary);
  text-shadow: 0 1px 3px rgb(0 0 0 / 90%);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  pointer-events: none;
}

/* 片段右缘切点：读成「下一段从这里开始」。 */
.csTlClipCut {
  position: absolute;
  right: 0;
  top: 0;
  bottom: 0;
  width: 1px;
  background: var(--cs-line-hi, var(--dsw-alias-border-l2));
  pointer-events: none;
}

.csTlClipBgm {
  cursor: pointer;
}

.csTlCheck {
  position: absolute;
  top: -6px;
  right: -4px;
  width: 16px;
  height: 16px;
  display: grid;
  place-items: center;
  padding: 0;
  border-radius: 50%;
  border: 1px solid var(--cs-line-hi, var(--dsw-alias-border-l2));
  background: var(--cs-node, var(--dsw-alias-bg-base));
  color: var(--dsw-alias-label-secondary);
  font-size: 10px;
  line-height: 1;
  cursor: pointer;
  z-index: 2;
}

.csTlCheckOff {
  background: var(--dsw-alias-interactive-bg-hover);
}

/* 参考·产物轨：金色 chip = 素材参考，teal chip = 成片产物（产物 ≠ 素材）。
   文字色向黑混 18%：gold/teal 是固定功能色不分轨，浅色主题下原值对比不足。 */
.csTlRefRow {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  gap: var(--cs-space-2, 8px);
  padding: 0 8px;
  overflow-x: auto;
}

.csTlRefChip {
  flex: 0 0 auto;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  padding: 1px 7px;
  font-size: var(--cs-fs-xs, 11px);
  border-radius: var(--cs-radius-pill, 999px);
  background: color-mix(in srgb, var(--cs-gold, #e8b45a) 14%, transparent);
  color: color-mix(in srgb, var(--cs-gold, #e8b45a) 82%, black);
  border: 1px solid transparent;
  white-space: nowrap;
  cursor: pointer;
}

.csTlRefChip:hover {
  border-color: var(--cs-line-hi, var(--dsw-alias-border-l2));
}

.csTlRefChipFilm {
  background: color-mix(in srgb, var(--cs-teal, #35c2a6) 14%, transparent);
  color: color-mix(in srgb, var(--cs-teal, #35c2a6) 82%, black);
}

/* 失效版本 chip：与画布语义一致——保留可回溯，灰显。 */
.csTlRefChipRetired {
  opacity: 0.55;
  text-decoration: line-through;
}

/* 播放头：纵向贯穿三轨；top 15px = 标尺(14px)下沿起。accent 光晕双轨都有。 */
.csTlPlayhead {
  position: absolute;
  top: 15px;
  bottom: 0;
  width: 1px;
  background: var(--cs-accent, #6c5ce7);
  box-shadow: 0 0 8px color-mix(in srgb, var(--cs-accent, #6c5ce7) 70%, transparent);
  pointer-events: none;
  z-index: 8;
}

.csTlPhGrip {
  position: absolute;
  top: 0;
  left: -4px;
  width: 9px;
  height: 9px;
  border-radius: 2px;
  background: var(--cs-accent, #6c5ce7);
  cursor: ew-resize;
  pointer-events: auto;
}

/* 预计成片时长（Σ 参与合成的逐镜片段真值；成片产物与失效版本都不计入）。 */
.csTimelineEst {
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
  font-variant-numeric: tabular-nums;
}

/* CV-160：时间轴上有成片产物时的说明（避免「预计时长对不上」的误解）。 */
.csTimelineHint {
  font-size: 12px;
  color: var(--dsw-alias-label-tertiary);
}

.csTimelineBgm {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--dsw-alias-label-tertiary);
}

.csTimelineBgm select {
  max-width: 180px;
  font-size: 12px;
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-base);
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 4px;
  padding: 2px 4px;
}

/* BGM 可能短于成片的 amber 软提示（不拦，服务端守卫兜底报精确差额）。 */
.csTimelineWarn {
  font-size: 12px;
  color: var(--dsw-status-warning-fg, #b8860b);
}

.csTimelineToggleAll {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
  font-size: 12px;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
  white-space: nowrap;
}

.csConversation {
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

/* ---- CV-114：素材 chip 的 hover 缩略图浮层 ----
   chip 画在 composer 的镜像层里（不可交互），卡片是我们自己的元素：
   fixed 定位 + 自身可点，点一下打开大图 / 播放器。 */
.csChipPreview {
  position: fixed;
  z-index: 90;
  transform: translateY(-100%);
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 6px;
  border: 1px solid var(--cs-line-hi, var(--dsw-alias-border-l2));
  border-radius: 10px;
  background: var(--cs-float, var(--dsw-alias-bg-layer-2));
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.42);
  cursor: pointer;
  overflow: hidden;
}

.csChipPreviewMedia {
  position: relative;
  width: 100%;
  height: 124px;
  border-radius: 6px;
  overflow: hidden;
  background: #000;
}

.csChipPreviewImage,
.csChipPreviewVideo {
  display: block;
  width: 100%;
  height: 124px;
  object-fit: cover;
  border-radius: 6px;
}

.csChipPreviewEmpty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 124px;
  border-radius: 6px;
  background: rgba(127, 127, 127, 0.16);
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
}

/* CV-124：技能 chip 的 hover 说明卡（无缩略图概念，图标 + 标题 + 一句话说明）。 */
.csChipPreviewSkill {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 4px 2px;
  color: var(--dsw-alias-label-primary);
}

.csChipPreviewSkill > svg {
  flex: 0 0 auto;
  margin-top: 2px;
  color: var(--cs-accent, #7aa2f7);
}

.csChipPreviewSkillBody {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.csChipPreviewSummary {
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 1.5;
}

.csChipPreviewBadge,
.csChipPreviewDuration {
  position: absolute;
  bottom: 6px;
  padding: 1px 5px;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.62);
  color: #fff;
  font-size: 11px;
  line-height: 16px;
}

.csChipPreviewBadge {
  left: 6px;
}

.csChipPreviewDuration {
  right: 6px;
}

.csChipPreviewFoot {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
}

.csChipPreviewHandle {
  flex: 0 0 auto;
  color: var(--cs-accent, #7aa2f7);
  font-size: 12px;
  font-weight: 600;
}

.csChipPreviewTitle {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-primary);
  font-size: 12px;
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
  border-bottom: 1px solid var(--cs-line, var(--dsw-alias-border-l2));
  /* DD-02：工具栏归壳层，与下方画布成形明度落差。 */
  background: var(--cs-shell, var(--dsw-alias-bg-base));
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
/* DD-03：locked / retired 只写**状态乘数**，由 .csNode 的 calc 统一乘进
   opacity。改前这里写的是 opacity: 0.75，被 CanvasNode 的 inline opacity
   永久压制（inline 永远赢）—— 这两个数字从来没生效过。 */
.csNodeLocked {
  --cs-node-state: 0.75;
  cursor: not-allowed;
}

.csNodeError {
  border-color: var(--dsw-alias-state-error-primary);
}

.csNodeLoading {
  border-style: dashed;
  border-color: var(--cs-line-hi, var(--dsw-alias-interactive-bg-active));
}

/* DD-03：媒体窗口 = 片门。上下各一道 2px 的暗带，把「画面」和「卡片壳」切开
   —— 这是单张卡片看起来像「镜头条」而不是「通用卡片」的关键一笔。
   box-sizing：height:100% 配上下边框，默认 content-box 会把节点撑高 4px 并被
   .csNode 的 overflow:hidden 裁掉底部 2px；border-box 让边框向内吃，画面
   上下各让 2px（对象是 object-fit:cover，读数是「闸门」，不是「画面被裁」）。 */
.csNodeMediaBox {
  position: relative;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  border-top: 2px solid var(--cs-gate, #0b0d12);
  border-bottom: 2px solid var(--cs-gate, #0b0d12);
}

/* CV-083：视频时长角标（左下角 m:ss，metadata 就绪后显示）。 */
.csNodeDuration {
  position: absolute;
  left: 8px;
  bottom: 8px;
  padding: 1px 6px;
  border-radius: var(--cs-radius-sm, 4px);
  font-size: var(--cs-fs-xs, 11px);
  line-height: 1.4;
  /* DD-03：数字等宽 —— 时长每帧都在变（拖播放头 / 播放中），比例数字会让
     整条角标左右抖动。 */
  font-variant-numeric: tabular-nums;
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
  border-radius: var(--cs-radius-sm, 4px);
  font-size: var(--cs-fs-xs, 11px);
  line-height: 1.4;
  font-variant-numeric: tabular-nums;
  color: #fff;
  background: color-mix(in srgb, #000 62%, transparent);
  pointer-events: none;
}

.csNodeGroup {
  display: flex;
  align-items: flex-start;
  padding: var(--cs-space-2, 8px);
  height: 100%;
  box-sizing: border-box;
  /* DD-03：分组框也跟品牌走 —— 改前是写死的靛蓝 rgb(99 102 241 / 6%)，
     切到琥珀金预设时分组框还是一片紫。 */
  border: 1px dashed color-mix(in srgb, var(--cs-accent, #7c6cff) 45%, transparent);
  border-radius: var(--cs-radius-md, 8px);
  background: color-mix(in srgb, var(--cs-accent, #7c6cff) 7%, transparent);
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

.csNodeLinkHandle:hover {
  box-shadow: 0 0 0 2px var(--dsw-alias-interactive-bg-active);
}

/* DD-03：生成中遮罩 —— 改前是 bg-base + opacity .92 的实心板，浅色主题下
   一块白板、深色下一块黑板，都读成「卡片坏了」。现在是一层**主题感知**的
   纱（--cs-scrim），通透度靠颜色本身给，不再靠 opacity 折中。 */
.csNodeOverlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: var(--cs-scrim, var(--dsw-alias-bg-base));
}

.csNodeOverlayLabel {
  font-size: var(--cs-fs-sm, 12px);
  /* DD-03：MM:SS 计时每秒都在跳，等宽数字才不会让整行左右晃。 */
  font-variant-numeric: tabular-nums;
  color: var(--dsw-alias-label-secondary);
}

/* DD-03：生成中 = **显影扫描光带**（设计稿的 develop 语义），不再是横向进度条。
   进度条说的是「还剩多少」（没人知道），扫描光带说的是「正在显影」（一定成立）。
   DOM 不动（.csNodeProgress 仍是那个 <span>，宿主测试与快照不受影响）：把容器
   变成覆盖整张卡的绝对定位层，把内条变成一道自上而下扫过的渐变光带。 */
.csNodeProgress {
  position: absolute;
  inset: 0;
  width: auto;
  height: auto;
  border-radius: 0;
  overflow: hidden;
  background: none;
  pointer-events: none;
}

.csNodeProgressBar {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  display: block;
  width: auto;
  /* 40% 高的光带，在 100% 高的容器里自上而下扫 —— 首尾都停在画面外，
     读者看不到「跳回起点」这一帧。 */
  height: 40%;
  border-radius: 0;
  background: linear-gradient(
    180deg,
    transparent,
    color-mix(in srgb, var(--cs-accent, #7c6cff) 30%, transparent) 50%,
    transparent
  );
  animation: csDevelop 1.6s linear infinite;
}

/* DD-03：显影语义（新内容出现）—— 动效三语义的第一个。
   命名规则：@keyframes 必须归入 develop / advance / yield 其一（守卫断言）。 */
@keyframes csDevelop {
  from { transform: translateY(-110%); }
  to { transform: translateY(360%); }
}

@media (prefers-reduced-motion: reduce) {
  .csNodeProgressBar { animation: none; }
}

/* CV-010：loading 超时（>3 分钟）的可打断提示。 */
.csNodeOverlayHint {
  font-size: var(--cs-fs-xs, 11px);
  color: var(--dsw-alias-label-tertiary);
}

.csNodeBadge {
  position: absolute;
  top: -8px;
  left: -8px;
  padding: 2px 8px;
  border-radius: var(--cs-radius-sm, 6px);
  font-size: var(--cs-fs-xs, 11px);
  font-variant-numeric: tabular-nums;
  max-width: 80%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  /* DD-03：角标是「挂在卡片边上的一块小卡」，底色必须跟节点面同源。改前用
     宿主 bg-base，与 .csNode 的 --cs-node 不是同一档，卡片边上像贴了张别的纸。 */
  background: var(--cs-node, var(--dsw-alias-bg-base));
  border: 1px solid var(--cs-line-hi, var(--dsw-alias-border-l2));
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
  font-size: var(--cs-fs-xs, 11px);
  z-index: 2;
}

.csNodeBadgeRetry:hover {
  background: var(--dsw-alias-state-error-primary);
  /* DD-03：反转文字色跟卡片面走，不再直接吃宿主 bg-base。 */
  color: var(--cs-node, var(--dsw-alias-bg-base));
}

/* CV-011：参考图角色角标（左上角，色点按角色区分，避开错误徽章的位置放底部）。 */
.csNodeRefBadge {
  position: absolute;
  bottom: -8px;
  left: -8px;
  display: inline-flex;
  align-items: center;
  gap: var(--cs-space-1, 4px);
  padding: 2px 8px;
  border-radius: var(--cs-radius-sm, 6px);
  font-size: var(--cs-fs-xs, 11px);
  white-space: nowrap;
  /* DD-03：与 .csNodeBadge 同一处理 —— 角标底色跟节点面同源。 */
  background: var(--cs-node, var(--dsw-alias-bg-base));
  border: 1px solid var(--cs-line-hi, var(--dsw-alias-border-l2));
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

/* CV-108：失效版本（被新版取代 / 已作废）——灰显 + 虚线框，保留在画布上可回溯与恢复。
   注意：样式名用连字符，注释里不要写反引号包围的选择器。 */
.csNodeRetired {
  --cs-node-state: 0.45;
  filter: grayscale(1);
}

.csNodeRetired::after {
  content: '';
  position: absolute;
  inset: 0;
  border: 1px dashed var(--dsw-alias-border-l3);
  border-radius: var(--cs-radius-md, 8px);
  pointer-events: none;
}

.csNodeBadgeVersion {
  left: auto;
  right: -8px;
  /* DD-03：版本 chip 用 accent 底 + 药丸形 —— 镜号/版本是「镜头条」的身份标记，
     值得比普通角标高一档的识别度，也把「同一镜位出过几版」这件事摆在明面上。
     文字色走 --cs-accent（浅色轨是 accentDeep），对比度在两套主题下都够。 */
  border-radius: var(--cs-radius-pill, 999px);
  border-color: color-mix(in srgb, var(--cs-accent, #7c6cff) 34%, transparent);
  background: var(--cs-accent-soft, var(--dsw-alias-interactive-bg-active));
  color: var(--cs-accent, var(--dsw-alias-label-primary));
}

.csNodeBadgeRetired {
  /* DD-03：失效角标用「最凹陷的一档壳色」——它是一个被划掉的标签，该比卡片面
     更沉，而不是更亮（改前借宿主 bg-layer-3，语义是弹层，方向正好反了）。 */
  background: var(--cs-shell-3, var(--dsw-alias-bg-layer-3));
  color: var(--dsw-alias-label-tertiary);
  text-decoration: line-through;
}

/* CV-143：成片音轨构成角标。放右下外侧——左下被参考图角标占了，顶部左上/右上
   分别是失败与锁定角标。颜色按构成区分：有环境声=青、无声=错误色。
   注意：注释里不要写反引号包围的选择器名。 */
.csNodeAudioMix {
  left: auto;
  right: -8px;
  top: auto;
  bottom: -8px;
}

.csNodeAudioMix[data-audio='native'],
.csNodeAudioMix[data-audio='native+bgm'] {
  border-color: #38c9b8;
  color: #38c9b8;
}

.csNodeAudioMix[data-audio='none'] {
  border-color: var(--dsw-alias-state-error-primary);
  color: var(--dsw-alias-state-error-primary);
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
  /* DD-02：右栏与左栏同属壳层（硬约束：不动右侧对话区结构，只对齐底色）。 */
  background: var(--cs-shell, var(--dsw-alias-bg-base));
  border-left: 1px solid var(--cs-line, var(--dsw-alias-border-l2));
}

/* ---- Floating layer-list overlay (inside the canvas body) ---- */
.csCanvasLayers {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 10;
  width: 260px;
  border-radius: var(--cs-radius-lg, 10px);
  border: 1px solid var(--cs-line-hi, var(--dsw-alias-border-l2));
  /* DD-02：图层浮层与检查器同属最亮档（浮层压节点）。 */
  background: var(--cs-float, var(--dsw-alias-bg-base));
  box-shadow: var(--cs-shadow-2, 0 8px 28px rgb(0 0 0 / 18%));
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
  border-radius: var(--cs-radius-lg, 10px);
  border: 1px solid var(--cs-line-hi, var(--dsw-alias-border-l2));
  /* DD-02：浮层是最亮档 —— 必须高于节点，否则检查器压在节点上会「糊成一片」。 */
  background: var(--cs-float, var(--dsw-alias-bg-base));
  color: var(--dsw-alias-label-primary);
  box-shadow: var(--cs-shadow-2, 0 8px 28px rgb(0 0 0 / 18%));
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
  /* DD-05：入场动效接动效令牌（行进语义 csToastIn，白名单已归位）。 */
  animation: csToastIn var(--cs-duration-fast, 120ms) var(--cs-ease, ease);
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

/* ---- Settings popup (DeepSeek Harness style: nav rail + content column) ---- */
.csSettingsBackdrop {
  position: fixed;
  inset: 0;
  z-index: 70;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--dsw-alias-bg-mask-1);
  backdrop-filter: var(--dsw-mask-blur);
}

.csSettingsModal {
  width: 800px;
  height: min(800px, calc(100vh - 48px));
  max-width: calc(100vw - 48px);
  display: flex;
  border-radius: 24px;
  overflow: hidden;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
  box-shadow: var(--dsw-shadow-lv3);
}

/* ---- General modal backdrop (used by create project, video player, image preview) ---- */
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

/* ---- Nav rail (left sidebar) ---- */
.csNav {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 18px;
  width: 188px;
  padding: 22px 12px 0;
  box-sizing: border-box;
}

.csNavTitle {
  padding: 0 12px;
  font-size: 16px;
  line-height: 24px;
  font-weight: 500;
  color: var(--dsw-alias-label-primary);
}

.csNavList {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.csNavCell {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 40px;
  padding: 9px 16px 9px 12px;
  box-sizing: border-box;
  border: none;
  border-radius: 12px;
  background: transparent;
  cursor: pointer;
  font-family: inherit;
  font-size: 14px;
  line-height: 22px;
  font-weight: 400;
  color: var(--dsw-alias-label-primary);
  text-align: left;
}

.csNavCell:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}

.csNavCellActive {
  background: var(--dsw-alias-interactive-bg-active);
}

.csNavLabel {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

/* ---- Content column (right side) ---- */
.csContent {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.csContentHeader {
  flex: none;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  height: 54px;
  padding: 20px 14px 8px 10px;
  box-sizing: border-box;
}

.csContentActions {
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  margin-left: auto;
}

.csClose {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: 28px;
  background: transparent;
  cursor: pointer;
  color: var(--dsw-alias-label-primary);
}

.csClose:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}

.csCloseIcon {
  font-size: 18px;
  line-height: 1;
}

.csContentOptions {
  flex: 1;
  min-height: 0;
  padding: 0 24px 24px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

/* ---- Legacy class names (kept for compatibility with child sections) ---- */
.csModalHeader {
  display: none;
}

.csModalHeader h2 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}

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
  display: none;
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

/* ---- CV-099：新建项目预置规格（画幅 / 目标时长）---- */
/* 规格行：下拉 + 自定义秒数输入（仅选中「自定义」时出现输入框）。 */
.csPlanRow {
  display: flex;
  align-items: center;
  gap: 8px;
}

.csPlanRow .csFieldSelect {
  flex: 1 1 auto;
  min-width: 0;
}

.csPlanRow .csFieldInput {
  flex: 0 0 96px;
}

/* 字段下方的弱化说明（如 1:1 不支持视频的提示）。 */
.csFieldHint {
  margin: 0;
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
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
  background: var(--cs-accent, #5b4bd6);
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

/* ===== CV-130：音频播放器窗口（双击音频节点打开） ===== */

/* 卡片宽 560，高度受自适应（歌词多时内部滚动，窗口本身不无限长）。 */
.csAudioModalCard {
  width: min(560px, calc(100vw - 48px));
  max-height: calc(100vh - 96px);
}

/* 舞台：音频没有画面，让位给歌词 / 波形。固定高度让「有词/无词」两种形态
   尺寸一致，切换节点时不跳。 */
.csAudioStage {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 280px;
  max-height: calc(100vh - 260px);
  padding: 20px 24px;
  box-sizing: border-box;
  background: var(--dsw-alias-bg-base);
  cursor: pointer;
  overflow: hidden;
}

/* 纯器乐：波形（进度按条数点亮，与卡片同一套语义）。 */
.csAudioStageWave {
  display: flex;
  align-items: center;
  gap: 3px;
  width: 100%;
  height: 140px;
}

.csAudioStageBar {
  flex: 1 1 auto;
  min-width: 2px;
  border-radius: 2px;
  background: var(--cs-accent, #6c5ce7);
  transition: opacity 120ms ease;
}

/* 有歌词：逐行铺开，长词可滚动（overflow-y auto + overscroll 阻断）。 */
.csAudioStageLyrics {
  width: 100%;
  max-height: 100%;
  overflow-y: auto;
  overscroll-behavior: contain;
  text-align: center;
  cursor: text;
}

.csAudioLyricLine {
  margin: 0 0 8px;
  font-size: 14px;
  line-height: 1.7;
  color: var(--dsw-alias-label-primary);
}

/* 结构标记（[Verse] / [Chorus - anthemic]）：弱化成小号灰字，不当正文读。 */
.csAudioLyricMarker {
  font-size: 11px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--dsw-alias-label-tertiary);
}

/* 空行分隔（段落边界）：保留高度，让歌词段落感不丢。 */
.csAudioLyricGap {
  display: block;
  height: 8px;
}

/* 详情面板里的歌词全文（复用 csDetailPrompt 排版，额外给最大高度避免刷屏）。 */
.csDetailLyrics {
  max-height: 220px;
  overflow-y: auto;
  overscroll-behavior: contain;
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
  padding: var(--cs-space-6, 32px);
  /* DD-06：accent-soft 主光晕 + accent-deep 底部余晖（顺带接线空转的 deep）。 */
  background:
    radial-gradient(60% 50% at 50% 40%, var(--cs-accent-soft, transparent), transparent 70%),
    radial-gradient(45% 35% at 50% 88%, var(--cs-accent-deep, transparent), transparent 72%),
    var(--cs-canvas-bg, var(--dsw-alias-bg-base));
}
.csWelcomeCard {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--cs-space-3, 12px);
  max-width: 460px;
  text-align: center;
  padding: var(--cs-space-6, 32px) var(--cs-space-7, 48px);
  border-radius: var(--cs-radius-lg, 12px);
  border: 1px solid var(--cs-line, var(--dsw-alias-border-l2));
  /* DD-06：欢迎卡浮在画布上 —— 用浮层令牌 + 三级阴影。 */
  background: var(--cs-float, var(--dsw-alias-bg-layer-1));
  box-shadow: var(--cs-shadow-3, none);
}
.csWelcomeTitle {
  margin: 0;
  font-size: var(--cs-fs-2xl, 24px);
  font-weight: 500;
  letter-spacing: 0.2px;
  color: var(--dsw-alias-label-primary);
}
.csWelcomeNameZh {
  margin-left: var(--cs-space-2, 8px);
  font-size: var(--cs-fs-lg, 14px);
  font-weight: 400;
  color: var(--cs-accent, var(--dsw-alias-label-secondary));
}
.csWelcomeTagline {
  margin: 0;
  font-size: var(--cs-fs-md, 13px);
  font-style: italic;
  color: var(--cs-accent, var(--dsw-alias-label-secondary));
}
.csWelcomePositioning {
  margin: 0;
  font-size: var(--cs-fs-sm, 12px);
  color: var(--dsw-alias-label-secondary);
}
.csWelcomeActions {
  display: flex;
  gap: var(--cs-space-3, 12px);
  margin-top: var(--cs-space-2, 8px);
}
.csWelcomeActions button {
  padding: 7px var(--cs-space-4, 16px);
  font-size: var(--cs-fs-md, 13px);
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
  margin: var(--cs-space-1, 4px) 0 0;
  font-size: var(--cs-fs-xs, 11px);
  color: var(--dsw-alias-label-tertiary);
}

/* CV-064：Lobby 态中栏顶部品牌条（横向紧凑版，与下方居中的聊天卡片配套）。
   与 .csWelcome*（整屏欢迎卡）分开：后者会把聊天挤出视口。 */
.csLobbyHero {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--cs-space-5, 24px);
  padding: var(--cs-space-5, 24px) var(--cs-space-6, 32px) var(--cs-space-4, 16px);
  background:
    radial-gradient(70% 130% at 50% 0%, var(--cs-accent-soft, transparent), transparent 70%),
    var(--cs-canvas-bg, var(--dsw-alias-bg-base));
}
.csLobbyBrand {
  display: flex;
  align-items: center;
  gap: var(--cs-space-4, 16px);
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
  font-size: var(--cs-fs-xl, 18px);
  font-weight: 500;
  letter-spacing: 0.2px;
  color: var(--dsw-alias-label-primary);
}
.csLobbyNameZh {
  margin-left: var(--cs-space-2, 8px);
  font-size: var(--cs-fs-md, 13px);
  font-weight: 400;
  color: var(--cs-accent, var(--dsw-alias-label-secondary));
}
.csLobbyTagline {
  margin: 0;
  font-size: var(--cs-fs-sm, 12px);
  font-style: italic;
  color: var(--cs-accent, var(--dsw-alias-label-secondary));
}
.csLobbyHint {
  margin: var(--cs-space-1, 4px) 0 0;
  font-size: var(--cs-fs-sm, 12px);
  color: var(--dsw-alias-label-secondary);
}
.csLobbyActions {
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  align-items: flex-end;
  gap: var(--cs-space-2, 8px);
}
.csLobbyButtons {
  display: flex;
  gap: var(--cs-space-3, 12px);
}
.csLobbyActions button {
  padding: 7px var(--cs-space-4, 16px);
  font-size: var(--cs-fs-md, 13px);
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
  font-size: var(--cs-fs-xs, 11px);
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
  padding: var(--cs-space-1, 4px) var(--cs-space-5, 24px) var(--cs-space-4, 16px);
  overflow: hidden;
}
.csLobbyTailHead {
  display: flex;
  align-items: baseline;
  gap: var(--cs-space-3, 12px);
  margin-bottom: var(--cs-space-2, 8px);
}
.csLobbyTailHead > span:first-child {
  font-size: var(--cs-fs-md, 13px);
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
}
.csLobbyTailHint {
  font-size: var(--cs-fs-xs, 11px);
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

/* CV-118 语义修订（2026-09-09）：试跑期角标（卡片右上 absolute；弹窗标题内 static）。 */
.csSkillPreviewBadge {
  position: absolute;
  top: 6px;
  right: 6px;
  padding: 0 5px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 700;
  line-height: 1.5;
  letter-spacing: 0.04em;
  color: var(--dsw-alias-label-primary);
  background: color-mix(in srgb, var(--dsw-alias-bg-layer-2, rgb(128 128 128 / 30%)) 88%, transparent);
  border: 1px solid var(--dsw-alias-border-l2);
  pointer-events: none;
}
.csSkillDetailTitle .csSkillPreviewBadge {
  position: static;
  align-self: center;
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
  position: relative;
  flex-shrink: 0;
  width: 132px;
  height: 96px;
  border-radius: 12px;
  overflow: hidden;
  color: rgb(255 255 255 / 92%);
}
/* CV-112：详情弹窗缩略图 GIF（与卡片默认显示的 csSkillThumbGif 一致——盖在渐变上）。 */
.csSkillDetailThumbGif {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

@media (prefers-reduced-motion: reduce) {
  .csSkillDetailThumbGif {
    display: none;
  }
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