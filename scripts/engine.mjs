/**
 * engine.mjs — recipe evaluation.
 *
 * Walks a recipe tree, rolls each step's table, and produces a render-ready
 * tree of result nodes. Children fire once per parent result; per-step
 * `chance` gates each invocation; `count` controls how many times a step
 * rolls per parent.
 *
 * Output shape (per node):
 *   {
 *     id,                  // unique per draw, used for re-roll targeting
 *     stepId,              // recipe step that produced this node
 *     stepLabel,           // user-visible label
 *     index,               // 1-based index of this roll within its parent
 *     skipped,             // true if chance% gated this off
 *     result: {            // present unless skipped
 *       text, img, documentUuid, raw // raw is the TableResult document
 *     } | null,
 *     childGroups: [       // one group per child step
 *       { stepId, stepLabel, nodes: Node[] }
 *     ]
 *   }
 *
 * The card the drawer renders is just { id, recipeId, recipeName, timestamp,
 * nodes: Node[] } — `nodes` is the root step's per-count results, each with
 * its own subtree.
 */

import { MAX_RECURSION, MODULE_ID } from "./constants.mjs";

/**
 * Roll a recipe and return a card-shaped object ready to render in the
 * drawer. Does NOT post anything to chat — that's the caller's choice.
 *
 * @param {object} recipe        Recipe document (see recipes.mjs)
 * @param {object} [options]
 * @param {(step:object)=>number|null} [options.countOverride]
 *        Optional resolver for prompt-mode counts. Return null/undefined to
 *        fall back to the step's stored count.
 * @returns {Promise<{id, recipeId, recipeName, recipeIcon, timestamp, nodes}>}
 */
export async function rollRecipe(recipe, options = {}) {
  const card = {
    id: foundry.utils.randomID(),
    recipeId: recipe.id,
    recipeName: recipe.name,
    recipeIcon: recipe.icon,
    timestamp: Date.now(),
    nodes: []
  };

  for (const step of recipe.steps ?? []) {
    const nodes = await evaluateStep(step, options, 0);
    card.nodes.push(...nodes);
  }

  return card;
}

/**
 * Roll just one step (and its subtree) — used by per-node "re-roll" buttons
 * in the drawer. Returns a single {stepId, stepLabel, nodes} group rather
 * than a full card.
 */
export async function rollStepSubtree(step, options = {}) {
  const nodes = await evaluateStep(step, options, 0);
  return {
    stepId: step.id,
    stepLabel: step.label || "Step",
    nodes
  };
}

/* ------------------------------------------------------------------ */
/*  Internal                                                           */
/* ------------------------------------------------------------------ */

/**
 * Roll a step `count` times, gating each invocation on `chance`, and
 * recursively roll children once per produced result.
 *
 * Returns an array of nodes — the step's results at this level. The caller
 * splices these into either the card's root list or a parent's child group.
 */
async function evaluateStep(step, options, depth) {
  if (depth > MAX_RECURSION) {
    console.warn(`${MODULE_ID} | recursion cap hit on step "${step?.label || step?.id}"`);
    return [];
  }
  if (!step?.tableUuid) return [];

  const table = await fromUuid(step.tableUuid).catch(() => null);
  const label = step.label || table?.name || "Step";

  const count = resolveCount(step, options);
  const nodes = [];

  for (let i = 0; i < count; i++) {
    // Per-parent-result chance gate.
    const chance = Number.isFinite(step.chance) ? step.chance : 100;
    if (chance < 100 && Math.random() * 100 >= chance) {
      nodes.push({
        id: foundry.utils.randomID(),
        stepId: step.id,
        stepLabel: label,
        index: i + 1,
        skipped: true,
        result: null,
        childGroups: []
      });
      continue;
    }

    if (!table) {
      nodes.push({
        id: foundry.utils.randomID(),
        stepId: step.id,
        stepLabel: label,
        index: i + 1,
        skipped: false,
        result: missingTableResult(),
        childGroups: []
      });
      continue;
    }

    const draw = await rollTableOnce(table);
    const node = {
      id: foundry.utils.randomID(),
      stepId: step.id,
      stepLabel: label,
      index: i + 1,
      skipped: false,
      result: draw,
      childGroups: []
    };

    // Children fire once per parent result. Each child is its own subtree.
    for (const child of step.children ?? []) {
      const childNodes = await evaluateStep(child, options, depth + 1);
      node.childGroups.push({
        stepId: child.id,
        stepLabel: child.label || (await fromUuid(child.tableUuid).catch(() => null))?.name || "Step",
        nodes: childNodes
      });
    }
    nodes.push(node);
  }

  return nodes;
}

function resolveCount(step, options) {
  const stored = Number.isFinite(step.count) ? Math.max(1, step.count) : 1;
  if (step.countMode === "prompt" && typeof options.countOverride === "function") {
    const override = options.countOverride(step);
    if (Number.isFinite(override) && override > 0) return override;
  }
  return stored;
}

/**
 * Use RollTable.draw() with displayChat:false so we get the rolled
 * TableResult(s) without spamming global chat. We render the result
 * ourselves in the drawer.
 */
async function rollTableOnce(table) {
  let draw;
  try {
    draw = await table.draw({ displayChat: false, recursive: true });
  } catch (err) {
    console.error(`${MODULE_ID} | RollTable.draw failed`, err);
    return missingTableResult();
  }

  // Foundry can return >1 result per draw if ranges overlap. Render them
  // as a single concatenated entry — preserve the first result's metadata
  // for things like document links / images.
  const results = Array.isArray(draw?.results) ? draw.results : [];
  if (!results.length) return emptyResult();

  const text = results.map((r) => extractText(r)).filter(Boolean).join(" · ");
  const first = results[0];
  return {
    text: text || (first.text ?? ""),
    img: first.img ?? table?.img ?? null,
    documentUuid: extractDocumentUuid(first),
    raw: first
  };
}

function extractText(tableResult) {
  // v14 / v13 surface a `.text` HTML field; documents have a name we want.
  if (tableResult?.text) return String(tableResult.text);
  if (tableResult?.name) return String(tableResult.name);
  return "";
}

function extractDocumentUuid(tableResult) {
  // v14 stores a single documentUuid; older versions split into collection + id.
  if (tableResult?.documentUuid) return tableResult.documentUuid;
  const coll = tableResult?.documentCollection;
  const id = tableResult?.documentId;
  if (!coll || !id) return null;
  // Compendium pack id contains a dot; world collection is a Document type.
  if (coll.includes(".")) return `Compendium.${coll}.${id}`;
  return `${coll}.${id}`;
}

function emptyResult() {
  return { text: "", img: null, documentUuid: null, raw: null, empty: true };
}

function missingTableResult() {
  return { text: null, img: null, documentUuid: null, raw: null, missing: true };
}
