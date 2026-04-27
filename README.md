# CPR Rollboards

A GM-only Foundry VTT module that gives chained roll tables their own dashboard. Drag any `RollTable` onto a canvas tile, click to roll, see results in an in-module drawer instead of global chat. Recipes can chain — roll an organisation, then roll its members, then optionally roll a quirk for each — and you build them by dragging tables together rather than writing code. When the [`cyberpunk-red-core`](https://gitlab.com/cyberpunk-red-team/fvtt-cyberpunk-red-core) system is active, individual NPC results get a one-click **Make Actor** button that produces a drop-ready Mook with stats, role, and a starter skill package.

Sister module to [foundry-macro-dashboards](https://github.com/VebjornNyvoll/foundry-macro-dashboards): same per-scene tab + free-positioning canvas + presets pattern, with tiles that fire roll-table recipes instead of macros.

## Highlights

- **Tabbed dashboard** — one tab per selected scene. The Scenes… picker is the same one you have in macro-dashboards.
- **Drag-drop recipe building** — drop a roll table onto the canvas to make a tile; drop another onto an existing tile to chain it as a sibling root step; drop on a step row in the inspector to nest it as a child.
- **Recipe inspector** side panel — per-step inline label, count, chance %, prompt-mode toggle, optional flag, drag-handle reorder, delete. Auto-saves on every change. Open via the pencil icon on any tile.
- **Right-click any tile** — quick popup with count/chance edits for one-step recipes plus shortcuts to open the inspector or delete the tile.
- **Roll-all** — toolbar button + `Ctrl+Enter` keybind; rolls every tile on the current tab in placement order, streaming separate cards into the drawer.
- **Results drawer** — scrolling list of cards, no global chat unless you press the chat icon. Per-card actions (re-roll, send-everything-to-chat, dismiss); per-result actions (send-to-chat, Make Actor on CPR).
- **Prompt-mode counts** — mark any step as "prompt" and a single combined dialog appears at roll time, asking how many of each prompt-mode step to roll.
- **Per-step `chance` %** — covers the "some of them have a quirk" pattern without needing a "no quirk" entry on the table itself.
- **Save / Import / Manage presets** — per-tab tile-layout snapshots, scoped to the world.
- **CPR Mook generator** — only loads when `cyberpunk-red-core` is the active system. Four archetype templates (Booster / Tech / Solo / Generic), tries to fetch role + skills + weapons + armor + cyberware from the system compendiums and falls back gracefully if a pack is missing. Optional one-click token placement on the active scene.

## How a chained recipe is built (≈10 seconds)

The canonical "gang of N members with a job and sometimes a quirk" flow:

1. Drag the **Gang Type** roll table from the sidebar onto the canvas → instant tile, recipe inspector opens.
2. Drag **NPC Archetype** onto the *Gang Type* row in the inspector → adds as a child step.
3. Click NPC's `× 1`, type `6`, enter → six NPCs per gang.
4. Drag **Job** onto the *NPC* row → child of NPC.
5. Drag **Quirk** onto the *NPC* row → child of NPC.
6. Set Quirk's chance to `60` → 60% of NPCs get a quirk, the rest are skipped.

Click the tile. Drawer card:

```
Gang Type: Maelstrom
  ▾ NPC 1: Booster   [Make Actor]
      Job: Bouncer at Totentanz
      Quirk: Twitchy under bright lights
  ▾ NPC 2: Tech      [Make Actor]
      Job: Cyberware mod runner
      (Quirk skipped — chance roll missed)
  …
```

## Install (manual)

This is a private module. Symlink or copy the repository into your Foundry `Data/modules/foundry-cpr-rollboards/`, then enable it in the world. GM-only — non-GM users see no UI.

Quick symlink on Windows (run from a regular `cmd`):

```
mklink /D "%LOCALAPPDATA%\FoundryVTT\Data\modules\foundry-cpr-rollboards" "C:\dev\projects\foundry-cpr-rollboards"
```

## Open the dashboard

- Roll Tables sidebar → header button **"CPR Rollboards"**, or
- Scene Controls → token layer → the d20 icon, or
- From a macro / console: `game.modules.get("foundry-cpr-rollboards").api.open()`

## Foundry compatibility

`{ minimum: 12, verified: 12, maximum: 14 }`. Built with ApplicationV2 + HandlebarsApplicationMixin which work in v12 and v13; the action-map style is forward-compatible with v14.

## CPR Mook generator notes

The Mook generator probes these pack ids (first match wins):

- `cyberpunk-red-core.skills` / `cyberpunk-red-core.core_skills`
- `cyberpunk-red-core.roles` / `cyberpunk-red-core.core_roles`
- `cyberpunk-red-core.weapons` / `cyberpunk-red-core.core_weapons`
- `cyberpunk-red-core.armor` / `cyberpunk-red-core.core_armor`
- `cyberpunk-red-core.cyberware` / `cyberpunk-red-core.core_cyberware`

If your CPR install names them differently, edit `CPR_PACKS` at the top of [`scripts/cpr-mook.mjs`](scripts/cpr-mook.mjs). Skills always create as inline items if the compendium isn't found, so the Actor is always usable.

## License

MIT — see [LICENSE](LICENSE).
