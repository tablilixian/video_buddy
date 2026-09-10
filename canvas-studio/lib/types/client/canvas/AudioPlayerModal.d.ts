/**
 * CV-130：音频固定尺寸播放器浮层（双击音频节点打开）。
 *
 * 与 `VideoPlayerModal` 同构（同一套自绘控制条语义：不挂原生 controls、
 * pointer capture 拖进度、Escape 关闭），差别在「舞台」部分——音频没有画面，
 * 于是把舞台让给**歌词**：有歌词时逐行铺开（可滚动），纯器乐时显示波形动画。
 *
 * 为什么要有这个窗口：画布卡片只有一行歌词位置，而「唱的到底是什么」是用户
 * 事后复核 BGM/歌曲的核心信息（CV-130 的诉求之一）。卡片负责「一眼看出有词」，
 * 窗口负责「完整读一遍」。
 */
export interface AudioPlayerModalProps {
    title: string;
    url: string;
    /** 节点上的歌词原文（含结构标记；[Instrumental] = 纯器乐）。 */
    lyrics?: string;
    /** 节点记录的时长（秒）——metadata 就绪前先用它占位，避免出现「加载中…」空窗。 */
    duration?: number;
    onClose(): void;
}
export declare function AudioPlayerModal(props: AudioPlayerModalProps): import("react").JSX.Element;
