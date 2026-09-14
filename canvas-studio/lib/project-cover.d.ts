/**
 * 项目封面（DD-08 / R3）—— 零素材依赖的「首字色块」（拍板 A+C）。
 *
 * 为什么不放图片封面：那要走 Host 侧 `coverUrl` 增量写（CV-087 已在立项，
 * 但涉及产物落盘 + 契约扩字段 + 存量项目零封面兜底三件事）。本批先用**纯前端
 * 派生**——名字首字 + 稳定色档——把「一行文字」变成「一眼可扫的方阵」，
 * 等 CV-087 落地时这块只是把 `<span>` 换成 `<img>` 的局部替换。
 *
 * 纯函数、无 DOM、无 React：`node --test` 可直连。
 */
/** 色档数量（与 brand.ts 的 `--cs-cover-1..6` 一一对应）。 */
export declare const COVER_TONES = 6;
/**
 * 取名字的首字（用于色块上的字形）。
 *
 * 用 `Array.from` 按**码点**切，不用 `charAt(0)`：emoji 与部分汉字是代理对，
 * `charAt` 会切出半个码点（渲染成豆腐块）。空白名字返回 `?` 而不是空串 ——
 * 空块读成「渲染坏了」。
 */
export declare function coverInitial(name: string): string;
/**
 * 由**项目 id**（而不是名字）派生的稳定色档，返回 1..COVER_TONES。
 *
 * 用 id 而不是名字：改名后封面不该换色（视觉记忆靠颜色，改名后颜色一换，
 * 用户会以为点错了项目）。id 是 Host 铸的 UUID，稳定且无碰撞。
 *
 * 散列用 FNV-1a 的 32 位变体：够均匀、纯整数运算、无依赖。`% 6` 之前先取
 * 无符号（`>>> 0`）—— JS 的 `^` 结果是**带符号**的，负数取模会得到负档位。
 */
export declare function coverTone(projectId: string): number;
/** 色档 → 样式类名（1..6 越界时夹回范围，脏数据不至于渲染成无色块）。 */
export declare function coverToneClass(projectId: string): string;
