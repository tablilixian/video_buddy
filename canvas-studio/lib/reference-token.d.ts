/**
 * @ref 引用标记工具（Host/Client 共用，纯函数，无副作用）。
 *
 * 画布参考托盘里的图片节点用 `@ref[显示名]` 作为对话内引用句柄：用户在节点
 * 详情面板 / 参考托盘点「引用到对话」会把该标记复制到剪贴板，粘贴进聊天框后，
 * Host 侧生成工具（image_generate / video_generate / style_transfer / video_composite）
 * 会自动把 `@ref[显示名]` 解析成对应的 Drama Backend 文件名，免去手动 upload_image。
 *
 * 这与 Midjourney 的 `--cref` / `--sref` token、Runway 的参考区思路一致：
 * 一个稳定的引用句柄，跨「画布 ↔ 聊天」复用素材。
 */
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
/** 把节点显示名格式化为对话内引用标记。 */
export declare function formatRefToken(title: string): string;
/**
 * 从一段文本里抽取所有 `@ref[显示名]` 标记，返回显示名数组（去重保持首次出现顺序）。
 * 用于 Host 侧在工具参数里识别 `@ref[...]` 并解析成 Drama 文件名。
 */
export declare function parseRefTokens(text: string): string[];
