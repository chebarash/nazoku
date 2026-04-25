export type Difficulty = "easy" | "medium" | "hard";

export interface PlayerSession {
  playerId: string;
  playerName: string;
  playerColor: string;
}

interface BaseEvent {
  id: string;
  roomId: string;
  actorId: string;
  actorName: string;
  actorColor: string;
  createdAt: string;
}

export interface PlayerJoinEvent extends BaseEvent {
  type: "player-join";
}

export interface GameStartEvent extends BaseEvent {
  type: "game-start";
  difficulty: Difficulty;
  puzzle: Array<number | null>;
  solution: number[];
  givens: boolean[];
}

export interface CellSetEvent extends BaseEvent {
  type: "cell-set";
  index: number;
  value: number | null;
}

export interface NoteToggleEvent extends BaseEvent {
  type: "note-toggle";
  index: number;
  value: number;
}

export type RoomEvent =
  | PlayerJoinEvent
  | GameStartEvent
  | CellSetEvent
  | NoteToggleEvent;

export interface RoomPresence {
  roomId: string;
  playerId: string;
  playerName: string;
  playerColor: string;
  lastSeenAt: string;
}

export interface RoomPlayer extends PlayerSession {
  joinedAt: string;
  lastSeenAt: string | null;
  connected: boolean;
  moveCount: number;
  correctMoves: number;
  errors: number;
}

export interface ActivityItem {
  id: string;
  type: RoomEvent["type"];
  actorName: string;
  actorColor: string;
  createdAt: string;
  label: string;
}

export interface RoomState {
  roomId: string;
  createdAt: string;
  startedAt: string;
  difficulty: Difficulty;
  puzzle: Array<number | null>;
  board: Array<number | null>;
  solution: number[];
  givens: boolean[];
  notes: number[][];
  players: RoomPlayer[];
  activity: ActivityItem[];
  cellOwners: Array<string | null>;
  cellUpdatedAt: Array<string | null>;
  filledCells: number;
  correctCells: number;
  totalToFill: number;
  completedAt: string | null;
  winner: PlayerSession | null;
}

export interface CreateRoomResult {
  roomId: string;
  player: PlayerSession;
  room: RoomState;
}

export interface JoinRoomResult {
  roomId: string;
  player: PlayerSession;
  room: RoomState;
}

export type RoomActionInput =
  | {
      action: "cell-set";
      actor: PlayerSession;
      index: number;
      value: number | null;
    }
  | {
      action: "note-toggle";
      actor: PlayerSession;
      index: number;
      value: number;
    }
  | {
      action: "new-game";
      actor: PlayerSession;
      difficulty: Difficulty;
    };

export const DIFFICULTY_META: Record<
  Difficulty,
  { label: string; clues: string; pulse: string }
> = {
  easy: { label: "Calm", clues: "39-43 clues", pulse: "measured" },
  medium: { label: "Sharp", clues: "32-37 clues", pulse: "tense" },
  hard: { label: "Brutal", clues: "28-31 clues", pulse: "surgical" },
};

export const PLAYER_COLORS = [
  "#ff5f2e",
  "#ffb703",
  "#3fb950",
  "#2ec4ff",
  "#7c5cff",
  "#ef476f",
];
