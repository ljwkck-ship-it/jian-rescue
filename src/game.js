export const DIFFICULTIES = {
  beginner: { label: "초급", rows: 9, cols: 9, jianCount: 10, maxLevel: 16, hintCount: 2 },
  intermediate: { label: "중급", rows: 16, cols: 16, jianCount: 40, maxLevel: 1, hintCount: 1 },
  expert: { label: "고급", rows: 16, cols: 30, jianCount: 99, maxLevel: 1, hintCount: 1 },
};

export function createGame(difficultyKey = "beginner", level = 1) {
  const safeLevel = clampLevel(difficultyKey, level);
  const config = getDifficultyConfig(difficultyKey, safeLevel);
  return {
    difficultyKey,
    level: safeLevel,
    config,
    status: "ready",
    board: createEmptyBoard(config.rows, config.cols),
    openedSafeCount: 0,
    flags: 0,
    firstClickDone: false,
    startedAt: null,
    elapsedSeconds: 0,
    hintsUsed: 0,
    hintedCells: new Set(),
    combo: 0,
    bestCombo: 0,
  };
}

export function getDifficultyConfig(difficultyKey = "beginner", level = 1) {
  const base = DIFFICULTIES[difficultyKey] ?? DIFFICULTIES.beginner;
  const safeLevel = clampLevel(difficultyKey, level);
  if (difficultyKey !== "beginner") {
    return {
      ...base,
      bombCount: difficultyKey === "intermediate" ? 16 : 40,
    };
  }

  const jianCount = Math.min(base.jianCount + safeLevel - 1, 25);
  return {
    ...base,
    jianCount,
    bombCount: Math.ceil(jianCount * 0.4),
  };
}

export function getMaxLevel(difficultyKey = "beginner") {
  return (DIFFICULTIES[difficultyKey] ?? DIFFICULTIES.beginner).maxLevel;
}

export function clampLevel(difficultyKey = "beginner", level = 1) {
  const maxLevel = getMaxLevel(difficultyKey);
  const safeLevel = Number.isSafeInteger(level) && level > 0 ? level : 1;
  return Math.min(safeLevel, maxLevel);
}

export function createEmptyBoard(rows, cols) {
  return Array.from({ length: rows }, (_, row) =>
    Array.from({ length: cols }, (_, col) => ({
      row,
      col,
      hasJian: false,
      hasBomb: false,
      adjacentCount: 0,
      adjacentBombCount: 0,
      isOpen: false,
      isFlagged: false,
      isFound: false,
      isHinted: false,
      isWrongFlag: false,
    })),
  );
}

export function placeJians(game, safeRow, safeCol, random = Math.random) {
  const { rows, cols, jianCount, bombCount = 0 } = game.config;
  const protectedCells = new Set([keyOf(safeRow, safeCol)]);

  if (rows <= 16 && cols <= 16) {
    for (const [row, col] of neighbors(rows, cols, safeRow, safeCol)) {
      protectedCells.add(keyOf(row, col));
    }
  }

  let candidates = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      if (!protectedCells.has(keyOf(row, col))) candidates.push([row, col]);
    }
  }

  if (candidates.length < jianCount) {
    candidates = [];
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        if (row !== safeRow || col !== safeCol) candidates.push([row, col]);
      }
    }
  }

  shuffle(candidates, random);
  for (const [row, col] of candidates.slice(0, jianCount)) {
    game.board[row][col].hasJian = true;
  }
  for (const [row, col] of candidates.slice(jianCount, jianCount + bombCount)) {
    game.board[row][col].hasBomb = true;
  }
  calculateAdjacentCounts(game.board);
  game.firstClickDone = true;
  game.status = "playing";
}

export function calculateAdjacentCounts(board) {
  const rows = board.length;
  const cols = board[0]?.length ?? 0;
  for (const row of board) {
    for (const cell of row) {
      cell.adjacentCount = neighbors(rows, cols, cell.row, cell.col).filter(
        ([r, c]) => board[r][c].hasJian,
      ).length;
      cell.adjacentBombCount = neighbors(rows, cols, cell.row, cell.col).filter(
        ([r, c]) => board[r][c].hasBomb,
      ).length;
    }
  }
}

export function openCell(game, row, col, random = Math.random) {
  if (!canReceiveInput(game)) return game.status;
  const cell = getCell(game, row, col);
  if (!cell || cell.isOpen || cell.isFlagged) return game.status;

  if (!game.firstClickDone) {
    placeJians(game, row, col, random);
  }

  if (cell.hasBomb) {
    cell.isOpen = true;
    game.status = "lost";
    revealAfterLoss(game);
    return game.status;
  }

  if (cell.hasJian) {
    findJian(game, cell);
    if (hasFoundAllJians(game)) finishWithWin(game);
    return game.status;
  }

  openSafeArea(game, row, col);
  if (hasFoundAllJians(game)) finishWithWin(game);
  return game.status;
}

export function toggleFlag(game, row, col) {
  if (!canReceiveInput(game)) return game.status;
  if (!game.firstClickDone) return game.status;
  const cell = getCell(game, row, col);
  if (!cell || cell.isOpen) return game.status;

  if (!cell.hasJian) {
    cell.isWrongFlag = true;
    game.status = "lost";
    revealAfterLoss(game);
    return game.status;
  }

  cell.isFlagged = !cell.isFlagged;
  cell.isFound = cell.isFlagged;
  game.flags += cell.isFlagged ? 1 : -1;
  game.combo = cell.isFlagged ? game.combo + 1 : 0;
  game.bestCombo = Math.max(game.bestCombo, game.combo);
  if (hasFoundAllJians(game)) finishWithWin(game);
  return game.status;
}

export function useHint(game) {
  if (!canReceiveInput(game) || !game.firstClickDone) return null;
  if (game.hintsUsed >= game.config.hintCount) return null;

  const candidates = game.board
    .flat()
    .filter((cell) => !cell.isOpen && !cell.isFlagged && !cell.hasJian && !cell.hasBomb)
    .sort((a, b) => {
      const dangerDifference = b.adjacentBombCount - a.adjacentBombCount;
      if (dangerDifference !== 0) return dangerDifference;
      return b.adjacentCount - a.adjacentCount;
    });
  const cell = candidates[0];
  if (!cell) return null;

  cell.isOpen = true;
  cell.isHinted = true;
  game.openedSafeCount += 1;
  game.hintsUsed += 1;
  game.hintedCells.add(`${cell.row}:${cell.col}`);
  return cell;
}

export function openSafeArea(game, startRow, startCol) {
  const rows = game.config.rows;
  const cols = game.config.cols;
  const queue = [[startRow, startCol]];
  const seen = new Set();

  while (queue.length > 0) {
    const [row, col] = queue.shift();
    const cell = getCell(game, row, col);
    if (
      !cell ||
      seen.has(keyOf(row, col)) ||
      cell.isOpen ||
      cell.isFlagged ||
      cell.hasJian ||
      cell.hasBomb
    ) {
      continue;
    }

    seen.add(keyOf(row, col));
    cell.isOpen = true;
    game.openedSafeCount += 1;

    if (cell.adjacentCount === 0 && cell.adjacentBombCount === 0) {
      for (const next of neighbors(rows, cols, row, col)) queue.push(next);
    }
  }
}

export function revealAfterLoss(game) {
  for (const row of game.board) {
    for (const cell of row) {
      if (cell.hasJian) cell.isOpen = true;
      if (cell.hasBomb) cell.isOpen = true;
      if (cell.isFlagged && !cell.hasJian) cell.isWrongFlag = true;
    }
  }
}

export function revealJiansAfterWin(game) {
  for (const row of game.board) {
    for (const cell of row) {
      if (cell.hasJian) cell.isOpen = true;
    }
  }
}

export function getRemainingJians(game) {
  return game.config.jianCount - game.flags;
}

export function getFoundJianMarks(game) {
  return game.board.flat().filter((cell) => cell.hasJian && cell.isFound).length;
}

export function hasFoundAllJians(game) {
  if (!game.firstClickDone) return false;
  return getFoundJianMarks(game) === game.config.jianCount;
}

export function getCell(game, row, col) {
  return game.board[row]?.[col] ?? null;
}

export function neighbors(rows, cols, row, col) {
  const result = [];
  for (let dr = -1; dr <= 1; dr += 1) {
    for (let dc = -1; dc <= 1; dc += 1) {
      if (dr === 0 && dc === 0) continue;
      const nr = row + dr;
      const nc = col + dc;
      if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) result.push([nr, nc]);
    }
  }
  return result;
}

function canReceiveInput(game) {
  return game.status === "ready" || game.status === "playing";
}

function finishWithWin(game) {
  game.status = "won";
  revealJiansAfterWin(game);
}

function findJian(game, cell) {
  if (cell.isFound) return;
  cell.isFound = true;
  cell.isOpen = true;
  cell.isFlagged = true;
  game.flags += 1;
}

function keyOf(row, col) {
  return `${row}:${col}`;
}

function shuffle(items, random) {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
}
