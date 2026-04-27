/**
 * item-piles.mjs — Item Piles merchant spawn integration.
 *
 * Loaded only when the `item-piles` module is active. Walks a drawer card's
 * results, resolves each one to a Foundry Item from the cyberpunk-red-core
 * compendia, and creates an Item Piles merchant Actor with those items as
 * inventory.
 *
 * Resolution is best-effort. Result entries fall into three buckets:
 *   - Concrete items: "Heavy Pistol", "Cyberaudio Suite" → looked up by
 *     name in the relevant pack.
 *   - "X or Y" alternates: split on " or ", first hit wins.
 *   - Categories / placeholders ("Programs or Hardware of 100eb or less",
 *     "GM's Choice", "Cybereye Option of exactly 1,000eb") → skipped, and
 *     reported back so the GM knows what they need to add manually.
 *
 * Public API: isItemPilesActive(), resolveCardItems(card),
 * spawnMerchantFromCard(card).
 */

import { MODULE_ID, I18N_NS } from "./constants.mjs";

const CPR_ITEM_PACKS = [
  "cyberpunk-red-core.core_weapons",
  "cyberpunk-red-core.core_weapons-branded",
  "cyberpunk-red-core.core_armor",
  "cyberpunk-red-core.core_cyberware",
  "cyberpunk-red-core.core_gear",
  "cyberpunk-red-core.core_clothing",
  "cyberpunk-red-core.core_drugs",
  "cyberpunk-red-core.core_ammo",
  "cyberpunk-red-core.core_programs"
];

const L = (k) => game.i18n.localize(`${I18N_NS}.${k}`);
const F = (k, d) => game.i18n.format(`${I18N_NS}.${k}`, d);

/* ------------------------------------------------------------------ */
/*  Detection                                                          */
/* ------------------------------------------------------------------ */

export function isItemPilesActive() {
  const mod = game.modules.get("item-piles");
  return !!mod?.active && !!game.itempiles?.API;
}

/* ------------------------------------------------------------------ */
/*  Resolution                                                         */
/* ------------------------------------------------------------------ */

/** Strip HTML, then strip the corebook price tail and fashion suffixes. */
function cleanItemText(text) {
  let s = String(text ?? "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
  // " · 50eb (Costly)" / " — 50eb (Premium)"
  s = s.replace(/\s*[·\-—]+\s*[\d,.]+\s*eb\s*\([^)]+\)\s*$/i, "");
  // "50eb (Costly)" without a separator
  s = s.replace(/\s*[\d,.]+\s*eb\s*\([^)]+\)\s*$/i, "");
  // " (Fashion)" or " [Fashionware]" trailing tag
  s = s.replace(/\s*\(Fashion(?:ware)?\)\s*$/i, "");
  s = s.replace(/\s*\[Fashion(?:ware)?\]\s*$/i, "");
  return s.trim();
}

/**
 * True if the cleaned text is a corebook category/placeholder rather than
 * a single item name. We match these heuristically — the actual list is
 * fixed in the d100 tables.
 */
function isPlaceholder(cleaned) {
  const lower = cleaned.toLowerCase();
  if (/\bgm['']s\s+choice\b/.test(lower)) return true;
  if (/\boption of\b/.test(lower)) return true;        // "Cybereye Option of …"
  if (/\bof\s+(?:exactly|gm)\b/.test(lower)) return true;
  if (/\bof\s+\d/.test(lower)) return true;             // "of 100eb or less"
  if (/^(?:programs or hardware|ammunition|armor|weapon attachments|external cyberware|internal cyberware|street drugs|fashionware|borgware|any cyberware)\b/.test(lower)) return true;
  if (/\bof\s+\d+eb\s*(?:or less|or higher|or more)?\s*$/.test(lower)) return true;
  return false;
}

/**
 * Try to find an Item by name across the candidate CPR compendia.
 * Exact match first, then a startsWith fallback to catch quality variants
 * (`Heavy Pistol` → `Heavy Pistol (Excellent)`).
 */
async function findInPacks(name) {
  const lower = name.toLowerCase();
  for (const packId of CPR_ITEM_PACKS) {
    const pack = game.packs.get(packId);
    if (!pack) continue;
    try {
      await pack.getIndex({ fields: ["name", "type", "img"] });
    } catch {
      continue;
    }
    let entry = pack.index.find((e) => e?.name?.toLowerCase() === lower);
    if (!entry) entry = pack.index.find((e) => e?.name?.toLowerCase().startsWith(`${lower} `));
    if (!entry) continue;
    try {
      const doc = await pack.getDocument(entry._id);
      if (doc) return doc;
    } catch (err) {
      console.warn(`${MODULE_ID} | failed to load ${entry.name} from ${packId}`, err);
    }
  }
  return null;
}

/**
 * Try to resolve a single result text → Item document.
 * Returns null for placeholders or names that don't resolve.
 */
export async function resolveItemFromText(text) {
  const cleaned = cleanItemText(text);
  if (!cleaned) return null;
  if (isPlaceholder(cleaned)) return null;
  const candidates = cleaned.split(/\s+or\s+/i).map((s) => s.trim()).filter(Boolean);
  for (const c of candidates) {
    const item = await findInPacks(c);
    if (item) return item;
  }
  return null;
}

/**
 * Walk a card's node tree, resolving each result and tracking unresolved
 * placeholder text so the GM can be told what was skipped.
 */
export async function resolveCardItems(card) {
  const resolved = [];
  const unresolved = [];
  const visit = async (node) => {
    if (!node?.skipped && node?.result?.text) {
      const item = await resolveItemFromText(node.result.text);
      if (item) resolved.push(item);
      else unresolved.push(cleanItemText(node.result.text));
    }
    for (const g of node?.childGroups ?? []) {
      for (const c of g?.nodes ?? []) await visit(c);
    }
  };
  for (const root of card?.nodes ?? []) await visit(root);
  return { resolved, unresolved };
}

/* ------------------------------------------------------------------ */
/*  Merchant spawn                                                     */
/* ------------------------------------------------------------------ */

export async function spawnMerchantFromCard(card, options = {}) {
  if (!isItemPilesActive()) {
    ui.notifications.warn(L("itemPiles.notInstalled"));
    return null;
  }
  const scene = canvas?.scene;
  if (!scene) {
    ui.notifications.warn(L("itemPiles.noScene"));
    return null;
  }

  const { resolved, unresolved } = await resolveCardItems(card);
  if (!resolved.length) {
    ui.notifications.warn(L("itemPiles.noItemsResolved"));
    if (unresolved.length) {
      console.warn(`${MODULE_ID} | Item Piles: nothing resolved from card "${card.recipeName}". Unresolved entries:`, unresolved);
    }
    return null;
  }

  // Pre-built items array — Item Piles accepts {item, quantity} wrappers.
  const items = resolved.map((doc) => ({
    item: doc.toObject(),
    quantity: 1
  }));

  const ts = new Date(card.timestamp).toLocaleTimeString();
  const merchantName = options.name
    || F("itemPiles.merchantName", { recipe: card.recipeName, time: ts });

  const view = canvas.stage?.pivot;
  const x = Number.isFinite(view?.x) ? view.x : scene.width / 2;
  const y = Number.isFinite(view?.y) ? view.y : scene.height / 2;

  let uuid;
  try {
    uuid = await game.itempiles.API.createItemPile({
      sceneId: scene.id,
      position: { x, y },
      createActor: true,
      itemPileFlags: {
        enabled: true,
        type: game.itempiles.pile_types?.MERCHANT ?? "merchant",
        purchaseOnly: true,
        infiniteQuantity: false,
        infiniteCurrencies: true,
        merchantImage: card.recipeIcon ?? "icons/svg/coins.svg"
      },
      actorOverrides: {
        name: merchantName,
        img: card.recipeIcon ?? "icons/svg/coins.svg"
      },
      items
    });
  } catch (err) {
    console.error(`${MODULE_ID} | Item Piles createItemPile failed`, err);
    ui.notifications.error(L("itemPiles.createFailed"));
    return null;
  }

  const merchant = await fromUuid(uuid).catch(() => null);

  if (unresolved.length) {
    console.info(
      `${MODULE_ID} | Spawned merchant "${merchantName}" with ${resolved.length} items. ` +
      `${unresolved.length} entries did not resolve to compendium items:`,
      unresolved
    );
    ui.notifications.info(F("itemPiles.spawnedMerchantSkipped", {
      count: resolved.length,
      skipped: unresolved.length,
      name: merchantName
    }));
  } else {
    ui.notifications.info(F("itemPiles.spawnedMerchant", {
      count: resolved.length,
      name: merchantName
    }));
  }

  // Open the merchant interface for the GM.
  if (merchant) {
    try {
      await game.itempiles.API.renderItemPileInterface(merchant, {
        userIds: [game.user.id]
      });
    } catch (err) {
      console.warn(`${MODULE_ID} | renderItemPileInterface failed`, err);
    }
  }

  return { merchant, resolvedCount: resolved.length, skippedCount: unresolved.length };
}
