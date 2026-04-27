/**
 * boards.mjs — Board CRUD + persistence.
 *
 * A "board" is a named tab in the dashboard, with its own canvas full of
 * tiles. Boards are user-created (no scene coupling); each board lives in
 * a single world setting keyed by id.
 *
 * Board shape:
 *   {
 *     id: "uuid",
 *     name: "Combat Zone tables",
 *     showNames: boolean,
 *     tiles: [{ recipeId, x, y }],
 *     sort: number,
 *     createdAt: number,
 *     updatedAt: number
 *   }
 */

import { MODULE_ID, SETTING_BOARDS } from "./constants.mjs";

export function readBoards() {
  const raw = game.settings.get(MODULE_ID, SETTING_BOARDS);
  return (raw && typeof raw === "object") ? raw : {};
}

export async function writeBoards(boards) {
  return game.settings.set(MODULE_ID, SETTING_BOARDS, boards);
}

/** Return all boards as an array, sorted by `sort` (then createdAt). */
export function listBoards() {
  return Object.values(readBoards()).sort((a, b) => {
    const sa = Number.isFinite(a.sort) ? a.sort : (a.createdAt ?? 0);
    const sb = Number.isFinite(b.sort) ? b.sort : (b.createdAt ?? 0);
    return sa - sb;
  });
}

export function getBoard(id) {
  const all = readBoards();
  return id ? (all[id] ?? null) : null;
}

export async function upsertBoard(board) {
  const all = readBoards();
  all[board.id] = { ...board, updatedAt: Date.now() };
  await writeBoards(all);
  return all[board.id];
}

export async function deleteBoard(id) {
  if (!id) return false;
  const all = readBoards();
  if (!(id in all)) return false;
  delete all[id];
  await writeBoards(all);
  return true;
}

export function makeBoard(name) {
  const now = Date.now();
  return {
    id: foundry.utils.randomID(),
    name: String(name ?? "").trim() || "New board",
    showNames: true,
    tiles: [],
    sort: now,
    createdAt: now,
    updatedAt: now
  };
}

/**
 * Update a board's tile list / showNames, returning the modified board.
 * The board reference passed in is mutated AND persisted.
 */
export async function saveBoard(board) {
  return upsertBoard(board);
}
