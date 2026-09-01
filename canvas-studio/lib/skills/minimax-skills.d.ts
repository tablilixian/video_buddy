import type { Context } from '@deepseek-ai/cordis';
/** Package-root `skills/` directory (populated by scripts/sync-minimax-skills.mjs). */
export declare const MINIMAX_SKILLS_DIR: string;
/** Registry-valid kebab-case names of upstream skills present under skills/. */
export declare const MINIMAX_SKILL_NAMES: string[];
/**
 * Register every synced upstream skill into the host registry with a directory
 * resource base for on-demand `references/` reads.
 * @param ctx - active Host context (`skills` service injected).
 * @returns the combined disposer that unregisters all skills.
 */
export declare function registerMinimaxSkills(ctx: Context): () => void;
