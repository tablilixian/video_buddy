import type { Context } from '@deepseek-ai/cordis';
/** Package-root `skills/` directory (populated by scripts/sync-minimax-skills.mjs). */
export declare const MINIMAX_SKILLS_DIR: string;
/** Registry-valid kebab-case names of upstream skills present under skills/. */
export declare const MINIMAX_SKILL_NAMES: string[];
/**
 * description 注册上限（字符）。
 *
 * SK-04：取值依据 = 实测 `skills/` 下 13 个 skill 的 frontmatter description，
 * 最长者 `papercraft-stop-motion-explainer` 为 914 字符，故取 914 + 约 100 buffer。
 * **不要随手调小**——description 是模型在 catalog 中选择 skill 的唯一依据，
 * 截断会静默砍掉排在最末的负向路由语（如 "Not for KOC talking-head ads…" 这类
 * 能力边界限定），且改动前后都无日志，故障极难发现。
 * 调整本值须同步更新 `tests/minimax-skill.test.mjs` 的长度快照断言。
 */
export declare const DESCRIPTION_LIMIT = 1024;
/** description 截断结果。 */
export interface TruncatedDescription {
    text: string;
    truncated: boolean;
    /** 被丢弃的字符数（未截断时为 0）。 */
    dropped: number;
}
/**
 * 截断 skill description（纯函数，无副作用，便于单测）。
 * 恰好等于 limit 时不截断、不计为截断。
 * @param raw - frontmatter 中的原始 description。
 * @param limit - 上限，缺省用 {@link DESCRIPTION_LIMIT}。
 */
export declare function truncateDescription(raw: string, limit?: number): TruncatedDescription;
/** 单个 skill 的读取结果：description 统计 + 去掉 frontmatter 的正文。 */
export interface SkillStat {
    /** skill 注册名（同 skills/<name>/ 目录名）。 */
    name: string;
    /** skills/<name>/ 绝对路径（即 resourceBase.path）。 */
    dir: string;
    /** 截断前的原始 description。 */
    rawDescription: string;
    /** 截断后实际注册给 harness 的 description。 */
    description: string;
    /** rawDescription 的字符数。 */
    length: number;
    truncated: boolean;
    dropped: number;
    /** SKILL.md 正文（已剥离 frontmatter）。 */
    body: string;
}
/**
 * 读取 `skills/` 下全部 skill 的 description 统计与正文（纯读盘，无副作用）。
 * 供注册流程与单测共用，避免测试侧重复实现 frontmatter 解析而漂移。
 */
export declare function collectSkillStats(): readonly SkillStat[];
/**
 * Register every synced upstream skill into the host registry with a directory
 * resource base for on-demand `references/` reads.
 * @param ctx - active Host context (`skills` service injected).
 * @returns the combined disposer that unregisters all skills.
 */
export declare function registerMinimaxSkills(ctx: Context): () => void;
