/**
 * RollboardDashboard — GM-only rollboard window.
 *
 * One window. One tab per user-named board. Each board is a free-positioning
 * canvas of recipe tiles. Clicking a tile rolls its recipe and a card lands
 * in the drawer at the bottom of the window. No global chat spam.
 *
 * Persistence:
 *   game.settings("foundry-cpr-rollboards", "boards")
 *     → { [id]: { id, name, showNames, tiles: [{recipeId, x, y}],
 *                 sort, createdAt, updatedAt } }
 *   game.settings("foundry-cpr-rollboards", "recipes")
 *     → { [id]: Recipe }
 *
 * Roll history (drawer cards) lives in module memory on the singleton —
 * session-scoped, cleared on window close.
 */

import {
  MODULE_ID,
  I18N_NS,
  TILE_SIZE,
  NAME_HEIGHT,
  DRAG_THRESHOLD,
  CANVAS_PADDING,
  MAX_DRAW_HISTORY
} from "./constants.mjs";

import {
  readBoards,
  listBoards,
  getBoard,
  upsertBoard,
  deleteBoard,
  makeBoard
} from "./boards.mjs";

import {
  readRecipes,
  upsertRecipe,
  getRecipe,
  recipeFromTable,
  makeStep,
  countSteps,
  findStep,
  addStep,
  removeStep,
  moveStep,
  DEFAULT_TILE_ICON
} from "./recipes.mjs";

import { rollRecipe } from "./engine.mjs";
import { isCprActive, openMookDialog } from "./cpr-mook.mjs";
import { importSampleTables } from "./sample-tables.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

function L(key) { return game.i18n.localize(`${I18N_NS}.${key}`); }
function F(key, data) { return game.i18n.format(`${I18N_NS}.${key}`, data); }
function esc(s) { return Handlebars.escapeExpression(String(s ?? "")); }

/** Strip HTML tags from a roll-table result so we can use it as a name/notes seed. */
function stripTags(html) {
  if (!html) return "";
  const div = document.createElement("div");
  div.innerHTML = String(html);
  return (div.textContent ?? "").replace(/\s+/g, " ").trim();
}

export class RollboardDashboard extends HandlebarsApplicationMixin(ApplicationV2) {
  /** @type {string|null} currently active board id */
  #activeBoardId = null;

  /** @type {ResizeObserver|null} */
  #resizeObserver = null;

  /** @type {boolean} drawer toggled state, session-scoped */
  #drawerOpen = true;

  /** @type {Array<object>} card history, newest first, capped at MAX_DRAW_HISTORY */
  #draws = [];

  /** @type {string|null} recipe id currently shown in the inspector */
  #editingRecipeId = null;

  /** @type {HTMLElement|null} active right-click popup, if any */
  #popupEl = null;

  /** @type {Map<string,string>} cache of resolved table names by uuid (per render) */
  #tableNameCache = new Map();

  static DEFAULT_OPTIONS = {
    id: "foundry-cpr-rollboards-app",
    classes: ["foundry-cpr-rollboards"],
    tag: "div",
    window: {
      title: `${I18N_NS}.windowTitle`,
      icon: "fas fa-dice-d20",
      resizable: true
    },
    position: { width: 1100, height: 760 },
    actions: {
      selectTab: RollboardDashboard.#onSelectTab,
      toggleNames: RollboardDashboard.#onToggleNames,
      rollTile: RollboardDashboard.#onRollTile,
      editTile: RollboardDashboard.#onEditTile,
      deleteTile: RollboardDashboard.#onDeleteTile,
      rollAll: RollboardDashboard.#onRollAll,
      closeInspector: RollboardDashboard.#onCloseInspector,
      openBoardsManager: RollboardDashboard.#onOpenBoardsManager,
      newBoard: RollboardDashboard.#onNewBoard,
      toggleDrawer: RollboardDashboard.#onToggleDrawer,
      clearDraws: RollboardDashboard.#onClearDraws
    }
  };

  static PARTS = {
    body: {
      template: `modules/${MODULE_ID}/templates/rollboards.hbs`,
      scrollable: [".fcr-canvas-scroll", ".fcr-drawer-body", ".fcr-inspector-tree"]
    }
  };

  /* -------------------------------------------- */
  /*  Context                                     */
  /* -------------------------------------------- */

  async _prepareContext(options) {
    const boards = listBoards();

    // Reset active board if it was deleted.
    if (this.#activeBoardId && !boards.some((b) => b.id === this.#activeBoardId)) {
      this.#activeBoardId = null;
    }
    // Default active board: first one if no current selection.
    if (!this.#activeBoardId && boards.length) {
      this.#activeBoardId = boards[0].id;
    }

    const activeBoard = getBoard(this.#activeBoardId);
    const recipes = readRecipes();

    const tiles = (activeBoard?.tiles ?? []).map((t) => {
      const recipe = recipes[t.recipeId];
      const stepCount = recipe ? countSteps(recipe) : 0;
      return {
        recipeId: t.recipeId,
        x: Number.isFinite(t.x) ? Math.max(0, t.x) : 0,
        y: Number.isFinite(t.y) ? Math.max(0, t.y) : 0,
        name: recipe?.name ?? L("missingRecipe"),
        img: recipe?.icon ?? DEFAULT_TILE_ICON,
        missing: !recipe,
        stepCount: stepCount > 1 ? stepCount : 0,
        stepCountTooltip: stepCount > 1 ? `${stepCount} steps` : "",
        editing: !!recipe && recipe.id === this.#editingRecipeId
      };
    });

    // Drop the editing id if its recipe vanished.
    let inspectorOpen = false;
    let editingRecipeName = "";
    if (this.#editingRecipeId) {
      const editing = recipes[this.#editingRecipeId];
      if (editing) {
        inspectorOpen = true;
        editingRecipeName = editing.name ?? "";
      } else {
        this.#editingRecipeId = null;
      }
    }

    return {
      moduleId: MODULE_ID,
      tileSize: TILE_SIZE,
      nameHeight: NAME_HEIGHT,
      boards: boards.map((b) => ({
        id: b.id,
        name: b.name,
        active: b.id === this.#activeBoardId
      })),
      hasBoards: boards.length > 0,
      activeBoardId: this.#activeBoardId,
      showNames: activeBoard?.showNames !== false,
      tiles,
      canRollAll: !!activeBoard && tiles.length > 0,
      inspectorOpen,
      editingRecipeId: this.#editingRecipeId ?? "",
      editingRecipeName,
      drawerOpen: this.#drawerOpen,
      drawCount: this.#draws.length
    };
  }

  /* -------------------------------------------- */
  /*  Render hooks                                */
  /* -------------------------------------------- */

  _onRender(context, options) {
    super._onRender?.(context, options);
    const root = this.element;
    if (!root) return;

    const scroll = root.querySelector(".fcr-canvas-scroll");
    const canvas = root.querySelector(".fcr-canvas");
    if (canvas) this.#bindCanvas(canvas);
    if (scroll && canvas) {
      this.#syncCanvasSize(scroll, canvas);
      this.#resizeObserver?.disconnect();
      this.#resizeObserver = new ResizeObserver(() => this.#syncCanvasSize(scroll, canvas));
      this.#resizeObserver.observe(scroll);
    }

    if (this.#drawerOpen) this.#renderCards();
    if (this.#editingRecipeId) this.#renderEditor();
  }

  _onClose(options) {
    this.#resizeObserver?.disconnect();
    this.#resizeObserver = null;
    this.#dismissPopup();
    super._onClose?.(options);
  }

  #syncCanvasSize(scroll, canvas) {
    let maxX = 0;
    let maxY = 0;
    for (const tile of canvas.querySelectorAll(".fcr-tile")) {
      const x = parseFloat(tile.style.left) || 0;
      const y = parseFloat(tile.style.top) || 0;
      const h = tile.classList.contains("fcr-with-name") ? TILE_SIZE + NAME_HEIGHT : TILE_SIZE;
      if (x + TILE_SIZE > maxX) maxX = x + TILE_SIZE;
      if (y + h > maxY) maxY = y + h;
    }
    const viewW = scroll.clientWidth;
    const viewH = scroll.clientHeight;
    canvas.style.minWidth = `${Math.max(maxX + CANVAS_PADDING, viewW)}px`;
    canvas.style.minHeight = `${Math.max(maxY + CANVAS_PADDING, viewH)}px`;
  }

  #bindCanvas(canvas) {
    canvas.addEventListener("dragover", (event) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      const tile = event.target.closest(".fcr-tile");
      const previous = canvas.querySelector(".fcr-tile.fcr-tile-droptarget");
      if (previous && previous !== tile) previous.classList.remove("fcr-tile-droptarget");
      if (tile) tile.classList.add("fcr-tile-droptarget");
    });

    canvas.addEventListener("dragleave", (event) => {
      if (!event.relatedTarget || !canvas.contains(event.relatedTarget)) {
        canvas.querySelectorAll(".fcr-tile.fcr-tile-droptarget")
          .forEach((el) => el.classList.remove("fcr-tile-droptarget"));
      }
    });

    canvas.addEventListener("drop", (event) => {
      canvas.querySelectorAll(".fcr-tile.fcr-tile-droptarget")
        .forEach((el) => el.classList.remove("fcr-tile-droptarget"));
      this.#onCanvasDrop(event, canvas);
    });

    canvas.addEventListener("contextmenu", (event) => this.#onTileContextMenu(event, canvas));

    for (const tile of canvas.querySelectorAll(".fcr-tile")) {
      this.#bindTileDrag(tile, canvas);
    }
  }

  /* -------------------------------------------- */
  /*  Drop handler                                */
  /* -------------------------------------------- */

  async #onCanvasDrop(event, canvas) {
    event.preventDefault();

    let raw;
    try {
      raw = event.dataTransfer.getData("text/plain");
    } catch {
      return;
    }
    if (!raw) return;

    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      return;
    }

    if (payload?.type !== "RollTable") {
      ui.notifications.warn(L("onlyTables"));
      return;
    }

    const uuid = payload.uuid ?? (payload.id ? `RollTable.${payload.id}` : null);
    if (!uuid) return;

    const table = await fromUuid(uuid).catch(() => null);
    if (!table) {
      ui.notifications.warn(L("missingTable"));
      return;
    }

    const board = this.#currentBoard();
    if (!board) {
      ui.notifications.warn(L("noActiveBoard"));
      return;
    }

    // If the drop lands on an existing tile, append a step to that recipe
    // instead of creating a brand-new tile. This is how you build chains
    // by dragging tables together.
    const targetTile = event.target.closest(".fcr-tile");
    if (targetTile) {
      const recipeId = targetTile.dataset.recipeId;
      const recipe = getRecipe(recipeId);
      if (recipe) {
        addStep(recipe, null, makeStep({ tableUuid: table.uuid, label: table.name }));
        await upsertRecipe(recipe);
        this.#editingRecipeId = recipe.id;
        this.render(false);
        return;
      }
    }

    // Default: build a single-step recipe and place a new tile at the drop
    // point.
    const recipe = recipeFromTable(table);
    await upsertRecipe(recipe);

    const { x, y } = this.#clampToCanvas(canvas, event.clientX, event.clientY, true);
    board.tiles.push({ recipeId: recipe.id, x, y });
    await upsertBoard(board);
    this.render(false);
  }

  /* -------------------------------------------- */
  /*  Tile drag-reposition                        */
  /* -------------------------------------------- */

  #bindTileDrag(tile, canvas) {
    tile.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      if (event.target.closest(".fcr-tile-delete")) return;
      if (event.target.closest(".fcr-tile-edit")) return;

      const recipeId = tile.dataset.recipeId;
      const startX = event.clientX;
      const startY = event.clientY;
      const origLeft = parseFloat(tile.style.left) || 0;
      const origTop = parseFloat(tile.style.top) || 0;
      let moved = false;
      let captured = false;

      const onMove = (e) => {
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        if (!moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        if (!moved) {
          moved = true;
          tile.classList.add("fcr-dragging");
          try { tile.setPointerCapture(event.pointerId); captured = true; } catch {}
        }
        const nx = Math.max(0, origLeft + dx);
        const ny = Math.max(0, origTop + dy);
        tile.style.left = `${nx}px`;
        tile.style.top = `${ny}px`;
        this.#ensureCanvasFits(canvas, nx, ny);
      };

      const onUp = async () => {
        tile.removeEventListener("pointermove", onMove);
        tile.removeEventListener("pointerup", onUp);
        tile.removeEventListener("pointercancel", onUp);
        tile.classList.remove("fcr-dragging");
        if (captured) {
          try { tile.releasePointerCapture(event.pointerId); } catch {}
        }
        if (!moved) return;

        // Swallow the synthetic click queued by the browser after pointerup.
        tile.dataset.fcrSuppressClick = "1";

        const board = this.#currentBoard();
        if (!board) return;
        const entry = board.tiles.find((t) => t.recipeId === recipeId);
        if (!entry) return;
        entry.x = parseFloat(tile.style.left) || 0;
        entry.y = parseFloat(tile.style.top) || 0;
        await upsertBoard(board);
      };

      tile.addEventListener("pointermove", onMove);
      tile.addEventListener("pointerup", onUp);
      tile.addEventListener("pointercancel", onUp);
    });
  }

  #ensureCanvasFits(canvas, tileLeft, tileTop) {
    const needW = tileLeft + TILE_SIZE + CANVAS_PADDING;
    const needH = tileTop + TILE_SIZE + NAME_HEIGHT + CANVAS_PADDING;
    const curW = parseFloat(canvas.style.minWidth) || 0;
    const curH = parseFloat(canvas.style.minHeight) || 0;
    if (needW > curW) canvas.style.minWidth = `${needW}px`;
    if (needH > curH) canvas.style.minHeight = `${needH}px`;
  }

  /* -------------------------------------------- */
  /*  Action handlers                             */
  /* -------------------------------------------- */

  static async #onSelectTab(event, target) {
    event.preventDefault();
    const boardId = target.dataset.boardId;
    if (!boardId) return;
    this.#activeBoardId = boardId;
    this.render(false);
  }

  static async #onToggleNames(event, target) {
    const board = this.#currentBoard();
    if (!board) return;
    board.showNames = !!target.checked;
    await upsertBoard(board);
    this.render(false);
  }

  static async #onRollTile(event, target) {
    event.preventDefault();
    const tile = target.closest(".fcr-tile");
    if (tile?.dataset.fcrSuppressClick) {
      delete tile.dataset.fcrSuppressClick;
      return;
    }
    const recipeId = target.dataset.recipeId;
    if (!recipeId) return;
    const recipe = getRecipe(recipeId);
    if (!recipe) {
      ui.notifications.warn(L("missingRecipe"));
      return;
    }

    const counts = await this.#collectPromptCounts(recipe);
    if (counts === false) return;

    let card;
    try {
      card = await rollRecipe(recipe, {
        countOverride: (step) => counts?.[step.id]
      });
    } catch (err) {
      console.error(`${MODULE_ID} | rollRecipe failed`, err);
      ui.notifications.error(L("rollFailed"));
      return;
    }

    this.#draws.unshift(card);
    if (this.#draws.length > MAX_DRAW_HISTORY) {
      this.#draws.length = MAX_DRAW_HISTORY;
    }
    if (!this.#drawerOpen) this.#drawerOpen = true;
    this.render(false);
  }

  static async #onDeleteTile(event, target) {
    event.preventDefault();
    event.stopPropagation();
    const recipeId = target.dataset.recipeId;
    if (!recipeId) return;
    const board = this.#currentBoard();
    if (!board) return;
    board.tiles = board.tiles.filter((t) => t.recipeId !== recipeId);
    await upsertBoard(board);
    this.render(false);
  }

  static async #onToggleDrawer(event) {
    event.preventDefault();
    this.#drawerOpen = !this.#drawerOpen;
    this.render(false);
  }

  static async #onClearDraws(event) {
    event.preventDefault();
    if (!this.#draws.length) return;
    const ok = await Dialog.confirm({
      title: L("drawerClear"),
      content: `<p>${esc(L("drawerClearPrompt"))}</p>`,
      rejectClose: false
    });
    if (!ok) return;
    this.#draws = [];
    this.render(false);
  }

  static async #onEditTile(event, target) {
    event.preventDefault();
    event.stopPropagation();
    const recipeId = target.dataset.recipeId;
    if (!recipeId) return;
    if (!getRecipe(recipeId)) {
      ui.notifications.warn(L("missingRecipe"));
      return;
    }
    this.#editingRecipeId = recipeId;
    this.render(false);
  }

  static async #onCloseInspector(event) {
    event?.preventDefault?.();
    this.#editingRecipeId = null;
    this.render(false);
  }

  static async #onRollAll(event) {
    event?.preventDefault?.();
    return this.rollAllOnActiveBoard();
  }

  static async #onOpenBoardsManager(event) {
    event?.preventDefault?.();
    return this.#openBoardsManagerDialog();
  }

  static async #onNewBoard(event) {
    event?.preventDefault?.();
    return this.#promptNewBoard();
  }

  /**
   * Public entry point for the keybind in main.mjs.
   * Rolls every tile on the active board in placement order.
   */
  async rollAllOnActiveBoard() {
    const board = this.#currentBoard();
    if (!board) {
      ui.notifications.warn(L("noActiveBoard"));
      return;
    }
    if (!board.tiles.length) {
      ui.notifications.warn(L("rollAllNothing"));
      return;
    }

    const ordered = [...board.tiles].sort((a, b) => (a.y - b.y) || (a.x - b.x));
    let rolled = 0;
    for (const tile of ordered) {
      const recipe = getRecipe(tile.recipeId);
      if (!recipe) continue;
      const counts = await this.#collectPromptCounts(recipe);
      if (counts === false) continue;
      try {
        const card = await rollRecipe(recipe, {
          countOverride: (step) => counts?.[step.id]
        });
        this.#draws.unshift(card);
        rolled++;
      } catch (err) {
        console.error(`${MODULE_ID} | rollAll: rollRecipe failed`, err);
      }
    }
    if (this.#draws.length > MAX_DRAW_HISTORY) this.#draws.length = MAX_DRAW_HISTORY;
    if (rolled > 0 && !this.#drawerOpen) this.#drawerOpen = true;
    this.render(false);
  }

  async #collectPromptCounts(recipe) {
    const prompts = [];
    const walk = (steps) => {
      for (const s of steps ?? []) {
        if (s.countMode === "prompt") prompts.push(s);
        if (s.children?.length) walk(s.children);
      }
    };
    walk(recipe.steps);
    if (!prompts.length) return null;

    const rows = prompts.map((s) => `
      <div class="fcr-dialog-form">
        <label>${esc(F("step.promptTitle", { label: s.label || L("step.missingTable") }))}</label>
        <input type="number" name="${esc(s.id)}" min="1" value="${esc(String(s.count ?? 1))}" autofocus />
      </div>
    `).join("<hr />");

    return new Promise((resolve) => {
      new Dialog({
        title: L("step.promptLabel"),
        content: rows,
        buttons: {
          ok: {
            icon: '<i class="fas fa-check"></i>',
            label: L("save"),
            callback: (html) => {
              const root = html instanceof jQuery ? html[0] : html;
              const out = {};
              for (const s of prompts) {
                const v = Number(root.querySelector(`input[name="${s.id}"]`)?.value);
                out[s.id] = (Number.isFinite(v) && v > 0) ? Math.max(1, Math.floor(v)) : (s.count ?? 1);
              }
              resolve(out);
            }
          },
          cancel: {
            icon: '<i class="fas fa-times"></i>',
            label: L("cancel"),
            callback: () => resolve(false)
          }
        },
        default: "ok",
        close: () => resolve(false)
      }, { classes: ["foundry-cpr-rollboards", "dialog"] }).render(true);
    });
  }

  /* -------------------------------------------- */
  /*  Right-click popup                           */
  /* -------------------------------------------- */

  #onTileContextMenu(event, canvas) {
    const tileEl = event.target.closest(".fcr-tile");
    if (!tileEl) return;
    event.preventDefault();
    event.stopPropagation();
    const recipeId = tileEl.dataset.recipeId;
    const recipe = getRecipe(recipeId);
    if (!recipe) return;
    this.#showPopup(event.clientX, event.clientY, recipe);
  }

  #showPopup(clientX, clientY, recipe) {
    this.#dismissPopup();
    const root = this.element;
    if (!root) return;

    const rootRect = root.getBoundingClientRect();
    const x = clientX - rootRect.left;
    const y = clientY - rootRect.top;

    const onlyStep = (recipe.steps?.length === 1) ? recipe.steps[0] : null;

    const el = document.createElement("div");
    el.className = "fcr-popup";
    el.style.left = `${Math.max(0, x)}px`;
    el.style.top = `${Math.max(0, y)}px`;
    el.dataset.recipeId = recipe.id;

    const rows = [];
    if (onlyStep) {
      rows.push(`
        <div class="fcr-popup-row">
          <label for="fcr-popup-count">${esc(L("step.count"))}</label>
          <input id="fcr-popup-count" type="number" min="1" value="${esc(String(onlyStep.count ?? 1))}" data-popup-field="count" />
        </div>
        <div class="fcr-popup-row">
          <label for="fcr-popup-chance">${esc(L("step.chance"))}</label>
          <input id="fcr-popup-chance" type="number" min="1" max="100" value="${esc(String(onlyStep.chance ?? 100))}" data-popup-field="chance" />
        </div>`);
    }

    el.innerHTML = `
      <div class="fcr-popup-title" title="${esc(recipe.name)}">${esc(recipe.name)}</div>
      ${rows.join("")}
      <div class="fcr-popup-actions">
        <button type="button" class="fcr-btn" data-popup-action="inspector">
          <i class="fas fa-pen"></i> ${esc(L("popup.editInInspector"))}
        </button>
        <button type="button" class="fcr-btn" data-popup-action="delete">
          <i class="fas fa-times"></i> ${esc(L("popup.delete"))}
        </button>
      </div>`;
    root.appendChild(el);
    this.#popupEl = el;

    el.addEventListener("change", async (ev) => {
      const field = ev.target?.dataset?.popupField;
      if (!field || !onlyStep) return;
      const cur = getRecipe(recipe.id);
      if (!cur || !cur.steps?.[0]) return;
      const value = Number(ev.target.value);
      if (!Number.isFinite(value)) return;
      if (field === "count") cur.steps[0].count = Math.max(1, Math.floor(value));
      if (field === "chance") cur.steps[0].chance = Math.max(1, Math.min(100, Math.floor(value)));
      await upsertRecipe(cur);
    });

    el.addEventListener("click", async (ev) => {
      const btn = ev.target.closest("[data-popup-action]");
      if (!btn) return;
      const action = btn.dataset.popupAction;
      this.#dismissPopup();
      if (action === "inspector") {
        this.#editingRecipeId = recipe.id;
        this.render(false);
      } else if (action === "delete") {
        const ok = await Dialog.confirm({
          title: L("popup.delete"),
          content: `<p>${esc(F("popup.deleteConfirm", { name: recipe.name }))}</p>`,
          rejectClose: false
        });
        if (!ok) return;
        const board = this.#currentBoard();
        if (!board) return;
        board.tiles = board.tiles.filter((t) => t.recipeId !== recipe.id);
        await upsertBoard(board);
        this.render(false);
      }
    });

    setTimeout(() => {
      const onDocClick = (ev) => {
        if (!el.contains(ev.target)) {
          document.removeEventListener("mousedown", onDocClick);
          this.#dismissPopup();
        }
      };
      document.addEventListener("mousedown", onDocClick);
    }, 0);
  }

  #dismissPopup() {
    if (this.#popupEl?.parentNode) {
      this.#popupEl.parentNode.removeChild(this.#popupEl);
    }
    this.#popupEl = null;
  }

  /* -------------------------------------------- */
  /*  Editor (full-width recipe view)             */
  /* -------------------------------------------- */

  async #renderEditor() {
    const root = this.element;
    if (!root) return;
    const tree = root.querySelector(".fcr-editor-tree");
    if (!tree) return;
    const recipe = getRecipe(this.#editingRecipeId);
    if (!recipe) {
      tree.innerHTML = "";
      return;
    }

    this.#tableNameCache.clear();
    await this.#resolveTableNames(recipe.steps ?? []);

    const stepsHTML = (recipe.steps ?? []).map((s) => this.#renderStepCardHTML(s)).join("");
    const empty = !stepsHTML
      ? `<div class="fcr-editor-empty">${esc(L("editor.empty"))}</div>`
      : "";
    const dropZone = `
      <div class="fcr-editor-droplane" data-action-scope="droplane">
        <i class="fas fa-plus"></i>
        ${esc(L("editor.dropToAddRoot"))}
      </div>`;
    tree.innerHTML = empty + stepsHTML + dropZone;
    this.#bindEditor(tree, recipe);
  }

  async #resolveTableNames(steps) {
    for (const s of steps ?? []) {
      if (s.tableUuid && !this.#tableNameCache.has(s.tableUuid)) {
        try {
          const doc = await fromUuid(s.tableUuid);
          this.#tableNameCache.set(s.tableUuid, doc?.name ?? "");
        } catch {
          this.#tableNameCache.set(s.tableUuid, "");
        }
      }
      if (s.children?.length) await this.#resolveTableNames(s.children);
    }
  }

  #renderStepCardHTML(step) {
    const tableName = this.#tableNameCache.get(step.tableUuid) || "";
    const labelValue = step.label || tableName || "";
    const sourceText = tableName
      ? `${L("editor.sourceLabel")}: ${tableName}`
      : (step.tableUuid
        ? `${L("editor.sourceLabel")}: ${L("editor.sourceMissing")}`
        : L("editor.sourceNone"));
    const sourceClass = step.tableUuid ? "" : " fcr-step-card-source-missing";
    const optionalOn = !!step.optional;
    const promptOn = step.countMode === "prompt";
    const childrenHTML = (step.children ?? []).map((c) => this.#renderStepCardHTML(c)).join("");

    // Vertical form layout — handle/delete are absolute-positioned overlays so
    // we don't depend on a horizontal flex row that Foundry's CSS keeps
    // collapsing. Form rows use !important via the CSS to win specificity.
    return `
      <div class="fcr-step-card" data-step-id="${esc(step.id)}">
        <span class="fcr-step-card-handle" draggable="true"
              title="${esc(L("editor.dragHandle"))}">⋮⋮</span>
        <button type="button" class="fcr-step-card-delete" data-step-action="delete"
                title="${esc(L("editor.deleteStep"))}">
          <i class="fas fa-times"></i>
        </button>
        <div class="fcr-step-card-body">
          <div class="fcr-form-row">
            <label class="fcr-form-label">${esc(L("editor.stepName"))}</label>
            <input type="text" class="fcr-form-input fcr-form-input-text"
                   value="${esc(labelValue)}"
                   placeholder="${esc(L("editor.labelPlaceholder"))}"
                   data-step-field="label" />
          </div>
          <div class="fcr-step-card-source${sourceClass}">
            <i class="fas fa-link"></i>
            <span>${esc(sourceText)}</span>
          </div>
          <div class="fcr-form-grid">
            <div class="fcr-form-row">
              <label class="fcr-form-label">${esc(L("editor.rollCount"))}</label>
              <div class="fcr-input-group">
                <input type="number" class="fcr-form-input fcr-form-input-num" min="1"
                       value="${esc(String(step.count ?? 1))}"
                       data-step-field="count" />
                <span class="fcr-input-suffix">${esc(L("editor.times"))}</span>
              </div>
            </div>
            <div class="fcr-form-row">
              <label class="fcr-form-label">${esc(L("editor.chanceLabel"))}</label>
              <div class="fcr-input-group">
                <input type="number" class="fcr-form-input fcr-form-input-num" min="1" max="100"
                       value="${esc(String(step.chance ?? 100))}"
                       data-step-field="chance" />
                <span class="fcr-input-suffix">%</span>
              </div>
            </div>
          </div>
          <div class="fcr-form-toggles">
            <label class="fcr-form-toggle">
              <input type="checkbox" ${promptOn ? "checked" : ""}
                     data-step-toggle="prompt" />
              <span>${esc(L("editor.promptForCount"))}</span>
            </label>
            <label class="fcr-form-toggle">
              <input type="checkbox" ${optionalOn ? "checked" : ""}
                     data-step-toggle="optional" />
              <span>${esc(L("editor.optional"))}</span>
            </label>
          </div>
          <div class="fcr-step-card-children-section">
            <div class="fcr-step-card-children-header">
              <span class="fcr-step-card-children-label">${esc(L("editor.childrenLabel"))}</span>
              <button type="button" class="fcr-add-child-btn" data-step-action="addChild"
                      title="${esc(L("editor.addChildTooltip"))}">
                <i class="fas fa-plus"></i> ${esc(L("editor.addChildButton"))}
              </button>
            </div>
            ${childrenHTML
              ? `<div class="fcr-step-card-children">${childrenHTML}</div>`
              : ""}
          </div>
        </div>
      </div>`;
  }

  #bindEditor(tree, recipe) {
    // Inline edits — count/chance/label change handlers.
    tree.addEventListener("change", async (event) => {
      // Toggle checkboxes (prompt / optional).
      const toggle = event.target?.dataset?.stepToggle;
      if (toggle) {
        const stepEl = event.target.closest(".fcr-step-card");
        const stepId = stepEl?.dataset?.stepId;
        if (!stepId) return;
        const cur = getRecipe(recipe.id);
        const step = cur ? findStep(cur, stepId) : null;
        if (!step) return;
        if (toggle === "prompt") {
          step.countMode = event.target.checked ? "prompt" : "fixed";
        } else if (toggle === "optional") {
          step.optional = !!event.target.checked;
        }
        await upsertRecipe(cur);
        return;
      }

      const field = event.target?.dataset?.stepField;
      if (!field) return;
      const stepEl = event.target.closest(".fcr-step-card");
      const stepId = stepEl?.dataset?.stepId;
      if (!stepId) return;
      const cur = getRecipe(recipe.id);
      const step = cur ? findStep(cur, stepId) : null;
      if (!step) return;
      if (field === "label") {
        step.label = String(event.target.value ?? "").trim();
      } else if (field === "count") {
        step.count = Math.max(1, Math.floor(Number(event.target.value) || 1));
        event.target.value = String(step.count);
      } else if (field === "chance") {
        step.chance = Math.max(1, Math.min(100, Math.floor(Number(event.target.value) || 100)));
        event.target.value = String(step.chance);
      }
      await upsertRecipe(cur);
    });

    // Card actions: delete + add child step.
    tree.addEventListener("click", async (event) => {
      const actionBtn = event.target.closest("[data-step-action]");
      if (!actionBtn) return;
      event.preventDefault();
      event.stopPropagation();
      const stepEl = actionBtn.closest(".fcr-step-card");
      const stepId = stepEl?.dataset?.stepId;
      if (!stepId) return;
      const action = actionBtn.dataset.stepAction;
      const cur = getRecipe(recipe.id);
      const step = cur ? findStep(cur, stepId) : null;
      if (!step) return;
      if (action === "delete") {
        const hasChildren = (step.children?.length ?? 0) > 0;
        if (hasChildren) {
          const ok = await Dialog.confirm({
            title: L("editor.deleteStep"),
            content: `<p>${esc(F("editor.deleteConfirm", { name: step.label || L("editor.sourceMissing") }))}</p>`,
            rejectClose: false
          });
          if (!ok) return;
        }
        removeStep(cur, stepId);
        await upsertRecipe(cur);
        this.render(false);
      } else if (action === "addChild") {
        await this.#promptAddChildStep(stepId);
      }
    });

    // Drop handlers — child step on a card, root step on the drop lane,
    // internal reorder (drag the card head).
    tree.addEventListener("dragover", (event) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      // Highlight the most-specific drop target (a card OR the drop lane).
      const card = event.target.closest(".fcr-step-card");
      const lane = event.target.closest(".fcr-editor-droplane");
      tree.querySelectorAll(".fcr-step-card-drop-target, .fcr-editor-droplane-active")
        .forEach((el) => el.classList.remove("fcr-step-card-drop-target", "fcr-editor-droplane-active"));
      if (card) card.classList.add("fcr-step-card-drop-target");
      else if (lane) lane.classList.add("fcr-editor-droplane-active");
    });

    tree.addEventListener("dragleave", (event) => {
      if (!event.relatedTarget || !tree.contains(event.relatedTarget)) {
        tree.querySelectorAll(".fcr-step-card-drop-target, .fcr-editor-droplane-active")
          .forEach((el) => el.classList.remove("fcr-step-card-drop-target", "fcr-editor-droplane-active"));
      }
    });

    tree.addEventListener("drop", async (event) => {
      tree.querySelectorAll(".fcr-step-card-drop-target, .fcr-editor-droplane-active")
        .forEach((el) => el.classList.remove("fcr-step-card-drop-target", "fcr-editor-droplane-active"));

      const targetCard = event.target.closest(".fcr-step-card");
      const targetLane = event.target.closest(".fcr-editor-droplane");
      if (!targetCard && !targetLane) return;

      const targetStepId = targetCard?.dataset?.stepId ?? null;

      // Internal reorder (a step card head was dragged onto a target).
      const internalId = event.dataTransfer.getData("application/x-fcr-step");
      if (internalId) {
        event.preventDefault();
        if (internalId === targetStepId) return;
        const cur = getRecipe(recipe.id);
        if (!cur) return;
        const ok = moveStep(cur, internalId, targetStepId, undefined);
        if (ok) {
          await upsertRecipe(cur);
          this.render(false);
        }
        return;
      }

      // External drop — a RollTable from the sidebar.
      let payload;
      try {
        payload = JSON.parse(event.dataTransfer.getData("text/plain"));
      } catch {
        return;
      }
      if (payload?.type !== "RollTable") return;
      event.preventDefault();
      const uuid = payload.uuid ?? (payload.id ? `RollTable.${payload.id}` : null);
      if (!uuid) return;
      const table = await fromUuid(uuid).catch(() => null);
      if (!table) {
        ui.notifications.warn(L("missingTable"));
        return;
      }
      const cur = getRecipe(recipe.id);
      if (!cur) return;
      addStep(cur, targetStepId, makeStep({ tableUuid: uuid, label: table.name }));
      await upsertRecipe(cur);
      this.render(false);
    });

    // Internal drag of a step (via the small ⋮⋮ handle) for reorder.
    tree.querySelectorAll(".fcr-step-card-handle[draggable=true]").forEach((handle) => {
      handle.addEventListener("dragstart", (event) => {
        const id = handle.closest(".fcr-step-card")?.dataset?.stepId;
        if (!id) return;
        event.dataTransfer.setData("application/x-fcr-step", id);
        event.dataTransfer.effectAllowed = "move";
        handle.closest(".fcr-step-card")?.classList.add("fcr-step-card-dragging");
      });
      handle.addEventListener("dragend", () => {
        handle.closest(".fcr-step-card")?.classList.remove("fcr-step-card-dragging");
      });
    });

    // Recipe-name input change handler — bind once per render.
    const rootEl = this.element;
    const nameInput = rootEl?.querySelector(".fcr-editor-name");
    if (nameInput && !nameInput.dataset.fcrBound) {
      nameInput.dataset.fcrBound = "1";
      nameInput.addEventListener("change", async () => {
        const cur = getRecipe(recipe.id);
        if (!cur) return;
        const value = String(nameInput.value ?? "").trim() || cur.name;
        cur.name = value;
        await upsertRecipe(cur);
        this.render(false);
      });
    }
  }

  /**
   * Open a picker dialog listing every world RollTable. Picking one adds it
   * as a child of the given step. Discoverable alternative to drag-drop —
   * the GM no longer has to know which area accepts a child drop.
   */
  async #promptAddChildStep(parentStepId) {
    const tables = Array.from(game.tables ?? [])
      .sort((a, b) => a.name.localeCompare(b.name));
    if (!tables.length) {
      ui.notifications.warn(L("editor.noTables"));
      return;
    }
    const options = tables.map((t) =>
      `<option value="${esc(t.uuid)}">${esc(t.name)}</option>`
    ).join("");

    const tableUuid = await Dialog.prompt({
      title: L("editor.pickTableTitle"),
      content: `
        <div class="fcr-dialog-form">
          <p class="fcr-dialog-hint">${esc(L("editor.pickTableHint"))}</p>
          <label>${esc(L("editor.pickTableLabel"))}</label>
          <select name="table" autofocus>${options}</select>
        </div>`,
      label: L("editor.add"),
      callback: (h) => {
        const r = h instanceof jQuery ? h[0] : h;
        return r.querySelector("select[name=table]")?.value;
      },
      rejectClose: false,
      options: { classes: ["foundry-cpr-rollboards", "dialog"] }
    });

    if (!tableUuid) return;
    const table = await fromUuid(tableUuid).catch(() => null);
    if (!table) {
      ui.notifications.warn(L("missingTable"));
      return;
    }
    const cur = getRecipe(this.#editingRecipeId);
    if (!cur) return;
    addStep(cur, parentStepId, makeStep({ tableUuid, label: table.name }));
    await upsertRecipe(cur);
    this.render(false);
  }

  /* -------------------------------------------- */
  /*  Drawer rendering                            */
  /* -------------------------------------------- */

  #renderCards() {
    const root = this.element;
    if (!root) return;
    const container = root.querySelector(".fcr-cards");
    if (!container) return;
    container.innerHTML = this.#draws.map((card) => this.#renderCardHTML(card)).join("");
    this.#bindCardInteractions(container);
  }

  #renderCardHTML(card) {
    const time = new Date(card.timestamp).toLocaleTimeString();
    const body = card.nodes.map((n) => this.#renderNodeHTML(n)).join("");
    return `
      <div class="fcr-card" data-card-id="${esc(card.id)}">
        <div class="fcr-card-header">
          <span class="fcr-card-title" title="${esc(card.recipeName)}">${esc(card.recipeName)}</span>
          <span class="fcr-card-time">${esc(time)}</span>
          <button type="button" class="fcr-card-action" data-card-action="reroll"
                  title="${esc(L("card.reroll"))}"><i class="fas fa-rotate-right"></i></button>
          <button type="button" class="fcr-card-action" data-card-action="toChat"
                  title="${esc(L("card.toChat"))}"><i class="fas fa-comment"></i></button>
          <button type="button" class="fcr-card-action" data-card-action="dismiss"
                  title="${esc(L("card.dismiss"))}"><i class="fas fa-times"></i></button>
        </div>
        <div class="fcr-card-body">
          ${body || `<div class="fcr-node-skipped">${esc(L("result.empty"))}</div>`}
        </div>
      </div>`;
  }

  #renderNodeHTML(node) {
    const labelHTML = node.stepLabel
      ? `<span class="fcr-node-label">${esc(node.stepLabel)}:</span>`
      : "";
    let textHTML;
    if (node.skipped) {
      textHTML = `<span class="fcr-node-text fcr-node-skipped">${esc(L("result.skipped"))}</span>`;
    } else if (node.result?.missing) {
      textHTML = `<span class="fcr-node-text fcr-node-skipped">${esc(L("missingTable"))}</span>`;
    } else if (node.result?.empty) {
      textHTML = `<span class="fcr-node-text fcr-node-skipped">${esc(L("result.empty"))}</span>`;
    } else {
      textHTML = `<span class="fcr-node-text">${node.result?.text ?? ""}</span>`;
    }

    const mookBtn = (!node.skipped && isCprActive())
      ? `<button type="button" class="fcr-node-action" data-node-action="mook" data-node-id="${esc(node.id)}"
                title="${esc(L("mook.buttonTooltip"))}"><i class="fas fa-user-plus"></i></button>`
      : "";
    const actions = node.skipped ? "" : `
      <div class="fcr-node-actions">
        ${mookBtn}
        <button type="button" class="fcr-node-action" data-node-action="toChat" data-node-id="${esc(node.id)}"
                title="${esc(L("result.toChat"))}"><i class="fas fa-comment"></i></button>
      </div>`;

    const childGroupsHTML = (node.childGroups ?? []).map((g) => `
      <div class="fcr-child-group">
        <div class="fcr-child-group-label">${esc(g.stepLabel)}</div>
        ${g.nodes.map((c) => this.#renderNodeHTML(c)).join("")}
      </div>
    `).join("");

    return `
      <div class="fcr-node" data-node-id="${esc(node.id)}">
        <div class="fcr-node-row">
          ${labelHTML}
          ${textHTML}
          ${actions}
        </div>
        ${childGroupsHTML
          ? `<div class="fcr-node-children">${childGroupsHTML}</div>`
          : ""}
      </div>`;
  }

  #bindCardInteractions(container) {
    container.addEventListener("click", async (event) => {
      const cardEl = event.target.closest(".fcr-card");
      if (!cardEl) return;
      const cardId = cardEl.dataset.cardId;
      const card = this.#draws.find((c) => c.id === cardId);
      if (!card) return;

      const cardBtn = event.target.closest("[data-card-action]");
      if (cardBtn) {
        event.preventDefault();
        event.stopPropagation();
        const action = cardBtn.dataset.cardAction;
        if (action === "dismiss") {
          this.#draws = this.#draws.filter((c) => c.id !== cardId);
          this.render(false);
        } else if (action === "reroll") {
          const recipe = getRecipe(card.recipeId);
          if (!recipe) {
            ui.notifications.warn(L("missingRecipe"));
            return;
          }
          try {
            const fresh = await rollRecipe(recipe);
            const idx = this.#draws.findIndex((c) => c.id === cardId);
            if (idx >= 0) this.#draws[idx] = fresh;
            this.render(false);
          } catch (err) {
            console.error(`${MODULE_ID} | reroll failed`, err);
            ui.notifications.error(L("rollFailed"));
          }
        } else if (action === "toChat") {
          await this.#sendCardToChat(card);
        }
        return;
      }

      const nodeBtn = event.target.closest("[data-node-action]");
      if (nodeBtn) {
        event.preventDefault();
        event.stopPropagation();
        const action = nodeBtn.dataset.nodeAction;
        const nodeId = nodeBtn.dataset.nodeId;
        const node = this.#findNode(card, nodeId);
        if (!node) return;
        if (action === "toChat") {
          await this.#sendNodeToChat(card, node);
        } else if (action === "mook") {
          await openMookDialog({
            name: stripTags(node.result?.text) || card.recipeName,
            notes: this.#buildMookNotes(card, node)
          });
        }
      }
    });
  }

  #buildMookNotes(card, node) {
    const lines = [`Generated from "${card.recipeName}" via CPR Rollboards.`];
    const flatten = (n, depth = 0) => {
      if (n.skipped) return;
      const text = stripTags(n.result?.text);
      if (text) lines.push(`${"  ".repeat(depth)}- ${n.stepLabel ? `${n.stepLabel}: ` : ""}${text}`);
      for (const g of n.childGroups ?? []) {
        for (const c of g.nodes ?? []) flatten(c, depth + 1);
      }
    };
    for (const root of card.nodes ?? []) flatten(root);
    return lines.join("\n");
  }

  #findNode(card, nodeId) {
    const stack = [...(card.nodes ?? [])];
    while (stack.length) {
      const n = stack.pop();
      if (n.id === nodeId) return n;
      for (const g of n.childGroups ?? []) {
        for (const c of g.nodes ?? []) stack.push(c);
      }
    }
    return null;
  }

  async #sendCardToChat(card) {
    const html = this.#renderCardChatHTML(card);
    return ChatMessage.create({
      content: html,
      flags: { [MODULE_ID]: { cardId: card.id, recipeId: card.recipeId } }
    });
  }

  async #sendNodeToChat(card, node) {
    const html = `
      <div class="fcr-chat">
        <div class="fcr-chat-title"><i class="fas fa-dice-d20"></i> ${esc(card.recipeName)}</div>
        <div class="fcr-chat-body">${this.#renderNodeChatHTML(node)}</div>
      </div>`;
    return ChatMessage.create({
      content: html,
      flags: { [MODULE_ID]: { cardId: card.id, recipeId: card.recipeId, nodeId: node.id } }
    });
  }

  #renderCardChatHTML(card) {
    const body = card.nodes.map((n) => this.#renderNodeChatHTML(n)).join("");
    return `
      <div class="fcr-chat">
        <div class="fcr-chat-title"><i class="fas fa-dice-d20"></i> ${esc(card.recipeName)}</div>
        <div class="fcr-chat-body">${body}</div>
      </div>`;
  }

  #renderNodeChatHTML(node) {
    if (node.skipped) {
      return `<div class="fcr-chat-row"><em>${esc(node.stepLabel)}: ${esc(L("result.skipped"))}</em></div>`;
    }
    const label = node.stepLabel ? `<strong>${esc(node.stepLabel)}:</strong> ` : "";
    const text = node.result?.text ?? L("result.empty");
    const childGroups = (node.childGroups ?? []).map((g) => `
      <div class="fcr-chat-children">
        ${g.nodes.map((c) => this.#renderNodeChatHTML(c)).join("")}
      </div>
    `).join("");
    return `<div class="fcr-chat-row">${label}${text}</div>${childGroups}`;
  }

  /* -------------------------------------------- */
  /*  Boards manager                              */
  /* -------------------------------------------- */

  async #promptNewBoard() {
    const name = await Dialog.prompt({
      title: L("boards.createTitle"),
      content: `<div class="fcr-dialog-form">
                  <label>${esc(L("boards.nameLabel"))}</label>
                  <input type="text" name="name" autofocus />
                </div>`,
      label: L("boards.create"),
      callback: (h) => {
        const r = h instanceof jQuery ? h[0] : h;
        return r.querySelector("input[name=name]")?.value?.trim();
      },
      rejectClose: false,
      options: { classes: ["foundry-cpr-rollboards", "dialog"] }
    });
    if (!name) return;
    const board = makeBoard(name);
    await upsertBoard(board);
    this.#activeBoardId = board.id;
    this.render(false);
  }

  async #openBoardsManagerDialog() {
    const list = listBoards();
    const rows = list.map((b) => `
      <div class="fcr-board-row" data-board-id="${esc(b.id)}">
        <span class="fcr-board-name">${esc(b.name)}</span>
        <span class="fcr-board-tilecount">${b.tiles?.length ?? 0}</span>
        <button type="button" class="fcr-board-rename" title="${esc(L("rename"))}">
          <i class="fas fa-pen"></i>
        </button>
        <button type="button" class="fcr-board-delete" title="${esc(L("delete"))}">
          <i class="fas fa-trash"></i>
        </button>
      </div>
    `).join("");

    const content = list.length
      ? `<div class="fcr-board-list">${rows}</div>`
      : `<p class="fcr-dialog-hint">${esc(L("boards.noneYet"))}</p>`;

    const self = this;

    new Dialog({
      title: L("boards.manageTitle"),
      content,
      buttons: {
        new: {
          icon: '<i class="fas fa-plus"></i>',
          label: L("boards.newBoard"),
          callback: async () => {
            await self.#promptNewBoard();
            // Re-open the manager so the GM keeps managing if they want.
            self.#openBoardsManagerDialog();
          }
        },
        samples: {
          icon: '<i class="fas fa-magic"></i>',
          label: L("samples.importButton"),
          callback: async () => {
            await importSampleTables();
          }
        },
        close: {
          icon: '<i class="fas fa-check"></i>',
          label: L("close")
        }
      },
      default: "close",
      render: (html) => {
        const root = html instanceof jQuery ? html[0] : html;
        root.querySelectorAll(".fcr-board-row").forEach((row) => {
          const id = row.dataset.boardId;
          row.querySelector(".fcr-board-rename").addEventListener("click", async () => {
            const cur = getBoard(id);
            if (!cur) return;
            const name = await Dialog.prompt({
              title: L("boards.renameTitle"),
              content: `<div class="fcr-dialog-form">
                          <label>${esc(L("boards.nameLabel"))}</label>
                          <input type="text" name="name" value="${esc(cur.name)}" autofocus />
                        </div>`,
              label: L("save"),
              callback: (h) => {
                const r = h instanceof jQuery ? h[0] : h;
                return r.querySelector("input[name=name]")?.value?.trim();
              },
              rejectClose: false
            });
            if (!name) return;
            cur.name = name;
            await upsertBoard(cur);
            row.querySelector(".fcr-board-name").textContent = name;
            self.render(false);
          });
          row.querySelector(".fcr-board-delete").addEventListener("click", async () => {
            const cur = getBoard(id);
            if (!cur) return;
            const ok = await Dialog.confirm({
              title: L("boards.deleteTitle"),
              content: `<p>${esc(F("boards.deletePrompt", { name: cur.name }))}</p>`,
              rejectClose: false
            });
            if (!ok) return;
            await deleteBoard(id);
            row.remove();
            if (self.#activeBoardId === id) self.#activeBoardId = null;
            self.render(false);
          });
        });
      }
    }, { classes: ["foundry-cpr-rollboards", "dialog"], width: 480 }).render(true);
  }

  /* -------------------------------------------- */
  /*  Helpers                                     */
  /* -------------------------------------------- */

  #currentBoard() {
    return this.#activeBoardId ? getBoard(this.#activeBoardId) : null;
  }

  #clampToCanvas(canvas, clientX, clientY, centerTile = false) {
    const rect = canvas.getBoundingClientRect();
    let x = clientX - rect.left + canvas.scrollLeft;
    let y = clientY - rect.top + canvas.scrollTop;
    if (centerTile) {
      x -= TILE_SIZE / 2;
      y -= TILE_SIZE / 2;
    }
    return {
      x: Math.max(0, x),
      y: Math.max(0, y)
    };
  }
}
