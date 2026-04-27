# Changelog

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
