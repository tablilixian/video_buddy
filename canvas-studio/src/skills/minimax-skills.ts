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
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-skill'
import { MINIMAX_SKILL_ASSETS } from './generated/minimax-skills.js'

/** Registry-valid kebab-case names of upstream skills loaded from the submodule. */
export const MINIMAX_SKILL_NAMES = MINIMAX_SKILL_ASSETS.map((asset) => asset.name)

/**
 * Register every synced upstream skill into the host registry.
 * @param ctx - active Host context (`skills` service injected).
 * @returns the combined disposer that unregisters all pilot skills.
 */
export function registerMinimaxSkills(ctx: Context): () => void {
  const disposers = MINIMAX_SKILL_ASSETS.map((asset) =>
    ctx.skills.register({
      name: asset.name,
      description: asset.description,
      source: 'runtime',
      content: asset.content,
    }),
  )
  return () => { for (const dispose of disposers) dispose() }
}
