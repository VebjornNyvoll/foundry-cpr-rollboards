/**
 * foundry-cpr-rollboards — entry point.
 *
 * Registers the GM-only Rollboards window, the Roll Tables sidebar header
 * button, and the Ctrl+Enter Roll-all keybind.
 */

import {
  MODULE_ID,
  I18N_NS,
  SETTING_BOARDS,
  SETTING_RECIPES
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
  _dashboardApp.rollAllOnActiveBoard();
  return true;
}

Hooks.once("init", () => {
  // Dashboard tabs (boards). User-named, scene-independent.
  game.settings.register(MODULE_ID, SETTING_BOARDS, {
    scope: "world",
    config: false,
    type: Object,
    default: {}
  });

  // Recipe library — keyed by recipe id, shareable across boards.
  game.settings.register(MODULE_ID, SETTING_RECIPES, {
    scope: "world",
    config: false,
    type: Object,
    default: {}
  });

  // Public API for macros / dev tools.
  game.modules.get(MODULE_ID).api = { open: openDashboard };

  // Ctrl+Enter while the dashboard is open → roll every tile on the active board.
  game.keybindings.register(MODULE_ID, "rollAll", {
    name: `${I18N_NS}.keybind.rollAll`,
    editable: [{ key: "Enter", modifiers: ["Control"] }],
    onDown: () => rollAllShortcut(),
    restricted: true,
    precedence: foundry.CONST?.KEYBINDING_PRECEDENCE?.NORMAL ?? CONST.KEYBINDING_PRECEDENCE.NORMAL
  });
});

/**
 * Header button on the Roll Tables sidebar directory — the natural home for
 * a roll-table tool. The GM opens the dashboard from there.
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
