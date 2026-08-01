import {
  DIFFICULTIES,
  clampLevel,
  createGame,
  getDifficultyConfig,
  getFoundJianMarks,
  getMaxLevel,
  openCell,
  toggleFlag,
  useHint,
} from "./game.js";

const STORAGE_KEY = "jian-finder-best-times-v1";
const LEGACY_LEVEL_KEY = "jian-finder-current-level-v1";
const LEVELS_KEY = "jian-finder-levels-by-difficulty-v1";
const HINT_PENALTY_SECONDS = 5;
const FACE_SRCS = Array.from({ length: 10 }, (_, index) =>
  `assets/faces/face-${String(index + 1).padStart(2, "0")}.png`,
);

const boardEl = document.querySelector("#board");
const difficultyButtons = Array.from(document.querySelectorAll("[data-difficulty]"));
const newGameEl = document.querySelector("#new-game");
const hintButtonEl = document.querySelector("#use-hint");
const installAppEl = document.querySelector("#install-app");
const installDialogEl = document.querySelector("#install-dialog");
const levelEl = document.querySelector("#level");
const remainingEl = document.querySelector("#remaining");
const timerEl = document.querySelector("#timer");
const bestTimeEl = document.querySelector("#best-time");
const messageEl = document.querySelector("#message");
const openModeEl = document.querySelector("#open-mode");
const flagModeEl = document.querySelector("#flag-mode");

let currentDifficulty = "beginner";
let currentLevel = readCurrentLevel(currentDifficulty);
let game = createGame(currentDifficulty, currentLevel);
let inputMode = "open";
let focused = { row: 0, col: 0 };
let timerId = null;
let currentFaceSrc = getFaceForLevel(currentLevel);
let deferredInstallPrompt = null;
const faceAvailability = new Map();

preloadFace(currentFaceSrc);

function startNewGame(difficultyKey = currentDifficulty, options = { advanceLevel: false }) {
  stopTimer();
  currentDifficulty = difficultyKey;
  const maxLevel = getMaxLevel(difficultyKey);
  if (options.advanceLevel && currentLevel < maxLevel) currentLevel += 1;
  currentLevel = clampLevel(difficultyKey, currentLevel);
  saveCurrentLevel(difficultyKey, currentLevel);
  currentFaceSrc = getFaceForLevel(currentLevel);
  preloadFace(currentFaceSrc);
  game = createGame(difficultyKey, currentLevel);
  focused = { row: 0, col: 0 };
  newGameEl.textContent = "같은 레벨 재도전";
  setMessage(
    `${game.config.label} 레벨 ${currentLevel}/${maxLevel}: 지안이 ${game.config.jianCount}명을 모두 찾으세요. 폭탄 ${game.config.bombCount}개는 열거나 잘못 표시하면 실패합니다. ${
      currentLevel >= maxLevel
        ? "폭탄을 피하고 마지막 레벨을 클리어하세요."
        : "폭탄을 피해서 모두 찾아야 다음 레벨로 넘어갑니다."
    }`,
  );
  updateDifficultyOptions();
  render();
}

function startTimerIfNeeded() {
  if (timerId || game.status !== "playing") return;
  game.startedAt = Date.now();
  timerId = window.setInterval(() => {
    if (game.status !== "playing") {
      stopTimer();
      return;
    }
    game.elapsedSeconds = Math.floor((Date.now() - game.startedAt) / 1000);
    timerEl.textContent = String(game.elapsedSeconds);
  }, 250);
}

function stopTimer() {
  if (timerId) window.clearInterval(timerId);
  timerId = null;
}

function handleOpen(row, col) {
  const wasReady = game.status === "ready";
  openCell(game, row, col);
  if (wasReady && game.status === "playing") startTimerIfNeeded();
  handleTerminalState();
  render();
}

function handleFlag(row, col) {
  const wasReady = game.status === "ready";
  const previousFlags = game.flags;
  toggleFlag(game, row, col);
  if (wasReady) {
    setMessage("첫 행동은 열기입니다. 숫자를 본 뒤 확실한 칸에만 지안 표시를 하세요.");
  } else if (game.status === "playing" && game.flags > previousFlags) {
    setMessage(`${game.combo}연속 정확한 찾기 · 정확한 찾기 +1${game.combo >= 3 ? " · 3연속 성공!" : ""}`);
  } else if (game.status === "playing" && game.flags < previousFlags) {
    setMessage("지안 표시를 해제했습니다. 숫자 단서를 다시 확인하세요.");
  }
  handleTerminalState();
  render();
}

function handleHint() {
  if (!game.firstClickDone) {
    setMessage("힌트는 첫 칸을 연 뒤 사용할 수 있습니다.");
    return;
  }
  const cell = useHint(game);
  if (!cell) {
    setMessage("이번 레벨의 돋보기 힌트를 모두 사용했습니다.");
    return;
  }
  setMessage(`돋보기 힌트: ${cell.row + 1}행 ${cell.col + 1}열을 안전한 칸으로 공개했습니다. 기록에는 +${HINT_PENALTY_SECONDS}s가 더해집니다.`);
  render();
}

function handleTerminalState() {
  if (game.status === "won") {
    stopTimer();
    const finalSeconds = game.elapsedSeconds;
    const recordSeconds = finalSeconds + game.hintsUsed * HINT_PENALTY_SECONDS;
    const isBest = saveBestTime(game.difficultyKey, currentLevel, recordSeconds);
    const maxLevel = getMaxLevel(game.difficultyKey);
    const isFinalLevel = currentLevel >= maxLevel;
    newGameEl.textContent = isFinalLevel ? "마지막 레벨 재도전" : "다음 레벨";
    setMessage(
      `${game.config.label} 레벨 ${currentLevel}/${maxLevel} 성공. 지안이 ${game.config.jianCount}명을 ${finalSeconds}s 만에 모두 찾았습니다.${
        game.hintsUsed > 0 ? ` 힌트 ${game.hintsUsed}회로 기록 시간은 ${recordSeconds}s입니다.` : ""
      }${
        isBest ? " 신기록입니다." : ""
      }${isFinalLevel ? " 마지막 레벨입니다." : " 다음 레벨로 넘어갈 수 있습니다."}`,
    );
  }

  if (game.status === "lost") {
    stopTimer();
    newGameEl.textContent = "같은 레벨 재도전";
    setMessage("실패했습니다. 폭탄 칸을 열었거나, 지안이가 아닌 칸에 표시해 폭탄이 터졌습니다. 다음 레벨로 넘어가지 않습니다.");
  }
}

function render() {
  boardEl.style.setProperty("--columns", String(game.config.cols));
  boardEl.dataset.difficulty = game.difficultyKey;
  document.body.dataset.difficulty = game.difficultyKey;
  boardEl.setAttribute("aria-rowcount", String(game.config.rows));
  boardEl.setAttribute("aria-colcount", String(game.config.cols));
  levelEl.textContent = `${currentLevel}/${getMaxLevel(game.difficultyKey)}`;
  remainingEl.textContent = `${getFoundJianMarks(game)}/${game.config.jianCount}`;
  timerEl.textContent = String(game.elapsedSeconds);
  bestTimeEl.textContent = formatBestTime(game.difficultyKey, currentLevel);
  const hintsRemaining = Math.max(game.config.hintCount - game.hintsUsed, 0);
  hintButtonEl.textContent = `돋보기 ${hintsRemaining}회`;
  hintButtonEl.disabled = game.status !== "playing" || hintsRemaining === 0;

  const fragment = document.createDocumentFragment();
  for (const row of game.board) {
    for (const cell of row) {
      fragment.appendChild(renderCell(cell));
    }
  }

  boardEl.replaceChildren(fragment);
}

function renderCell(cell) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "cell";
  button.dataset.row = String(cell.row);
  button.dataset.col = String(cell.col);
  button.setAttribute("role", "gridcell");
  button.setAttribute("aria-rowindex", String(cell.row + 1));
  button.setAttribute("aria-colindex", String(cell.col + 1));
  button.tabIndex = cell.row === focused.row && cell.col === focused.col ? 0 : -1;

  if (cell.isOpen) button.classList.add("is-open");
  if (cell.isFlagged && !cell.isOpen) button.classList.add("is-flagged");
  if (cell.isWrongFlag) button.classList.add("is-wrong-flag");
  if (cell.isHinted) button.classList.add("is-hinted");

  if (cell.isOpen && cell.hasBomb) {
    button.classList.add("is-bomb");
    button.innerHTML = `
      <svg class="bomb-icon" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
        <path class="bomb-spark" d="M45 7l3 8 8-3-5 7 7 5-9 1 1 9-6-7-7 5 3-8-8-3 9-2z"/>
        <path class="bomb-fuse" d="M40 18c6-7 12-7 18-1" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round"/>
        <circle class="bomb-body" cx="29" cy="37" r="20"/>
        <circle class="bomb-shine" cx="21" cy="29" r="5"/>
      </svg>
    `;
  } else if (cell.isOpen && cell.hasJian) {
    button.classList.add("is-jian");
    if (faceAvailability.get(currentFaceSrc) !== false) {
      const img = document.createElement("img");
      img.src = currentFaceSrc;
      img.alt = "";
      img.decoding = "async";
      button.appendChild(img);
    } else {
      button.classList.add("is-fallback-jian");
      button.textContent = "";
    }
  } else if (cell.isOpen && (cell.adjacentCount > 0 || cell.adjacentBombCount > 0)) {
    const jianCount = document.createElement("span");
    jianCount.className = `clue-jian n${cell.adjacentCount}`;
    jianCount.textContent = String(cell.adjacentCount);
    jianCount.setAttribute("aria-hidden", "true");
    const bombCount = document.createElement("span");
    bombCount.className = "clue-bomb";
    bombCount.textContent = `💣${cell.adjacentBombCount}`;
    bombCount.setAttribute("aria-hidden", "true");
    button.append(jianCount, bombCount);
  }

  button.setAttribute("aria-label", describeCell(cell));
  return button;
}

function describeCell(cell) {
  if (cell.isWrongFlag) return `${cell.row + 1}행 ${cell.col + 1}열, 잘못된 표시`;
  if (cell.isHinted) return `${cell.row + 1}행 ${cell.col + 1}열, 힌트로 공개된 안전 칸`;
  if (cell.isFlagged && !cell.isOpen) return `${cell.row + 1}행 ${cell.col + 1}열, 표시됨`;
  if (!cell.isOpen) return `${cell.row + 1}행 ${cell.col + 1}열, 닫힘`;
  if (cell.hasBomb) return `${cell.row + 1}행 ${cell.col + 1}열, 폭탄 칸`;
  if (cell.hasJian) return `${cell.row + 1}행 ${cell.col + 1}열, 지안 칸`;
  if (cell.adjacentCount === 0 && cell.adjacentBombCount === 0) {
    return `${cell.row + 1}행 ${cell.col + 1}열, 빈 안전 칸`;
  }
  return `${cell.row + 1}행 ${cell.col + 1}열, 주변 지안 ${cell.adjacentCount}개, 폭탄 ${cell.adjacentBombCount}개`;
}

function setInputMode(nextMode) {
  inputMode = nextMode;
  openModeEl.classList.toggle("is-active", inputMode === "open");
  flagModeEl.classList.toggle("is-active", inputMode === "flag");
  openModeEl.setAttribute("aria-pressed", String(inputMode === "open"));
  flagModeEl.setAttribute("aria-pressed", String(inputMode === "flag"));
}

function setMessage(message) {
  messageEl.textContent = message;
}

function readBestTimes() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function bestTimeKey(difficultyKey, level) {
  return `${difficultyKey}:${level}`;
}

function saveBestTime(difficultyKey, level, seconds) {
  const bestTimes = readBestTimes();
  const key = bestTimeKey(difficultyKey, level);
  if (typeof bestTimes[key] === "number" && bestTimes[key] <= seconds) {
    return false;
  }
  bestTimes[key] = seconds;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(bestTimes));
  return true;
}

function formatBestTime(difficultyKey, level) {
  const bestTimes = readBestTimes();
  const best = bestTimes[bestTimeKey(difficultyKey, level)] ?? bestTimes[difficultyKey];
  return typeof best === "number" ? `${best}초` : "-";
}

function readCurrentLevel(difficultyKey) {
  const levels = readStoredLevels();
  const stored = Number(levels[difficultyKey]);
  if (Number.isSafeInteger(stored) && stored > 0) return clampLevel(difficultyKey, stored);

  if (difficultyKey === "beginner") {
    const legacy = Number(localStorage.getItem(LEGACY_LEVEL_KEY));
    if (Number.isSafeInteger(legacy) && legacy > 0) return clampLevel(difficultyKey, legacy);
  }

  return 1;
}

function readStoredLevels() {
  try {
    return JSON.parse(localStorage.getItem(LEVELS_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function saveCurrentLevel(difficultyKey, level) {
  const levels = readStoredLevels();
  levels[difficultyKey] = clampLevel(difficultyKey, level);
  localStorage.setItem(LEVELS_KEY, JSON.stringify(levels));
}

function getFaceForLevel(level) {
  return FACE_SRCS[(level - 1) % FACE_SRCS.length];
}

function preloadFace(src) {
  if (faceAvailability.has(src)) return;
  const probe = new Image();
  probe.onload = () => {
    faceAvailability.set(src, true);
    render();
  };
  probe.onerror = () => {
    faceAvailability.set(src, false);
    render();
  };
  probe.src = src;
}

boardEl.addEventListener("click", (event) => {
  const target = event.target.closest(".cell");
  if (!target) return;
  const row = Number(target.dataset.row);
  const col = Number(target.dataset.col);
  focused = { row, col };
  if (inputMode === "flag") handleFlag(row, col);
  else handleOpen(row, col);
});

boardEl.addEventListener("contextmenu", (event) => {
  const target = event.target.closest(".cell");
  if (!target) return;
  event.preventDefault();
  const row = Number(target.dataset.row);
  const col = Number(target.dataset.col);
  focused = { row, col };
  handleFlag(row, col);
});

boardEl.addEventListener("keydown", (event) => {
  const { rows, cols } = game.config;
  let handled = true;
  if (event.key === "ArrowUp") focused.row = Math.max(0, focused.row - 1);
  else if (event.key === "ArrowDown") focused.row = Math.min(rows - 1, focused.row + 1);
  else if (event.key === "ArrowLeft") focused.col = Math.max(0, focused.col - 1);
  else if (event.key === "ArrowRight") focused.col = Math.min(cols - 1, focused.col + 1);
  else if (event.key === "Enter" || event.key === " ") handleOpen(focused.row, focused.col);
  else if (event.key.toLowerCase() === "f") handleFlag(focused.row, focused.col);
  else handled = false;

  if (!handled) return;
  event.preventDefault();
  render();
  boardEl
    .querySelector(`[data-row="${focused.row}"][data-col="${focused.col}"]`)
    ?.focus({ preventScroll: true });
});

difficultyButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const nextDifficulty = button.dataset.difficulty;
    currentLevel = readCurrentLevel(nextDifficulty);
    startNewGame(nextDifficulty, { advanceLevel: false });
  });
});

newGameEl.addEventListener("click", () => {
  startNewGame(currentDifficulty, {
    advanceLevel: game.status === "won" && currentLevel < getMaxLevel(game.difficultyKey),
  });
});

openModeEl.addEventListener("click", () => setInputMode("open"));
flagModeEl.addEventListener("click", () => setInputMode("flag"));
hintButtonEl.addEventListener("click", handleHint);

const isIosDevice =
  /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isStandalone =
  window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;

if (isIosDevice && !isStandalone) {
  installAppEl.classList.remove("hidden");
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  if (!isStandalone) installAppEl.classList.remove("hidden");
});

installAppEl.addEventListener("click", async () => {
  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    installAppEl.classList.add("hidden");
    return;
  }

  if (installDialogEl?.showModal) {
    installDialogEl.showModal();
    return;
  }

  setMessage("브라우저 메뉴에서 앱 설치 또는 홈 화면에 추가를 선택해 주세요.");
});

window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  installAppEl.classList.add("hidden");
  setMessage("Jian Finder가 앱으로 설치되었습니다.");
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {
      // 개발 중 파일 프로토콜 또는 제한된 브라우저에서는 등록이 실패할 수 있다.
    });
  });
}

function updateDifficultyOptions() {
  for (const button of difficultyButtons) {
    const key = button.dataset.difficulty;
    const config = DIFFICULTIES[key];
    const optionLevel = key === game.difficultyKey ? currentLevel : readCurrentLevel(key);
    const effectiveConfig = getDifficultyConfig(key, optionLevel);
    const isActive = key === game.difficultyKey;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
    button.textContent = `${config.label} ${optionLevel}/${getMaxLevel(key)} · ${effectiveConfig.jianCount}명`;
  }
}
updateDifficultyOptions();
render();
