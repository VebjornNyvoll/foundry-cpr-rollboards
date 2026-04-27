/**
 * sample-tables.mjs — starter Cyberpunk Red roll tables.
 *
 * One-click import creates these as world RollTable documents so the GM has
 * something to drag onto a board on day one. All tables are 1d10 weighted-
 * equally (range = single step) — easy to reason about and easy to extend.
 *
 * importSampleTables() is idempotent on a per-name basis: it skips any table
 * whose name already exists in `game.tables`, so re-running won't create
 * duplicates.
 */

import { MODULE_ID, I18N_NS } from "./constants.mjs";

/**
 * Build a TableResult-shaped row for the given text. Foundry's RollTable
 * normalize() pass redistributes ranges from weights; we set weight 1 and
 * let the engine assign ranges.
 */
function textResult(text) {
  return {
    type: 0, // CONST.TABLE_RESULT_TYPES.TEXT
    text,
    weight: 1,
    range: [0, 0]
  };
}

/** A sample table descriptor. */
function sampleTable(name, formula, entries, description = "") {
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

const SAMPLE_TABLES = [
  sampleTable(
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
  sampleTable(
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
  sampleTable(
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
  sampleTable(
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
  sampleTable(
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

/**
 * Import every sample table into the world. Skips tables whose name already
 * exists. Returns { created, skipped }.
 */
export async function importSampleTables() {
  if (!game.user?.isGM) {
    ui.notifications.warn(game.i18n.localize(`${I18N_NS}.gmOnly`));
    return { created: 0, skipped: 0 };
  }

  const existing = new Set(Array.from(game.tables ?? []).map((t) => t.name));
  const toCreate = SAMPLE_TABLES.filter((t) => !existing.has(t.name));
  if (!toCreate.length) {
    ui.notifications.info(game.i18n.localize(`${I18N_NS}.samples.allPresent`));
    return { created: 0, skipped: SAMPLE_TABLES.length };
  }

  try {
    const created = await RollTable.implementation.createDocuments(toCreate);
    // Normalize ranges from weights so each entry has a contiguous slice.
    for (const tbl of created) {
      try { await tbl.normalize?.(); } catch (err) {
        console.warn(`${MODULE_ID} | normalize failed for ${tbl?.name}`, err);
      }
    }
    ui.notifications.info(game.i18n.format(`${I18N_NS}.samples.created`, {
      count: created.length
    }));
    return { created: created.length, skipped: SAMPLE_TABLES.length - created.length };
  } catch (err) {
    console.error(`${MODULE_ID} | importSampleTables failed`, err);
    ui.notifications.error(game.i18n.localize(`${I18N_NS}.samples.failed`));
    return { created: 0, skipped: 0 };
  }
}
