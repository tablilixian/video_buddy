/**
 * 画布素材的短引用句柄（纯函数，无副作用）。
 *
 * CV-114：chip 上要显示「短、好认」的名字，而节点标题多是中文长句
 * （`Cinematic portrait 主角特写 01`），直接塞进对话框 chip 会挤爆一行，
 * 截断了又互相认不出。因此派生一套**类型前缀 + 同类型序号**的短句柄：
 *
 *   img-01  img-02  …   vid-01  vid-02  …
 *
 * 设计取舍：
 * - 短：`≤6` 字符，chip 只承担「这是第几张图/哪个视频」；
 * - 可认：完整标题 + 缩略图由 hover 浮层与 tooltip 兜住（reference-preview），
 *   这是真正「好认」的地方，不指望 chip 文案；
 * - 不落盘：序号按当前项目节点顺序派生，零迁移、零新字段。删除节点会让后续
 *   序号漂移，但 chip 显示的是**插入时刻的 label 快照**，模型侧拿的是
 *   （永不漂移的）node id —— 漂移只影响人类读新 chip，不影响正确性。
 */
import type { StudioCanvasNode } from './contracts/canvas.js';
/** 一个可引用素材（图片 / 视频）的短句柄视图。 */
export interface AssetHandle {
    /** 节点 id —— 引用句柄与模型侧 token 的真实身份（稳定）。 */
    readonly nodeId: string;
    /** 短句柄，如 `img-01` / `vid-02`（仅用于人读与展示）。 */
    readonly handle: string;
    readonly kind: 'image' | 'video';
    /** 完整节点标题（hover 卡片 / 候选项描述用）。 */
    readonly title: string;
    /** 素材 URL（缩略图 src；缺省时空浮层降级为纯文本卡）。 */
    readonly url: string | null;
    /** 视频时长（秒）；图片与未知时长为 undefined（卡片只出不显示）。 */
    readonly duration?: number;
}
/** 超出上限的标题截断成 `前 N 字…`（按 Unicode 码点切，避免切坏 emoji/汉字）。 */
export declare function truncateLabel(text: string, max?: number): string;
/**
 * 为当前项目的可引用素材派生短句柄（按节点数组顺序 = 创建顺序编号）。
 * 只有 image / video 节点可引用（文本便利贴等没有素材语义）。
 */
export declare function buildAssetHandles(nodes: readonly StudioCanvasNode[]): AssetHandle[];
/** 按短句柄反查（hover 浮层从 chip 文案回找素材；大小写不敏感）。 */
export declare function findAssetByHandle(handles: readonly AssetHandle[], handle: string): AssetHandle | undefined;
/**
 * 从 chip 上的文本反查素材（hover 浮层用）。
 *
 * chip 文案有四种来源，逐个兜：
 * 1. 我们自己的短句柄 `img-01`（右键插入 / 画布素材源选中）；
 * 2. node id（`@ref[<id>]` 被原样贴进输入框时）；
 * 3. 节点标题（上游 `@` 文件源选中后 label 是文件名，恰好与画布标题同名）；
 * 4. 文件 basename（上游文件源的 label 形如 `d73ea812.png`，与节点 url 末段一致）。
 *
 * 上游文件源（ui-reference）产生的 chip 走的正是 3/4：它不认识画布节点，
 * 但只要这个名字在画布上存在同名素材，就照样能出缩略图。
 */
export declare function findAssetByChipText(handles: readonly AssetHandle[], text: string): AssetHandle | undefined;
/** 按 query 过滤候选（句柄 / 标题 / 类型都参与匹配，空 query 返回全部）。 */
export declare function filterAssetHandles(handles: readonly AssetHandle[], query: string): AssetHandle[];
