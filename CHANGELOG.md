# Changelog

## 0.3.1 — Recipe library is browsable; sample import auto-places the Night Market tile

The 0.3.0 sample import created the Night Market generator recipe but it was invisible — recipes live in a world setting that had no UI to browse, so the GM never saw the master tile.

- **`Recipes…` toolbar button** opens the recipe library dialog. Lists every recipe (name + step count) with three per-row buttons:
  - **Place on board** — drops a tile for that recipe onto the active board (refuses if already present, refuses if no active board with a clear message).
  - **Open in editor** — jumps straight into the recipe editor.
  - **Delete** — removes the recipe AND every tile referencing it on every board (with confirm).
- **Sample import auto-places the Night Market tile** on the active board if there is one, finding a non-overlapping starting position. If no board exists, it tells you to make one first.
- New `findOpenTilePosition` helper scans a 10×10 grid and lands on the first empty cell so auto-placed tiles don't sit on top of each other.

## 0.3.0 — Switch steps · unique rolls · random count formulas · Night Market generator

Engine extension to express the Cyberpunk RED Night Market generator (corebook pp. 337-339) as a single fully-automated recipe. New step concepts:

### Engine

- **`kind: "switch"` step type.** A switch step doesn't roll a table itself. Instead it picks ONE child branch by matching the parent step's rolled text against each branch's `matches` field, and runs that branch in place. Maps directly to corebook procedures like *"depending on which category came up, roll on a different sub-table"*.
- **`matches` field** on every step. Used only when the step is nested under a switch — case-insensitive substring of the parent's rolled text. `*` or empty = fallback (matches anything; used when no other branch hits).
- **`unique: true` flag.** When a step rolls multiple times, re-roll on duplicates within the same parent. Maps to the corebook's *"if you roll the same result twice, reroll until you get a different result"* rule. Has a 24-roll retry budget per slot.
- **`countMode: "random"` + `countFormula`.** A step's count can be a dice expression evaluated at roll time (e.g. `1d10`). Joins the existing `fixed` / `prompt` modes.

### UI

- Step cards now have a **kind toggle** (`Normal` / `Switch — picks one branch by parent result`) at the top.
- Switch steps render with an orange-tinted background and a banner explaining the semantics; their fields collapse to just label + matches + branches list.
- Normal steps gain a **count-mode radio** (`Fixed` / `Prompt at roll time` / `Random (formula)`). Switching to Random reveals a `Count formula` text input.
- New **`Match parent result`** field on every step (only consulted when nested under a switch). Hint text explains when it's used.
- New **`Unique rolls (re-roll on duplicates)`** checkbox alongside Optional.

### Sample content — Night Market generator

- **Six new corebook tables** in the sample-tables import: `Categories (1d6)` plus five 1d100 item tables (`Food and Drugs`, `Personal Electronics`, `Weapons and Armor`, `Cyberware`, `Clothing and Fashionware`, `Survival Gear`). All entries verbatim from corebook pp. 338-339, with prices and quality tiers preserved.
- **One new pre-built recipe**: `"Cyberpunk RED — Night Market Generator"` — wires the corebook procedure end-to-end:
  - Step 1 — `Goods category` (1d6, count: 2, unique: true) — rolls two distinct categories from the categories table.
  - Step 2 (child of Step 1, `kind: switch`) — `On the shelves` — picks the matching items table by parent result text.
  - Branches under the switch — one per category, each with `count: 1d10`, `unique: true` to reproduce *"roll 1d10 to determine how many types of items, then roll d100 that many times, reroll on duplicates"*.
- The `Boards… → Import sample tables` button now creates all of the above in one click. Idempotent — re-running skips tables that already exist and the recipe if it already exists.

## 0.2.4 — Vertical form-style step cards; explicit "Add child step" button

The 0.2.3 horizontal step-card layout collapsed into a vertical stack of orphan elements under Foundry v13's CSS — the head row's drag handle, label input, and delete button stacked, and the controls row's count/chance fields stacked. The fight wasn't winnable with flex: Foundry forces `display: block` / `width: 100%` on form children somewhere up the cascade.

This release abandons the horizontal head row entirely. Step cards are now a **vertical form** with absolute-positioned drag handle (top-left) and delete button (top-right), and labelled form rows underneath. Layout-critical declarations use `!important` to overpower Foundry's defaults.

- **New step card layout** — vertically stacked form rows with `LABEL` above each input. Step name → Source → Roll count + Chance (2-col grid, collapses to 1 col under 480px) → toggles → children section.
- **Text colour fixed** — explicit `color: #fff` / `#ccc` / `#aaa` with `!important` so Foundry's defaults can't darken them. Backgrounds are `rgba(0, 0, 0, 0.4)` so the white text reads cleanly.
- **"Add child step" button** on every card — opens a picker dialog listing every world `RollTable` and adds the chosen one as a child. **Discoverable alternative to the drag-on-card semantic** which was confusing because the drag-target wasn't visible. Drag-drop still works for everyone who liked it.
- **Drag-drop semantics**, for the record (no shift modifier — that was never wired):
  - Drop on **canvas** (empty board) → new tile (root recipe)
  - Drop on an **existing tile** → chains a sibling root step into that recipe
  - Drop on a **step card in the editor** → nests as a child of that step
  - Drop on the **drop lane** at the bottom of the editor → sibling root step
  - Or just click **+ Add child step** on any card.

## 0.2.3 — Full-width recipe editor; sample roll tables import

The 0.2.0 cramped 360px side-panel inspector is replaced by a **full-width editor view** that takes over the canvas area while editing. Step cards are substantial blocks with proper form layout instead of a single row of icons crammed shoulder-to-shoulder.

- **Step cards** — each step is its own bordered card with three sections:
  1. Head row: drag handle · table-name input (full-width, editable) · delete ×
  2. Source row: shows the actual `RollTable` source as link-text (resolved from uuid)
  3. Controls row: clearly labelled `Roll [N] time(s)`, `Chance [N]%`, `☐ Prompt for count`, `☐ Optional` — with proper labels above each input, not just naked icons.
- **Children indented** with a left accent bar inside the parent card. Recipe trees are visually obvious.
- **Drop lane** at the bottom of the editor: drop a roll table there to add a sibling root step. Drop directly on a step card to nest as a child of that step.
- **Reorder** by dragging the step card's head bar (the gray strip at the top) onto another card.
- **Editor toolbar mode** — the top toolbar swaps in editor mode: a "Back to board" button replaces Roll-all/Boards, and the recipe name input lives there at substantial width. No more the 360px-input squeeze.
- **CSS specificity hardened** so Foundry v13's input/checkbox/button defaults can't squash the layout.

### Sample roll tables import

- New "Import sample tables" button in the **Boards…** dialog. One click creates 5 CPR-themed roll tables in the world's roll-table directory:
  - CPR — NPC Archetype
  - CPR — NPC Quirk
  - CPR — Random Job / Hustle
  - CPR — Gang Type
  - CPR — Encounter Hook
- Idempotent on the per-name level: re-running skips tables that already exist.
- Source: [`scripts/sample-tables.mjs`](scripts/sample-tables.mjs). Edit there if you want to add more.

## 0.2.2 — Restore scene-controls opener; v13-compatible sidebar hook

The 0.2.0 refactor removed the d20 button from the Scene Controls layer, leaving only the Roll Tables sidebar header button as an opener. In Foundry v13 the sidebar was rewritten as ApplicationV2 components and the old `renderRollTableDirectory` hook may not fire — so a v13 GM ended up with the module loaded but no UI affordance to open it.

- **Restored the scene-controls d20 button.** Always-on opener; works on v12 and v13. Handler accepts both the v12 array-of-records shape and the v13 object-keyed-by-name shape for the `controls` argument.
- **Sidebar opener now binds to both `renderRollTableDirectory` (v12) and `renderRollTables` (v13)** so it fires regardless of which Foundry version is in use.
- Header-element search broadened to also accept `header` (newer sidebar markup) as a fallback.

## 0.2.1 — Fix release workflow: strip "v" prefix from version

Every release before this (0.1.0, 0.1.1, 0.2.0) shipped a `module.json` with `"version": "vX.Y.Z"` because the GitHub Actions workflow substituted the git tag name verbatim. Foundry's manifest validator rejects non-semver version strings, so the module installed but didn't appear in the module list — silent failure.

Fixed by stripping the leading `v` before the variable substitution in `.github/workflows/release.yml`. No source code changes; this is purely a packaging fix.

If you have any 0.1.x or 0.2.0 install on a GM machine, uninstall and reinstall from the v0.2.1 manifest URL.

## 0.2.0 — Boards model + redesigned inspector (BREAKING)

Rip-and-replace of the macro-dashboards-inherited scene/preset architecture, which never made sense for recipes. Recipes are themselves the named persistent thing — wrapping them in tiles inside scenes inside presets gave four levels of organisation for what should be two.

- **Boards replace scene-tabs.** Boards are user-created, named, scene-independent. Stored in a single world setting `boards: {[id]: {id, name, showNames, tiles, sort, createdAt, updatedAt}}`. Tab strip has a `+` button to create a new board inline.
- **Presets removed.** Boards themselves serve the same purpose — if you want a "starter encounter" layout, save it as its own board.
- **Scenes…, Save preset, Import preset, Manage presets buttons removed.** Replaced by a single `Boards…` button (manage / rename / delete) plus the `+` tab button (create).
- **`getSceneControlButtons` opener removed.** The Roll Tables sidebar header button is the natural opener.
- **Scene-watching hooks removed** (`createScene` / `updateScene` / `deleteScene`).
- **Inspector step rows redesigned.** Two-row layout per step:
  - Top row: drag handle · table-name input (full width) · delete ×
  - Bottom row (smaller, muted): count · chance % · prompt toggle · optional toggle
  - Default values (count=1, chance=100%) are visually quiet so a clean recipe looks calm.
  - The label input now actually shows the **table's resolved name** (fetched async on render) instead of a `uuid: cGU…` debug stub. The hover tooltip on the label reveals the source table.
  - Empty-state placeholder when a recipe has no steps.
- **Settings storage cleanup.** Drops `selectedScenes` and `presets` settings; drops the per-scene `dashboard` flag. Existing data in those locations is left in the world but no longer read — Foundry just ignores it.

### Migration

Recipes are preserved (they live in the recipe library setting, untouched). Existing scene-flag tile placements are dropped — re-create your boards via the `+` tab button. Recipes drag-drop back onto the new boards just as before.

## 0.1.1 — CPR pack data verified against source

Fixes three lurking bugs in the v0.1.0 Mook generator caused by guessed-not-verified data:

- **Pack ids**: skills are at `cyberpunk-red-core.internal_skills` (different group prefix than the gear packs). The previous `cyberpunk-red-core.skills` / `cyberpunk-red-core.core_skills` candidates would never resolve. Roles, weapons, armor, and cyberware now use their verified single ids.
- **`activeRole` value shape**: the CPR system stores the role's *name* (e.g. `"Solo"`) in `system.roleInfo.activeRole`, not a lowercase id. v0.1.0 was writing `"solo"` which the role-update hook would never recognise. `ROLES` is now a flat list of canonical names.
- **Armor split**: armor in CPR is split into Body/Head locations (`Light Armorjack (Body)` + `Light Armorjack (Head)`). v0.1.0 looked up `"Light Armorjack"` which doesn't exist as a single entry. Each archetype now embeds both pieces.
- **Booster gets Poor-quality gear** (`Heavy Pistol (Poor)`, `Medium Melee (Poor)`) and `Rippers` cyberware — actually appropriate for a gang grunt.
- **Solo gets Sandevistan / Kerenzikov / Cybereye + Targeting Scope / Subdermal Armor**, all canonical cyberware names.
- **Tech gets Cyberaudio Suite + Interface Plugs + Tool Hand**.

All gear and skill names verified against the cyberpunk-red-core `dev` branch yaml source.

## 0.1.0 — CPR Mook generator

- **Make Actor** button on every drawer result row, when the active system is `cyberpunk-red-core`. Opens the Mook dialog seeded with the rolled NPC name and a structured notes summary of the parent rolls.
- **Mook archetypes**: Booster (gang grunt), Tech (gang specialist), Solo (combat specialist), Generic NPC. Each ships with a stat block, suggested role, and an inline skill package.
- **Compendium item embedding**: skills, role, weapons, armor, and cyberware are pulled from the cyberpunk-red-core compendiums when present (multiple pack-id candidates probed). Missing items are skipped silently — the Actor is always created with stats + role + a usable skill set, never a hard failure.
- **Place token**: dialog has both "Create" and "Create + place token" buttons; the latter drops a hostile-disposition token at the centre of the active scene's view.

## 0.0.2 — Chained recipes + inspector + Roll-all

- **Chained recipes** are now buildable through the UI:
  - Drop a roll table on the canvas → new tile (single-step recipe).
  - Drop a roll table onto an existing tile → appends as a new root step (chains).
  - Drop a roll table on a step row in the inspector → adds as a child of that step.
- **Recipe inspector** side panel: per-step inline label, count, chance %, prompt-mode toggle, optional flag, delete button. Drag-reorder steps within the tree by their handle. Auto-saves on every change. Open via the pencil icon on any tile.
- **Right-click a tile** → quick popup with count/chance edits (for one-step recipes) and shortcuts to open the inspector or delete the tile.
- **Roll-all** toolbar button + `Ctrl+Enter` keybind that fires every tile on the current tab in placement order, streaming separate cards into the drawer.
- **Prompt-mode counts**: marking a step as "prompt" causes a count dialog to appear at roll time (one combined dialog covering every prompt-mode step in the recipe).
- Tile **step-count badge** in the bottom-right when a recipe has more than one step.
- Tile **drop highlight** while dragging a roll table over an existing tile, distinguishing chain-this-recipe from create-new-tile.

## 0.0.1 — Initial scaffold

- Module skeleton: manifest, settings, hooks, sidebar + scene-controls openers.
- Dashboard window with per-scene tabs and the macro-dashboards-style canvas.
- Drag a RollTable from the sidebar onto the canvas to create a single-step tile.
- Click a tile to roll its recipe; results appear in the in-module drawer (no chat spam).
- Per-result actions: dismiss, send to chat, re-roll the card.
- Save / Import / Manage presets (per-tab tile snapshots).
- Drag-reposition tiles, hover-delete, show-names toggle.
