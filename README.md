# CPR Rollboards

A GM-only Foundry VTT module that gives chained roll tables their own dashboard. Drag any `RollTable` onto a canvas tile, click to roll, see results in an in-module drawer instead of global chat. Recipes can chain — roll an organisation, then roll its members, then optionally roll a quirk for each — and you build them by dragging tables together rather than writing code. When the [`cyberpunk-red-core`](https://gitlab.com/cyberpunk-red-team/fvtt-cyberpunk-red-core) system is active, individual NPC results get a one-click **Make Actor** button that produces a drop-ready Mook with stats, role, and a starter skill package.

## Concepts

- **Recipe** — a named tree of steps. Each step references one RollTable plus a count, a chance %, an optional flag, a count mode (fixed vs prompt), and may have child steps that fire once per parent result. Stored globally; reusable across boards.
- **Tile** — a placement of a recipe on a board.
- **Board** — a named tab on the dashboard. User-created, scene-independent. The GM creates as many as they want and groups recipes however they prefer ("Combat Zone tables", "Corpo NPCs", "Quick spawns").
- **Card** — one click of a tile produces one card in the drawer, mirroring the recipe's step tree. Per-card actions: re-roll, send-everything-to-chat, dismiss. Per-result actions: send-to-chat, Make Actor (CPR only).

## Highlights

- **User-named boards** — no scene coupling. Click `+` in the tab strip to make a new board; `Boards…` to rename or delete.
- **Drag-drop recipe building** — drop a roll table on the canvas to make a tile; drop on an existing tile to chain a sibling root step; drop on a step row in the inspector to nest it as a child.
- **Recipe inspector** with a clean two-row step layout — table-name input + delete on top, count / chance / prompt-mode / optional underneath. Default values are visually muted so a simple recipe looks simple. Auto-saves on every change.
- **Right-click any tile** — popup with count/chance edits for one-step recipes plus open-inspector and delete-tile.
- **Roll-all** — toolbar button + `Ctrl+Enter` keybind that fires every tile on the active board in placement order.
- **Prompt-mode counts** — mark a step as prompt and a single combined dialog asks the GM at roll time.
- **Per-step `chance` %** — covers the "some of them have a quirk" pattern without needing a "no quirk" entry on the table.
- **In-module results drawer** instead of global chat. Send to chat is opt-in per result.
- **CPR Mook generator** — only loads when `cyberpunk-red-core` is the active system. Four archetype templates (Booster / Tech / Solo / Generic), all gear names verified against the system's compendium yaml source.

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

## Install

This is a private module. Install via Foundry's **Setup → Install Module → Manifest URL**:

```
https://github.com/VebjornNyvoll/foundry-cpr-rollboards/releases/latest/download/module.json
```

For live development, symlink the working tree (Windows `cmd`):

```
mklink /D "%LOCALAPPDATA%\FoundryVTT\Data\modules\foundry-cpr-rollboards" "C:\dev\projects\foundry-cpr-rollboards"
```

Open the dashboard from the Roll Tables sidebar header button (or `game.modules.get("foundry-cpr-rollboards").api.open()`). GM-only — non-GM users see no UI.

## Foundry compatibility

`{ minimum: 12, verified: 12, maximum: 14 }`. Built on ApplicationV2 + HandlebarsApplicationMixin which work in v12 and v13.

## CPR Mook generator

When the `cyberpunk-red-core` system is active, every drawer result row gets a 👤 button. Pick archetype + role, optionally place a token, done. Pack ids and gear names are verified against the [`cyberpunk-red-core` `dev` branch yaml source](https://gitlab.com/cyberpunk-red-team/fvtt-cyberpunk-red-core/-/tree/dev/src/packs):

- skills → `cyberpunk-red-core.internal_skills`
- roles → `cyberpunk-red-core.core_roles`
- weapons → `cyberpunk-red-core.core_weapons`
- armor → `cyberpunk-red-core.core_armor`
- cyberware → `cyberpunk-red-core.core_cyberware`

`system.roleInfo.activeRole` stores the role's name verbatim (e.g. `"Solo"`), matching the system's `update-role-from-item` hook.

## License

MIT — see [LICENSE](LICENSE).
