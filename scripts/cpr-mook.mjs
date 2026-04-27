/**
 * cpr-mook.mjs — Cyberpunk Red Mook generator.
 *
 * Loads only when the active system is `cyberpunk-red-core`. Provides:
 *   - 4 archetype presets (Booster, Tech, Solo, Generic) with stat blocks,
 *     suggested role, and a small inline skill package.
 *   - A dialog opened from drawer result rows: pick name + archetype + role,
 *     optionally place a token on the active scene.
 *   - createMook(...) — builds the Actor data, resolves role/skills from the
 *     CPR system compendiums when present, falls back to inline items if a
 *     pack is missing, and creates the Actor (and token).
 *
 * Defensive about pack ids — best-guesses against the released CPR system
 * layout — and tolerant when an item can't be found. The Actor is always
 * created with stats + role; missing packs only mean fewer pre-embedded
 * items, never a hard failure.
 */

import { MODULE_ID, I18N_NS } from "./constants.mjs";

export const CPR_SYSTEM_ID = "cyberpunk-red-core";

/**
 * Pack ids in cyberpunk-red-core. Verified against `src/system.json` on the
 * `dev` branch. Skills live in the `internal_*` group, gear in `core_*`.
 */
const CPR_PACKS = {
  skills:    `${CPR_SYSTEM_ID}.internal_skills`,
  roles:     `${CPR_SYSTEM_ID}.core_roles`,
  weapons:   `${CPR_SYSTEM_ID}.core_weapons`,
  armor:     `${CPR_SYSTEM_ID}.core_armor`,
  cyberware: `${CPR_SYSTEM_ID}.core_cyberware`
};

/**
 * Canonical role names. Stored verbatim in `system.roleInfo.activeRole` and
 * also used for the compendium lookup (the role item's `name` field matches).
 * The system's update-role-from-item hook writes `doc.name` directly, so the
 * value here MUST match the corebook spelling.
 */
export const ROLES = [
  "Exec", "Fixer", "Lawman", "Media", "Medtech",
  "Netrunner", "Nomad", "Rockerboy", "Solo", "Tech"
];

/**
 * Archetype presets. All item names verified against the `cyberpunk-red-core`
 * compendium yaml source on the `dev` branch (Apr 2026).
 *
 *   - stats: 10 stat values
 *   - role: canonical role NAME (matches the role item in core_roles)
 *   - skills: [{ name, level, stat }] — verified against internal_skills;
 *     created inline if a compendium hit fails
 *   - weapons / armor / cyberware: [name] — fetched from corresponding pack
 *     by exact name. Armor is split into Body/Head entries to match how the
 *     CPR system models head + body locations.
 */
export const ARCHETYPES = {
  booster: {
    label: "Booster (gang grunt)",
    role: "Solo",
    stats: { int: 4, ref: 6, dex: 5, tech: 3, cool: 5, will: 5, luck: 4, move: 5, body: 6, emp: 3 },
    skills: [
      { name: "Athletics",     level: 4, stat: "dex" },
      { name: "Brawling",      level: 4, stat: "dex" },
      { name: "Concentration", level: 2, stat: "will" },
      { name: "Endurance",     level: 4, stat: "will" },
      { name: "Evasion",       level: 4, stat: "dex" },
      { name: "Handgun",       level: 4, stat: "ref" },
      { name: "Melee Weapon",  level: 4, stat: "dex" },
      { name: "Perception",    level: 3, stat: "int" },
      { name: "Resist Torture/Drugs", level: 2, stat: "will" },
      { name: "Streetwise",    level: 4, stat: "cool" }
    ],
    // Cheap gang-tier gear — Poor-quality variants intentionally.
    weapons: ["Heavy Pistol (Poor)", "Medium Melee (Poor)"],
    armor: ["Light Armorjack (Body)", "Light Armorjack (Head)"],
    cyberware: ["Rippers"]
  },
  tech: {
    label: "Tech (gang specialist)",
    role: "Tech",
    stats: { int: 6, ref: 5, dex: 5, tech: 7, cool: 4, will: 5, luck: 5, move: 5, body: 4, emp: 5 },
    skills: [
      { name: "Athletics",          level: 2, stat: "dex" },
      { name: "Basic Tech",         level: 6, stat: "tech" },
      { name: "Cybertech",          level: 6, stat: "tech" },
      { name: "Electronics/Security Tech", level: 6, stat: "tech" },
      { name: "Handgun",            level: 3, stat: "ref" },
      { name: "Land Vehicle Tech",  level: 4, stat: "tech" },
      { name: "Perception",         level: 4, stat: "int" },
      { name: "Persuasion",         level: 3, stat: "cool" },
      { name: "Streetwise",         level: 3, stat: "cool" }
    ],
    weapons: ["Medium Pistol"],
    armor: ["Light Armorjack (Body)", "Light Armorjack (Head)"],
    cyberware: ["Cyberaudio Suite", "Interface Plugs", "Tool Hand"]
  },
  solo: {
    label: "Solo (combat specialist)",
    role: "Solo",
    stats: { int: 5, ref: 7, dex: 6, tech: 4, cool: 6, will: 6, luck: 5, move: 6, body: 7, emp: 4 },
    skills: [
      { name: "Athletics",     level: 6, stat: "dex" },
      { name: "Brawling",      level: 5, stat: "dex" },
      { name: "Concentration", level: 4, stat: "will" },
      { name: "Endurance",     level: 6, stat: "will" },
      { name: "Evasion",       level: 6, stat: "dex" },
      { name: "Handgun",       level: 6, stat: "ref" },
      { name: "Heavy Weapons", level: 4, stat: "ref" },
      { name: "Melee Weapon",  level: 5, stat: "dex" },
      { name: "Perception",    level: 5, stat: "int" },
      { name: "Shoulder Arms", level: 6, stat: "ref" },
      { name: "Stealth",       level: 4, stat: "dex" },
      { name: "Tactics",       level: 4, stat: "int" }
    ],
    weapons: ["Assault Rifle", "Very Heavy Pistol"],
    armor: ["Medium Armorjack (Body)", "Medium Armorjack (Head)"],
    cyberware: ["Sandevistan", "Kerenzikov", "Cybereye", "Targeting Scope", "Subdermal Armor"]
  },
  generic: {
    label: "Generic NPC",
    role: "Fixer",
    stats: { int: 5, ref: 5, dex: 5, tech: 5, cool: 5, will: 5, luck: 5, move: 5, body: 5, emp: 5 },
    skills: [
      { name: "Athletics",      level: 2, stat: "dex" },
      { name: "Brawling",       level: 2, stat: "dex" },
      { name: "Concentration",  level: 2, stat: "will" },
      { name: "Conversation",   level: 3, stat: "emp" },
      { name: "Education",      level: 2, stat: "int" },
      { name: "Handgun",        level: 2, stat: "ref" },
      { name: "Human Perception", level: 3, stat: "emp" },
      { name: "Local Expert (Your Home)", level: 3, stat: "int" },
      { name: "Perception",     level: 3, stat: "int" },
      { name: "Persuasion",     level: 3, stat: "cool" }
    ],
    weapons: [],
    armor: [],
    cyberware: []
  }
};

/** Detect whether the CPR system is active. */
export function isCprActive() {
  return game.system?.id === CPR_SYSTEM_ID;
}

/* ------------------------------------------------------------------ */
/*  Compendium helpers                                                 */
/* ------------------------------------------------------------------ */

async function findInPackByName(packId, name) {
  if (!name) return null;
  const pack = game.packs.get(packId);
  if (!pack) {
    console.warn(`${MODULE_ID} | compendium pack "${packId}" not found`);
    return null;
  }
  // Lazily build the index — case-insensitive name match.
  await pack.getIndex();
  const entry = pack.index.find((e) => e?.name?.toLowerCase() === name.toLowerCase());
  if (!entry) {
    console.warn(`${MODULE_ID} | "${name}" not found in pack "${packId}"`);
    return null;
  }
  try {
    return await pack.getDocument(entry._id);
  } catch (err) {
    console.warn(`${MODULE_ID} | failed to fetch "${name}" from ${packId}`, err);
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Mook builder                                                       */
/* ------------------------------------------------------------------ */

/**
 * @typedef {Object} CreateMookOpts
 * @property {string} name              actor name
 * @property {string} archetype         key in ARCHETYPES
 * @property {string} [role]            override role id (default = archetype.role)
 * @property {string} [notes]           free-form text dropped into system.information.notes
 * @property {boolean} [placeToken]     drop a token on the current scene
 */

/**
 * Build + create a CPR mook actor. Returns the created Actor (or null).
 *
 * Tries to embed the role + skills + weapons + armor + cyberware suggested
 * by the archetype. Each lookup is independent and tolerant of missing
 * compendiums — if a pack is absent or an item name doesn't resolve, we
 * fall back to creating a simple inline item (skills) or skipping (gear).
 *
 * @param {CreateMookOpts} opts
 */
export async function createMook(opts) {
  if (!isCprActive()) {
    ui.notifications.warn(game.i18n.localize(`${I18N_NS}.mook.systemMissing`));
    return null;
  }

  const archetype = ARCHETYPES[opts.archetype] ?? ARCHETYPES.generic;
  // The CPR system stores the role's NAME (e.g. "Solo") in activeRole — not
  // a slug. ROLES is canonical-cased to match.
  const roleName = ROLES.includes(opts.role) ? opts.role : (archetype.role ?? "Fixer");

  const items = [];

  // Role — prefer the compendium entry so the user sees the proper role item.
  // Fallback inline if the pack/name miss.
  const roleDoc = await findInPackByName(CPR_PACKS.roles, roleName);
  if (roleDoc) {
    items.push(roleDoc.toObject());
  } else {
    items.push({
      type: "role",
      name: roleName,
      img: "icons/svg/mystery-man.svg",
      system: {}
    });
  }

  // Skills — try compendium first, fallback to a minimal inline skill item.
  for (const sk of archetype.skills) {
    const doc = await findInPackByName(CPR_PACKS.skills, sk.name);
    if (doc) {
      const obj = doc.toObject();
      // Override the level + stat from the archetype recipe.
      obj.system ??= {};
      obj.system.level = sk.level;
      obj.system.stat = sk.stat;
      items.push(obj);
    } else {
      items.push({
        type: "skill",
        name: sk.name,
        img: "icons/svg/d20-grey.svg",
        system: { level: sk.level, stat: sk.stat, category: "" }
      });
    }
  }

  // Gear — only embedded if the compendium lookup hits. Skip silently otherwise.
  for (const wname of archetype.weapons) {
    const doc = await findInPackByName(CPR_PACKS.weapons, wname);
    if (doc) items.push(doc.toObject());
  }
  for (const aname of archetype.armor) {
    const doc = await findInPackByName(CPR_PACKS.armor, aname);
    if (doc) items.push(doc.toObject());
  }
  for (const cname of archetype.cyberware) {
    const doc = await findInPackByName(CPR_PACKS.cyberware, cname);
    if (doc) items.push(doc.toObject());
  }

  const stats = archetype.stats;
  const data = {
    name: opts.name?.trim() || "Mook",
    type: "mook",
    img: "icons/svg/mystery-man.svg",
    system: {
      stats: {
        int:  { value: stats.int },
        ref:  { value: stats.ref },
        dex:  { value: stats.dex },
        tech: { value: stats.tech },
        cool: { value: stats.cool },
        will: { value: stats.will },
        luck: { value: stats.luck, max: stats.luck },
        move: { value: stats.move },
        body: { value: stats.body },
        emp:  { value: stats.emp, max: stats.emp, min: -10 }
      },
      information: {
        alias: "",
        description: "",
        history: "",
        notes: opts.notes ?? ""
      },
      roleInfo: {
        activeRole: roleName,
        activeNetRole: ""
      }
    },
    items,
    prototypeToken: {
      name: opts.name?.trim() || "Mook",
      displayName: 30, // CONST.TOKEN_DISPLAY_MODES.HOVER
      disposition: -1, // hostile
      actorLink: false
    }
  };

  let actor;
  try {
    actor = await Actor.implementation.create(data);
  } catch (err) {
    console.error(`${MODULE_ID} | Actor.create failed`, err);
    ui.notifications.error(game.i18n.localize(`${I18N_NS}.mook.createFailed`));
    return null;
  }
  if (!actor) return null;

  // Place a token at the centre of the active scene's view.
  if (opts.placeToken) {
    try {
      const scene = canvas?.scene;
      if (!scene) {
        ui.notifications.warn(game.i18n.localize(`${I18N_NS}.mook.noScene`));
      } else {
        const view = canvas.stage?.pivot;
        const x = Number.isFinite(view?.x) ? view.x : scene.width / 2;
        const y = Number.isFinite(view?.y) ? view.y : scene.height / 2;
        const td = await actor.getTokenDocument({ x, y });
        await scene.createEmbeddedDocuments("Token", [td.toObject()]);
      }
    } catch (err) {
      console.error(`${MODULE_ID} | Token placement failed`, err);
      ui.notifications.warn(game.i18n.localize(`${I18N_NS}.mook.tokenFailed`));
    }
  }

  return actor;
}

/* ------------------------------------------------------------------ */
/*  Dialog                                                             */
/* ------------------------------------------------------------------ */

/**
 * Open the Make Mook dialog. Pre-fills name + notes from a drawer result.
 *
 * @param {{name?: string, notes?: string, defaultArchetype?: string, defaultRole?: string}} [seed]
 */
export async function openMookDialog(seed = {}) {
  if (!isCprActive()) {
    ui.notifications.warn(game.i18n.localize(`${I18N_NS}.mook.systemMissing`));
    return null;
  }

  const archetypeOptions = Object.entries(ARCHETYPES)
    .map(([k, v]) => `<option value="${k}"${k === seed.defaultArchetype ? " selected" : ""}>${v.label}</option>`)
    .join("");
  const roleOptions = ROLES
    .map((r) => `<option value="${r}"${r === seed.defaultRole ? " selected" : ""}>${r}</option>`)
    .join("");

  const L = (k) => game.i18n.localize(`${I18N_NS}.${k}`);

  const content = `
    <div class="fcr-dialog-form">
      <label>${L("mook.name")}</label>
      <input type="text" name="name" value="${(seed.name ?? "").replace(/"/g, "&quot;")}" autofocus />
      <label>${L("mook.archetype")}</label>
      <select name="archetype">${archetypeOptions}</select>
      <label>${L("mook.role")}</label>
      <select name="role">${roleOptions}</select>
      <label>${L("mook.notes")}</label>
      <textarea name="notes" rows="4">${(seed.notes ?? "").replace(/</g, "&lt;")}</textarea>
      <p class="fcr-dialog-hint">${L("mook.hint")}</p>
    </div>`;

  return new Promise((resolve) => {
    const handler = async (root, placeToken) => {
      const name = root.querySelector("input[name=name]").value.trim();
      const archetype = root.querySelector("select[name=archetype]").value;
      const role = root.querySelector("select[name=role]").value;
      const notes = root.querySelector("textarea[name=notes]").value;
      const actor = await createMook({ name, archetype, role, notes, placeToken });
      if (actor) {
        ui.notifications.info(game.i18n.format(`${I18N_NS}.mook.created`, { name: actor.name }));
        try { actor.sheet?.render(true); } catch {}
      }
      resolve(actor);
    };

    new Dialog({
      title: L("mook.dialogTitle"),
      content,
      buttons: {
        create: {
          icon: '<i class="fas fa-user-plus"></i>',
          label: L("mook.create"),
          callback: (html) => handler(html instanceof jQuery ? html[0] : html, false)
        },
        place: {
          icon: '<i class="fas fa-map-marker-alt"></i>',
          label: L("mook.createAndPlace"),
          callback: (html) => handler(html instanceof jQuery ? html[0] : html, true)
        },
        cancel: {
          icon: '<i class="fas fa-times"></i>',
          label: L("cancel"),
          callback: () => resolve(null)
        }
      },
      default: "create",
      close: () => resolve(null)
    }, { classes: ["foundry-cpr-rollboards", "dialog"], width: 460 }).render(true);
  });
}
