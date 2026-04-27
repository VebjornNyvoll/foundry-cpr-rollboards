# CPR Rollboards

A GM-only Foundry VTT module that gives chained roll tables their own dashboard. Drag any `RollTable` onto a canvas tile, click to roll, see results in an in-module drawer instead of global chat. Recipes can chain — roll an organisation, then roll its members, then optionally roll a quirk for each — and you build them by dragging tables together rather than writing code.

Built as a sister to [foundry-macro-dashboards](https://github.com/VebjornNyvoll/foundry-macro-dashboards): same per-scene tab + free-positioning canvas + presets pattern, with tiles that fire roll-table recipes instead of macros.

> **Status:** v0.0.1 — single-step tiles, drag-drop creation, click-to-roll, results drawer, presets. Chained recipes, the recipe inspector panel, the right-click popup, Roll-all, and the Cyberpunk Red Mook → Actor generator are landing in subsequent 0.0.x bumps.

## What you get today (v0.0.1)

- Dashboard window with one tab per selected scene (same scene-picker pattern as foundry-macro-dashboards).
- Drag a roll table from the sidebar onto the canvas → an instant tile that rolls that table on click.
- Drag tiles to reposition; hover to remove; toggle name labels.
- Per-tab presets — save, import (append/replace), rename, delete.
- Results drawer at the bottom of the window. Each roll posts a card; per-card actions: re-roll, send to chat, dismiss. Nothing is auto-posted to global chat.

## What's coming

- **Chained recipes** — drop a table onto an existing tile to chain it; `Shift`+drop or drop on a step row in the inspector to nest it as a child. Per-step `count`, `optional`, `chance: 0–100`, `prompt-at-roll-time` count.
- **Recipe inspector** — side panel showing the step tree; explicit drop targets resolve depth ambiguity that drag-onto-tile alone can't.
- **Right-click tile popup** — inline count/optional/chance/delete without opening the inspector.
- **Roll-all** — toolbar button + `Ctrl+Enter` keybind that fires every tile on the current tab in placement order.
- **CPR Mook generator** — when the [cyberpunk-red-core](https://gitlab.com/cyberpunk-red-team/fvtt-cyberpunk-red-core) system is active, individual NPC results in the drawer get a "Make Actor" button that rolls stats, picks a role, embeds skills/weapons/armor/cyberware from the system compendiums, and drops a token on the active scene.

## Install (manual)

This is a private module. Copy the repository into your Foundry `Data/modules/foundry-cpr-rollboards/` directory (or symlink it for development), then enable it in the world's module settings. GM only — non-GM users see no UI.

## Open the dashboard

- Roll Tables sidebar → header button **"CPR Rollboards"**, or
- Scene Controls → token layer → the dice icon, or
- From a macro / console: `game.modules.get("foundry-cpr-rollboards").api.open()`

## License

MIT — see [LICENSE](LICENSE).
