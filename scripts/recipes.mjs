/**
 * recipes.mjs — recipe CRUD + persistence helpers.
 *
 * A "recipe" is a tree of steps that a tile rolls. The simplest recipe is one
 * step pointing at a single RollTable; the most complex is several nested
 * steps with per-step count, chance, and optional flags.
 *
 * Step shape:
 *   {
 *     id: "uuid",
 *     tableUuid: "RollTable.abc",
 *     label: "Archetype",          // override; defaults to table name
 *     count: 1,
 *     countMode: "fixed" | "prompt",
 *     optional: false,             // GM toggles per-roll in the popup
 *     chance: 100,                 // 1..100; rolled per parent result
 *     children: [Step, Step, ...]  // children fire once per parent result
 *   }
 *
 * Recipe shape:
 *   {
 *     id, name, icon, steps: [Step, ...], createdAt, updatedAt
 *   }
 *
 * Recipes live in a single world setting (`recipes` object keyed by id) so
 * they're shareable across scenes/tabs. Tiles only store { recipeId, x, y }.
 */

import { MODULE_ID, SETTING_RECIPES } from "./constants.mjs";

export const DEFAULT_TILE_ICON = "icons/svg/d20-grey.svg";

/* ---------- factory ---------- */

export function makeStep(partial = {}) {
  return {
    id: foundry.utils.randomID(),
    tableUuid: partial.tableUuid ?? null,
    label: partial.label ?? "",
    count: Number.isFinite(partial.count) ? Math.max(1, partial.count) : 1,
    countMode: partial.countMode === "prompt" ? "prompt" : "fixed",
    optional: !!partial.optional,
    chance: Number.isFinite(partial.chance) ? clamp(partial.chance, 1, 100) : 100,
    children: Array.isArray(partial.children) ? partial.children.map(makeStep) : []
  };
}

export function makeRecipe(partial = {}) {
  const now = Date.now();
  return {
    id: partial.id ?? foundry.utils.randomID(),
    name: partial.name ?? "Untitled recipe",
    icon: partial.icon ?? DEFAULT_TILE_ICON,
    steps: Array.isArray(partial.steps) ? partial.steps.map(makeStep) : [],
    createdAt: partial.createdAt ?? now,
    updatedAt: now
  };
}

/**
 * Build a single-step recipe from a RollTable document. Used when the GM
 * drags a table from the sidebar onto the canvas — instant tile, no dialog.
 */
export function recipeFromTable(table) {
  return makeRecipe({
    name: table?.name ?? "Untitled recipe",
    icon: table?.img ?? DEFAULT_TILE_ICON,
    steps: [makeStep({ tableUuid: table?.uuid, label: table?.name ?? "" })]
  });
}

/* ---------- persistence ---------- */

export function readRecipes() {
  const raw = game.settings.get(MODULE_ID, SETTING_RECIPES);
  return (raw && typeof raw === "object") ? raw : {};
}

export async function writeRecipes(recipes) {
  return game.settings.set(MODULE_ID, SETTING_RECIPES, recipes);
}

export function getRecipe(id) {
  const all = readRecipes();
  return id ? all[id] ?? null : null;
}

export async function upsertRecipe(recipe) {
  const all = readRecipes();
  const normalized = { ...recipe, updatedAt: Date.now() };
  all[recipe.id] = normalized;
  await writeRecipes(all);
  return normalized;
}

export async function deleteRecipe(id) {
  if (!id) return false;
  const all = readRecipes();
  if (!(id in all)) return false;
  delete all[id];
  await writeRecipes(all);
  return true;
}

/* ---------- utilities ---------- */

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}
