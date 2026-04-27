/**
 * foundry-cpr-rollboards — entry point.
 *
 * Registers the GM-only Rollboards window, the Roll Tables sidebar header
 * button, and a Scene Controls button as alternate openers. Re-renders the
 * dashboard on scene create/update/delete so tabs stay in sync.
 */

import {
  MODULE_ID,
  I18N_NS,
  SETTING_SELECTED_SCENES,
  SETTING_RECIPES,
  SETTING_PRESETS
} from "./constants.mjs";
import { RollboardDashboard } from "./rollboards.mjs";

let _dashboardApp = null;

function openDashboard() {
  if (!game.user.isGM) {
    ui.notifications.warn(game.i18n.localize(`${I18N_NS}.gmOnly`));
    return;
  }
  if (!_dashboardApp) _dashboardApp = new RollboardDashboard();
  _dashboardApp.render(true);
}

function rollAllShortcut() {
  if (!game.user?.isGM) return false;
  if (!_dashboardApp?.rendered) return false;
  _dashboardApp.rollAllOnActiveTab();
  return true;
}

Hooks.once("init", () => {
  // Which scenes get a tab on the dashboard.
  game.settings.register(MODULE_ID, SETTING_SELECTED_SCENES, {
    scope: "world",
    config: false,
    type: Array,
    default: []
  });

  // Recipe library — keyed by recipe id, shareable across scenes/tabs.
  game.settings.register(MODULE_ID, SETTING_RECIPES, {
    scope: "world",
    config: false,
    type: Object,
    default: {}
  });

  // Named tile-layout presets.
  game.settings.register(MODULE_ID, SETTING_PRESETS, {
    scope: "world",
    config: false,
    type: Object,
    default: {}
  });

  // Public API for macros / dev tools.
  game.modules.get(MODULE_ID).api = { open: openDashboard };

  // Ctrl+Enter while the dashboard is open → roll every tile on the active tab.
  game.keybindings.register(MODULE_ID, "rollAll", {
    name: `${I18N_NS}.keybind.rollAll`,
    editable: [
      { key: "Enter", modifiers: ["Control"] }
    ],
    onDown: () => rollAllShortcut(),
    restricted: true,
    precedence: foundry.CONST?.KEYBINDING_PRECEDENCE?.NORMAL ?? CONST.KEYBINDING_PRECEDENCE.NORMAL
  });
});

/**
 * Scene Controls: token layer button (GM-only). Mirrors the macro-dashboards
 * affordance so the GM has a one-click opener regardless of which sidebar
 * tab is active.
 */
Hooks.on("getSceneControlButtons", (controls) => {
  if (!game.user?.isGM) return;
  const tokenControls = controls.find((c) => c.name === "token");
  if (!tokenControls) return;
  tokenControls.tools.push({
    name: "cpr-rollboards",
    title: `${I18N_NS}.openDashboard`,
    icon: "fas fa-dice-d20",
    button: true,
    visible: game.user.isGM,
    onClick: () => openDashboard()
  });
});

/**
 * Header button on the Roll Tables sidebar directory.
 */
Hooks.on("renderRollTableDirectory", (app, html) => {
  if (!game.user?.isGM) return;
  const root = html instanceof jQuery ? html[0] : html;
  if (!root) return;
  if (root.querySelector(`.${MODULE_ID}-open-btn`)) return;

  const header = root.querySelector(".directory-header .header-actions") || root.querySelector(".directory-header");
  if (!header) return;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = `${MODULE_ID}-open-btn`;
  btn.innerHTML = `<i class="fas fa-dice-d20"></i> ${game.i18n.localize(`${I18N_NS}.openDashboard`)}`;
  btn.addEventListener("click", () => openDashboard());
  header.appendChild(btn);
});

// Keep the tab bar in sync with the scene list.
for (const hook of ["createScene", "updateScene", "deleteScene"]) {
  Hooks.on(hook, () => {
    if (_dashboardApp?.rendered) _dashboardApp.render(false);
  });
}
