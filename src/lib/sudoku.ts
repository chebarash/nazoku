import { Difficulty } from "@/lib/types";

const DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const DIFFICULTY_TARGETS: Record<Difficulty, number> = {
  easy: 41,
  medium: 34,
  hard: 29,
};

function randomInt(max: number) {
  return Math.floor(Math.random() * max);
}

function shuffle<T>(source: T[]) {
  const array = [...source];

  for (let index = array.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    const current = array[index];
    array[index] = array[swapIndex];
    array[swapIndex] = current;
  }

  return array;
}

function pattern(row: number, column: number) {
  return (row * 3 + Math.floor(row / 3) + column) % 9;
}

function buildSolvedBoard() {
  const bands = shuffle([0, 1, 2]);
  const rows = bands.flatMap((band) =>
    shuffle([0, 1, 2]).map((offset) => band * 3 + offset),
  );
  const stacks = shuffle([0, 1, 2]);
  const columns = stacks.flatMap((stack) =>
    shuffle([0, 1, 2]).map((offset) => stack * 3 + offset),
  );
  const digits = shuffle(DIGITS);

  return rows.flatMap((row) =>
    columns.map((column) => digits[pattern(row, column)]),
  );
}

function getCandidates(board: number[], index: number) {
  if (board[index] !== 0) {
    return [];
  }

  const row = Math.floor(index / 9);
  const column = index % 9;
  const used = new Set<number>();

  for (let offset = 0; offset < 9; offset += 1) {
    used.add(board[row * 9 + offset]);
    used.add(board[offset * 9 + column]);
  }

  const boxRow = Math.floor(row / 3) * 3;
  const boxColumn = Math.floor(column / 3) * 3;

  for (let deltaRow = 0; deltaRow < 3; deltaRow += 1) {
    for (let deltaColumn = 0; deltaColumn < 3; deltaColumn += 1) {
      used.add(board[(boxRow + deltaRow) * 9 + boxColumn + deltaColumn]);
    }
  }

  return DIGITS.filter((value) => !used.has(value));
}

function countSolutions(board: number[], limit = 2): number {
  let nextIndex = -1;
  let nextCandidates: number[] | null = null;

  for (let index = 0; index < 81; index += 1) {
    if (board[index] !== 0) {
      continue;
    }

    const candidates = getCandidates(board, index);

    if (candidates.length === 0) {
      return 0;
    }

    if (nextCandidates === null || candidates.length < nextCandidates.length) {
      nextIndex = index;
      nextCandidates = candidates;
    }
  }

  if (nextIndex === -1 || nextCandidates === null) {
    return 1;
  }

  let solutions = 0;

  for (const candidate of nextCandidates) {
    board[nextIndex] = candidate;
    solutions += countSolutions(board, limit - solutions);

    if (solutions >= limit) {
      board[nextIndex] = 0;
      return solutions;
    }
  }

  board[nextIndex] = 0;
  return solutions;
}

function buildSymmetryPairs() {
  const seen = new Set<number>();
  const pairs: Array<[number, number]> = [];

  for (let index = 0; index < 81; index += 1) {
    if (seen.has(index)) {
      continue;
    }

    const mirror = 80 - index;
    seen.add(index);
    seen.add(mirror);
    pairs.push(index === mirror ? [index, mirror] : [index, mirror]);
  }

  return shuffle(pairs);
}

export function generatePuzzle(difficulty: Difficulty) {
  const solution = buildSolvedBoard();
  const puzzle = [...solution];
  let clues = 81;
  const targetClues = DIFFICULTY_TARGETS[difficulty];

  for (const [first, second] of buildSymmetryPairs()) {
    const removalCount = first === second ? 1 : 2;

    if (clues - removalCount < targetClues) {
      continue;
    }

    const firstValue = puzzle[first];
    const secondValue = puzzle[second];
    puzzle[first] = 0;
    puzzle[second] = 0;

    if (countSolutions([...puzzle], 2) !== 1) {
      puzzle[first] = firstValue;
      puzzle[second] = secondValue;
      continue;
    }

    clues -= removalCount;

    if (clues <= targetClues) {
      break;
    }
  }

  if (clues > targetClues) {
    for (const index of shuffle(Array.from({ length: 81 }, (_, value) => value))) {
      if (puzzle[index] === 0 || clues - 1 < targetClues) {
        continue;
      }

      const current = puzzle[index];
      puzzle[index] = 0;

      if (countSolutions([...puzzle], 2) !== 1) {
        puzzle[index] = current;
        continue;
      }

      clues -= 1;

      if (clues <= targetClues) {
        break;
      }
    }
  }

  return {
    puzzle: puzzle.map((value) => (value === 0 ? null : value)),
    solution,
    givens: puzzle.map((value) => value !== 0),
  };
}

export function isSolved(
  board: Array<number | null>,
  solution: number[],
  givens: boolean[],
) {
  return board.every((value, index) =>
    givens[index] ? value === solution[index] : value === solution[index],
  );
}

export function clampDifficulty(input: unknown): Difficulty {
  if (input === "easy" || input === "medium" || input === "hard") {
    return input;
  }

  return "medium";
}
