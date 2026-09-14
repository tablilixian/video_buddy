/**
 * 相对时间（DD-08 / R3）——「最后一次动过是什么时候」的**唯一派生实现**。
 *
 * 纯函数、无 DOM：`node --test` 可直连。`now` 由调用方传入而不是内部取
 * `Date.now()` —— 否则这条规则永远测不了（列表渲染时同一项目两次调用可能
 * 跨过整点边界，断言只能写成「1 小时前 或 2 小时前」），而「刚刚」这类
 * 边界恰恰是最容易写错的地方。
 *
 * ## 为什么不用 Intl.RelativeTimeFormat
 *
 * 它给的是「3 小时前」这样的单档措辞，但侧栏副行只有约 90px 宽，需要的是
 * **最短可读形态**（`3h`、`昨天`、`9/1`），且要在中文下稳定不抖动。
 * 自造一个 12 行的函数比给 Intl 传 options 更可控，也更好断言。
 */
/** 一小时的毫秒数。 */
const MINUTE_MS = 60_000;
/** 一天的毫秒数。 */
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
/** 把数字补成两位（`9` → `09`）。 */
function pad2(value) {
    return value < 10 ? `0${value}` : String(value);
}
/**
 * 项目最后活动时间的紧凑表达。
 *
 * 分档（自最近向最远）：< 1 分钟「刚刚」→ < 1 小时「N 分钟前」→ < 24 小时
 * 「N 小时前」→ 昨天「昨天」→ < 7 天「N 天前」→ 更早「M/D」→ 跨年「YYYY/M/D」。
 *
 * 非法/缺失时间戳返回 `null`（调用方据此省略这一段，而不是显示「Invalid Date」）。
 * 未来时间（时钟漂移、手工改过系统时间）一律按「刚刚」处理 —— 显示「-3 分钟前」
 * 比不显示更糟。
 */
export function relativeTime(iso, now) {
    const then = new Date(iso);
    if (Number.isNaN(then.getTime()))
        return null;
    const delta = now.getTime() - then.getTime();
    if (delta < MINUTE_MS)
        return '刚刚';
    if (delta < HOUR_MS)
        return `${Math.floor(delta / MINUTE_MS)} 分钟前`;
    if (delta < DAY_MS)
        return `${Math.floor(delta / HOUR_MS)} 小时前`;
    if (delta < 2 * DAY_MS)
        return '昨天';
    if (delta < 7 * DAY_MS)
        return `${Math.floor(delta / DAY_MS)} 天前`;
    // 同一自然年内省掉年份：侧栏够窄，`2026/9/1` 会被省略号吃掉后半截。
    const sameYear = then.getFullYear() === now.getFullYear();
    const date = `${pad2(then.getMonth() + 1)}/${pad2(then.getDate())}`;
    return sameYear ? date : `${then.getFullYear()}/${date}`;
}
