"use client";

import {
  ArrowLeft,
  Copy,
  Crown,
  LoaderCircle,
  Plus,
  RefreshCcw,
  SquarePen,
  Users,
  X,
} from "lucide-react";
import { startTransition, useEffect, useState } from "react";
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
    return "Player";
  }

  return window.localStorage.getItem(NAME_KEY) ?? "Player";
}

function useRoom(roomId: string | null, player: PlayerSession | null) {
  const [room, setRoom] = useState<RoomState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        const response = await fetch(`/api/rooms/${roomId}`, { cache: "no-store" });

        if (!response.ok) {
          throw new Error("Room not found");
        }

        const payload = (await response.json()) as { room: RoomState };

        if (!active) {
          return;
        }

        startTransition(() => {
          setRoom(payload.room);
          setError(null);
        });
      } catch (fetchError) {
        if (!active) {
          return;
        }

        setError(fetchError instanceof Error ? fetchError.message : "Failed to sync room");
        setRoom(null);
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
      await fetch(`/api/rooms/${roomId}/presence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(player),
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
      const response = await fetch(`/api/rooms/${roomId}`, { cache: "no-store" });

      if (!response.ok) {
        throw new Error("Room not found");
      }

      const payload = (await response.json()) as { room: RoomState };
      startTransition(() => {
        setRoom(payload.room);
        setError(null);
      });
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : "Failed to sync room");
      setRoom(null);
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
  const [joinCode, setJoinCode] = useState("");
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
  const [notice, setNotice] = useState<string | null>(null);
  const player = roomId ? storedSessions[roomId] ?? readStoredSession(roomId) : null;
  const { room, loading, error, refresh, setRoom } = useRoom(roomId, player);

  useEffect(() => {
    window.localStorage.setItem(NAME_KEY, displayName);
  }, [displayName]);

  const selfPlayer =
    room && player
      ? room.players.find((candidate) => candidate.playerId === player.playerId) ?? null
      : null;

  async function performAction(
    payload:
      | {
          action: "cell-set";
          index: number;
          value: number | null;
        }
      | {
          action: "note-toggle";
          index: number;
          value: number;
        }
      | {
          action: "new-game";
          difficulty: Difficulty;
        },
  ) {
    if (!roomId || !player) {
      return;
    }

    const response = await fetch(`/api/rooms/${roomId}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...payload,
        actor: player,
      }),
    });

    if (!response.ok) {
      throw new Error("Action failed");
    }

    const next = (await response.json()) as { room: RoomState };
    startTransition(() => {
      setRoom(next.room);
    });
  }

  useEffect(() => {
    async function sendKeyAction(
      payload:
        | { action: "cell-set"; index: number; value: number | null }
        | { action: "note-toggle"; index: number; value: number },
    ) {
      if (!roomId || !player) {
        return;
      }

      const response = await fetch(`/api/rooms/${roomId}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...payload,
          actor: player,
        }),
      });

      if (!response.ok) {
        return;
      }

      const next = (await response.json()) as { room: RoomState };
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

  async function createRoom() {
    setPending(true);
    setNotice(null);

    try {
      const response = await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playerName: displayName,
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
      startTransition(() => {
        setRoom(payload.room);
      });
      router.replace(`/?room=${payload.roomId}`);
      setSelectedCell(0);
      setJoinCode(payload.roomId);
    } catch (createError) {
      setNotice(createError instanceof Error ? createError.message : "Create failed");
    } finally {
      setPending(false);
    }
  }

  async function joinRoom() {
    const targetRoom = joinCode.trim().toUpperCase();

    if (!targetRoom) {
      setNotice("Enter a room code");
      return;
    }

    setPending(true);
    setNotice(null);

    try {
      const response = await fetch(`/api/rooms/${targetRoom}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playerName: displayName,
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
      startTransition(() => {
        setRoom(payload.room);
      });
      router.replace(`/?room=${payload.roomId}`);
      setSelectedCell(0);
    } catch (joinError) {
      setNotice(joinError instanceof Error ? joinError.message : "Join failed");
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
    setNotice("Link copied");
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
  }

  function leaveRoom() {
    router.replace("/");
    setJoinCode("");
    setNotice(null);
    setSelectedCell(0);
  }

  const showJoinOverlay = Boolean(roomId && !player);
  const connectedCount = room?.players.filter((candidate) => candidate.connected).length ?? 0;

  return (
    <main className="page-shell">
      <div className="ambient ambient-left" aria-hidden="true" />
      <div className="ambient ambient-right" aria-hidden="true" />

      <section className="workspace">
        <header className="topbar">
          <div className="brand-block">
            <span className="brand-mark">Nazoku</span>
            <p className="brand-copy">
              Multiplayer Sudoku lounge for fast rooms, shared pencil marks and
              live board pressure.
            </p>
          </div>

          <div className="topbar-actions">
            {roomId ? (
              <>
                <button className="icon-button" type="button" onClick={copyRoomLink}>
                  <Copy size={16} />
                  <span>{roomId}</span>
                </button>
                <button className="icon-button" type="button" onClick={leaveRoom}>
                  <ArrowLeft size={16} />
                  <span>Lobby</span>
                </button>
              </>
            ) : null}
          </div>
        </header>

        <section className="grid-layout">
          <section className="panel">
            <div className="panel-head">
              <span className="eyebrow">Session</span>
              <div className="pulse-row">
                <Users size={16} />
                <span>{connectedCount} online</span>
              </div>
            </div>

            <div className="identity-block">
              <label className="field">
                <span>Name</span>
                <input
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  maxLength={18}
                  placeholder="Player"
                />
              </label>

              <label className="field">
                <span>Room code</span>
                <input
                  value={joinCode}
                  onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
                  maxLength={6}
                  placeholder="AB12CD"
                />
              </label>
            </div>

            <div className="segmented">
              {(Object.keys(DIFFICULTY_META) as Difficulty[]).map((option) => (
                <button
                  key={option}
                  type="button"
                  className={option === difficulty ? "segment active" : "segment"}
                  onClick={() => setDifficulty(option)}
                >
                  <span>{DIFFICULTY_META[option].label}</span>
                  <small>{DIFFICULTY_META[option].pulse}</small>
                </button>
              ))}
            </div>

            <div className="action-stack">
              <button className="primary-button" type="button" onClick={createRoom} disabled={pending}>
                {pending ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />}
                <span>Create room</span>
              </button>
              <button className="secondary-button" type="button" onClick={joinRoom} disabled={pending}>
                <SquarePen size={16} />
                <span>Join room</span>
              </button>
            </div>

            {room ? (
              <div className="score-strip">
                <div>
                  <span className="metric-label">Solved</span>
                  <strong>{progressPercent(room)}%</strong>
                </div>
                <div>
                  <span className="metric-label">Correct</span>
                  <strong>
                    {room.correctCells}/{room.totalToFill}
                  </strong>
                </div>
                <div>
                  <span className="metric-label">Started</span>
                  <strong>{formatTime(room.startedAt)}</strong>
                </div>
              </div>
            ) : null}

            {notice || error ? (
              <p className="status-line">{notice ?? error}</p>
            ) : loading ? (
              <p className="status-line">Syncing room…</p>
            ) : null}
          </section>

          <section className="board-panel">
            <div className="panel-head">
              <span className="eyebrow">Board</span>
              {room ? (
                <div className="board-tools">
                  <button
                    className={notesMode ? "icon-button active" : "icon-button"}
                    type="button"
                    onClick={() => setNotesMode((current) => !current)}
                  >
                    <SquarePen size={16} />
                    <span>Notes</span>
                  </button>
                  <button className="icon-button" type="button" onClick={() => void refresh()}>
                    <RefreshCcw size={16} />
                    <span>Sync</span>
                  </button>
                </div>
              ) : null}
            </div>

            {room ? (
              <>
                <SudokuBoard
                  room={room}
                  selfPlayer={selfPlayer}
                  selectedCell={selectedCell}
                  onSelectCell={setSelectedCell}
                />

                <div className="keypad">
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
                  <button className="digit-button utility" type="button" onClick={() => void pressDigit(null)}>
                    <X size={16} />
                  </button>
                </div>

                {room.completedAt && room.winner ? (
                  <div className="completion-banner">
                    <Crown size={16} />
                    <span>{room.winner.playerName} closed the grid.</span>
                  </div>
                ) : null}
              </>
            ) : (
              <div className="board-placeholder">
                <span>Open a room to start the shared grid.</span>
              </div>
            )}
          </section>

          <section className="panel">
            <div className="panel-head">
              <span className="eyebrow">Players</span>
              {room ? (
                <button
                  className="secondary-button compact"
                  type="button"
                  onClick={() => void remixPuzzle(difficulty)}
                >
                  <RefreshCcw size={14} />
                  <span>Remix</span>
                </button>
              ) : null}
            </div>

            <div className="players-list">
              {room?.players.map((entry) => (
                <article className="player-row" key={entry.playerId}>
                  <div className="player-meta">
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

                  <div className="player-stats">
                    <span>{entry.correctMoves} solved</span>
                    <span>{entry.errors} misses</span>
                  </div>
                </article>
              )) ?? <p className="muted-line">No players yet.</p>}
            </div>

            <div className="activity-list">
              {room?.activity.map((item) => (
                <article className="activity-row" key={item.id}>
                  <span
                    className="activity-line"
                    style={{ backgroundColor: item.actorColor }}
                    aria-hidden="true"
                  />
                  <div>
                    <strong>{item.label}</strong>
                    <small>{formatTime(item.createdAt)}</small>
                  </div>
                </article>
              )) ?? <p className="muted-line">Fresh room activity lands here.</p>}
            </div>
          </section>
        </section>
      </section>

      {showJoinOverlay ? (
        <section className="join-overlay">
          <div className="join-sheet">
            <span className="eyebrow">Join room {roomId}</span>
            <h2>Claim your seat on the grid.</h2>
            <p>
              The room exists. Enter with a fresh player profile or reuse your
              stored identity on this device.
            </p>
            <button className="primary-button" type="button" onClick={joinRoom} disabled={pending}>
              <Users size={16} />
              <span>Enter room</span>
            </button>
          </div>
        </section>
      ) : null}
    </main>
  );
}
