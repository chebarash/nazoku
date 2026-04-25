import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { get, list, put } from "@vercel/blob";

import { clampDifficulty, generatePuzzle, isSolved } from "@/lib/sudoku";
import {
  CreateRoomResult,
  Difficulty,
  JoinRoomResult,
  PLAYER_COLORS,
  PlayerSession,
  RoomActionInput,
  RoomEvent,
  RoomPlayer,
  RoomPresence,
  RoomState,
} from "@/lib/types";

const STORAGE_ROOT = path.join(process.cwd(), ".nazoku-data");
const ROOM_PREFIX = "rooms";
const PRESENCE_TTL_MS = 30_000;

interface RoomMeta {
  roomId: string;
  createdAt: string;
}

function sanitizeName(input: string) {
  const value = input.trim().replace(/\s+/g, " ");
  return value.length > 0 ? value.slice(0, 18) : "Guest";
}

function timestamp() {
  return new Date().toISOString();
}

function roomMetaPath(roomId: string) {
  return `${ROOM_PREFIX}/${roomId}/meta.json`;
}

function roomEventsPrefix(roomId: string) {
  return `${ROOM_PREFIX}/${roomId}/events/`;
}

function roomPresencePrefix(roomId: string) {
  return `${ROOM_PREFIX}/${roomId}/presence/`;
}

function positionLabel(index: number) {
  const row = Math.floor(index / 9);
  const column = index % 9;
  return `${String.fromCharCode(65 + row)}${column + 1}`;
}

function normalizeRoomId(input: string) {
  return input.trim().toUpperCase();
}

function isValidRoomCode(input: string) {
  return /^[A-Z2-9]{6}$/.test(input);
}

function hasBlobToken() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

async function readBlobJson<T>(pathname: string) {
  const result = await get(pathname, { access: "private", useCache: false });

  if (!result || result.statusCode !== 200) {
    return null;
  }

  const text = await new Response(result.stream).text();
  return JSON.parse(text) as T;
}

async function writeJson(pathname: string, data: unknown, overwrite = true) {
  const payload = JSON.stringify(data);

  if (hasBlobToken()) {
    await put(pathname, payload, {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: overwrite,
      contentType: "application/json",
    });
    return;
  }

  const target = path.join(STORAGE_ROOT, pathname);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, payload, "utf8");
}

async function readJson<T>(pathname: string): Promise<T | null> {
  if (hasBlobToken()) {
    return readBlobJson<T>(pathname);
  }

  try {
    const target = path.join(STORAGE_ROOT, pathname);
    const payload = await readFile(target, "utf8");
    return JSON.parse(payload) as T;
  } catch {
    return null;
  }
}

async function walkLocal(relativeDirectory = ""): Promise<string[]> {
  const base = path.join(STORAGE_ROOT, relativeDirectory);

  try {
    const entries = await readdir(base, { withFileTypes: true });
    const results = await Promise.all(
      entries.map(async (entry) => {
        const relativePath = path.posix.join(relativeDirectory, entry.name);

        if (entry.isDirectory()) {
          return walkLocal(relativePath);
        }

        return [relativePath];
      }),
    );
    return results.flat();
  } catch {
    return [];
  }
}

async function listJson<T>(prefix: string) {
  if (hasBlobToken()) {
    let cursor: string | undefined;
    const items: Array<{ pathname: string; data: T }> = [];

    do {
      const page = await list({ prefix, cursor });
      const chunk = await Promise.all(
        page.blobs.map(async (blob) => {
          const data = await readBlobJson<T>(blob.pathname);
          return data ? { pathname: blob.pathname, data } : null;
        }),
      );
      items.push(...chunk.filter(Boolean) as Array<{ pathname: string; data: T }>);
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);

    return items;
  }

  const files = (await walkLocal()).filter((pathname) => pathname.startsWith(prefix));
  const items = await Promise.all(
    files.map(async (pathname) => {
      const data = await readJson<T>(pathname);
      return data ? { pathname, data } : null;
    }),
  );

  return items.filter(Boolean) as Array<{ pathname: string; data: T }>;
}

function newEventPath(roomId: string, createdAt: string, eventId: string) {
  return `${roomEventsPrefix(roomId)}${createdAt}-${eventId}.json`;
}

function presencePath(roomId: string, playerId: string) {
  return `${roomPresencePrefix(roomId)}${playerId}.json`;
}

function emptyNotes() {
  return Array.from({ length: 81 }, () => [] as number[]);
}

function generateRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";

  for (let index = 0; index < 6; index += 1) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }

  return code;
}

async function getUnusedRoomCode() {
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const roomId = generateRoomCode();
    const exists = await readJson<RoomMeta>(roomMetaPath(roomId));

    if (!exists) {
      return roomId;
    }
  }

  throw new Error("Could not allocate a room code");
}

function selectColor(index: number) {
  return PLAYER_COLORS[index % PLAYER_COLORS.length];
}

async function appendEvent(roomId: string, event: RoomEvent) {
  await writeJson(newEventPath(roomId, event.createdAt, event.id), event, false);
}

async function writePresence(roomId: string, player: PlayerSession) {
  const presence: RoomPresence = {
    roomId,
    playerId: player.playerId,
    playerName: sanitizeName(player.playerName),
    playerColor: player.playerColor,
    lastSeenAt: timestamp(),
  };

  await writeJson(presencePath(roomId, player.playerId), presence, true);
}

function ensureIndex(index: number) {
  return Number.isInteger(index) && index >= 0 && index < 81;
}

function ensureDigit(value: number) {
  return Number.isInteger(value) && value >= 1 && value <= 9;
}

function normalizeActor(actor: PlayerSession) {
  return {
    playerId: actor.playerId,
    playerName: sanitizeName(actor.playerName),
    playerColor: actor.playerColor || selectColor(0),
  };
}

function makeActivityLabel(event: RoomEvent, solution: number[]) {
  if (event.type === "player-join") {
    return `${event.actorName} entered the room`;
  }

  if (event.type === "game-start") {
    return `${event.actorName} spun a fresh ${event.difficulty} grid`;
  }

  if (event.type === "note-toggle") {
    return `${event.actorName} marked ${event.value} in ${positionLabel(event.index)}`;
  }

  if (event.value === null) {
    return `${event.actorName} cleared ${positionLabel(event.index)}`;
  }

  if (solution[event.index] === event.value) {
    return `${event.actorName} locked ${event.value} in ${positionLabel(event.index)}`;
  }

  return `${event.actorName} tested ${event.value} in ${positionLabel(event.index)}`;
}

function reduceRoom(meta: RoomMeta, events: RoomEvent[], presences: RoomPresence[]) {
  const players = new Map<
    string,
    Omit<RoomPlayer, "connected" | "lastSeenAt" | "moveCount" | "correctMoves" | "errors"> & {
      lastSeenAt: string | null;
      moveCount: number;
      correctMoves: number;
      errors: number;
    }
  >();

  let difficulty: Difficulty = "medium";
  let puzzle = Array<number | null>(81).fill(null);
  let board = Array<number | null>(81).fill(null);
  let solution = Array<number>(81).fill(0);
  let givens = Array<boolean>(81).fill(false);
  let notes = emptyNotes();
  let startedAt = meta.createdAt;
  let completedAt: string | null = null;
  let winner: PlayerSession | null = null;
  let cellOwners = Array<string | null>(81).fill(null);
  let cellUpdatedAt = Array<string | null>(81).fill(null);
  const activity: RoomState["activity"] = [];

  function touchPlayer(playerId: string, playerName: string, playerColor: string, joinedAt: string) {
    const existing = players.get(playerId);

    players.set(playerId, {
      playerId,
      playerName,
      playerColor,
      joinedAt: existing?.joinedAt ?? joinedAt,
      lastSeenAt: existing?.lastSeenAt ?? null,
      moveCount: existing?.moveCount ?? 0,
      correctMoves: existing?.correctMoves ?? 0,
      errors: existing?.errors ?? 0,
    });
  }

  for (const event of events) {
    touchPlayer(event.actorId, event.actorName, event.actorColor, event.createdAt);

    if (event.type === "player-join") {
      activity.push({
        id: event.id,
        type: event.type,
        actorName: event.actorName,
        actorColor: event.actorColor,
        createdAt: event.createdAt,
        label: makeActivityLabel(event, solution),
      });
      continue;
    }

    if (event.type === "game-start") {
      difficulty = event.difficulty;
      puzzle = [...event.puzzle];
      board = [...event.puzzle];
      solution = [...event.solution];
      givens = [...event.givens];
      notes = emptyNotes();
      startedAt = event.createdAt;
      completedAt = null;
      winner = null;
      cellOwners = Array<string | null>(81).fill(null);
      cellUpdatedAt = Array<string | null>(81).fill(null);

      for (const [playerId, player] of players.entries()) {
        players.set(playerId, {
          ...player,
          moveCount: 0,
          correctMoves: 0,
          errors: 0,
        });
      }

      activity.push({
        id: event.id,
        type: event.type,
        actorName: event.actorName,
        actorColor: event.actorColor,
        createdAt: event.createdAt,
        label: makeActivityLabel(event, solution),
      });
      continue;
    }

    if (completedAt) {
      continue;
    }

    if (event.type === "cell-set") {
      if (!ensureIndex(event.index) || givens[event.index]) {
        continue;
      }

      const nextValue = event.value === null ? null : Math.max(1, Math.min(9, event.value));

      if (board[event.index] === nextValue) {
        continue;
      }

      const player = players.get(event.actorId);

      if (player) {
        player.moveCount += 1;

        if (nextValue !== null) {
          if (solution[event.index] === nextValue && board[event.index] !== solution[event.index]) {
            player.correctMoves += 1;
          } else if (solution[event.index] !== nextValue) {
            player.errors += 1;
          }
        }
      }

      board[event.index] = nextValue;
      notes[event.index] = [];
      cellOwners[event.index] = event.actorId;
      cellUpdatedAt[event.index] = event.createdAt;

      activity.push({
        id: event.id,
        type: event.type,
        actorName: event.actorName,
        actorColor: event.actorColor,
        createdAt: event.createdAt,
        label: makeActivityLabel(event, solution),
      });

      if (isSolved(board, solution, givens)) {
        completedAt = event.createdAt;
        winner = {
          playerId: event.actorId,
          playerName: event.actorName,
          playerColor: event.actorColor,
        };
      }

      continue;
    }

    if (
      event.type === "note-toggle" &&
      ensureIndex(event.index) &&
      ensureDigit(event.value) &&
      !givens[event.index] &&
      board[event.index] === null
    ) {
      const cellNotes = new Set(notes[event.index]);

      if (cellNotes.has(event.value)) {
        cellNotes.delete(event.value);
      } else {
        cellNotes.add(event.value);
      }

      notes[event.index] = [...cellNotes].sort((left, right) => left - right);
      cellOwners[event.index] = event.actorId;
      cellUpdatedAt[event.index] = event.createdAt;
      activity.push({
        id: event.id,
        type: event.type,
        actorName: event.actorName,
        actorColor: event.actorColor,
        createdAt: event.createdAt,
        label: makeActivityLabel(event, solution),
      });
    }
  }

  for (const presence of presences) {
    touchPlayer(
      presence.playerId,
      presence.playerName,
      presence.playerColor,
      meta.createdAt,
    );
    const current = players.get(presence.playerId);

    if (current) {
      current.lastSeenAt = presence.lastSeenAt;
    }
  }

  const now = Date.now();
  const playerList = [...players.values()]
    .map((player) => ({
      ...player,
      lastSeenAt: player.lastSeenAt,
      connected:
        player.lastSeenAt !== null &&
        now - new Date(player.lastSeenAt).getTime() <= PRESENCE_TTL_MS,
    }))
    .sort((left, right) => {
      if (right.correctMoves !== left.correctMoves) {
        return right.correctMoves - left.correctMoves;
      }

      return left.errors - right.errors;
    });

  const filledCells = board.filter((value) => value !== null).length;
  const correctCells = board.filter(
    (value, index) => value !== null && value === solution[index],
  ).length;
  const totalToFill = givens.filter(Boolean).length
    ? 81 - givens.filter(Boolean).length
    : 81;

  return {
    roomId: meta.roomId,
    createdAt: meta.createdAt,
    startedAt,
    difficulty,
    puzzle,
    board,
    solution,
    givens,
    notes,
    players: playerList,
    activity: activity.slice(-18).reverse(),
    cellOwners,
    cellUpdatedAt,
    filledCells,
    correctCells,
    totalToFill,
    completedAt,
    winner,
  } satisfies RoomState;
}

async function loadRoomState(roomId: string) {
  const meta = await readJson<RoomMeta>(roomMetaPath(roomId));

  if (!meta) {
    return null;
  }

  const [events, presences] = await Promise.all([
    listJson<RoomEvent>(roomEventsPrefix(roomId)),
    listJson<RoomPresence>(roomPresencePrefix(roomId)),
  ]);

  const sortedEvents = events
    .map((entry) => entry.data)
    .sort((left, right) => {
      if (left.createdAt === right.createdAt) {
        return left.id.localeCompare(right.id);
      }

      return left.createdAt.localeCompare(right.createdAt);
    });

  return reduceRoom(
    meta,
    sortedEvents,
    presences.map((entry) => entry.data),
  );
}

export async function createRoom(playerName: string, difficultyInput: unknown) {
  const roomId = await getUnusedRoomCode();
  const createdAt = timestamp();
  const difficulty = clampDifficulty(difficultyInput);
  const player: PlayerSession = {
    playerId: randomUUID(),
    playerName: sanitizeName(playerName),
    playerColor: selectColor(0),
  };
  const puzzle = generatePuzzle(difficulty);

  await writeJson(roomMetaPath(roomId), { roomId, createdAt }, false);

  await appendEvent(roomId, {
    id: randomUUID(),
    type: "player-join",
    roomId,
    actorId: player.playerId,
    actorName: player.playerName,
    actorColor: player.playerColor,
    createdAt,
  });

  await appendEvent(roomId, {
    id: randomUUID(),
    type: "game-start",
    roomId,
    actorId: player.playerId,
    actorName: player.playerName,
    actorColor: player.playerColor,
    createdAt: timestamp(),
    difficulty,
    puzzle: puzzle.puzzle,
    solution: puzzle.solution,
    givens: puzzle.givens,
  });

  await writePresence(roomId, player);
  const room = await loadRoomState(roomId);

  if (!room) {
    throw new Error("Could not initialize room state");
  }

  return {
    roomId,
    player,
    room,
  } satisfies CreateRoomResult;
}

export async function getRoomState(roomIdInput: string) {
  const roomId = normalizeRoomId(roomIdInput);

  if (!isValidRoomCode(roomId)) {
    return null;
  }

  return loadRoomState(roomId);
}

export async function joinRoom(roomIdInput: string, playerName: string) {
  const roomId = normalizeRoomId(roomIdInput);

  if (!isValidRoomCode(roomId)) {
    return null;
  }

  const room = await loadRoomState(roomId);

  if (!room) {
    return null;
  }

  const player: PlayerSession = {
    playerId: randomUUID(),
    playerName: sanitizeName(playerName),
    playerColor: selectColor(room.players.length),
  };

  await appendEvent(roomId, {
    id: randomUUID(),
    type: "player-join",
    roomId,
    actorId: player.playerId,
    actorName: player.playerName,
    actorColor: player.playerColor,
    createdAt: timestamp(),
  });
  await writePresence(roomId, player);
  const nextRoom = await loadRoomState(roomId);

  if (!nextRoom) {
    throw new Error("Could not load joined room");
  }

  return {
    roomId,
    player,
    room: nextRoom,
  } satisfies JoinRoomResult;
}

export async function refreshPresence(roomIdInput: string, player: PlayerSession) {
  const roomId = normalizeRoomId(roomIdInput);

  if (!isValidRoomCode(roomId)) {
    return false;
  }

  const room = await loadRoomState(roomId);

  if (!room) {
    return false;
  }

  await writePresence(roomId, normalizeActor(player));
  return true;
}

export async function postRoomAction(roomIdInput: string, input: RoomActionInput) {
  const roomId = normalizeRoomId(roomIdInput);

  if (!isValidRoomCode(roomId)) {
    return null;
  }

  const room = await loadRoomState(roomId);

  if (!room) {
    return null;
  }

  const actor = normalizeActor(input.actor);
  const createdAt = timestamp();

  if (input.action === "new-game") {
    const difficulty = clampDifficulty(input.difficulty);
    const puzzle = generatePuzzle(difficulty);
    await appendEvent(roomId, {
      id: randomUUID(),
      type: "game-start",
      roomId,
      actorId: actor.playerId,
      actorName: actor.playerName,
      actorColor: actor.playerColor,
      createdAt,
      difficulty,
      puzzle: puzzle.puzzle,
      solution: puzzle.solution,
      givens: puzzle.givens,
    });
  }

  if (input.action === "cell-set" && ensureIndex(input.index)) {
    await appendEvent(roomId, {
      id: randomUUID(),
      type: "cell-set",
      roomId,
      actorId: actor.playerId,
      actorName: actor.playerName,
      actorColor: actor.playerColor,
      createdAt,
      index: input.index,
      value: input.value === null ? null : Math.max(1, Math.min(9, input.value)),
    });
  }

  if (input.action === "note-toggle" && ensureIndex(input.index) && ensureDigit(input.value)) {
    await appendEvent(roomId, {
      id: randomUUID(),
      type: "note-toggle",
      roomId,
      actorId: actor.playerId,
      actorName: actor.playerName,
      actorColor: actor.playerColor,
      createdAt,
      index: input.index,
      value: input.value,
    });
  }

  await writePresence(roomId, actor);
  return loadRoomState(roomId);
}
