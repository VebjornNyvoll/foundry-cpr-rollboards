export const MODULE_ID = "foundry-cpr-rollboards";

// i18n namespace — uppercase, hyphens, mirrors module id.
export const I18N_NS = "FOUNDRY-CPR-ROLLBOARDS";

// World settings keyed off the module id.
export const SETTING_BOARDS = "boards";    // { [id]: Board }
export const SETTING_RECIPES = "recipes";  // { [id]: Recipe }

// Tunables.
export const TILE_SIZE = 64;
export const NAME_HEIGHT = 18;
export const DRAG_THRESHOLD = 4;     // px before pointer-down promotes to drag
export const CANVAS_PADDING = 32;    // extra room around the outermost tile
export const MAX_DRAW_HISTORY = 50;  // drawer cards retained per session
export const MAX_RECURSION = 8;      // safety cap on chained-step depth
