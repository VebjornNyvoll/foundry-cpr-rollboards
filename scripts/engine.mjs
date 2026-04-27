/**
 * engine.mjs — recipe evaluation.
 *
 * Walks a recipe tree, rolls each step's table, and produces a render-ready
 * tree of result nodes. Children fire once per parent result; per-step
 * `chance` gates each invocation; `count` controls how many times a step
 * rolls per parent.
 *
 * Step kinds:
 *   - "normal" — rolls its tableUuid `count` times, each result gets the
 *     full child subtree fired against it.
 *   - "switch" — picks a single child branch by matching the parent
 *     result's text against each branch's `matches` field, and evaluates
 *     that branch as if it were the original step. Children of a switch
 *     are branches, not parallel sub-steps.
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
 *     childGroups: [       // one group per child step (never set on switches)
 *       { stepId, stepLabel, nodes: Node[] }
 *     ]
 *   }
 *
 * The card the drawer renders is just { id, recipeId, recipeName, timestamp,
 * nodes: Node[] } — `nodes` is the root step's per-count results, each with
 * its own subtree.
 */

import { MAX_RECURSION, MODULE_ID } from "./constants.mjs";

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
    const nodes = await evaluateStep(step, options, 0, null);
    card.nodes.push(...nodes);
  }

  return card;
}

export async function rollStepSubtree(step, options = {}) {
  const nodes = await evaluateStep(step, options, 0, null);
  return {
    stepId: step.id,
    stepLabel: step.label || "Step",
    nodes
  };
}

/* ------------------------------------------------------------------ */
/*  Internal                                                           */
/* ------------------------------------------------------------------ */

async function evaluateStep(step, options, depth, parentResultText) {
  if (depth > MAX_RECURSION) {
    console.warn(`${MODULE_ID} | recursion cap hit on step "${step?.label || step?.id}"`);
    return [];
  }
  if (!step) return [];

  // Switch step: doesn't roll a table. Picks the matching branch by
  // parent-result text and evaluates that branch in place.
  if (step.kind === "switch") {
    return await evaluateSwitchStep(step, options, depth, parentResultText);
  }

  if (!step.tableUuid) return [];

  const table = await fromUuid(step.tableUuid).catch(() => null);
  const label = step.label || table?.name || "Step";

  const count = await resolveCount(step, options);
  const seen = step.unique ? new Set() : null;
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

    const draw = await rollTableOnce(table, seen);
    const node = {
      id: foundry.utils.randomID(),
      stepId: step.id,
      stepLabel: label,
      index: i + 1,
      skipped: false,
      result: draw,
      childGroups: []
    };

    // Children fire once per parent result; each child gets THIS roll's
    // text so a switch child can branch on it.
    const thisText = stripTags(draw?.text);
    for (const child of step.children ?? []) {
      const childNodes = await evaluateStep(child, options, depth + 1, thisText);
      node.childGroups.push({
        stepId: child.id,
        stepLabel: child.label
          || (await fromUuid(child.tableUuid).catch(() => null))?.name
          || (child.kind === "switch" ? "Switch" : "Step"),
        nodes: childNodes
      });
    }
    nodes.push(node);
  }

  return nodes;
}

/**
 * Switch step — pick the first child whose `matches` field matches the
 * parent result text. Fallback: a child with empty/`*` matches. If no
 * branch matches, return a single skipped node so the drawer shows "no
 * branch fired" instead of silently dropping the step.
 */
async function evaluateSwitchStep(step, options, depth, parentResultText) {
  const branches = step.children ?? [];
  if (!branches.length) return [];

  let matched = branches.find((c) => matchesRule(c.matches, parentResultText));
  if (!matched) {
    matched = branches.find((c) => !c.matches || c.matches === "*");
  }
  if (!matched) {
    return [{
      id: foundry.utils.randomID(),
      stepId: step.id,
      stepLabel: step.label || "Switch",
      index: 1,
      skipped: true,
      result: { text: `(no branch matched "${parentResultText ?? ""}")`, img: null, documentUuid: null, raw: null, empty: true },
      childGroups: []
    }];
  }

  // Evaluate the matched branch as a normal step. Its results become the
  // switch step's results directly.
  return await evaluateStep(matched, options, depth + 1, parentResultText);
}

/** Case-insensitive substring match. Empty rule = always match. */
function matchesRule(rule, text) {
  if (!rule || rule === "*") return true;
  if (!text) return false;
  return String(text).toLowerCase().includes(String(rule).toLowerCase());
}

async function resolveCount(step, options) {
  const stored = Number.isFinite(step.count) ? Math.max(1, step.count) : 1;
  if (step.countMode === "prompt" && typeof options.countOverride === "function") {
    const override = options.countOverride(step);
    if (Number.isFinite(override) && override > 0) return override;
  }
  if (step.countMode === "random" && step.countFormula) {
    try {
      const roll = await new Roll(step.countFormula).roll({ async: true });
      const v = Number(roll?.total);
      if (Number.isFinite(v) && v > 0) return Math.max(1, Math.floor(v));
    } catch (err) {
      console.warn(`${MODULE_ID} | invalid countFormula "${step.countFormula}" — falling back to ${stored}`, err);
    }
  }
  return stored;
}

/**
 * Roll a table, retrying on duplicates if `seen` is provided (a Set of
 * already-drawn result texts). Bails after a fixed retry budget so
 * exhausted tables don't loop forever.
 */
async function rollTableOnce(table, seen) {
  const RETRY_BUDGET = 24; // ~2× a typical d100 to account for narrow ranges
  for (let attempt = 0; attempt < (seen ? RETRY_BUDGET : 1); attempt++) {
    let draw;
    try {
      draw = await table.draw({ displayChat: false, recursive: true });
    } catch (err) {
      console.error(`${MODULE_ID} | RollTable.draw failed`, err);
      return missingTableResult();
    }

    const results = Array.isArray(draw?.results) ? draw.results : [];
    if (!results.length) return emptyResult();

    const text = results.map((r) => extractText(r)).filter(Boolean).join(" · ");
    const key = stripTags(text || results[0]?.text || "");

    if (seen && seen.has(key)) continue; // duplicate — try again

    if (seen) seen.add(key);
    const first = results[0];
    return {
      text: text || (first.text ?? ""),
      img: first.img ?? table?.img ?? null,
      documentUuid: extractDocumentUuid(first),
      raw: first
    };
  }
  // Exhausted the table — fall through with a one-off draw so we still return something.
  return rollTableOnce(table, null);
}

function extractText(tableResult) {
  if (tableResult?.text) return String(tableResult.text);
  if (tableResult?.name) return String(tableResult.name);
  return "";
}

function extractDocumentUuid(tableResult) {
  if (tableResult?.documentUuid) return tableResult.documentUuid;
  const coll = tableResult?.documentCollection;
  const id = tableResult?.documentId;
  if (!coll || !id) return null;
  if (coll.includes(".")) return `Compendium.${coll}.${id}`;
  return `${coll}.${id}`;
}

function stripTags(html) {
  if (!html) return "";
  return String(html).replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function emptyResult() {
  return { text: "", img: null, documentUuid: null, raw: null, empty: true };
}

function missingTableResult() {
  return { text: null, img: null, documentUuid: null, raw: null, missing: true };
}
