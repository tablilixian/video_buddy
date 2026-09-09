/**
 * @ref 引用标记工具（Host/Client 共用，纯函数，无副作用）。
 *
 * 画布素材用 `@ref[句柄]` 作为对话内引用句柄：用户在节点右键/详情面板/参考
 * 托盘点「引用到对话」会插入一个 chip，Host 侧生成工具（image_generate /
 * video_generate / character_sheet / video_composite）把 `@ref[句柄]` 解析成
 * 对应的 Drama Backend 文件名，免去手动 upload_image。
 *
 * CV-114：句柄语义由「显示名」升级为**节点 id**，标题退化为兜底——
 * 标题会重名（uniqueTitle 只能去重批次内的）、会被用户改名，两者都会让引用
 * 指错对象或失效；id 是节点唯一稳定标识。旧教材/手输的 `@ref[标题]` 仍可用。
 *
 * 这与 Midjourney 的 `--cref` / `--sref` token、Runway 的参考区思路一致：
 * 一个稳定的引用句柄，跨「画布 ↔ 聊天」复用素材。
 */
import type { StudioCanvasNode } from './contracts/canvas.js';
/** 把上传文件的原始名清洗成合法节点标题：空名兜底 + 去除 [ ]（CR-031）。 */
export declare function sanitizeTitle(raw: string, fallback?: string): string;
/**
 * 在已占用标题集合内生成不重名的节点标题：重名时在扩展名前追加序号
 * （`image.png` → `image 2.png`）。剪贴板粘贴的 File.name 恒为 image.png，
 * 多张重名会让 @ref[token] 无法区分——parseRefTokens 按名去重，同消息里
 * 第二条同名引用会被静默丢弃，agent 拿到的参考就缺图了。生成的新标题会
 * 回写进 used，供同批次后续文件继续去重。
 */
export declare function uniqueTitle(raw: string, used: Set<string>, fallback?: string): string;
/**
 * 把引用句柄（优先节点 id）格式化为对话内引用标记。
 *
 * CV-114 起传 node.id；仍兼容任意句柄字符串（旧的 `@ref[标题]`）。
 */
export declare function formatRefToken(handle: string): string;
/**
 * 引用句柄 → 节点：**id 精确优先**，其次标题兜底（历史/手输兼容）。
 *
 * 两者都不命中返回 undefined，由调用方给可操作报错。同标题多节点时取首个
 * （数组顺序 = 创建顺序），不做猜测。
 */
export declare function findNodeByRef<T extends Pick<StudioCanvasNode, 'id' | 'title'>>(nodes: readonly T[], token: string): T | undefined;
/**
 * 从一段文本里抽取所有 `@ref[显示名]` 标记，返回显示名数组（去重保持首次出现顺序）。
 * 用于 Host 侧在工具参数里识别 `@ref[...]` 并解析成 Drama 文件名。
 */
export declare function parseRefTokens(text: string): string[];
