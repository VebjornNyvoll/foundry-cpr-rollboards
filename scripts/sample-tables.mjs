/**
 * sample-tables.mjs — starter Cyberpunk Red roll tables and a pre-built
 * Night Market recipe.
 *
 * One-click import creates the tables as world RollTable documents and a
 * matching Recipe in the recipe library, so the GM can drag a fully-wired
 * Night Market generator onto a board on day one.
 *
 * importSampleTables() is idempotent on a per-name basis: it skips any
 * RollTable whose name already exists and the recipe if a recipe with the
 * same name exists.
 *
 * The Night Market tables and procedure are reproduced verbatim from the
 * Cyberpunk RED corebook (R. Talsorian Games, 2020) pp. 337-339. This
 * module is private and personal-use, so reproduction is fine.
 */

import { MODULE_ID, I18N_NS } from "./constants.mjs";
import { makeRecipe, makeStep, upsertRecipe, readRecipes } from "./recipes.mjs";

const TABLE_RESULT_TEXT = 0; // CONST.TABLE_RESULT_TYPES.TEXT

/**
 * Build a TableResult-shaped row with an explicit range. For tables that
 * use 1d100 with 5%-bucket entries, each row's range matches the corebook.
 */
function rangedResult(low, high, text) {
  return {
    type: TABLE_RESULT_TEXT,
    text,
    weight: high - low + 1,
    range: [low, high]
  };
}

/** Equal-weight 1-bucket entry for tables not using a fixed-d100 range. */
function textResult(text) {
  return {
    type: TABLE_RESULT_TEXT,
    text,
    weight: 1,
    range: [0, 0]
  };
}

function evenTable(name, formula, entries, description = "") {
  return {
    name,
    formula,
    description,
    img: "icons/svg/d20-grey.svg",
    replacement: true,
    displayRoll: true,
    results: entries.map(textResult)
  };
}

function rangedTable(name, formula, entries, description = "") {
  return {
    name,
    formula,
    description,
    img: "icons/svg/d20-grey.svg",
    replacement: true,
    displayRoll: true,
    results: entries.map(([lo, hi, text]) => rangedResult(lo, hi, text))
  };
}

/* ============================================================
 *  Generic CPR sample tables (kept from earlier release)
 * ============================================================ */

const GENERIC_TABLES = [
  evenTable(
    "CPR — NPC Archetype",
    "1d10",
    [
      "Booster (gang grunt)",
      "Tech (gang specialist)",
      "Solo (combat specialist)",
      "Netrunner",
      "Medtech",
      "Media",
      "Exec",
      "Lawman",
      "Fixer",
      "Nomad"
    ],
    "Roll for a random Cyberpunk Red NPC archetype. Pair with the Mook generator to spawn a drop-ready actor."
  ),
  evenTable(
    "CPR — NPC Quirk",
    "1d10",
    [
      "Twitchy under bright lights",
      "Vegan in a meat-grinder world",
      "Misses the old gang",
      "Paranoid about netrunners",
      "Carries a battered photograph of someone gone",
      "Compulsively counts cyberware modifications",
      "Hums old corp jingles when nervous",
      "Speaks only in whispers in public",
      "Refuses to use elevators",
      "Believes Night City is haunted"
    ]
  ),
  evenTable(
    "CPR — Random Job / Hustle",
    "1d10",
    [
      "Bouncer at a Combat Zone bar",
      "Cyberware mod runner",
      "Drug courier on the strip",
      "Bodyguard for a minor corp exec",
      "Information broker on the netscape",
      "Gun runner moving stolen merch",
      "Tech specialist patching cyberdecks",
      "Streetside ripperdoc",
      "Smuggler for a Nomad pack",
      "Combat-zone enforcer for hire"
    ]
  ),
  evenTable(
    "CPR — Gang Type",
    "1d10",
    [
      "Maelstrom (chrome-obsessed psychos)",
      "Tyger Claws (mono-katana enforcers)",
      "Voodoo Boys (netrunner mystics)",
      "6th Street (veteran self-defence)",
      "Animals (combat-drugs muscle)",
      "Valentinos (operatic gun gang)",
      "Scavengers (cyberware harvesters)",
      "Wraiths (Badlands raiders)",
      "Iron Lords (Combat Zone warlords)",
      "Independent crew (no flag, just contract)"
    ]
  ),
  evenTable(
    "CPR — Encounter Hook",
    "1d10",
    [
      "Crashed AV-4 leaks fuel onto a crowded street",
      "Drone surveillance drones spot the party",
      "Two corp suits exchange a black case under a streetlight",
      "Gang firefight rolls down the block",
      "Ripperdoc stumbles out screaming about a botched job",
      "A child grabs the party's sleeve, points at a roof",
      "Police drone hovers, scanning faces",
      "Nomad caravan asks for an escort to the city limits",
      "Strange neon flicker — netrunner is overlaying AR ads",
      "Medical scream sirens converge on the next block"
    ]
  )
];

/* ============================================================
 *  Night Market — corebook pp. 337-339
 * ============================================================ */

const NM_CATEGORIES = evenTable(
  "CPR — NM Categories (1d6)",
  "1d6",
  [
    "Food and Drugs",
    "Personal Electronics",
    "Weapons and Armor",
    "Cyberware",
    "Clothing and Fashionware",
    "Survival Gear"
  ],
  "Step 1 of the Night Market generator: roll twice (unique) on this table to pick the two goods categories at the market. Cyberpunk RED corebook pg. 338."
);

const NM_FOOD_AND_DRUGS = rangedTable(
  "CPR — NM: Food and Drugs",
  "1d100",
  [
    [1, 5,    "Canned Goods · 10eb (Cheap)"],
    [6, 10,   "Packaged Goods · 10eb (Cheap)"],
    [11, 15,  "Frozen Goods · 10eb (Cheap)"],
    [16, 20,  "Bags of Grain · 20eb (Everyday)"],
    [21, 25,  "Kibble Pack · 10eb (Cheap)"],
    [26, 30,  "Bags of Prepak · 20eb (Everyday)"],
    [31, 35,  "Street Drugs of 20eb or less"],
    [36, 40,  "Poor Quality Alcohol · 10eb (Cheap)"],
    [41, 45,  "Alcohol · 20eb (Everyday)"],
    [46, 50,  "Excellent Quality Alcohol · 100eb (Premium)"],
    [51, 55,  "MRE · 10eb (Cheap)"],
    [56, 60,  "Live Chicken · 50eb (Costly)"],
    [61, 65,  "Live Fish · 50eb (Costly)"],
    [66, 70,  "Fresh Fruits · 50eb (Costly)"],
    [71, 75,  "Fresh Vegetables · 50eb (Costly)"],
    [76, 80,  "Root Vegetables · 20eb (Everyday)"],
    [81, 85,  "Live Pigs · 100eb (Premium)"],
    [86, 90,  "Exotic Fruits · 100eb (Premium)"],
    [91, 95,  "Exotic Vegetables · 100eb (Premium)"],
    [96, 100, "Street Drugs of exactly 50eb"]
  ],
  "Cyberpunk RED corebook pg. 338-339. Step 3 — Food and Drugs column."
);

const NM_PERSONAL_ELECTRONICS = rangedTable(
  "CPR — NM: Personal Electronics",
  "1d100",
  [
    [1, 5,    "Agent · 100eb (Premium)"],
    [6, 10,   "Programs or Hardware of 100eb or less"],
    [11, 15,  "Audio Recorder · 100eb (Premium)"],
    [16, 20,  "Bug Detector · 500eb (Expensive)"],
    [21, 25,  "Chemical Analyzer · 1,000eb (Very Expensive)"],
    [26, 30,  "Computer · 50eb (Costly)"],
    [31, 35,  "Cyberdeck · 500eb (Expensive)"],
    [36, 40,  "Disposable Cell Phone · 50eb (Costly)"],
    [41, 45,  "Electric Guitar or Other Instrument · 500eb (Expensive)"],
    [46, 50,  "Programs or Hardware of exactly 500eb"],
    [51, 55,  "Medscanner · 1,000eb (Very Expensive)"],
    [56, 60,  "Homing Tracer · 500eb (Expensive)"],
    [61, 65,  "Radio Communicator · 100eb (Premium)"],
    [66, 70,  "Techscanner · 1,000eb (Very Expensive)"],
    [71, 75,  "Smart Glasses · 500eb (Expensive)"],
    [76, 80,  "Radar Detector · 500eb (Expensive)"],
    [81, 85,  "Scrambler/Descrambler · 500eb (Expensive)"],
    [86, 90,  "Radio Scanner/Music Player · 50eb (Costly)"],
    [91, 95,  "Braindance Viewer · 1,000eb (Very Expensive)"],
    [96, 100, "Virtuality Goggles · 100eb (Premium)"]
  ],
  "Cyberpunk RED corebook pg. 338-339. Step 3 — Personal Electronics column."
);

const NM_WEAPONS_AND_ARMOR = rangedTable(
  "CPR — NM: Weapons and Armor",
  "1d100",
  [
    [1, 5,    "Medium Pistol · 50eb (Costly)"],
    [6, 10,   "Heavy Pistol or Very Heavy Pistol · 100eb (Premium)"],
    [11, 15,  "SMG · 100eb (Premium)"],
    [16, 20,  "Heavy SMG · 100eb (Premium)"],
    [21, 25,  "Shotgun · 500eb (Expensive)"],
    [26, 30,  "Assault Rifle · 500eb (Expensive)"],
    [31, 35,  "Sniper Rifle · 500eb (Expensive)"],
    [36, 40,  "Bows or Crossbow · 100eb (Premium)"],
    [41, 45,  "Grenade Launcher or Rocket Launcher · 500eb (Expensive)"],
    [46, 50,  "Ammunition of 500eb or less"],
    [51, 55,  "A Single Exotic Weapon of GM's choice"],
    [56, 60,  "Light Melee Weapon · 50eb (Costly)"],
    [61, 65,  "Medium Melee Weapon · 50eb (Costly)"],
    [66, 70,  "Heavy Melee Weapon · 100eb (Premium)"],
    [71, 75,  "Very Heavy Melee Weapon · 100eb (Premium)"],
    [76, 80,  "Armor of 100eb or less"],
    [81, 85,  "Armor of exactly 500eb"],
    [86, 90,  "Armor of exactly 1,000eb"],
    [91, 95,  "Weapon Attachments of 100eb or less"],
    [96, 100, "Weapon Attachments of 500eb or higher"]
  ],
  "Cyberpunk RED corebook pg. 338-339. Step 3 — Weapons and Armor column."
);

const NM_CYBERWARE = rangedTable(
  "CPR — NM: Cyberware",
  "1d100",
  [
    [1, 5,    "Cybereye · 100eb (Premium)"],
    [6, 10,   "Cyberaudio Suite · 500eb (Expensive)"],
    [11, 15,  "Neural Link · 500eb (Expensive)"],
    [16, 20,  "Cyberarm · 500eb (Expensive)"],
    [21, 25,  "Cyberleg · 100eb (Premium)"],
    [26, 30,  "External Cyberware of exactly 1,000eb"],
    [31, 35,  "External Cyberware of 500eb or less"],
    [36, 40,  "Internal Cyberware of exactly 1,000eb"],
    [41, 45,  "Internal Cyberware of 500eb or less"],
    [46, 50,  "Cybereye Option of exactly 1,000eb"],
    [51, 55,  "Cybereye Option of 500eb or less"],
    [56, 60,  "Cyberaudio Option of exactly 1,000eb"],
    [61, 65,  "Cyberaudio Option of 500eb or less"],
    [66, 70,  "Neuralware Option of exactly 1,000eb"],
    [71, 75,  "Neuralware Option of 500eb or less"],
    [76, 80,  "Cyberlimb Option of exactly 1,000eb"],
    [81, 85,  "Cyberlimb Option of 500eb or less"],
    [86, 90,  "Fashionware of GM's Choice"],
    [91, 95,  "Borgware of GM's Choice"],
    [96, 100, "Any Cyberware of GM's Choice"]
  ],
  "Cyberpunk RED corebook pg. 338-339. Step 3 — Cyberware column. If a Cyberware Option is rolled, the Foundational Cyberware required is also available at the market. Cyberware is not installed at the market — seller refers to a Ripperdoc for free installation."
);

const NM_CLOTHING_AND_FASHIONWARE = rangedTable(
  "CPR — NM: Clothing and Fashionware",
  "1d100",
  [
    [1, 5,    "Bag Lady Chic (Fashion)"],
    [6, 10,   "Gang Colors (Fashion)"],
    [11, 15,  "Generic Chic (Fashion)"],
    [16, 20,  "Bohemian (Fashion)"],
    [21, 25,  "Leisurewear (Fashion)"],
    [26, 30,  "Nomad Leathers (Fashion)"],
    [31, 35,  "Asia Pop (Fashion)"],
    [36, 40,  "Urban Flash (Fashion)"],
    [41, 45,  "Businesswear (Fashion)"],
    [46, 50,  "High Fashion (Fashion)"],
    [51, 55,  "Biomonitor · 100eb (Premium) [Fashionware]"],
    [56, 60,  "Chemskin · 100eb (Premium) [Fashionware]"],
    [61, 65,  "EMP Threading · 10eb (Cheap) [Fashionware]"],
    [66, 70,  "Light Tattoo · 100eb (Premium) [Fashionware]"],
    [71, 75,  "Shift Tacts · 100eb (Premium) [Fashionware]"],
    [76, 80,  "Skinwatch · 100eb (Premium) [Fashionware]"],
    [81, 85,  "Techhair · 100eb (Premium) [Fashionware]"],
    [86, 90,  "Generic Chic (Fashion)"],
    [91, 95,  "Leisurewear (Fashion)"],
    [96, 100, "Gang Colors (Fashion)"]
  ],
  "Cyberpunk RED corebook pg. 338-339. Step 3 — Clothing and Fashionware column. Fashion items use the Fashion price table. Fashionware can be installed at the market."
);

const NM_SURVIVAL_GEAR = rangedTable(
  "CPR — NM: Survival Gear",
  "1d100",
  [
    [1, 5,    "Anti-Smog Breathing Mask · 20eb (Everyday)"],
    [6, 10,   "Auto Level Dampening Ear Protectors · 1,000eb (Very Expensive)"],
    [11, 15,  "Binoculars · 50eb (Costly)"],
    [16, 20,  "Carryall · 20eb (Everyday)"],
    [21, 25,  "Flashlight · 20eb (Everyday)"],
    [26, 30,  "Duct Tape · 20eb (Everyday)"],
    [31, 35,  "Inflatable Bed & Sleep-bag · 20eb (Everyday)"],
    [36, 40,  "Lock Picking Set · 20eb (Everyday)"],
    [41, 45,  "Handcuffs · 50eb (Costly)"],
    [46, 50,  "Medtech Bag · 100eb (Premium)"],
    [51, 55,  "Tent and Camping Equipment · 50eb (Costly)"],
    [56, 60,  "Rope (60m/yds) · 20eb (Everyday)"],
    [61, 65,  "Techtool · 100eb (Premium)"],
    [66, 70,  "Personal CarePak · 20eb (Everyday)"],
    [71, 75,  "Radiation Suit · 1,000eb (Very Expensive)"],
    [76, 80,  "Road Flare · 10eb (Cheap)"],
    [81, 85,  "Grapple Gun · 100eb (Premium)"],
    [86, 90,  "Tech Bag · 500eb (Expensive)"],
    [91, 95,  "Shovel or Axe · 50eb (Costly)"],
    [96, 100, "Airhypo · 50eb (Costly)"]
  ],
  "Cyberpunk RED corebook pg. 338-339. Step 3 — Survival Gear column."
);

const NIGHT_MARKET_TABLES = [
  NM_CATEGORIES,
  NM_FOOD_AND_DRUGS,
  NM_PERSONAL_ELECTRONICS,
  NM_WEAPONS_AND_ARMOR,
  NM_CYBERWARE,
  NM_CLOTHING_AND_FASHIONWARE,
  NM_SURVIVAL_GEAR
];

/* Map from category text → matching items table name. Used to wire the
 * recipe's switch-step branches. */
const NM_BRANCH_TABLE_BY_CATEGORY = {
  "Food and Drugs":         NM_FOOD_AND_DRUGS.name,
  "Personal Electronics":   NM_PERSONAL_ELECTRONICS.name,
  "Weapons and Armor":      NM_WEAPONS_AND_ARMOR.name,
  "Cyberware":              NM_CYBERWARE.name,
  "Clothing and Fashionware": NM_CLOTHING_AND_FASHIONWARE.name,
  "Survival Gear":          NM_SURVIVAL_GEAR.name
};

const NIGHT_MARKET_RECIPE_NAME = "Cyberpunk RED — Night Market Generator";

/* ============================================================
 *  Public import functions
 * ============================================================ */

const ALL_SAMPLE_TABLES = [...GENERIC_TABLES, ...NIGHT_MARKET_TABLES];

/**
 * Import every sample table into the world (idempotent on per-name basis).
 * Returns a map of `name → uuid` for ALL tables now present in the world,
 * which the recipe builder uses to resolve uuids.
 */
async function importTables() {
  const existing = new Map(Array.from(game.tables ?? []).map((t) => [t.name, t]));
  const toCreate = ALL_SAMPLE_TABLES.filter((t) => !existing.has(t.name));
  let created = [];
  if (toCreate.length) {
    created = await RollTable.implementation.createDocuments(toCreate);
    for (const tbl of created) {
      try { await tbl.normalize?.(); } catch (err) {
        console.warn(`${MODULE_ID} | normalize failed for ${tbl?.name}`, err);
      }
    }
  }
  // Build name→uuid map for every sample table now present.
  const uuidByName = new Map();
  for (const t of Array.from(game.tables ?? [])) uuidByName.set(t.name, t.uuid);
  return { uuidByName, createdCount: created.length };
}

/**
 * Build the Night Market recipe wired to the named tables. Skips if a
 * recipe with the same name already exists.
 */
async function buildNightMarketRecipe(uuidByName) {
  const recipes = readRecipes();
  if (Object.values(recipes).some((r) => r?.name === NIGHT_MARKET_RECIPE_NAME)) {
    return { skipped: true };
  }

  const categoriesUuid = uuidByName.get(NM_CATEGORIES.name);
  if (!categoriesUuid) {
    console.warn(`${MODULE_ID} | Night Market: categories table missing, skipping recipe build`);
    return { skipped: true };
  }

  // Build one branch per category. Each branch is a normal step on the
  // matching items table, count = 1d10, unique. The switch step picks the
  // branch by parent-result text.
  const branches = Object.entries(NM_BRANCH_TABLE_BY_CATEGORY).map(([category, tableName]) => {
    const tableUuid = uuidByName.get(tableName);
    return makeStep({
      kind: "normal",
      tableUuid,
      label: category,
      matches: category,
      countMode: "random",
      countFormula: "1d10",
      unique: true
    });
  });

  const recipe = makeRecipe({
    name: NIGHT_MARKET_RECIPE_NAME,
    icon: "icons/svg/coins.svg",
    steps: [
      makeStep({
        tableUuid: categoriesUuid,
        label: "Goods category",
        count: 2,
        unique: true,
        children: [
          makeStep({
            kind: "switch",
            label: "On the shelves",
            children: branches
          })
        ]
      })
    ]
  });
  await upsertRecipe(recipe);
  return { skipped: false, recipeId: recipe.id, recipeName: recipe.name };
}

/**
 * Public entry point. Imports all sample tables and builds the Night
 * Market recipe. Returns { tablesCreated, recipeCreated, recipeId, recipeName }.
 */
export async function importSampleTables() {
  if (!game.user?.isGM) {
    ui.notifications.warn(game.i18n.localize(`${I18N_NS}.gmOnly`));
    return { tablesCreated: 0, recipeCreated: false, recipeId: null, recipeName: null };
  }

  let tableInfo;
  try {
    tableInfo = await importTables();
  } catch (err) {
    console.error(`${MODULE_ID} | importTables failed`, err);
    ui.notifications.error(game.i18n.localize(`${I18N_NS}.samples.failed`));
    return { tablesCreated: 0, recipeCreated: false, recipeId: null, recipeName: null };
  }

  let recipeInfo = { skipped: true };
  try {
    recipeInfo = await buildNightMarketRecipe(tableInfo.uuidByName);
  } catch (err) {
    console.error(`${MODULE_ID} | buildNightMarketRecipe failed`, err);
  }

  // Resolve the recipe id even on the skipped path (so the caller can
  // place an existing recipe's tile on a board).
  let recipeId = recipeInfo.recipeId ?? null;
  let recipeName = recipeInfo.recipeName ?? null;
  if (!recipeId) {
    const existing = Object.values(readRecipes())
      .find((r) => r?.name === NIGHT_MARKET_RECIPE_NAME);
    if (existing) {
      recipeId = existing.id;
      recipeName = existing.name;
    }
  }

  const tablesCreated = tableInfo.createdCount;
  const recipeCreated = !recipeInfo.skipped;

  if (tablesCreated > 0 || recipeCreated) {
    ui.notifications.info(
      game.i18n.format(`${I18N_NS}.samples.created`, {
        tables: tablesCreated,
        recipe: recipeCreated ? 1 : 0
      })
    );
  } else {
    ui.notifications.info(game.i18n.localize(`${I18N_NS}.samples.allPresent`));
  }
  return { tablesCreated, recipeCreated, recipeId, recipeName };
}
