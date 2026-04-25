"use client";

import type { CSSProperties } from "react";

import { RoomPlayer, RoomState } from "@/lib/types";

interface SudokuBoardProps {
  room: RoomState;
  selfPlayer: RoomPlayer | null;
  selectedCell: number | null;
  onSelectCell: (index: number) => void;
}

function neighbors(a: number, b: number) {
  const rowA = Math.floor(a / 9);
  const columnA = a % 9;
  const rowB = Math.floor(b / 9);
  const columnB = b % 9;

  if (rowA === rowB || columnA === columnB) {
    return true;
  }

  return (
    Math.floor(rowA / 3) === Math.floor(rowB / 3) &&
    Math.floor(columnA / 3) === Math.floor(columnB / 3)
  );
}

function valueMatch(room: RoomState, selectedCell: number, index: number) {
  const selected = room.board[selectedCell];

  if (selected === null) {
    return false;
  }

  return room.board[index] === selected;
}

export function SudokuBoard({
  room,
  selfPlayer,
  selectedCell,
  onSelectCell,
}: SudokuBoardProps) {
  return (
    <div className="board-shell">
      <div className="board-grid" role="grid" aria-label="Shared Sudoku board">
        {room.board.map((value, index) => {
          const player = room.players.find(
            (candidate) => candidate.playerId === room.cellOwners[index],
          );
          const isGiven = room.givens[index];
          const isSelected = selectedCell === index;
          const isNeighbor =
            selectedCell !== null && !isSelected && neighbors(selectedCell, index);
          const isSameValue =
            selectedCell !== null && !isSelected && valueMatch(room, selectedCell, index);
          const isWrong = value !== null && value !== room.solution[index];
          const notes = room.notes[index];

          return (
            <button
              key={index}
              className={[
                "cell",
                isGiven ? "cell-given" : "",
                isSelected ? "cell-selected" : "",
                isNeighbor ? "cell-neighbor" : "",
                isSameValue ? "cell-same-value" : "",
                isWrong ? "cell-wrong" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              style={
                player
                  ? {
                      "--cell-accent": player.playerColor,
                    } as CSSProperties
                  : undefined
              }
              onClick={() => onSelectCell(index)}
              aria-label={`Cell ${index + 1}`}
              type="button"
            >
              {value !== null ? (
                <span className="cell-value">{value}</span>
              ) : (
                <span className="cell-notes" aria-hidden="true">
                  {Array.from({ length: 9 }, (_, noteIndex) => noteIndex + 1).map((note) => (
                    <span key={note} className="cell-note">
                      {notes.includes(note) ? note : ""}
                    </span>
                  ))}
                </span>
              )}

              {player ? (
                <span
                  className="cell-owner"
                  style={{ backgroundColor: player.playerColor }}
                  aria-hidden="true"
                />
              ) : null}

              {selfPlayer && room.cellOwners[index] === selfPlayer.playerId ? (
                <span className="sr-only">Last touched by you</span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
