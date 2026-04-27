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

  static DEFAULT_OPTIONS = {
    id: "foundry-cpr-rollboards-app",
    classes: ["foundry-cpr-rollboards"],
    tag: "div",
    window: {
      title: `${I18N_NS}.windowTitle`,
      icon: "fas fa-dice-d20",
      resizable: true
    },
    position: { width: 960, height: 720 },
    actions: {
      selectTab: RollboardDashboard.#onSelectTab,
      toggleNames: RollboardDashboard.#onToggleNames,
      rollTile: RollboardDashboard.#onRollTile,
      deleteTile: RollboardDashboard.#onDeleteTile,
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
      return {
        recipeId: t.recipeId,
        x: Number.isFinite(t.x) ? Math.max(0, t.x) : 0,
        y: Number.isFinite(t.y) ? Math.max(0, t.y) : 0,
        name: recipe?.name ?? L("missingRecipe"),
        img: recipe?.icon ?? DEFAULT_TILE_ICON,
        missing: !recipe
      };
    });

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
  }

  _onClose(options) {
    this.#resizeObserver?.disconnect();
    this.#resizeObserver = null;
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
    });

    canvas.addEventListener("drop", (event) => this.#onCanvasDrop(event, canvas));

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

    // Build a single-step recipe from the dropped table and persist it.
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

    let card;
    try {
      card = await rollRecipe(recipe);
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
