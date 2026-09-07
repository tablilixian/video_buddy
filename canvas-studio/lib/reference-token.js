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
/** 单条消息内最多解析的 @ref token 数（防超长/恶意输入消耗 CPU）。 */
const MAX_REF_TOKENS = 64;
/** 把上传文件的原始名清洗成合法节点标题：空名兜底 + 去除 [ ]（CR-031）。 */
export function sanitizeTitle(raw, fallback = '本地素材') {
    return (raw.trim() === '' ? fallback : raw).replace(/[[\]]/gu, '');
}
/**
 * 在已占用标题集合内生成不重名的节点标题：重名时在扩展名前追加序号
 * （`image.png` → `image 2.png`）。剪贴板粘贴的 File.name 恒为 image.png，
 * 多张重名会让 @ref[token] 无法区分——parseRefTokens 按名去重，同消息里
 * 第二条同名引用会被静默丢弃，agent 拿到的参考就缺图了。生成的新标题会
 * 回写进 used，供同批次后续文件继续去重。
 */
export function uniqueTitle(raw, used, fallback = '本地素材') {
    const base = sanitizeTitle(raw, fallback);
    if (!used.has(base)) {
        used.add(base);
        return base;
    }
    const dot = base.lastIndexOf('.');
    const stem = dot > 0 ? base.slice(0, dot) : base;
    const ext = dot > 0 ? base.slice(dot) : '';
    for (let i = 2;; i += 1) {
        const candidate = `${stem} ${i}${ext}`;
        if (!used.has(candidate)) {
            used.add(candidate);
            return candidate;
        }
    }
}
/** 把节点显示名格式化为对话内引用标记。 */
export function formatRefToken(title) {
    // CR-031：标题含 `[` / `]` 时无法用 `@ref[title]` 无损表达（parseRefTokens 按
    // 最末 `]` 截断，解析出的名字与节点 title 错配 → 参考图解析失败/错连）。
    // 直接拒绝并给可操作提示，比生成一个坏 token 更安全。
    if (/[[\]]/u.test(title)) {
        throw new Error('节点标题包含 [ 或 ]，无法生成 @ref 引用标记，请先重命名该节点');
    }
    return `@ref[${title}]`;
}
/**
 * 从一段文本里抽取所有 `@ref[显示名]` 标记，返回显示名数组（去重保持首次出现顺序）。
 * 用于 Host 侧在工具参数里识别 `@ref[...]` 并解析成 Drama 文件名。
 */
export function parseRefTokens(text) {
    const out = [];
    const seen = new Set();
    const re = /@ref\[([^\]]+)\]/g;
    let m;
    // CR-031：token 数量上限，防超长输入触发大量正则回溯。
    while ((m = re.exec(text)) !== null && out.length < MAX_REF_TOKENS) {
        const name = m[1];
        if (!seen.has(name)) {
            seen.add(name);
            out.push(name);
        }
    }
    return out;
}
