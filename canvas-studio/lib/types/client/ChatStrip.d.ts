/**
 * DD-09 / b：右栏收起态的缩略条（56px 轨道）。
 *
 * ## 形态
 *
 * 两段竖列：展开按钮（点回对话区）→ 六段制作轨道竖排点。
 *
 * ## 为什么放制作轨道，而不是「放个图标占位」
 *
 * 左栏 RailStrip 装的是项目色块方阵 —— 它是「同一份列表的压缩形态」，收起后
 * 仍能定位到具体项目。右栏对称地需要回答同一个问题：**收起之后，我还能从这里
 * 看出什么？**
 *
 * 对话区里正在发生的事只有一件值得看：制作走到第几段了。而六段轨道的数据
 * （`workflowStages.stage`）本来就由 StudioFrame 单点派生、已经传给审批条 ——
 * 这里只是同一份数据的竖向渲染，**不新增任何语义、不新增任何契约**。
 *
 * 刻意不放的东西：产物计数、待确认数、消息未读数。前两个属于 c/d 批（要先把
 * 数据接到 wire 上），最后一个宿主有自己的未读模型，插件再算一份就是第二份实现。
 *
 * ## 无内部状态
 *
 * 与 RailStrip 同款：不持有状态，由 StudioFrame 整体挂载 / 卸载。**对话区本身
 * 不卸载**（见 styles.ts 里收起态的对话区处理），所以草稿、会话绑定都不会丢。
 */
import type { ReactElement } from 'react';
export interface ChatStripProps {
    /** 当前制作阶段序号（六段轨道）。由 StudioFrame 从 workflowStages 单点派生后传入。 */
    stageIndex: number;
    /** 展开右栏。 */
    onExpand(): void;
}
export declare function ChatStrip(props: ChatStripProps): ReactElement;
