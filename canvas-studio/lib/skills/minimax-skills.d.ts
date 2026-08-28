/**
 * MiniMax-H3 upstream skills registration (pilot).
 *
 * The skill bodies come verbatim from the pinned `minimax-h3` submodule via
 * `scripts/sync-minimax-skills.mjs` (see generated/minimax-skills.ts). This
 * module only decides which upstream skills are enabled and registers them into
 * the host skill registry with `ctx.skills.register()` — content is never
 * adapted here.
 *
 * Pilot scope: `3d-animation-short-generator` only. Enable more upstream skills
 * by adding their names to the ENABLED set in the sync script and rebuilding.
 */
import type { Context } from '@deepseek-ai/cordis';
/** Registry-valid kebab-case names of upstream skills loaded from the submodule. */
export declare const MINIMAX_SKILL_NAMES: string[];
/**
 * Register every synced upstream skill into the host registry.
 * @param ctx - active Host context (`skills` service injected).
 * @returns the combined disposer that unregisters all pilot skills.
 */
export declare function registerMinimaxSkills(ctx: Context): () => void;
