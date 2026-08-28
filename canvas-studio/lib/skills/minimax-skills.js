import { MINIMAX_SKILL_ASSETS } from './generated/minimax-skills.js';
/** Registry-valid kebab-case names of upstream skills loaded from the submodule. */
export const MINIMAX_SKILL_NAMES = MINIMAX_SKILL_ASSETS.map((asset) => asset.name);
/**
 * Register every synced upstream skill into the host registry.
 * @param ctx - active Host context (`skills` service injected).
 * @returns the combined disposer that unregisters all pilot skills.
 */
export function registerMinimaxSkills(ctx) {
    const disposers = MINIMAX_SKILL_ASSETS.map((asset) => ctx.skills.register({
        name: asset.name,
        description: asset.description,
        source: 'runtime',
        content: asset.content,
    }));
    return () => { for (const dispose of disposers)
        dispose(); };
}
