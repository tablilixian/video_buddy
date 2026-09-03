# 05 · 客户端基础设施审查

> 覆盖：`project-store.ts` / `api.ts` / `layout-controller.ts` / `slots-contracts.ts` / `contracts.ts` / `question-capture.tsx` / `brief-capture.ts`
> 条目：CR-082 ~ CR-091。状态总表见 [README.md](./README.md#3-状态总表修复台账)。
> 本组以 store 设计健康、api 稳健为主基调，无高危项；多为边界声明与类型/健壮性改善。

---

## 中危

### CR-089｜[中] question 卡片本地选态在数据回流后不清零，展示冲突
- **位置**：[question-capture.tsx#L120-L123](../src/client/question-capture.tsx#L120-L123)、`#L220-L224`
- **问题（是什么）**：本地 `selected`/`freeText`/`submitted` 在 `data.answer/note` 回流更新后不清零。若用户先选 `selected=['A']`、`submitted=true`，之后 `note` 被更新为「超时/取消」，本地 `selected` 仍残留 A，UI 用 `data.answer` 展示已选与 note 语义冲突。
- **影响**：卡片展示与真实结算结果不一致。
- **解决方案**：在 `note`/`answer` 结算时清空本地选态。
- **验收方式**：作答后 result 回流，卡片展示与 `data.answer`/`note` 一致，无残留选态。

---

## 低危清单

| ID | 位置 | 问题 | 解决方案 |
| --- | --- | --- | --- |
| CR-082 | [project-store.ts#L495](../src/client/project-store.ts#L495) | `updateNode` 的 `{...node,...updates} as StudioCanvasNode` 掩盖「必填字段被传 undefined 覆盖」 | 运行时保护：合法性校验 / 忽略必填字段的 undefined |
| CR-083 | [project-store.ts#L263-L266](../src/client/project-store.ts#L263-L266) | `viewOf` 返回共享 `DEFAULT_VIEW_ENTRY` 常量，若调用方误写会污染全局 | 加 `as const` / 只读约定 |
| CR-084 | [project-store.ts#L547-L552](../src/client/project-store.ts#L547-L552) | `copySelected` 全局单剪贴板，未按项目划分；跨项目粘贴时 `sourceIds`/`parentId` 引用可能悬空 | 粘贴时按需重映射或过滤失效引用 |
| CR-085 | [project-store.ts#L320-L332](../src/client/project-store.ts#L320-L332)、#L530-546 | `history` 单栈跨项目，undo 会跳到另一项目的节点列表（多项目混一个栈） | 属设计选择；如需改善按项目分栈 |
| CR-086 | [api.ts#L23-L33](../src/client/api.ts#L23-L33) | `readJson` 对非 JSON 错误响应（如 5xx HTML）抛 `SyntaxError` 而非带 status 的 `StudioApiError` | 先判 `response.ok`，或 try/catch json 回退 `response.text()` |
| CR-087 | [api.ts#L108-L114](../src/client/api.ts#L108-L114) | `normalizeCanvasNodes` 正则只覆盖 `127.0.0.1`，不含 `localhost` 历史 URL | 正则兼容 `localhost` |
| CR-088 | [layout-controller.ts](../src/client/layout-controller.ts) | `StudioLayoutController` 实现 `ILayout` 但 toggle/open/close 全 no-op，未来接入侧栏易静默失败 | 加 `TODO`/日志断言提示接线 |
| CR-090 | [question-capture.tsx#L111-L113](../src/client/question-capture.tsx#L111-L113)、#L296-297 | `memo` 包裹的组件依赖每次新建的 `hooks` 闭包，memo 可能失效 | 稳定化 hooks 引用（useCallback/useMemo 到宿主层） |
| CR-091 | [brief-capture.ts#L68](../src/client/brief-capture.ts#L68) | `_context: unknown` 参数未标精确类型（刻意放宽） | 视需要收窄；如无必要保持并加注释 |

---

## 核实为健康的结论（勿重复排查）
- `project-store`：action 边界清晰、瞬态节点清洗、`viewOf` 稳定引用、undo 语义均有注释支撑；`moveNode` 组带动 children 与多选过滤防双移逻辑正确。无高危 BUG。
- `api.ts`：各处都支持 `AbortSignal`，模型接口传参暴露良好；仅缺「非 JSON 错误响应归类」（CR-086）与 `localhost` 归一化（CR-087）两个小缺口。
- `slots-contracts.ts` / `contracts.ts`：纯类型声明（`declare module` 增强 SlotMap），无运行期风险。`CanvasStudioModelApi` 部分方法入参用 `object` 建议补具体类型（类型质量，非缺陷）。
- `brief-capture.ts`：`addBriefNode` 幂等去重正确，无 BUG。