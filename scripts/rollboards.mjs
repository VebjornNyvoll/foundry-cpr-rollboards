/**
 * RollboardDashboard — GM-only rollboard window.
 *
 * One window. One tab per Scene. Each tab is a free-positioning canvas of
 * recipe tiles; clicking a tile rolls its recipe and a card lands in the
 * drawer at the bottom of the window. No global chat spam.
 *
 * Persistence:
 *   scene.flags["foundry-cpr-rollboards"].dashboard = {
 *     showNames: boolean,
 *     tiles: [{ recipeId, x, y }]
 *   }
 *   game.settings("foundry-cpr-rollboards", "recipes")  : { [id]: Recipe }
 *   game.settings("foundry-cpr-rollboards", "presets")  : { [id]: Preset }
 *   game.settings("foundry-cpr-rollboards", "selectedScenes") : string[]
 *
 * Roll history (drawer cards) lives in module memory on the singleton —
 * session-scoped, cleared on window close.
 */

import {
  MODULE_ID,
  I18N_NS,
  FLAG_DASHBOARD,
  SETTING_SELECTED_SCENES,
  SETTING_PRESETS,
  TILE_SIZE,
  NAME_HEIGHT,
  DRAG_THRESHOLD,
  CANVAS_PADDING,
  MAX_DRAW_HISTORY
} from "./constants.mjs";

import {
  readRecipes,
  upsertRecipe,
  getRecipe,
  recipeFromTable,
  makeStep,
  countSteps,
  findStep,
  findStepLocation,
  addStep,
  removeStep,
  moveStep,
  DEFAULT_TILE_ICON
} from "./recipes.mjs";

import { rollRecipe } from "./engine.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

function L(key) { return game.i18n.localize(`${I18N_NS}.${key}`); }
function F(key, data) { return game.i18n.format(`${I18N_NS}.${key}`, data); }
function esc(s) { return Handlebars.escapeExpression(String(s ?? "")); }

function emptyData() {
  return { showNames: true, tiles: [] };
}

function readData(scene) {
  const flag = scene?.getFlag(MODULE_ID, FLAG_DASHBOARD);
  if (!flag) return emptyData();
  return {
    showNames: flag.showNames !== false,
    tiles: Array.isArray(flag.tiles) ? flag.tiles.map((t) => ({ ...t })) : []
  };
}

async function writeData(scene, data) {
  return scene.setFlag(MODULE_ID, FLAG_DASHBOARD, data);
}

function readSelectedSceneIds() {
  const raw = game.settings.get(MODULE_ID, SETTING_SELECTED_SCENES);
  return Array.isArray(raw) ? raw : [];
}

async function writeSelectedSceneIds(ids) {
  return game.settings.set(MODULE_ID, SETTING_SELECTED_SCENES, Array.from(new Set(ids)));
}

function readPresets() {
  const raw = game.settings.get(MODULE_ID, SETTING_PRESETS);
  return (raw && typeof raw === "object") ? raw : {};
}

async function writePresets(presets) {
  return game.settings.set(MODULE_ID, SETTING_PRESETS, presets);
}

export class RollboardDashboard extends HandlebarsApplicationMixin(ApplicationV2) {
  /** @type {string|null} currently active scene id */
  #activeSceneId = null;

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
      openSceneSelector: RollboardDashboard.#onOpenSceneSelector,
      savePreset: RollboardDashboard.#onSavePreset,
      importPreset: RollboardDashboard.#onImportPreset,
      managePresets: RollboardDashboard.#onManagePresets,
      toggleDrawer: RollboardDashboard.#onToggleDrawer,
      clearDraws: RollboardDashboard.#onClearDraws
    }
  };

  static PARTS = {
    body: {
      template: `modules/${MODULE_ID}/templates/rollboards.hbs`,
      scrollable: [".fcr-canvas-scroll", ".fcr-drawer-body"]
    }
  };

  /* -------------------------------------------- */
  /*  Context                                     */
  /* -------------------------------------------- */

  async _prepareContext(options) {
    const selectedIds = new Set(readSelectedSceneIds());
    const scenes = Array.from(game.scenes ?? [])
      .filter((s) => selectedIds.has(s.id))
      .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));

    if (!this.#activeSceneId || !scenes.some((s) => s.id === this.#activeSceneId)) {
      const viewedId = game.scenes?.viewed?.id;
      this.#activeSceneId = (viewedId && selectedIds.has(viewedId)) ? viewedId : (scenes[0]?.id ?? null);
    }

    const presetCount = Object.keys(readPresets()).length;
    const activeScene = this.#activeSceneId ? game.scenes.get(this.#activeSceneId) : null;
    const data = activeScene ? readData(activeScene) : emptyData();
    const recipes = readRecipes();

    const tiles = data.tiles.map((t) => {
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

    // Drop the editing id if its recipe vanished or its tile was removed.
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
      scenes: scenes.map((s) => ({
        id: s.id,
        name: s.name,
        active: s.id === this.#activeSceneId
      })),
      hasScenes: scenes.length > 0,
      hasAnyScenesInWorld: (game.scenes?.size ?? 0) > 0,
      activeSceneId: this.#activeSceneId,
      showNames: data.showNames,
      tiles,
      canActSave: !!activeScene && data.tiles.length > 0,
      canActImport: !!activeScene && presetCount > 0,
      canManagePresets: presetCount > 0,
      canRollAll: !!activeScene && data.tiles.length > 0,
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

    // Render draw cards into the drawer (manual DOM — too dynamic for hbs).
    if (this.#drawerOpen) this.#renderCards();

    // Render and wire the inspector tree if it's open.
    if (this.#editingRecipeId) this.#renderInspector();
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
      // Highlight any tile currently under the cursor so the GM sees that
      // dropping there appends a step instead of creating a new tile.
      const tile = event.target.closest(".fcr-tile");
      const previous = canvas.querySelector(".fcr-tile.fcr-tile-droptarget");
      if (previous && previous !== tile) previous.classList.remove("fcr-tile-droptarget");
      if (tile) tile.classList.add("fcr-tile-droptarget");
    });

    canvas.addEventListener("dragleave", (event) => {
      // The dragleave fires per-element, so re-check whether the pointer is
      // still over a child of the canvas. relatedTarget can be null when the
      // cursor exits the window entirely.
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

    const scene = this.#currentScene();
    if (!scene) return;

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
        // Open the inspector so the GM can see the new step land in the tree.
        this.#editingRecipeId = recipe.id;
        this.render(false);
        return;
      }
    }

    // Default: build a single-step recipe from the dropped table and place a
    // new tile at the drop point.
    const recipe = recipeFromTable(table);
    await upsertRecipe(recipe);

    const { x, y } = this.#clampToCanvas(canvas, event.clientX, event.clientY, true);
    const data = readData(scene);
    data.tiles.push({ recipeId: recipe.id, x, y });
    await writeData(scene, data);
    this.render(false);
  }

  /* -------------------------------------------- */
  /*  Tile drag-reposition                        */
  /* -------------------------------------------- */

  #bindTileDrag(tile, canvas) {
    tile.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      if (event.target.closest(".fcr-tile-delete")) return;

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

        // Swallow the synthetic click queued by the browser after pointerup,
        // so the recipe doesn't fire at the end of a drag.
        tile.dataset.fcrSuppressClick = "1";

        const scene = this.#currentScene();
        if (!scene) return;
        const data = readData(scene);
        const entry = data.tiles.find((t) => t.recipeId === recipeId);
        if (!entry) return;
        entry.x = parseFloat(tile.style.left) || 0;
        entry.y = parseFloat(tile.style.top) || 0;
        await writeData(scene, data);
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
    const sceneId = target.dataset.sceneId;
    if (!sceneId) return;
    this.#activeSceneId = sceneId;
    this.render(false);
  }

  static async #onToggleNames(event, target) {
    const scene = this.#currentScene();
    if (!scene) return;
    const data = readData(scene);
    data.showNames = !!target.checked;
    await writeData(scene, data);
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
    if (counts === false) return; // user cancelled the prompt dialog

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

  /**
   * Collect counts for all prompt-mode steps in a recipe via a single dialog.
   * Returns:
   *   - null if there are no prompt-mode steps,
   *   - { [stepId]: count } if the GM accepted,
   *   - false if the GM cancelled (caller should abort the roll).
   */
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

  static async #onDeleteTile(event, target) {
    event.preventDefault();
    event.stopPropagation();
    const recipeId = target.dataset.recipeId;
    if (!recipeId) return;
    const scene = this.#currentScene();
    if (!scene) return;
    const data = readData(scene);
    data.tiles = data.tiles.filter((t) => t.recipeId !== recipeId);
    await writeData(scene, data);
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
    return this.rollAllOnActiveTab();
  }

  /**
   * Public entry point for the keybind in main.mjs.
   * Rolls every tile on the active tab in placement order.
   */
  async rollAllOnActiveTab() {
    const scene = this.#currentScene();
    if (!scene) {
      ui.notifications.warn(L("noActiveTab"));
      return;
    }
    const data = readData(scene);
    if (!data.tiles.length) {
      ui.notifications.warn(L("rollAllNothing"));
      return;
    }

    // Roll in a stable order so the drawer reflects the layout sequence.
    const ordered = [...data.tiles].sort((a, b) => (a.y - b.y) || (a.x - b.x));
    let rolled = 0;
    for (const tile of ordered) {
      const recipe = getRecipe(tile.recipeId);
      if (!recipe) continue;
      const counts = await this.#collectPromptCounts(recipe);
      if (counts === false) continue; // skip this tile if the GM cancelled
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

  /* -------------------------------------------- */
  /*  Right-click popup                           */
  /* -------------------------------------------- */

  #onTileContextMenu(event, canvas) {
    const tileEl = event.target.closest(".fcr-tile");
    if (!tileEl) return; // right-clicking empty canvas does nothing yet
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

    // Recipes with one root step show that step's count/chance/optional in
    // the popup; chained recipes only get the "open inspector" affordance.
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

    // Inputs save on change.
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

    // Action buttons.
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
        const scene = this.#currentScene();
        if (!scene) return;
        const data = readData(scene);
        data.tiles = data.tiles.filter((t) => t.recipeId !== recipe.id);
        await writeData(scene, data);
        this.render(false);
      }
    });

    // Dismiss on click outside.
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
  /*  Inspector                                   */
  /* -------------------------------------------- */

  #renderInspector() {
    const root = this.element;
    if (!root) return;
    const tree = root.querySelector(".fcr-inspector-tree");
    if (!tree) return;
    const recipe = getRecipe(this.#editingRecipeId);
    if (!recipe) {
      tree.innerHTML = "";
      return;
    }
    tree.innerHTML = (recipe.steps ?? []).map((s) => this.#renderStepHTML(s, 0)).join("");
    this.#bindInspector(tree, recipe);
  }

  #renderStepHTML(step, depth) {
    const tableLabel = step.tableUuid ? esc(`uuid: ${step.tableUuid.split(".").pop()}`) : esc(L("step.missingTable"));
    const childrenHTML = (step.children ?? []).map((c) => this.#renderStepHTML(c, depth + 1)).join("");
    const optionalOn = !!step.optional;
    const promptOn = step.countMode === "prompt";
    return `
      <div class="fcr-step" data-step-id="${esc(step.id)}" data-depth="${depth}">
        <div class="fcr-step-row" draggable="true">
          <span class="fcr-step-handle" title="Drag to move">⋮⋮</span>
          <input type="text" class="fcr-step-label${step.tableUuid ? "" : " fcr-step-missing"}"
                 value="${esc(step.label ?? "")}"
                 placeholder="${esc(L("step.label"))}"
                 data-step-field="label" />
          <span class="fcr-step-table" title="${esc(step.tableUuid ?? "")}">${tableLabel}</span>
          <input type="number" class="fcr-step-count" min="1"
                 value="${esc(String(step.count ?? 1))}"
                 title="${esc(L("step.count"))}"
                 data-step-field="count" />
          <span class="fcr-step-flags">
            <button type="button"
                    class="fcr-step-flag${promptOn ? " fcr-step-flag-on" : ""}"
                    data-step-toggle="prompt"
                    title="${esc(L("step.countPrompt"))}">?</button>
            <button type="button"
                    class="fcr-step-flag${optionalOn ? " fcr-step-flag-on" : ""}"
                    data-step-toggle="optional"
                    title="${esc(L("step.optionalTooltip"))}">opt</button>
          </span>
          <input type="number" class="fcr-step-chance" min="1" max="100"
                 value="${esc(String(step.chance ?? 100))}"
                 title="${esc(L("step.chanceTooltip"))}"
                 data-step-field="chance" />
          <button type="button" class="fcr-step-delete" data-step-action="delete"
                  title="${esc(L("step.delete"))}"><i class="fas fa-times"></i></button>
        </div>
        ${childrenHTML
          ? `<div class="fcr-step-children">${childrenHTML}</div>`
          : ""}
      </div>`;
  }

  #bindInspector(tree, recipe) {
    // Inline edits — auto-save on change.
    tree.addEventListener("change", async (event) => {
      const field = event.target?.dataset?.stepField;
      if (!field) return;
      const stepEl = event.target.closest(".fcr-step");
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

    // Toggle buttons (prompt-mode, optional).
    tree.addEventListener("click", async (event) => {
      const toggleBtn = event.target.closest("[data-step-toggle]");
      if (toggleBtn) {
        event.preventDefault();
        const stepEl = toggleBtn.closest(".fcr-step");
        const stepId = stepEl?.dataset?.stepId;
        if (!stepId) return;
        const cur = getRecipe(recipe.id);
        const step = cur ? findStep(cur, stepId) : null;
        if (!step) return;
        const which = toggleBtn.dataset.stepToggle;
        if (which === "prompt") {
          step.countMode = step.countMode === "prompt" ? "fixed" : "prompt";
        } else if (which === "optional") {
          step.optional = !step.optional;
        }
        await upsertRecipe(cur);
        this.#renderInspector();
        return;
      }
      const actionBtn = event.target.closest("[data-step-action]");
      if (actionBtn) {
        event.preventDefault();
        const stepEl = actionBtn.closest(".fcr-step");
        const stepId = stepEl?.dataset?.stepId;
        if (!stepId) return;
        const cur = getRecipe(recipe.id);
        const step = cur ? findStep(cur, stepId) : null;
        if (!step) return;
        if (actionBtn.dataset.stepAction === "delete") {
          const hasChildren = (step.children?.length ?? 0) > 0;
          if (hasChildren) {
            const ok = await Dialog.confirm({
              title: L("step.delete"),
              content: `<p>${esc(F("step.deleteConfirm", { name: step.label || L("step.missingTable") }))}</p>`,
              rejectClose: false
            });
            if (!ok) return;
          }
          removeStep(cur, stepId);
          await upsertRecipe(cur);
          // Re-render the dashboard so the tile badge / step-count updates.
          this.render(false);
        }
      }
    });

    // Drop a RollTable from the sidebar onto a step row → child step of that step.
    tree.addEventListener("dragover", (event) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      const target = event.target.closest(".fcr-step-row");
      const previous = tree.querySelector(".fcr-step-row.fcr-step-drop-target");
      if (previous && previous !== target) previous.classList.remove("fcr-step-drop-target");
      if (target) target.classList.add("fcr-step-drop-target");
    });

    tree.addEventListener("dragleave", (event) => {
      if (!event.relatedTarget || !tree.contains(event.relatedTarget)) {
        tree.querySelectorAll(".fcr-step-row.fcr-step-drop-target")
          .forEach((el) => el.classList.remove("fcr-step-drop-target"));
      }
    });

    tree.addEventListener("drop", async (event) => {
      tree.querySelectorAll(".fcr-step-row.fcr-step-drop-target")
        .forEach((el) => el.classList.remove("fcr-step-drop-target"));
      const targetRow = event.target.closest(".fcr-step-row");
      if (!targetRow) return;
      const targetStepId = targetRow.closest(".fcr-step")?.dataset?.stepId;
      if (!targetStepId) return;

      // Two payload kinds we care about: external sidebar drops (RollTable
      // payload) and internal step-handle drags (data-internal-step).
      const internalId = event.dataTransfer.getData("application/x-fcr-step");
      if (internalId) {
        event.preventDefault();
        if (internalId === targetStepId) return;
        const cur = getRecipe(recipe.id);
        if (!cur) return;
        const ok = moveStep(cur, internalId, targetStepId, undefined);
        if (ok) {
          await upsertRecipe(cur);
          this.#renderInspector();
        }
        return;
      }

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

    // Internal drag of a step (handle) for reorder.
    tree.querySelectorAll(".fcr-step-row[draggable=true]").forEach((row) => {
      row.addEventListener("dragstart", (event) => {
        const id = row.closest(".fcr-step")?.dataset?.stepId;
        if (!id) return;
        event.dataTransfer.setData("application/x-fcr-step", id);
        event.dataTransfer.effectAllowed = "move";
        row.closest(".fcr-step")?.classList.add("fcr-step-dragging");
      });
      row.addEventListener("dragend", () => {
        row.closest(".fcr-step")?.classList.remove("fcr-step-dragging");
      });
    });

    // Wire the recipe-name input change.
    const root = this.element;
    const nameInput = root?.querySelector(".fcr-inspector-name");
    if (nameInput && !nameInput.dataset.fcrBound) {
      nameInput.dataset.fcrBound = "1";
      nameInput.addEventListener("change", async () => {
        const cur = getRecipe(recipe.id);
        if (!cur) return;
        const value = String(nameInput.value ?? "").trim() || cur.name;
        cur.name = value;
        await upsertRecipe(cur);
        this.render(false); // tile name update on the canvas
      });
    }
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
      // Honor the rich HTML coming back from RollTable.draw — Foundry already
      // sanitizes this on its side, and links/inline rolls render correctly.
      textHTML = `<span class="fcr-node-text">${node.result?.text ?? ""}</span>`;
    }

    const actions = node.skipped ? "" : `
      <div class="fcr-node-actions">
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
            // Replace the card in place so it stays visually pinned at the
            // same drawer position.
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
        }
      }
    });
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
  /*  Scene selector                              */
  /* -------------------------------------------- */

  static async #onOpenSceneSelector(event, target) {
    event.preventDefault();
    return this.#openSceneSelectorDialog();
  }

  async #openSceneSelectorDialog() {
    const selected = new Set(readSelectedSceneIds());
    const scenes = Array.from(game.scenes ?? []).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));

    if (!scenes.length) {
      ui.notifications.warn(L("noScenesInWorld"));
      return;
    }

    const rows = scenes.map((s) => `
      <div class="fcr-picker-row" data-scene-name="${esc(s.name.toLowerCase())}">
        <label>
          <input type="checkbox" name="${esc(s.id)}" ${selected.has(s.id) ? "checked" : ""} />
          <span class="fcr-picker-row-name">${esc(s.name)}</span>
        </label>
      </div>
    `).join("");

    const content = `
      <div class="fcr-picker">
        <p class="fcr-picker-hint">${esc(L("sceneSelectorHint"))}</p>
        <input type="search" class="fcr-picker-search"
               placeholder="${esc(L("searchScenes"))}" autocomplete="off" />
        <div class="fcr-picker-actions">
          <button type="button" class="fcr-picker-all">${esc(L("selectAll"))}</button>
          <button type="button" class="fcr-picker-none">${esc(L("selectNone"))}</button>
        </div>
        <div class="fcr-picker-count"></div>
        <div class="fcr-picker-list">${rows}</div>
        <div class="fcr-picker-empty" hidden>${esc(L("noMatches"))}</div>
      </div>`;

    return new Promise((resolve) => {
      const dlg = new Dialog({
        title: L("sceneSelectorTitle"),
        content,
        buttons: {
          save: {
            icon: '<i class="fas fa-check"></i>',
            label: L("save"),
            callback: async (html) => {
              const root = html instanceof jQuery ? html[0] : html;
              const ids = Array.from(root.querySelectorAll(".fcr-picker-list input[type=checkbox]:checked")).map((i) => i.name);
              await writeSelectedSceneIds(ids);
              resolve(ids);
              this.render(false);
            }
          },
          cancel: {
            icon: '<i class="fas fa-times"></i>',
            label: L("cancel"),
            callback: () => resolve(null)
          }
        },
        default: "save",
        render: (html) => {
          const root = html instanceof jQuery ? html[0] : html;
          const search = root.querySelector(".fcr-picker-search");
          const listRows = () => root.querySelectorAll(".fcr-picker-list .fcr-picker-row");
          const emptyMsg = root.querySelector(".fcr-picker-empty");
          const list = root.querySelector(".fcr-picker-list");
          const countEl = root.querySelector(".fcr-picker-count");

          const updateCount = () => {
            const total = listRows().length;
            const checked = root.querySelectorAll(".fcr-picker-list input[type=checkbox]:checked").length;
            const visible = Array.from(listRows()).filter((r) => !r.hidden).length;
            countEl.textContent = F("selectionCount", { checked, total, visible });
          };

          const applyFilter = () => {
            const needle = search.value.trim().toLowerCase();
            let visible = 0;
            for (const row of listRows()) {
              const match = !needle || row.dataset.sceneName.includes(needle);
              row.hidden = !match;
              if (match) visible++;
            }
            emptyMsg.hidden = visible > 0;
            list.hidden = visible === 0;
            updateCount();
          };

          search.addEventListener("input", applyFilter);
          search.focus();

          root.querySelector(".fcr-picker-all")?.addEventListener("click", () => {
            for (const row of listRows()) {
              if (!row.hidden) row.querySelector("input[type=checkbox]").checked = true;
            }
            updateCount();
          });
          root.querySelector(".fcr-picker-none")?.addEventListener("click", () => {
            for (const row of listRows()) {
              if (!row.hidden) row.querySelector("input[type=checkbox]").checked = false;
            }
            updateCount();
          });
          list.addEventListener("change", (e) => {
            if (e.target?.matches?.('input[type="checkbox"]')) updateCount();
          });

          updateCount();
        }
      }, { classes: ["foundry-cpr-rollboards", "dialog"], width: 460 });
      dlg.render(true);
    });
  }

  /* -------------------------------------------- */
  /*  Preset: save                                */
  /* -------------------------------------------- */

  static async #onSavePreset(event, target) {
    event.preventDefault();
    return this.#savePresetDialog();
  }

  async #savePresetDialog() {
    const scene = this.#currentScene();
    if (!scene) {
      ui.notifications.warn(L("noActiveTab"));
      return;
    }
    const data = readData(scene);
    if (!data.tiles.length) {
      ui.notifications.warn(L("nothingToSave"));
      return;
    }

    const defaultName = scene.name ?? "";
    const content = `
      <div class="fcr-dialog-form">
        <label>${esc(L("presetName"))}</label>
        <input type="text" name="presetName" value="${esc(defaultName)}" autofocus />
      </div>`;

    new Dialog({
      title: L("savePresetTitle"),
      content,
      buttons: {
        save: {
          icon: '<i class="fas fa-save"></i>',
          label: L("save"),
          callback: async (html) => {
            const root = html instanceof jQuery ? html[0] : html;
            const name = root.querySelector("input[name=presetName]").value.trim();
            if (!name) {
              ui.notifications.warn(L("nameRequired"));
              return;
            }
            const presets = readPresets();
            const id = foundry.utils.randomID();
            presets[id] = {
              id,
              name,
              tiles: data.tiles.map((t) => ({ recipeId: t.recipeId, x: t.x, y: t.y })),
              createdAt: Date.now()
            };
            await writePresets(presets);
            ui.notifications.info(F("presetSaved", { name }));
            this.render(false);
          }
        },
        cancel: {
          icon: '<i class="fas fa-times"></i>',
          label: L("cancel")
        }
      },
      default: "save"
    }, { classes: ["foundry-cpr-rollboards", "dialog"] }).render(true);
  }

  /* -------------------------------------------- */
  /*  Preset: import                              */
  /* -------------------------------------------- */

  static async #onImportPreset(event, target) {
    event.preventDefault();
    return this.#importPresetDialog();
  }

  async #importPresetDialog() {
    const scene = this.#currentScene();
    if (!scene) {
      ui.notifications.warn(L("noActiveTab"));
      return;
    }
    const presets = readPresets();
    const list = Object.values(presets).sort((a, b) => a.name.localeCompare(b.name));
    if (!list.length) {
      ui.notifications.warn(L("noPresets"));
      return;
    }

    const options = list.map((p) => `<option value="${esc(p.id)}">${esc(p.name)} (${p.tiles?.length ?? 0})</option>`).join("");
    const content = `
      <div class="fcr-dialog-form">
        <label>${esc(L("choosePreset"))}</label>
        <select name="presetId">${options}</select>
        <p class="fcr-dialog-hint">${esc(L("importModeHint"))}</p>
      </div>`;

    const apply = async (mode, root) => {
      const id = root.querySelector("select[name=presetId]").value;
      const preset = presets[id];
      if (!preset) return;
      const dashData = readData(scene);
      const presetTiles = (preset.tiles ?? []).map((t) => ({
        recipeId: t.recipeId,
        x: Number.isFinite(t.x) ? t.x : 0,
        y: Number.isFinite(t.y) ? t.y : 0
      }));
      dashData.tiles = (mode === "replace") ? presetTiles : [...dashData.tiles, ...presetTiles];
      await writeData(scene, dashData);
      ui.notifications.info(F("presetImported", {
        name: preset.name,
        mode: L(mode === "replace" ? "replace" : "append")
      }));
      this.render(false);
    };

    new Dialog({
      title: L("importPresetTitle"),
      content,
      buttons: {
        append: {
          icon: '<i class="fas fa-plus"></i>',
          label: L("append"),
          callback: (html) => apply("append", html instanceof jQuery ? html[0] : html)
        },
        replace: {
          icon: '<i class="fas fa-sync-alt"></i>',
          label: L("replace"),
          callback: (html) => apply("replace", html instanceof jQuery ? html[0] : html)
        },
        cancel: {
          icon: '<i class="fas fa-times"></i>',
          label: L("cancel")
        }
      },
      default: "append"
    }, { classes: ["foundry-cpr-rollboards", "dialog"], width: 420 }).render(true);
  }

  /* -------------------------------------------- */
  /*  Preset: manage                              */
  /* -------------------------------------------- */

  static async #onManagePresets(event, target) {
    event.preventDefault();
    return this.#managePresetsDialog();
  }

  async #managePresetsDialog() {
    const presets = readPresets();
    const list = Object.values(presets).sort((a, b) => a.name.localeCompare(b.name));
    if (!list.length) {
      ui.notifications.warn(L("noPresets"));
      return;
    }

    const rows = list.map((p) => `
      <div class="fcr-preset-row" data-preset-id="${esc(p.id)}">
        <span class="fcr-preset-name">${esc(p.name)}</span>
        <span class="fcr-preset-count">${p.tiles?.length ?? 0}</span>
        <button type="button" class="fcr-preset-rename" title="${esc(L("rename"))}">
          <i class="fas fa-pen"></i>
        </button>
        <button type="button" class="fcr-preset-delete" title="${esc(L("delete"))}">
          <i class="fas fa-trash"></i>
        </button>
      </div>
    `).join("");

    const content = `<div class="fcr-preset-list">${rows}</div>`;
    const self = this;

    new Dialog({
      title: L("managePresetsTitle"),
      content,
      buttons: {
        close: { icon: '<i class="fas fa-check"></i>', label: L("close") }
      },
      default: "close",
      render: (html) => {
        const root = html instanceof jQuery ? html[0] : html;
        root.querySelectorAll(".fcr-preset-row").forEach((row) => {
          const id = row.dataset.presetId;
          row.querySelector(".fcr-preset-rename").addEventListener("click", async () => {
            const cur = readPresets();
            const existing = cur[id];
            if (!existing) return;
            const name = await Dialog.prompt({
              title: L("renamePreset"),
              content: `<div class="fcr-dialog-form"><label>${esc(L("presetName"))}</label><input type="text" name="name" value="${esc(existing.name)}" autofocus /></div>`,
              label: L("save"),
              callback: (h) => {
                const r = h instanceof jQuery ? h[0] : h;
                return r.querySelector("input[name=name]").value.trim();
              },
              rejectClose: false
            });
            if (!name) return;
            cur[id].name = name;
            await writePresets(cur);
            row.querySelector(".fcr-preset-name").textContent = name;
          });
          row.querySelector(".fcr-preset-delete").addEventListener("click", async () => {
            const cur = readPresets();
            const existing = cur[id];
            if (!existing) return;
            const confirmed = await Dialog.confirm({
              title: L("deletePreset"),
              content: `<p>${esc(F("deletePresetPrompt", { name: existing.name }))}</p>`,
              rejectClose: false
            });
            if (!confirmed) return;
            delete cur[id];
            await writePresets(cur);
            row.remove();
            self.render(false);
          });
        });
      }
    }, { classes: ["foundry-cpr-rollboards", "dialog"], width: 480 }).render(true);
  }

  /* -------------------------------------------- */
  /*  Helpers                                     */
  /* -------------------------------------------- */

  #currentScene() {
    return this.#activeSceneId ? game.scenes.get(this.#activeSceneId) : null;
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
