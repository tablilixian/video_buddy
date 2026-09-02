/**
 * Lobby 态（无项目）中栏顶部品牌条。
 *
 * 需求 1：项目没开始时聊天在中间，开始后回到右边。中栏因此被切成上下两截
 * —— 上截是本组件（品牌 + 双 CTA），下截是聊天。聊天下移由 CSS grid 重排
 * 完成（见 styles.ts `.csFrame[data-mode="lobby"]`），**对话槽始终挂载在原
 * DOM 位置**：JSX 条件搬家会让上游 conversation 组件卸载重建，草稿、滚动
 * 位置与会话绑定全丢。
 */
import type { ReactElement } from 'react';
export interface LobbyHeroProps {
    /** 新建项目（打开左侧栏新建表单）。 */
    onCreate: () => void;
    /** 创建示例项目。 */
    onCreateSample: () => void;
    /** 示例项目创建中。 */
    creating: boolean;
}
/** Lobby 品牌条：左侧品牌标识 + 引导句，右侧双 CTA。 */
export declare function LobbyHero(props: LobbyHeroProps): ReactElement;
