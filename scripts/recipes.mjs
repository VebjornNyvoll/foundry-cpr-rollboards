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

/* ---------- tree utilities (mutate in place; caller persists) ---------- */

/** Total number of steps in the tree (root + descendants), or 0. */
export function countSteps(recipe) {
  if (!recipe?.steps?.length) return 0;
  let n = 0;
  const walk = (steps) => {
    for (const s of steps) {
      n++;
      if (s.children?.length) walk(s.children);
    }
  };
  walk(recipe.steps);
  return n;
}

/** Locate a step by id anywhere in the recipe tree. Returns null if missing. */
export function findStep(recipe, stepId) {
  if (!recipe?.steps || !stepId) return null;
  const stack = [...recipe.steps];
  while (stack.length) {
    const s = stack.pop();
    if (s.id === stepId) return s;
    if (s.children?.length) stack.push(...s.children);
  }
  return null;
}

/**
 * Find the array containing a step plus its index in that array. Returns
 * { list, index, parent } where `parent` is the parent step (or null for
 * root). `null` if the step doesn't exist.
 */
export function findStepLocation(recipe, stepId) {
  if (!recipe?.steps || !stepId) return null;
  if (recipe.steps.some((s, i) => s.id === stepId)) {
    const i = recipe.steps.findIndex((s) => s.id === stepId);
    return { list: recipe.steps, index: i, parent: null };
  }
  const stack = [...recipe.steps];
  while (stack.length) {
    const s = stack.pop();
    if (!s.children) continue;
    const idx = s.children.findIndex((c) => c.id === stepId);
    if (idx >= 0) return { list: s.children, index: idx, parent: s };
    stack.push(...s.children);
  }
  return null;
}

/** Remove a step (and its subtree) from the recipe in place. Returns it or null. */
export function removeStep(recipe, stepId) {
  const loc = findStepLocation(recipe, stepId);
  if (!loc) return null;
  return loc.list.splice(loc.index, 1)[0] ?? null;
}

/**
 * Add a step to a recipe. If parentStepId is null/undefined, append to the
 * root step list; otherwise append to that parent's children.
 */
export function addStep(recipe, parentStepId, step) {
  if (!parentStepId) {
    if (!Array.isArray(recipe.steps)) recipe.steps = [];
    recipe.steps.push(step);
    return step;
  }
  const parent = findStep(recipe, parentStepId);
  if (!parent) return null;
  if (!Array.isArray(parent.children)) parent.children = [];
  parent.children.push(step);
  return step;
}

/** Move an existing step under a new parent (or root if newParentId is null). */
export function moveStep(recipe, stepId, newParentId, newIndex) {
  if (stepId === newParentId) return false;
  // Refuse to move a step under one of its own descendants — that would orphan the tree.
  if (newParentId && isDescendant(recipe, stepId, newParentId)) return false;
  const removed = removeStep(recipe, stepId);
  if (!removed) return false;
  const targetList = newParentId ? findStep(recipe, newParentId)?.children : recipe.steps;
  if (!targetList) {
    // Restore — move target vanished.
    recipe.steps.push(removed);
    return false;
  }
  const idx = (typeof newIndex === "number" && newIndex >= 0 && newIndex <= targetList.length)
    ? newIndex
    : targetList.length;
  targetList.splice(idx, 0, removed);
  return true;
}

function isDescendant(recipe, ancestorId, candidateId) {
  const ancestor = findStep(recipe, ancestorId);
  if (!ancestor) return false;
  const stack = [...(ancestor.children ?? [])];
  while (stack.length) {
    const s = stack.pop();
    if (s.id === candidateId) return true;
    if (s.children?.length) stack.push(...s.children);
  }
  return false;
}

/* ---------- utilities ---------- */

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}
