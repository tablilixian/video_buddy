# Generation Failure and Drift Fallback Policy

### Failure fallback (MiniMax H3, fixed model)

H3 fallback ladder when a clip fails or drifts:

1. First retry: regenerate the same clip with the H3 prompt prefix strengthened by quoting the exact `Reference Anchors` block from the table.
2. Second retry: shorten the shot to ≤6s and split the dropped seconds into a new adjacent row in Step 5; re-run Step 5.5 self-check, then re-render.
3. Third retry: drop reference images and use text-only generation.
4. After three failed attempts on the same shot: pause and ask the user with a choice card:
   - Loosen the request (drop a prop, simplify the action, reduce the hook).
   - Skip the shot and add a `placeholder: missing clip` note for downstream review.
   - Manually supply a reference video to bind instead of generating.

The video model is fixed to MiniMax H3 in this project — never offer a model switch as a fallback option.

### After all clips are rendered

Place the rendered clips on canvas in shot order, group them as `<title> shot clips`, and show a user choice card:

- Approve clips and composite full film (recommended)
- Re-render selected clip
- Fix character mismatch
- Fix scene mismatch
- Strengthen storyboard cleanup
- Fix spatial anchor drift across clips

If a rendered clip drifts from the approved `Reference Anchors` (e.g. door-frame lands on the wrong side, character exits from the wrong edge, lighting flipped), re-render with a strengthened prompt that quotes the exact `Reference Anchors` block from the table; do not silently mix corrected and uncorrected clips into assembly.

## Storyboard Visualization Fallback

### Storyboard generation failure fallback (visualization mode only)

If a pencil image storyboard cannot be produced at the required quality (e.g. layout collapses, labels illegible, panels merged, character inconsistency), apply the following escalation before asking the user:

1. **First retry**: regenerate the same shot storyboard with a tightened prompt that explicitly mentions the four-quadrant layout, the `[char:…] [scene:…] [shot:…]` labels, and the per-panel content rules.
2. **Second retry**: drop the bottom-right audio/anchor quadrant text (keep it as a blank cell with a tiny `♪` mark) to reduce text load; this usually fixes illegible labels without losing the visual beat.
3. **Third retry**: reduce panel count by one (e.g. 6 panels → 5 panels by merging the two least-actionable seconds) and simplify camera icons to single arrows.
4. **After three failed attempts on the same shot**: pause and ask the user with a choice card:
   - Switch to a block-color storyboard (gray boxes for poses, no pencil lines) for the failing shot only.
   - Drop the pencil image for the failing shot and rely on the text storyboards document alone for that row.
   - Split the failing shot into two shorter shots in Step 5 and re-run Step 5.5.
   - Manually supply a reference image to bind instead of generating.

In default text mode this whole fallback is unnecessary — text storyboards fail only when the model cannot produce coherent structured text, in which case return to Step 5 to revise the table row.
