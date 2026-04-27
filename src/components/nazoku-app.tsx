"use client";

import {
  ArrowLeft,
  Check,
  Copy,
  Crown,
  LoaderCircle,
  LogIn,
  Plus,
  RefreshCcw,
  SquarePen,
  Users,
  X,
} from "lucide-react";
import { startTransition, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { SudokuBoard } from "@/components/sudoku-board";
import {
  DIFFICULTY_META,
  Difficulty,
  JoinRoomResult,
  PlayerSession,
  RoomState,
} from "@/lib/types";

const NAME_KEY = "nazoku.display-name";
const SESSION_KEY_PREFIX = "nazoku.session.";

type EntryScreen = "name" | "lobby";
type LobbyMode = "create" | "join";
type ToastTone = "neutral" | "success" | "error" | "event";
type BoardActionPayload =
  | { action: "cell-set"; index: number; value: number | null }
  | { action: "note-toggle"; index: number; value: number };

interface ToastItem {
  id: string;
  message: string;
  tone: ToastTone;
}

interface UseRoomOptions {
  onRoomData?: (room: RoomState) => void;
  onSyncError?: (message: string) => void;
}

function sessionKey(roomId: string) {
  return `${SESSION_KEY_PREFIX}${roomId}`;
}

function readStoredSession(roomId: string) {
  const raw = window.localStorage.getItem(sessionKey(roomId));

  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as PlayerSession;
  } catch {
    return null;
  }
}

function writeStoredSession(roomId: string, player: PlayerSession) {
  window.localStorage.setItem(sessionKey(roomId), JSON.stringify(player));
}

function normalizeName(input: string) {
  return input.trim().replace(/\s+/g, " ").slice(0, 18);
}

function normalizeRoomCode(input: string) {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}

function cellLabel(index: number) {
  return `${String.fromCharCode(65 + Math.floor(index / 9))}${(index % 9) + 1}`;
}

function firstEditableCell(room: RoomState) {
  const index = room.givens.findIndex((value) => !value);
  return index === -1 ? 0 : index;
}

function formatTime(input: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(input));
}

function progressPercent(room: RoomState) {
  if (room.totalToFill === 0) {
    return 100;
  }

  return Math.round((room.correctCells / room.totalToFill) * 100);
}

function loadStoredName() {
  if (typeof window === "undefined") {
    return "";
  }

  return window.localStorage.getItem(NAME_KEY) ?? "";
}

function makeToastId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `toast-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function applyOptimisticRoom(
  room: RoomState,
  actor: PlayerSession,
  payload: BoardActionPayload,
) {
  if (room.completedAt) {
    return room;
  }

  if (payload.index < 0 || payload.index >= 81 || room.givens[payload.index]) {
    return room;
  }

  const now = new Date().toISOString();
  const nextPlayers = room.players.map((entry) => ({ ...entry }));
  const nextBoard = [...room.board];
  const nextNotes = [...room.notes];
  const nextCellOwners = [...room.cellOwners];
  const nextCellUpdatedAt = [...room.cellUpdatedAt];

  if (payload.action === "cell-set") {
    if (nextBoard[payload.index] === payload.value) {
      return room;
    }

    const actorRow = nextPlayers.find((entry) => entry.playerId === actor.playerId);

    if (actorRow) {
      actorRow.moveCount += 1;

      if (payload.value !== null) {
        if (
          room.solution[payload.index] === payload.value &&
          nextBoard[payload.index] !== room.solution[payload.index]
        ) {
          actorRow.correctMoves += 1;
        } else if (room.solution[payload.index] !== payload.value) {
          actorRow.errors += 1;
        }
      }
    }

    nextBoard[payload.index] = payload.value;
    nextNotes[payload.index] = [];
    nextCellOwners[payload.index] = actor.playerId;
    nextCellUpdatedAt[payload.index] = now;
  }

  if (payload.action === "note-toggle") {
    if (nextBoard[payload.index] !== null) {
      return room;
    }

    const currentNotes = new Set(nextNotes[payload.index]);

    if (currentNotes.has(payload.value)) {
      currentNotes.delete(payload.value);
    } else {
      currentNotes.add(payload.value);
    }

    nextNotes[payload.index] = [...currentNotes].sort((left, right) => left - right);
    nextCellOwners[payload.index] = actor.playerId;
    nextCellUpdatedAt[payload.index] = now;
  }

  const nextFilledCells = nextBoard.filter((value) => value !== null).length;
  const nextCorrectCells = nextBoard.filter(
    (value, index) => value !== null && value === room.solution[index],
  ).length;
  const solved = nextBoard.every((value, index) => value === room.solution[index]);

  return {
    ...room,
    board: nextBoard,
    notes: nextNotes,
    cellOwners: nextCellOwners,
    cellUpdatedAt: nextCellUpdatedAt,
    players: nextPlayers,
    filledCells: nextFilledCells,
    correctCells: nextCorrectCells,
    completedAt: solved ? now : room.completedAt,
    winner: solved
      ? {
          playerId: actor.playerId,
          playerName: actor.playerName,
          playerColor: actor.playerColor,
        }
      : room.winner,
  };
}

function useRoom(
  roomId: string | null,
  player: PlayerSession | null,
  options: UseRoomOptions = {},
) {
  const [room, setRoom] = useState<RoomState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const roomHandlerRef = useRef(options.onRoomData);
  const errorHandlerRef = useRef(options.onSyncError);

  useEffect(() => {
    roomHandlerRef.current = options.onRoomData;
    errorHandlerRef.current = options.onSyncError;
  }, [options.onRoomData, options.onSyncError]);

  useEffect(() => {
    if (!roomId) {
      startTransition(() => {
        setRoom(null);
        setError(null);
      });
      return;
    }

    let active = true;

    async function syncRoom(silent = false) {
      if (!silent) {
        setLoading(true);
      }

      try {
        const response = await fetch(`/api/game?roomId=${roomId}`, { cache: "no-store" });

        if (!response.ok) {
          throw new Error("Room not found");
        }

        const payload = (await response.json()) as { room: RoomState };

        if (!active) {
          return;
        }

        roomHandlerRef.current?.(payload.room);
        startTransition(() => {
          setRoom(payload.room);
          setError(null);
        });
      } catch (fetchError) {
        if (!active) {
          return;
        }

        const message =
          fetchError instanceof Error ? fetchError.message : "Failed to sync room";
        setError(message);
        setRoom(null);
        errorHandlerRef.current?.(message);
      } finally {
        if (!silent && active) {
          setLoading(false);
        }
      }
    }

    void syncRoom();

    const syncTimer = window.setInterval(() => {
      void syncRoom(true);
    }, 1800);

    return () => {
      active = false;
      window.clearInterval(syncTimer);
    };
  }, [roomId]);

  useEffect(() => {
    if (!roomId || !player) {
      return;
    }

    async function ping() {
      await fetch("/api/game", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "presence",
          roomId,
          ...player,
        }),
      });
    }

    void ping();
    const presenceTimer = window.setInterval(() => {
      void ping();
    }, 7000);

    return () => {
      window.clearInterval(presenceTimer);
    };
  }, [player, roomId]);

  async function refresh() {
    if (!roomId) {
      return;
    }

    setLoading(true);

    try {
      const response = await fetch(`/api/game?roomId=${roomId}`, { cache: "no-store" });

      if (!response.ok) {
        throw new Error("Room not found");
      }

      const payload = (await response.json()) as { room: RoomState };
      roomHandlerRef.current?.(payload.room);
      startTransition(() => {
        setRoom(payload.room);
        setError(null);
      });
    } catch (fetchError) {
      const message = fetchError instanceof Error ? fetchError.message : "Failed to sync room";
      setError(message);
      setRoom(null);
      errorHandlerRef.current?.(message);
    } finally {
      setLoading(false);
    }
  }

  return { room, loading, error, refresh, setRoom };
}

export function NazokuApp() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const roomId = searchParams.get("room")?.toUpperCase() ?? null;
  const [displayName, setDisplayName] = useState(loadStoredName);
  const [entryScreen, setEntryScreen] = useState<EntryScreen>("name");
  const [lobbyMode, setLobbyMode] = useState<LobbyMode>(roomId ? "join" : "create");
  const [joinCode, setJoinCode] = useState(() => roomId ?? "");
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [storedSessions, setStoredSessions] = useState<Record<string, PlayerSession>>(() => {
    if (typeof window === "undefined" || !roomId) {
      return {};
    }

    const existing = readStoredSession(roomId);
    return existing ? { [roomId]: existing } : {};
  });
  const [selectedCell, setSelectedCell] = useState<number | null>(0);
  const [notesMode, setNotesMode] = useState(false);
  const [pending, setPending] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastTimersRef = useRef<Map<string, number>>(new Map());
  const pushToastRef = useRef<(message: string, tone?: ToastTone) => void>(() => undefined);
  const ingestRoomRef = useRef<(room: RoomState, prime?: boolean) => void>(() => undefined);
  const roomTrackerRef = useRef<{
    roomId: string | null;
    seenActivityIds: Set<string>;
    completedAt: string | null;
    lastError: string | null;
  }>({
    roomId: null,
    seenActivityIds: new Set(),
    completedAt: null,
    lastError: null,
  });

  const player = roomId ? storedSessions[roomId] ?? readStoredSession(roomId) : null;

  function dismissToast(id: string) {
    const timer = toastTimersRef.current.get(id);

    if (timer) {
      window.clearTimeout(timer);
      toastTimersRef.current.delete(id);
    }

    setToasts((current) => current.filter((item) => item.id !== id));
  }

  function pushToast(message: string, tone: ToastTone = "neutral") {
    const id = makeToastId();
    const nextToast = { id, message, tone };

    setToasts((current) => [...current.slice(-2), nextToast]);

    const timer = window.setTimeout(() => {
      dismissToast(id);
    }, 3200);

    toastTimersRef.current.set(id, timer);
  }

  function ingestRoom(nextRoom: RoomState, prime = false) {
    const tracker = roomTrackerRef.current;
    tracker.lastError = null;

    if (prime || tracker.roomId !== nextRoom.roomId) {
      tracker.roomId = nextRoom.roomId;
      tracker.seenActivityIds = new Set(nextRoom.activity.map((item) => item.id));
      tracker.completedAt = nextRoom.completedAt;
      return;
    }

    const unseen = nextRoom.activity
      .filter((item) => !tracker.seenActivityIds.has(item.id))
      .reverse();

    for (const item of unseen) {
      tracker.seenActivityIds.add(item.id);
      pushToast(item.label, "event");
    }

    if (
      nextRoom.completedAt &&
      tracker.completedAt !== nextRoom.completedAt &&
      nextRoom.winner
    ) {
      pushToast(`${nextRoom.winner.playerName} closed the grid.`, "success");
    }

    tracker.completedAt = nextRoom.completedAt;
  }

  function handleSyncError(message: string) {
    if (roomTrackerRef.current.lastError === message) {
      return;
    }

    roomTrackerRef.current.lastError = message;
    pushToast(message, "error");
  }

  const { room, loading, error, refresh, setRoom } = useRoom(roomId, player, {
    onRoomData: (nextRoom) => ingestRoom(nextRoom),
    onSyncError: handleSyncError,
  });

  useEffect(() => {
    pushToastRef.current = pushToast;
    ingestRoomRef.current = ingestRoom;
  });

  useEffect(() => {
    window.localStorage.setItem(NAME_KEY, displayName);
  }, [displayName]);

  useEffect(() => {
    const timers = toastTimersRef.current;

    return () => {
      for (const timer of timers.values()) {
        window.clearTimeout(timer);
      }
    };
  }, []);

  const selfPlayer =
    room && player
      ? room.players.find((candidate) => candidate.playerId === player.playerId) ?? null
      : null;

  const view = roomId && player ? "room" : entryScreen;
  const liveRoom = roomId ? room : null;
  const connectedCount = liveRoom?.players.filter((candidate) => candidate.connected).length ?? 0;
  const selectedValue =
    room && selectedCell !== null ? room.board[selectedCell] ?? "Empty" : "Empty";
  const selectedNotes =
    room && selectedCell !== null ? room.notes[selectedCell].join(" ") : "";

  async function performAction(
    payload:
      | BoardActionPayload
      | { action: "new-game"; difficulty: Difficulty },
  ) {
    if (!roomId || !player) {
      return;
    }

    const snapshot = room;

    if (snapshot && payload.action !== "new-game") {
      const optimisticRoom = applyOptimisticRoom(snapshot, player, payload);

      if (optimisticRoom !== snapshot) {
        startTransition(() => {
          setRoom(optimisticRoom);
        });
      }
    }

    const response = await fetch("/api/game", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "room-event",
        roomId,
        payload: {
          ...payload,
          actor: player,
        },
      }),
    });

    if (!response.ok) {
      pushToast("Action failed", "error");

      if (snapshot) {
        startTransition(() => {
          setRoom(snapshot);
        });
      }

      return;
    }

    const next = (await response.json()) as { room: RoomState };
    ingestRoom(next.room);
    startTransition(() => {
      setRoom(next.room);
    });
  }

  useEffect(() => {
    async function sendKeyAction(
      payload: BoardActionPayload,
    ) {
      if (!roomId || !player) {
        return;
      }

      const snapshot = room;

      if (snapshot) {
        const optimisticRoom = applyOptimisticRoom(snapshot, player, payload);

        if (optimisticRoom !== snapshot) {
          startTransition(() => {
            setRoom(optimisticRoom);
          });
        }
      }

      const response = await fetch("/api/game", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "room-event",
          roomId,
          payload: {
            ...payload,
            actor: player,
          },
        }),
      });

      if (!response.ok) {
        pushToastRef.current("Action failed", "error");

        if (snapshot) {
          startTransition(() => {
            setRoom(snapshot);
          });
        }

        return;
      }

      const next = (await response.json()) as { room: RoomState };
      ingestRoomRef.current(next.room);
      startTransition(() => {
        setRoom(next.room);
      });
    }

    async function handleKeyDown(event: KeyboardEvent) {
      if (!room || !player || selectedCell === null) {
        return;
      }

      const target = event.target as HTMLElement | null;

      if (target && ["INPUT", "TEXTAREA"].includes(target.tagName)) {
        return;
      }

      if (event.key.toLowerCase() === "n") {
        setNotesMode((current) => !current);
        return;
      }

      if (event.key === "ArrowLeft" && selectedCell % 9 !== 0) {
        event.preventDefault();
        setSelectedCell(selectedCell - 1);
        return;
      }

      if (event.key === "ArrowRight" && selectedCell % 9 !== 8) {
        event.preventDefault();
        setSelectedCell(selectedCell + 1);
        return;
      }

      if (event.key === "ArrowUp" && selectedCell >= 9) {
        event.preventDefault();
        setSelectedCell(selectedCell - 9);
        return;
      }

      if (event.key === "ArrowDown" && selectedCell <= 71) {
        event.preventDefault();
        setSelectedCell(selectedCell + 9);
        return;
      }

      if (event.key === "Backspace" || event.key === "Delete" || event.key === "0") {
        event.preventDefault();
        await sendKeyAction({ action: "cell-set", index: selectedCell, value: null });
        return;
      }

      const digit = Number(event.key);

      if (!Number.isInteger(digit) || digit < 1 || digit > 9) {
        return;
      }

      event.preventDefault();

      if (notesMode && room.board[selectedCell] === null) {
        await sendKeyAction({ action: "note-toggle", index: selectedCell, value: digit });
        return;
      }

      await sendKeyAction({ action: "cell-set", index: selectedCell, value: digit });
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [notesMode, player, room, roomId, selectedCell, setRoom]);

  function continueToLobby() {
    const normalized = normalizeName(displayName);

    if (!normalized) {
      pushToast("Enter a nickname", "error");
      return;
    }

    setDisplayName(normalized);
    setEntryScreen("lobby");

    if (roomId) {
      setLobbyMode("join");
      setJoinCode(roomId);
    }
  }

  async function createRoom() {
    const normalized = normalizeName(displayName);

    if (!normalized) {
      pushToast("Enter a nickname", "error");
      setEntryScreen("name");
      return;
    }

    setPending(true);

    try {
      const response = await fetch("/api/game", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create-room",
          playerName: normalized,
          difficulty,
        }),
      });

      if (!response.ok) {
        throw new Error("Could not create room");
      }

      const payload = (await response.json()) as JoinRoomResult;
      writeStoredSession(payload.roomId, payload.player);
      setStoredSessions((current) => ({
        ...current,
        [payload.roomId]: payload.player,
      }));
      ingestRoom(payload.room, true);
      startTransition(() => {
        setRoom(payload.room);
      });
      setDisplayName(normalized);
      setSelectedCell(firstEditableCell(payload.room));
      setJoinCode(payload.roomId);
      setNotesMode(false);
      router.replace(`/?room=${payload.roomId}`);
      pushToast(`Room ${payload.roomId} is live`, "success");
    } catch (createError) {
      pushToast(createError instanceof Error ? createError.message : "Create failed", "error");
    } finally {
      setPending(false);
    }
  }

  async function joinRoom() {
    const normalizedName = normalizeName(displayName);
    const targetRoom = normalizeRoomCode(joinCode || roomId || "");

    if (!normalizedName) {
      pushToast("Enter a nickname", "error");
      setEntryScreen("name");
      return;
    }

    if (!targetRoom) {
      pushToast("Enter a room code", "error");
      return;
    }

    setPending(true);

    try {
      const response = await fetch("/api/game", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "join-room",
          roomId: targetRoom,
          playerName: normalizedName,
        }),
      });

      if (!response.ok) {
        throw new Error("Could not join room");
      }

      const payload = (await response.json()) as JoinRoomResult;
      writeStoredSession(payload.roomId, payload.player);
      setStoredSessions((current) => ({
        ...current,
        [payload.roomId]: payload.player,
      }));
      ingestRoom(payload.room, true);
      startTransition(() => {
        setRoom(payload.room);
      });
      setDisplayName(normalizedName);
      setSelectedCell(firstEditableCell(payload.room));
      setJoinCode(payload.roomId);
      setNotesMode(false);
      router.replace(`/?room=${payload.roomId}`);
      pushToast(`Joined room ${payload.roomId}`, "success");
    } catch (joinError) {
      pushToast(joinError instanceof Error ? joinError.message : "Join failed", "error");
    } finally {
      setPending(false);
    }
  }

  async function copyRoomLink() {
    if (!roomId) {
      return;
    }

    const url = `${window.location.origin}/?room=${roomId}`;
    await navigator.clipboard.writeText(url);
    pushToast("Invite link copied", "success");
  }

  async function pressDigit(value: number | null) {
    if (!room || !player || selectedCell === null) {
      return;
    }

    if (value !== null && notesMode && room.board[selectedCell] === null) {
      await performAction({ action: "note-toggle", index: selectedCell, value });
      return;
    }

    await performAction({ action: "cell-set", index: selectedCell, value });
  }

  async function remixPuzzle(nextDifficulty: Difficulty) {
    if (!player) {
      return;
    }

    await performAction({ action: "new-game", difficulty: nextDifficulty });
    setDifficulty(nextDifficulty);
    setSelectedCell(0);
    setNotesMode(false);
    pushToast(`${DIFFICULTY_META[nextDifficulty].label} grid loaded`, "neutral");
  }

  function leaveRoom() {
    roomTrackerRef.current = {
      roomId: null,
      seenActivityIds: new Set(),
      completedAt: null,
      lastError: null,
    };
    setEntryScreen("lobby");
    setLobbyMode("create");
    setJoinCode("");
    setSelectedCell(0);
    setNotesMode(false);
    router.replace("/");
  }

  function backToName() {
    setEntryScreen("name");
  }

  return (
    <main className="page-shell">
      <div className="page-glow page-glow-left" aria-hidden="true" />
      <div className="page-glow page-glow-right" aria-hidden="true" />

      {view === "name" ? (
        <section className="entry-screen">
          <div className="entry-pane">
            <span className="entry-mark">Nazoku</span>
            <p className="entry-submark">Shared Sudoku</p>

            <label className="field">
              <span>Nickname</span>
              <input
                autoFocus
                maxLength={18}
                placeholder="Player"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    continueToLobby();
                  }
                }}
              />
            </label>

            <button className="primary-button wide-button" type="button" onClick={continueToLobby}>
              <Check size={16} />
              <span>Continue</span>
            </button>
          </div>
        </section>
      ) : null}

      {view === "lobby" ? (
        <section className="entry-screen">
          <div className="lobby-pane">
            <div className="lobby-head">
              <div>
                <span className="entry-mark compact-mark">Nazoku</span>
                <p className="entry-submark">{normalizeName(displayName) || "Player"}</p>
              </div>

              <button className="icon-button subtle" type="button" onClick={backToName}>
                <SquarePen size={16} />
                <span>Edit</span>
              </button>
            </div>

            <div className="mode-switch">
              <button
                className={lobbyMode === "create" ? "mode-button active" : "mode-button"}
                type="button"
                onClick={() => setLobbyMode("create")}
              >
                <Plus size={16} />
                <span>Create game</span>
              </button>
              <button
                className={lobbyMode === "join" ? "mode-button active" : "mode-button"}
                type="button"
                onClick={() => setLobbyMode("join")}
              >
                <LogIn size={16} />
                <span>Join game</span>
              </button>
            </div>

            {lobbyMode === "create" ? (
              <div className="lobby-stack">
                <div className="difficulty-grid">
                  {(Object.keys(DIFFICULTY_META) as Difficulty[]).map((option) => (
                    <button
                      key={option}
                      className={difficulty === option ? "difficulty-tile active" : "difficulty-tile"}
                      type="button"
                      onClick={() => setDifficulty(option)}
                    >
                      <span>{DIFFICULTY_META[option].label}</span>
                      <small>{DIFFICULTY_META[option].clues}</small>
                    </button>
                  ))}
                </div>

                <button
                  className="primary-button wide-button"
                  type="button"
                  onClick={() => void createRoom()}
                  disabled={pending}
                >
                  {pending ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />}
                  <span>Create room</span>
                </button>
              </div>
            ) : (
              <div className="lobby-stack">
                <label className="field">
                  <span>Room code</span>
                  <input
                    autoFocus
                    maxLength={6}
                    placeholder="AB12CD"
                    value={joinCode}
                    onChange={(event) => setJoinCode(normalizeRoomCode(event.target.value))}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        void joinRoom();
                      }
                    }}
                  />
                </label>

                {roomId ? (
                  <div className="invite-strip">
                    <span>Invite detected</span>
                    <strong>{roomId}</strong>
                    {liveRoom ? <small>{connectedCount} online</small> : null}
                  </div>
                ) : null}

                <button
                  className="primary-button wide-button"
                  type="button"
                  onClick={() => void joinRoom()}
                  disabled={pending}
                >
                  {pending ? <LoaderCircle className="spin" size={16} /> : <LogIn size={16} />}
                  <span>Enter room</span>
                </button>
              </div>
            )}
          </div>
        </section>
      ) : null}

      {view === "room" && room ? (
        <section className="room-scene">
          <header className="room-topbar">
            <div className="brand-line">
              <span className="room-mark">Nazoku</span>
              <span className="room-pill">{roomId}</span>
            </div>

            <div className="room-top-actions">
              <button className="icon-button subtle" type="button" onClick={copyRoomLink}>
                <Copy size={16} />
                <span>Share</span>
              </button>
              <button className="icon-button subtle" type="button" onClick={leaveRoom}>
                <ArrowLeft size={16} />
                <span>Lobby</span>
              </button>
            </div>
          </header>

          <div className="room-layout">
            <section className="board-surface">
              <div className="board-surface-head">
                <div>
                  <span className="eyebrow">Live grid</span>
                  <h1 className="surface-title">
                    {progressPercent(room)}% solved
                  </h1>
                </div>

                <div className="status-strip">
                  <div className="status-chip">
                    <span>Cell</span>
                    <strong>{selectedCell !== null ? cellLabel(selectedCell) : "--"}</strong>
                  </div>
                  <div className="status-chip">
                    <span>Mode</span>
                    <strong>{notesMode ? "Notes" : "Ink"}</strong>
                  </div>
                </div>
              </div>

              <SudokuBoard
                room={room}
                selfPlayer={selfPlayer}
                selectedCell={selectedCell}
                onSelectCell={setSelectedCell}
              />

              <div className="board-toolbar">
                <div className="selection-chip">
                  <span>{selectedCell !== null ? cellLabel(selectedCell) : "Cell"}</span>
                  <strong>{selectedValue}</strong>
                  {selectedNotes ? <small>{selectedNotes}</small> : null}
                </div>

                <div className="tool-group">
                  <button
                    className={notesMode ? "icon-button active" : "icon-button"}
                    type="button"
                    onClick={() => setNotesMode((current) => !current)}
                  >
                    <SquarePen size={16} />
                    <span>Notes</span>
                  </button>
                  <button
                    className="icon-button"
                    type="button"
                    onClick={() => void pressDigit(null)}
                  >
                    <X size={16} />
                    <span>Clear</span>
                  </button>
                  <button className="icon-button" type="button" onClick={() => void refresh()}>
                    <RefreshCcw size={16} />
                    <span>{loading ? "Syncing" : "Sync"}</span>
                  </button>
                </div>
              </div>

              <div className="keypad-grid">
                {Array.from({ length: 9 }, (_, index) => index + 1).map((digit) => (
                  <button
                    key={digit}
                    className="digit-button"
                    type="button"
                    onClick={() => void pressDigit(digit)}
                  >
                    {digit}
                  </button>
                ))}
              </div>

              {room.completedAt && room.winner ? (
                <div className="completion-banner">
                  <Crown size={16} />
                  <span>{room.winner.playerName} finished the board.</span>
                </div>
              ) : null}
            </section>

            <aside className="room-sidebar">
              <section className="sidebar-surface">
                <span className="eyebrow">Overview</span>
                <div className="metric-grid">
                  <div className="metric-tile">
                    <span>Correct</span>
                    <strong>
                      {room.correctCells}/{room.totalToFill}
                    </strong>
                  </div>
                  <div className="metric-tile">
                    <span>Online</span>
                    <strong>{connectedCount}</strong>
                  </div>
                  <div className="metric-tile">
                    <span>Started</span>
                    <strong>{formatTime(room.startedAt)}</strong>
                  </div>
                  <div className="metric-tile">
                    <span>Left</span>
                    <strong>{room.totalToFill - room.correctCells}</strong>
                  </div>
                </div>

                <div className="difficulty-grid compact-grid">
                  {(Object.keys(DIFFICULTY_META) as Difficulty[]).map((option) => (
                    <button
                      key={option}
                      className={difficulty === option ? "difficulty-tile active" : "difficulty-tile"}
                      type="button"
                      onClick={() => void remixPuzzle(option)}
                    >
                      <span>{DIFFICULTY_META[option].label}</span>
                      <small>{DIFFICULTY_META[option].pulse}</small>
                    </button>
                  ))}
                </div>
              </section>

              <section className="sidebar-surface">
                <div className="sidebar-head">
                  <span className="eyebrow">Players</span>
                  <div className="live-pill">
                    <Users size={14} />
                    <span>{connectedCount}</span>
                  </div>
                </div>

                <div className="player-list">
                  {room.players.map((entry, index) => (
                    <div className="player-line" key={entry.playerId}>
                      <div className="player-left">
                        <span className="player-rank">{index + 1}</span>
                        <span
                          className="player-swatch"
                          style={{ backgroundColor: entry.playerColor }}
                          aria-hidden="true"
                        />
                        <div>
                          <strong>{entry.playerName}</strong>
                          <small>{entry.connected ? "online" : "away"}</small>
                        </div>
                      </div>

                      <div className="player-right">
                        <span>{entry.correctMoves}</span>
                        <small>{entry.errors} misses</small>
                      </div>
                    </div>
                  ))}
                </div>

                {error ? <p className="muted-line">{error}</p> : null}
              </section>
            </aside>
          </div>
        </section>
      ) : null}

      <div className="toast-stack" aria-live="polite" aria-atomic="true">
        {toasts.map((toast) => (
          <button
            key={toast.id}
            className={`toast toast-${toast.tone}`}
            type="button"
            onClick={() => dismissToast(toast.id)}
          >
            <span>{toast.message}</span>
          </button>
        ))}
      </div>
    </main>
  );
}
