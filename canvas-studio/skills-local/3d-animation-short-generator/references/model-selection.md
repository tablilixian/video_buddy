# Video Model Policy (Fixed: MiniMax H3) and Prompt Shaping

## STEP 7: Single-Shot Video Clips (H3 fixed)

### No video-model or resolution choice

This project has **no selectable video model**. All clips are rendered with **MiniMax H3** — do not show a video-model choice card, do not ask the user to pick between models (e.g. H3 vs Seedance), and do not offer per-shot mixed model modes.

Resolution is likewise not selectable: do not show a resolution choice card and do not ask the user to pick a resolution. Render with the backend default and keep the approved screen size / aspect ratio from the Project Brief.

### Single-shot clip rendering

For each approved table row, call MiniMax H3 to generate the corresponding independent video clip. Each clip must use exactly the matching section from the text storyboards document (extracted standalone node if that section was extracted, otherwise the in-document section), character card(s), and scene card from that row.

Per-shot rules:

- Use the text storyboards document as the authoritative per-shot reference for narrative, composition, camera movement, action staging, per-second timing, and shot number. For shots that have been extracted to a standalone node, read the extracted node instead. If a pencil image storyboard also exists, use it only for human-side pose / silhouette pre-check; do not let it override the text storyboard.
- Use character cards as the authoritative identity source.
- Use scene cards as the authoritative environment source.
- **Strip all storyboard double-binding labels** (`[char:…]`, `[scene:…]`, `[shot:…]`, `[dur:…]`, `[hook:…]`) before video render — these labels are storyboard-only reference markers and must NOT appear in the final clip. Pencil image storyboards additionally have their own shot numbers, camera icons, arrows, and notes that must be removed at render time.
- The rendered clip must contain only clean full-color Pixar-inspired 3D animation content.
- No storyboard line art, no hand-drawn sketch texture, no labels, no subtitles unless requested, no watermarks.
- Maintain the approved screen size / aspect ratio.

### H3 prompt shaping

The text storyboards document (or the extracted standalone node for that shot) feeds the model. Use the **H3 prompt prefix**: emphasize packaging keywords, design language, motion clarity, text/UI presence when relevant, and dual-channel audio intent. H3 is strong at instruction following, so the per-second directive can be sent almost verbatim. Add: `Pixar-inspired 3D cartoon rendering, C4D + Octane look, stylized Q-version proportions, warm SSS skin, designed-with-detail hair, strong character design language, clean motion, on-brand color palette`.
