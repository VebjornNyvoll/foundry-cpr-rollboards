# Changelog

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
