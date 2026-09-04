# VideoBuddy data-home isolation, brand app icon, and session storage

English | [中文](2026-09-04-videobuddy-sessions-and-icon-isolation.zh.md)

Records three desktop changes merged as a single working set: (1) full data-home
isolation from user-installed DeepSeek Harness CLIs, (2) moving the installer
app icon to the Canvas Studio brand mark, and (3) the reproducible one-shot
packaging script introduced earlier in this working set.

## 1. Data home is fully self-contained (DSH_HOME forced to VideoBuddy home)

The upstream `@deepseek-ai/dsh-home-paths` resolver has precedence
`configured argument > $DSH_HOME env > ~/.dsh`. The desktop previously passed
`~/.videobuddy` only as a local `resolveDshHome(configured)` argument on the
desktop side, and patched only the `settings` row config with `dshHome: home`.
Every other in-process harness consumer (`session-persistence-jsonl` root,
`storage-json` root, snapshots, presets, `llm-deepseek/upload-index`, …)
resolves via `dshHomePath()`/`resolveDshHome()`, which reads `$DSH_HOME` from
`process.env` or falls back to `~/.dsh`. So on a machine where a user-installed
dsh CLI had exported `DSH_HOME`, VideoBuddy sessions and storages landed in
`~/.dsh` and could collide with another application.

Fix (`dsh-plugin-desktop/src/main.ts`):
- New `VIDEOBUDDY_HOME` env override and `resolveDesktopDataHome()`: an explicit
  `$VIDEOBUDDY_HOME` wins, otherwise the dedicated `~/.videobuddy` is used.
  VideoBuddy never honors a user-provided `$DSH_HOME`.
- Right after `homeDir` is resolved and before the harness `boot()`, set
  `process.env[DSH_HOME_ENV] = homeDir`. This routes every in-process harness
  `resolveDshHome()`/`dshHomePath()` to VideoBuddy's own directory, and — because
  the assignment happens in our own Electron process — overrides any `$DSH_HOME`
  inherited from the launching shell. Other installed dsh clients and their
  `~/.dsh` data are untouched.
- Existing `~/.dsh` history is neither read nor migrated; VideoBuddy accumulates
  fresh data under `~/.videobuddy` (`~/.videobuddy/sessions/`,
  `~/.videobuddy/storages/`, …) from a clean start.

Verification: with a simulated `$DSH_HOME=~/.dsh`, before the override the
resolver returns `~/.dsh`; after `override DSH_HOME=~/.videobuddy`, both
`dshHomePath("sessions")` and `dshHomePath("storages")` resolve under
`~/.videobuddy`. Compiled `lib/main.js` contains the assignment.

## 2. Installer app icon now uses the Canvas Studio brand mark

`dsh-plugin-desktop/scripts/rewrite-app-icon.mjs` (new): reads
`canvas-studio/assets/brand/png/icon-1024.png` and writes
`build/app-icon.png`, transcoding to RGBA16 + Display P3 ICC — the exact
contract `generate-mac-app-icon.mjs` enforces. It is wired as the first step of
the desktop `build` chain (before `generate-mac-app-icon.mjs`), so the icon is
regenerated from the brand source on every build. Idempotent (same output hash).
Consumers were already pointed at the right files: mac `build.mac.icon` →
`app-icon-mac.png` (dock safe-area inset), win/linux → `build/app-icon.png`.

Verification: `typecheck` + `build` pass; the packaged mac DMG's `icon.icns`
carries the brand mark (transparent inset corners, dark `#1A1D29→#0F1117`
background, violet `#795CF7` mark). Windows/portable `.ico` generation can only
be confirmed on a native Windows host.

### macOS Dock icon rounded corners

macOS (Big Sur–Sequoia) does **not** auto-mask app icons the way iOS does: it
renders the artwork you ship. The brand mark is a full-bleed opaque dark square,
so a naive resize yields a square tile and the Dock shows sharp corners. Two
things had to line up:

- **Centered safe-area geometry** — 824 artwork centered on the 1024 canvas with
  100px transparent inset on every side (already done by
  `generate-mac-app-icon.mjs`). The earlier "not centered" readings were a
  measurement bug: the PNG is RGBA16 (8 bytes/pixel), and 8-bit alpha parsers
  mis-read it. With correct (sharp-based) measurement the inset is exactly
  `{left:100,top:100,right:100,bottom:100}`.
- **Continuous-corner squircle mask** — a plain centered square still leaves the
  corner pixels opaque, so macOS draws square corners. Fix: mask the 824 artwork
  with Apple's continuous-corner squircle before extending. New helper
  `squirclePath(side, radius, smoothing)` ports chartr's grid measured off
  Apple's system icons (`RADIUS_RATIO = 0.225`, `CORNER_SMOOTHING = 0.7`) and is
  applied with a `dest-in` composite. Result: the 4 corner pixels
  `(100,100)/(923,100)/(100,923)/(923,923)` are fully transparent, edge midpoints
  stay opaque. Verified at pixel level after a full `build`.

## 3. One-shot packaging script

`scripts/package.mjs` produces unsigned mac/win/win-portable packages through a
single command and prints artifact paths + package metadata; `VIDEOBUDDY_HOME`
documented in `scripts/package.README.md`. Root `yarn package:build` alias added.

## Cross-cutting notes

- No edits inside the pinned `deepseek-harness/` upstream submodule.
- Icon rewrite embeds the Display P3 ICC profile as a base64 constant (536 bytes,
  md5 `ecfda38e388547c36db4bd4f7ada182f`, matching the pre-existing pipeline).
- Windows branding in `package.json`/win verify specs was already rebranded to
  VideoBuddy in this working set.
