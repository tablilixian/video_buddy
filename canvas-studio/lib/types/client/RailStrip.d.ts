/**
 * DD-08 / R8：左栏收起态的缩略条（56px 轨道）。
 *
 * ## 形态
 *
 * 三段竖列：品牌标（点开）→ 项目色块方阵（独立滚动）→ 用户头像（点开）。
 * 色块复用项目卡的封面语言（同一套 `coverToneClass` 六档底色 + 首字），所以
 * 「展开时第一行是紫色方块」与「收起时第二个色块是紫色」指向同一个项目 ——
 * 收起态的价值就在这里：它是同一份列表的压缩形态，不是另一个东西。
 *
 * ## 为什么点色块要「展开 + 打开项目」一步做完
 *
 * 只打开项目而不展开，用户会在一列色块里对着看不见内容的画布 —— 而左栏是
 * 项目切换的主要入口。反过来只展开不打开，则相当于「点一下等于没点」。
 * 一步做完才是收起态该有的效率（否则收起就成了单向门，用户会躲着不用）。
 *
 * ## 无内部状态
 *
 * 本组件不持有任何状态，被 StudioFrame 在收起时整体挂载 / 卸载。这条是刻意的：
 * ProjectList 里有内联表单、重命名草稿等临时态，收起左栏本来就该把它们收起
 * （展开回来是干净的一份列表，而不是半截输入框留在 56px 里）。
 */
import type { ReactElement } from 'react';
import type { StudioProject } from '../contracts/project.js';
export interface RailStripProps {
    projects: readonly StudioProject[];
    selectedProjectId: string | null;
    /** 展开左栏（点品牌标 / 点用户头像 / 点任意项目色块都会先走这一步）。 */
    onExpand(): void;
    /** 打开某个项目（展开 + 打开由调用方一起完成，见上）。 */
    onOpen(project: StudioProject): void;
}
export declare function RailStrip(props: RailStripProps): ReactElement;
