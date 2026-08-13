export const MAX_LEVEL = 50;
const MAX_GENERATION_ATTEMPTS = 600;
const DOMAIN_SAFE = 1;
const DOMAIN_JIAN = 2;

export const HAZARDS = [
  { key: "puddle", label: "웅덩이", emoji: "💧", fromLevel: 1, rule: "주변 8칸", description: "이 칸을 둘러싼 8칸 안의 웅덩이 수예요.", example: "💧 2라면 바로 주변 8칸 중 웅덩이가 2곳이에요." },
  { key: "wind", label: "세찬 바람", emoji: "💨", fromLevel: 4, rule: "같은 행 + 같은 열 전체", description: "이 칸은 빼고, 같은 가로줄 전체와 세로줄 전체를 합쳐 세요. 십자(＋) 모양 범위예요.", example: "💨 2라면 같은 행·열의 모든 칸 중 바람 칸이 2곳이에요." },
  { key: "poop", label: "강아지 똥", emoji: "💩", fromLevel: 7, rule: "주변 8칸 + 같은 행 전체", description: "주변 8칸에 같은 가로줄의 먼 칸까지 더해 세요. 겹치는 칸은 한 번만 세요.", example: "💩 3이라면 그 넓은 가로 범위 안에 3곳이 있어요." },
  { key: "spider", label: "거미", emoji: "🕷️", fromLevel: 10, rule: "대각선 4방향 전체", description: "이 칸에서 X자 방향으로 끝까지 이어지는 모든 칸을 세요.", example: "🕷️ 1이라면 두 대각선 줄 전체에 거미가 1곳이에요." },
  { key: "snake", label: "뱀", emoji: "🐍", fromLevel: 13, rule: "상·하·좌·우 4칸", description: "대각선은 빼고 바로 맞닿은 네 방향만 세요.", example: "🐍 1이라면 위·아래·왼쪽·오른쪽 중 1곳이에요." },
];

const TUTORIAL_START = [1, 1];
const TUTORIAL_JIANS = [[0, 3]];
const TUTORIAL_HAZARDS = [[3, 3]];

export function getHazardForLevel(level = 1) {
  return HAZARDS.filter((hazard) => level >= hazard.fromLevel).at(-1) ?? HAZARDS[0];
}

export function getHazardsForLevel(level = 1) {
  const safeLevel = clampLevel(level);
  if (safeLevel < 4) return [HAZARDS[0]];
  if (safeLevel < 7) return [HAZARDS[1]];
  if (safeLevel < 10) return [HAZARDS[2]];
  if (safeLevel < 13) return [HAZARDS[3]];
  if (safeLevel < 20) return [HAZARDS[4]];
  if (safeLevel < 25) return [HAZARDS[0], HAZARDS[4]];
  if (safeLevel < 30) return [HAZARDS[0], HAZARDS[1]];
  if (safeLevel < 35) return [HAZARDS[1], HAZARDS[4]];
  if (safeLevel < 40) return [HAZARDS[0], HAZARDS[3]];
  if (safeLevel < 45) return [HAZARDS[1], HAZARDS[2]];
  if (safeLevel < 50) return [HAZARDS[2], HAZARDS[3]];
  return [HAZARDS[1], HAZARDS[2], HAZARDS[3]];
}

export function createGame(level = 1) {
  const safeLevel = clampLevel(level);
  const config = getLevelConfig(safeLevel);
  return {
    level: safeLevel,
    config,
    status: "ready",
    board: createEmptyBoard(config.rows, config.cols),
    openedSafeCount: 0,
    flags: 0,
    hazardMarks: 0,
    hazardMarkCounts: Object.fromEntries(config.hazards.map((hazard) => [hazard.key, 0])),
    firstClickDone: false,
    startedAt: null,
    elapsedSeconds: 0,
    remainingSeconds: config.timeLimitSeconds,
    timeWarnings: new Set(),
    hintsUsed: 0,
    hintPenaltySeconds: 0,
    hintedCells: new Set(),
    combo: 0,
    bestCombo: 0,
    score: 0,
    scoreBreakdown: { explore: 0, rescue: 0, mark: 0, time: 0, combo: 0 },
  };
}

export function getLevelConfig(level = 1) {
  const safeLevel = clampLevel(level);
  if (safeLevel === 1) {
    const hazards = getHazardsForLevel(safeLevel);
    return {
      rows: 4,
      cols: 4,
      jianCount: 1,
      bombCount: 1,
      hazardCount: 1,
      hazardCounts: { puddle: 1 },
      hintCount: 3,
      timeLimitSeconds: getTimeLimitForLevel(safeLevel),
      hazard: hazards[0],
      hazards,
      tutorial: true,
      tutorialNoTimer: true,
      tutorialStart: TUTORIAL_START,
    };
  }
  const boardSize = Math.min(13, 4 + Math.ceil(safeLevel / 6));
  const jianCount = Math.min(14, 1 + Math.ceil((safeLevel - 1) / 4));
  const hazardCount = Math.min(12, 1 + Math.floor((safeLevel - 1) / 4));
  const hazards = getHazardsForLevel(safeLevel);
  const hazardCounts = Object.fromEntries(hazards.map((hazard, index) => [hazard.key, Math.floor(hazardCount / hazards.length) + (index < hazardCount % hazards.length ? 1 : 0)]));
  return {
    rows: boardSize,
    cols: boardSize,
    jianCount,
    bombCount: hazardCount,
    hazardCount,
    hazardCounts,
    hintCount: 3,
    timeLimitSeconds: getTimeLimitForLevel(safeLevel),
    hazard: hazards[0],
    hazards,
    mixedHazards: hazards.length > 1,
    tutorial: false,
  };
}

export function getTimeLimitForLevel(level = 1) {
  const safeLevel = clampLevel(level);
  if (safeLevel === 1) return 0;
  const boardSize = Math.min(13, 4 + Math.ceil(safeLevel / 6));
  const jianCount = Math.min(14, 1 + Math.ceil((safeLevel - 1) / 4));
  const hazardCount = Math.min(12, 1 + Math.floor((safeLevel - 1) / 4));
  const hazardKinds = getHazardsForLevel(safeLevel).length;
  const complexity = boardSize * boardSize + jianCount * 6 + hazardCount * 5 + (hazardKinds - 1) * 28;
  return Math.ceil((35 + complexity * 1.25) / 15) * 15;
}

export function getMaxLevel() {
  return MAX_LEVEL;
}

export function clampLevel(level = 1) {
  const safeLevel = Number.isSafeInteger(level) && level > 0 ? level : 1;
  return Math.min(safeLevel, MAX_LEVEL);
}

export function createEmptyBoard(rows, cols) {
  return Array.from({ length: rows }, (_, row) =>
    Array.from({ length: cols }, (_, col) => ({
      row,
      col,
      hasJian: false,
      hasBomb: false,
      hazardKey: null,
      adjacentCount: 0,
      adjacentBombCount: 0,
      adjacentHazardCounts: {},
      isOpen: false,
      isFlagged: false,
      isHazardMarked: false,
      hazardMarkKey: null,
      hasScoredMark: false,
      isFound: false,
      isHinted: false,
      isHintSource: false,
      isHintTarget: false,
      isWrongFlag: false,
    })),
  );
}

export function placeJians(game, safeRow, safeCol, random = Math.random) {
  const { rows, cols, jianCount, bombCount = 0, hazards, hazardCounts } = game.config;
  if (game.config.tutorial) {
    const board = createEmptyBoard(rows, cols);
    for (const [row, col] of TUTORIAL_JIANS) board[row][col].hasJian = true;
    for (const [row, col] of TUTORIAL_HAZARDS) {
      board[row][col].hasBomb = true;
      board[row][col].hazardKey = game.config.hazard.key;
    }
    calculateAdjacentCounts(board, hazards);
    game.board = board;
    game.generationAttempts = 1;
    game.isLogicVerified = isLogicallySolvable(board, safeRow, safeCol, jianCount, hazardCounts, hazards);
    game.firstClickDone = true;
    game.status = "playing";
    return;
  }
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

  let selectedBoard = null;
  const placeTargets = (board, orderedCandidates) => {
    for (const [row, col] of orderedCandidates.slice(0, jianCount)) board[row][col].hasJian = true;
    let offset = jianCount;
    for (const hazard of hazards) {
      const count = hazardCounts[hazard.key] ?? 0;
      for (const [row, col] of orderedCandidates.slice(offset, offset + count)) {
        board[row][col].hasBomb = true;
        board[row][col].hazardKey = hazard.key;
      }
      offset += count;
    }
  };
  let attempts = 0;
  for (; attempts < MAX_GENERATION_ATTEMPTS; attempts += 1) {
    const board = createEmptyBoard(rows, cols);
    shuffle(candidates, random);
    placeTargets(board, candidates);
    calculateAdjacentCounts(board, hazards);
    if (isLogicallySolvable(board, safeRow, safeCol, jianCount, hazardCounts, hazards)) {
      selectedBoard = board;
      break;
    }
  }

  if (!selectedBoard) {
    selectedBoard = createEmptyBoard(rows, cols);
    const ordered = [...candidates].sort(([rowA, colA], [rowB, colB]) => {
      const distanceA = Math.abs(rowA - safeRow) + Math.abs(colA - safeCol);
      const distanceB = Math.abs(rowB - safeRow) + Math.abs(colB - safeCol);
      return distanceA - distanceB || rowA - rowB || colA - colB;
    });
    placeTargets(selectedBoard, ordered);
    calculateAdjacentCounts(selectedBoard, hazards);
    if (!isLogicallySolvable(selectedBoard, safeRow, safeCol, jianCount, hazardCounts, hazards)) {
      throw new Error("논리적으로 풀 수 있는 구조 보드를 만들지 못했습니다.");
    }
  }

  game.board = selectedBoard;
  game.generationAttempts = attempts + 1;
  game.isLogicVerified = isLogicallySolvable(selectedBoard, safeRow, safeCol, jianCount, hazardCounts, hazards);
  game.firstClickDone = true;
  game.status = "playing";
}

function normalizeHazardSpec(board, hazardTotals, hazardSpec) {
  if (Array.isArray(hazardSpec)) {
    const totals = typeof hazardTotals === "object" ? hazardTotals : Object.fromEntries(hazardSpec.map((hazard, index) => [hazard.key, index === 0 ? hazardTotals : 0]));
    return { hazards: hazardSpec, totals };
  }
  const key = typeof hazardSpec === "string" ? hazardSpec : "puddle";
  const hazard = HAZARDS.find((item) => item.key === key) ?? HAZARDS[0];
  return { hazards: [hazard], totals: { [hazard.key]: typeof hazardTotals === "number" ? hazardTotals : board.flat().filter((cell) => cell.hazardKey === hazard.key || cell.hasBomb).length } };
}

function makeDomainTypes(hazards) {
  const hazardTypes = Object.fromEntries(hazards.map((hazard, index) => [hazard.key, 1 << (index + 2)]));
  return { hazardTypes, unknown: DOMAIN_SAFE | DOMAIN_JIAN | Object.values(hazardTypes).reduce((mask, type) => mask | type, 0) };
}

export function isLogicallySolvable(board, startRow, startCol, jianTotal, hazardTotals, hazardSpec = "puddle") {
  const rows = board.length;
  const cols = board[0]?.length ?? 0;
  if (!board[startRow]?.[startCol] || board[startRow][startCol].hasJian || board[startRow][startCol].hasBomb) return false;
  const { hazards, totals } = normalizeHazardSpec(board, hazardTotals, hazardSpec);
  const { hazardTypes, unknown } = makeDomainTypes(hazards);
  const domains = Array.from({ length: rows }, () => Array(cols).fill(unknown));
  const opened = Array.from({ length: rows }, () => Array(cols).fill(false));

  const openSafe = (startR, startC) => {
    const queue = [[startR, startC]];
    while (queue.length) {
      const [row, col] = queue.shift();
      const cell = board[row]?.[col];
      if (!cell || opened[row][col] || cell.hasJian || cell.hasBomb) continue;
      domains[row][col] = DOMAIN_SAFE;
      opened[row][col] = true;
      const noClues = cell.adjacentCount === 0 && hazards.every((hazard) => (cell.adjacentHazardCounts?.[hazard.key] ?? (hazards.length === 1 ? cell.adjacentBombCount : 0)) === 0);
      if (noClues) for (const next of neighbors(rows, cols, row, col)) queue.push(next);
    }
  };

  openSafe(startRow, startCol);
  for (const [row, col] of neighbors(rows, cols, startRow, startCol)) openSafe(row, col);
  const allCells = Array.from({ length: rows * cols }, (_, index) => [Math.floor(index / cols), index % cols]);
  for (let pass = 0; pass < rows * cols * 6; pass += 1) {
    let changed = false;
    const constrain = (cells, clue, type) => {
      const known = cells.filter(([row, col]) => domains[row][col] === type).length;
      const candidates = cells.filter(([row, col]) => domains[row][col] !== type && (domains[row][col] & type));
      const remaining = clue - known;
      if (remaining < 0 || remaining > candidates.length) return false;
      for (const [row, col] of candidates) {
        const before = domains[row][col];
        if (remaining === 0) domains[row][col] &= ~type;
        else if (remaining === candidates.length) domains[row][col] = type;
        if (domains[row][col] === 0) return false;
        if (domains[row][col] !== before) changed = true;
      }
      return true;
    };

    for (let row = 0; row < rows; row += 1) for (let col = 0; col < cols; col += 1) {
      if (!opened[row][col]) continue;
      const cell = board[row][col];
      if (!constrain(neighbors(rows, cols, row, col), cell.adjacentCount, DOMAIN_JIAN)) return false;
      for (const hazard of hazards) {
        const clue = cell.adjacentHazardCounts?.[hazard.key] ?? (hazards.length === 1 ? cell.adjacentBombCount : 0);
        if (!constrain(hazardNeighbors(rows, cols, row, col, hazard.key), clue, hazardTypes[hazard.key])) return false;
      }
    }
    if (!constrain(allCells, jianTotal, DOMAIN_JIAN)) return false;
    for (const hazard of hazards) if (!constrain(allCells, totals[hazard.key] ?? 0, hazardTypes[hazard.key])) return false;

    for (let row = 0; row < rows; row += 1) for (let col = 0; col < cols; col += 1) {
      if (domains[row][col] === DOMAIN_SAFE && !opened[row][col]) {
        if (board[row][col].hasJian || board[row][col].hasBomb) return false;
        openSafe(row, col);
        changed = true;
      }
    }
    const solvedJians = domains.flat().filter((domain) => domain === DOMAIN_JIAN).length === jianTotal;
    const solvedHazards = hazards.every((hazard) => domains.flat().filter((domain) => domain === hazardTypes[hazard.key]).length === (totals[hazard.key] ?? 0));
    if (solvedJians && solvedHazards) return true;
    if (!changed) return false;
  }
  return false;
}

export function calculateAdjacentCounts(board, hazardSpec = "puddle") {
  const rows = board.length;
  const cols = board[0]?.length ?? 0;
  const hazards = Array.isArray(hazardSpec) ? hazardSpec : [HAZARDS.find((hazard) => hazard.key === hazardSpec) ?? HAZARDS[0]];
  for (const row of board) for (const cell of row) {
    cell.adjacentCount = neighbors(rows, cols, cell.row, cell.col).filter(([r, c]) => board[r][c].hasJian).length;
    cell.adjacentHazardCounts = Object.fromEntries(hazards.map((hazard) => [hazard.key, hazardNeighbors(rows, cols, cell.row, cell.col, hazard.key).filter(([r, c]) => board[r][c].hazardKey === hazard.key || (hazards.length === 1 && !board[r][c].hazardKey && board[r][c].hasBomb)).length]));
    cell.adjacentBombCount = Object.values(cell.adjacentHazardCounts).reduce((sum, count) => sum + count, 0);
  }
}

export function getLogicalHint(game) {
  if (!game.firstClickDone || game.status !== "playing") return null;
  const { rows, cols, jianCount, hazards, hazardCounts } = game.config;
  const { hazardTypes, unknown } = makeDomainTypes(hazards);
  const domains = Array.from({ length: rows }, () => Array(cols).fill(unknown));
  const reasons = Array.from({ length: rows }, () => Array(cols).fill(null));

  for (const row of game.board) {
    for (const cell of row) {
      if (cell.isOpen && cell.hasJian) domains[cell.row][cell.col] = DOMAIN_JIAN;
      else if (cell.isOpen && cell.hasBomb) domains[cell.row][cell.col] = hazardTypes[cell.hazardKey];
      else if (cell.isOpen) domains[cell.row][cell.col] = DOMAIN_SAFE;
      else if (cell.isHazardMarked && cell.hazardMarkKey && hazardTypes[cell.hazardMarkKey]) domains[cell.row][cell.col] = hazardTypes[cell.hazardMarkKey];
    }
  }

  const isActionable = (row, col, type) => {
    const cell = game.board[row][col];
    if (type === DOMAIN_SAFE) return !cell.isOpen;
    if (type === DOMAIN_JIAN) return !cell.isFound;
    return !cell.isHazardMarked || hazardTypes[cell.hazardMarkKey] !== type;
  };

  const makeHint = (row, col, type) => {
    const reason = reasons[row][col];
    const source = reason?.source ?? null;
    const position = `${row + 1}행 ${col + 1}열`;
    const sourcePosition = source ? `${source.row + 1}행 ${source.col + 1}열` : "전체 목표 수";
    const hazard = hazards.find((item) => hazardTypes[item.key] === type);
    const kind = type === DOMAIN_SAFE ? "safe" : type === DOMAIN_JIAN ? "jian" : "hazard";
    const needsUnmark = game.board[row][col].isHazardMarked && kind !== "hazard";
    const action = kind === "hazard" ? "위험 표시" : needsUnmark ? "위험 표시 해제 후 열기" : "열기";
    const conclusion = kind === "safe" ? "안전한 칸" : kind === "jian" ? "지안 칸" : `${hazard.label} 칸`;
    return {
      source,
      target: { row, col },
      kind,
      hazardKey: hazard?.key ?? null,
      action,
      sourcePosition,
      targetPosition: position,
      explanation: `${sourcePosition}의 단서와 남은 후보 수를 비교하면 ${position}은 ${conclusion}으로 확정돼요.`,
    };
  };

  for (let pass = 0; pass < rows * cols * 4; pass += 1) {
    let changed = false;
    const constrain = (cells, clue, type, source = null) => {
      const known = cells.filter(([row, col]) => domains[row][col] === type).length;
      const candidates = cells.filter(([row, col]) => domains[row][col] !== type && (domains[row][col] & type));
      const remaining = clue - known;
      if (remaining < 0 || remaining > candidates.length) return;
      for (const [row, col] of candidates) {
        const before = domains[row][col];
        if (remaining === 0) domains[row][col] &= ~type;
        else if (remaining === candidates.length) domains[row][col] = type;
        if (before !== domains[row][col]) {
          reasons[row][col] = { source, type };
          changed = true;
        }
      }
    };

    for (const row of game.board) {
      for (const cell of row) {
        if (!cell.isOpen || cell.hasJian || cell.hasBomb) continue;
        const source = { row: cell.row, col: cell.col };
        constrain(neighbors(rows, cols, cell.row, cell.col), cell.adjacentCount, DOMAIN_JIAN, source);
        for (const hazard of hazards) constrain(hazardNeighbors(rows, cols, cell.row, cell.col, hazard.key), cell.adjacentHazardCounts[hazard.key] ?? 0, hazardTypes[hazard.key], source);
      }
    }

    const allCells = [];
    for (let row = 0; row < rows; row += 1) for (let col = 0; col < cols; col += 1) allCells.push([row, col]);
    constrain(allCells, jianCount, DOMAIN_JIAN);
    for (const hazard of hazards) constrain(allCells, hazardCounts[hazard.key] ?? 0, hazardTypes[hazard.key]);

    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const type = domains[row][col];
        if ([DOMAIN_SAFE, DOMAIN_JIAN, ...Object.values(hazardTypes)].includes(type) && isActionable(row, col, type)) {
          return makeHint(row, col, type);
        }
      }
    }
    if (!changed) break;
  }
  return null;
}

export function openCell(game, row, col, random = Math.random) {
  if (!canReceiveInput(game)) return game.status;
  const cell = getCell(game, row, col);
  if (!cell || cell.isOpen || cell.isFlagged || cell.isHazardMarked) return game.status;

  const isFirstOpen = !game.firstClickDone;
  if (isFirstOpen) {
    const [tutorialRow, tutorialCol] = game.config.tutorialStart ?? [-1, -1];
    if (game.config.tutorial && (row !== tutorialRow || col !== tutorialCol)) {
      game.lastActionReason = "tutorial-start";
      return game.status;
    }
    placeJians(game, row, col, random);
  }

  if (cell.hasBomb) {
    cell.isOpen = true;
    game.status = "lost";
    game.lossReason = "hazard";
    game.lossHazardKey = cell.hazardKey;
    game.lossCell = { row, col };
    game.combo = 0;
    revealAfterLoss(game);
    return game.status;
  }

  if (cell.hasJian) {
    findJian(game, cell);
    if (hasCompletedMission(game)) finishWithWin(game);
    return game.status;
  }

  const openedBefore = game.openedSafeCount;
  openSafeArea(game, row, col);
  if (isFirstOpen) {
    for (const [safeRow, safeCol] of neighbors(game.config.rows, game.config.cols, row, col)) {
      openSafeArea(game, safeRow, safeCol);
    }
  }
  const openedNow = game.openedSafeCount - openedBefore;
  if (openedNow > 0) addComboScore(game, openedNow * 10, "explore");
  if (hasCompletedMission(game)) finishWithWin(game);
  return game.status;
}

export function expireGame(game) {
  if (game.status !== "playing") return game.status;
  game.remainingSeconds = 0;
  game.status = "lost";
  game.lossReason = "timeout";
  revealAfterLoss(game);
  return game.status;
}

export function toggleFlag(game, row, col) {
  if (!canReceiveInput(game)) return game.status;
  if (!game.firstClickDone) return game.status;
  const cell = getCell(game, row, col);
  if (!cell || cell.isOpen) return game.status;

  if (!cell.hasJian || cell.isHazardMarked) {
    cell.isWrongFlag = true;
    game.status = "lost";
    game.combo = 0;
    revealAfterLoss(game);
    return game.status;
  }

  cell.isFlagged = !cell.isFlagged;
  cell.isFound = cell.isFlagged;
  game.flags += cell.isFlagged ? 1 : -1;
  if (cell.isFlagged) addComboScore(game, 150, "rescue");
  else game.combo = 0;
  if (hasCompletedMission(game)) finishWithWin(game);
  return game.status;
}

export function toggleHazardMark(game, row, col, hazardKey = game.config.hazard.key) {
  if (!canReceiveInput(game) || !game.firstClickDone) return game.status;
  const cell = getCell(game, row, col);
  if (!cell || cell.isOpen) return game.status;

  if (cell.isFlagged || !game.config.hazardCounts[hazardKey]) return game.status;
  const previousKey = cell.hazardMarkKey;
  if (previousKey === hazardKey) {
    cell.isHazardMarked = false;
    cell.hazardMarkKey = null;
    game.hazardMarks -= 1;
    game.hazardMarkCounts[hazardKey] -= 1;
    game.combo = 0;
  } else {
    if ((game.hazardMarkCounts[hazardKey] ?? 0) >= game.config.hazardCounts[hazardKey]) return game.status;
    if (previousKey) game.hazardMarkCounts[previousKey] -= 1;
    else game.hazardMarks += 1;
    cell.isHazardMarked = true;
    cell.hazardMarkKey = hazardKey;
    game.hazardMarkCounts[hazardKey] = (game.hazardMarkCounts[hazardKey] ?? 0) + 1;
    if (!cell.hasScoredMark) {
      cell.hasScoredMark = true;
      addComboScore(game, 15, "mark");
    }
  }
  if (hasCompletedMission(game)) finishWithWin(game);
  return game.status;
}

export function useHint(game) {
  if (!canReceiveInput(game) || !game.firstClickDone) return null;
  for (const cell of game.board.flat()) {
    cell.isHintSource = false;
    cell.isHintTarget = false;
  }

  let consumed = false;
  if (!game.activeHint || game.activeHint.stage >= 3) {
    if (game.hintsUsed >= game.config.hintCount) return null;
    const logicalHint = getLogicalHint(game);
    if (!logicalHint) return null;
    game.activeHint = { ...logicalHint, stage: 1 };
    game.hintsUsed += 1;
    const penalty = [5, 10, 20][game.hintsUsed - 1] ?? 20;
    game.hintPenaltySeconds += penalty;
    game.combo = 0;
    consumed = true;
  } else {
    game.activeHint.stage += 1;
  }

  const hint = game.activeHint;
  if (hint.source) game.board[hint.source.row][hint.source.col].isHintSource = true;
  if (hint.stage >= 2) game.board[hint.target.row][hint.target.col].isHintTarget = true;
  return { ...hint, consumed, penalty: consumed ? [5, 10, 20][game.hintsUsed - 1] ?? 20 : 0 };
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

    if (cell.adjacentCount === 0 && game.config.hazards.every((hazard) => (cell.adjacentHazardCounts[hazard.key] ?? 0) === 0)) {
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
      if (cell.isHazardMarked && cell.hazardMarkKey !== (cell.hazardKey ?? game.config.hazard.key)) cell.isWrongFlag = true;
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

export function getFoundHazardMarks(game) {
  return game.board.flat().filter((cell) => cell.hasBomb && cell.isHazardMarked && cell.hazardMarkKey === (cell.hazardKey ?? game.config.hazard.key)).length;
}

export function hasMarkedAllHazards(game) {
  if (!game.firstClickDone) return false;
  return getFoundHazardMarks(game) === game.config.hazardCount;
}

export function hasFoundAllJians(game) {
  if (!game.firstClickDone) return false;
  return getFoundJianMarks(game) === game.config.jianCount;
}

export function hasCompletedMission(game) {
  return hasFoundAllJians(game) && hasMarkedAllHazards(game);
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

export function hazardNeighbors(rows, cols, row, col, hazardKey = "puddle") {
  if (hazardKey === "wind") {
    const result = [];
    for (let r = 0; r < rows; r += 1) if (r !== row) result.push([r, col]);
    for (let c = 0; c < cols; c += 1) if (c !== col) result.push([row, c]);
    return result;
  }
  if (hazardKey === "poop") {
    const result = new Map(neighbors(rows, cols, row, col).map(([r, c]) => [keyOf(r, c), [r, c]]));
    for (let c = 0; c < cols; c += 1) if (c !== col) result.set(keyOf(row, c), [row, c]);
    return [...result.values()];
  }
  if (hazardKey === "spider") {
    const result = [];
    for (const [dr, dc] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
      let r = row + dr;
      let c = col + dc;
      while (r >= 0 && r < rows && c >= 0 && c < cols) {
        result.push([r, c]);
        r += dr;
        c += dc;
      }
    }
    return result;
  }
  if (hazardKey === "snake") {
    return [[row - 1, col], [row + 1, col], [row, col - 1], [row, col + 1]].filter(
      ([r, c]) => r >= 0 && r < rows && c >= 0 && c < cols,
    );
  }
  return neighbors(rows, cols, row, col);
}

function canReceiveInput(game) {
  return game.status === "ready" || game.status === "playing";
}

function finishWithWin(game) {
  game.status = "won";
  const timeBonus = game.remainingSeconds * 5;
  const comboBonus = game.bestCombo * 20;
  game.scoreBreakdown.time += timeBonus;
  game.scoreBreakdown.combo += comboBonus;
  game.score += timeBonus + comboBonus;
  revealJiansAfterWin(game);
}

function findJian(game, cell) {
  if (cell.isFound) return;
  cell.isFound = true;
  cell.isOpen = true;
  cell.isFlagged = true;
  game.flags += 1;
  addComboScore(game, 150, "rescue");
}

function addComboScore(game, base, category) {
  game.combo += 1;
  game.bestCombo = Math.max(game.bestCombo, game.combo);
  const baseScore = base;
  const comboScore = Math.min(game.combo - 1, 10) * 5;
  game.scoreBreakdown[category] += baseScore;
  game.scoreBreakdown.combo += comboScore;
  game.score += baseScore + comboScore;
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
