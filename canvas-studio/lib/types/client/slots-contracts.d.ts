/**
 * Canvas Studio slot contract declarations.
 *
 * The slot registry is shared with the Desktop host at runtime, but the
 * `SlotMap` type resolves per client package: `@deepseek-ai/dsh-client-ui-slots`
 * ships an empty `SlotMap` and every consumer augments the seats it owns. The
 * upstream seats (`sidebar` / `conversation` / `details` / `shell.overlay`) and
 * `conversation.chat.node` are augmented by the `@deepseek-ai/dsh-client-ui-*`
 * packages, which Canvas Studio already depends on. The one seat Canvas Studio
 * owns that no other package declares is the top-level `root`; declare only it.
 *
 * Runtime ownership: Canvas Studio owns `root` (its `StudioFrame`) and declares
 * the four upstream child seats beneath it; the Desktop host yields `root` so
 * the two never race for a single slot.
 */
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface SlotMap {
        /** Canvas Studio main surface; the Desktop host renders into the same viewport. */
        'root': {
            kind: 'single';
            scope: 'root';
            owner: Record<never, never>;
        };
    }
}
export {};
