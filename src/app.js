import {
  clampLevel,
  createGame,
  expireGame,
  getFoundJianMarks,
  getMaxLevel,
  hazardNeighbors,
  openCell,
  toggleFlag,
  toggleHazardMark,
  useHint,
} from "./game.js?v=24";

const STORAGE_KEY = "jian-rescue-best-times-v3";
const LEVEL_KEY = "jian-rescue-current-level-v3";
const UNLOCKED_LEVEL_KEY = "jian-rescue-unlocked-level-v4";
const HAZARD_PRACTICE_KEY = "jian-rescue-hazard-practice-v1";
const IDLE_HINT_DELAY_MS = 18_000;
const FACE_SRCS = Array.from({ length: 10 }, (_, index) =>
  `assets/faces/face-${String(index + 1).padStart(2, "0")}.png`,
);

const boardEl = document.querySelector("#board");
const newGameEl = document.querySelector("#new-game");
const installAppEl = document.querySelector("#install-app");
const installDialogEl = document.querySelector("#install-dialog");
const levelEl = document.querySelector("#level");
const jianProgressEl = document.querySelector("#jian-progress");
const hazardProgressEl = document.querySelector("#hazard-progress");
const timerEl = document.querySelector("#timer");
const bestTimeEl = document.querySelector("#best-time");
const messageEl = document.querySelector("#message");
const missionEl = document.querySelector("#mission");
const quickHintEl = document.querySelector("#quick-hint");
const quickHintCountEl = document.querySelector("#quick-hint-count");
const levelRouteEl = document.querySelector("#level-route");

let currentLevel = readCurrentLevel();
let highestUnlocked = readHighestUnlocked(currentLevel);
let game = createGame(currentLevel);
let focused = { row: 0, col: 0 };
let timerId = null;
let currentFaceSrc = getFaceForLevel(currentLevel);
let deferredInstallPrompt = null;
let longPressTimer = null;
let longPressHandled = false;
let levelAdvanceTimer = null;
let boardMode = "open";
let idleHintTimer = null;
let hintSuggested = false;

function startNewGame(options = { advanceLevel: false }) {
  if (levelAdvanceTimer) window.clearTimeout(levelAdvanceTimer);
  levelAdvanceTimer = null;
  stopTimer();
  clearIdleHint();
  const maxLevel = getMaxLevel();
  if (options.advanceLevel && currentLevel < maxLevel) currentLevel += 1;
  currentLevel = clampLevel(currentLevel);
  highestUnlocked = Math.max(highestUnlocked, currentLevel);
  saveCurrentLevel(currentLevel);
  saveHighestUnlocked(highestUnlocked);
  currentFaceSrc = getFaceForLevel(currentLevel);
  game = createGame(currentLevel);
  boardMode = "open";
  updateBoardModeControls();
  focused = { row: 0, col: 0 };
  newGameEl.textContent = "새 구조 작전";
  setMessage(getHazardStory(game.config.hazard));
  render();
  if (isNewHazardLevel()) window.setTimeout(() => showHazardPractice(), 150);
}

function startTimerIfNeeded() {
  if (timerId || game.status !== "playing") return;
  game.startedAt = Date.now();
  timerId = window.setInterval(() => {
    if (game.status !== "playing") return stopTimer();
    updateClock();
  }, 250);
  scheduleIdleHint();
}

function updateClock() {
  const playedSeconds = Math.floor((Date.now() - game.startedAt) / 1000);
  game.elapsedSeconds = playedSeconds + game.hintPenaltySeconds;
  game.remainingSeconds = Math.max(game.config.timeLimitSeconds - game.elapsedSeconds, 0);
  timerEl.textContent = formatDuration(game.remainingSeconds);
  timerEl.closest(".stat")?.classList.toggle("is-urgent", game.remainingSeconds <= 15);
  showTimeWarningIfNeeded();
  if (game.remainingSeconds === 0) {
    expireGame(game);
    handleTerminalState();
    render();
  }
}

function showTimeWarningIfNeeded() {
  const threshold = [10, 30, 60].find((seconds) => game.remainingSeconds <= seconds && !game.timeWarnings.has(seconds));
  if (!threshold || game.remainingSeconds === 0) return;
  game.timeWarnings.add(threshold);
  const urgency = threshold === 10 ? "critical" : threshold === 30 ? "warning" : "notice";
  const copy = threshold === 10 ? "10초 남았어요!" : threshold === 30 ? "30초 남았어요!" : "1분 남았어요!";
  const stat = timerEl.closest(".stat");
  stat?.classList.remove("time-warning-notice", "time-warning-warning", "time-warning-critical");
  stat?.classList.add(`time-warning-${urgency}`);
  window.setTimeout(() => stat?.classList.remove(`time-warning-${urgency}`), 1400);
  document.querySelector(".time-warning-pop")?.remove();
  const warning = document.createElement("div");
  warning.className = `time-warning-pop is-${urgency}`;
  warning.setAttribute("role", "status");
  warning.innerHTML = `<span aria-hidden="true">⏱️</span><b>${copy}</b><small>${threshold === 10 ? "서둘러 구조하세요!" : "남은 작전을 확인하세요."}</small>`;
  document.body.appendChild(warning);
  window.setTimeout(() => warning.remove(), threshold === 10 ? 1600 : 1300);
}

function stopTimer() {
  if (timerId) window.clearInterval(timerId);
  timerId = null;
}

function handleOpen(row, col) {
  clearLogicalHint();
  notePlayerAction();
  const wasReady = game.status === "ready";
  const foundBefore = getFoundJianMarks(game);
  openCell(game, row, col);
  const foundAfter = getFoundJianMarks(game);
  if (foundAfter > foundBefore) showJianRescuedEffect(foundAfter, game.config.jianCount);
  if (wasReady && game.status === "playing") {
    startTimerIfNeeded();
    setMessage(game.config.tutorial ? "튜토리얼 2/3 · 빛나는 지안 칸을 열어 구조하세요." : `찍지 않아도 풀 수 있는 판이에요. ${getHazardStory(game.config.hazard)}`);
  } else if (wasReady && game.lastActionReason === "tutorial-start") {
    setMessage("튜토리얼 1/3 · 먼저 빛나는 2행 2열 칸을 열어 단서를 확인하세요.");
    game.lastActionReason = null;
  } else if (game.config.tutorial && foundAfter > foundBefore && game.status === "playing") {
    setMessage(`튜토리얼 3/3 · 지안을 구했어요. 위험 표시 모드로 바꿔 빛나는 ${game.config.hazard.label} 칸을 표시하세요.`);
  }
  handleTerminalState();
  render();
}

function handleMark(row, col, mode) {
  clearLogicalHint();
  notePlayerAction();
  const wasReady = game.status === "ready";
  const before = mode === "jian" ? game.flags : game.hazardMarks;
  if (mode === "jian") toggleFlag(game, row, col);
  else toggleHazardMark(game, row, col);
  const after = mode === "jian" ? game.flags : game.hazardMarks;
  if (wasReady) setMessage("첫 행동은 열기예요. 첫 안전 칸을 열고 단서를 확인하세요.");
  else if (game.status === "playing" && after > before) {
    setMessage(game.config.tutorial ? (mode === "jian" ? "튜토리얼 2/3 · 지안 위치를 찾았어요!" : `튜토리얼 3/3 · ${game.config.hazard.label}로 의심되는 칸을 표시했어요. 표시는 언제든 다시 눌러 지울 수 있어요.`) : (mode === "jian" ? "지안 위치를 표시했어요. 계속 구조하세요!" : `${game.config.hazard.emoji} 위험 후보를 표시했어요. 단서가 맞지 않으면 다시 눌러 지우세요.`));
  } else if (game.status === "playing" && after < before) {
    setMessage("표시를 지웠어요. 단서를 다시 확인해 보세요.");
  } else if (game.status === "playing" && mode === "hazard" && before >= game.config.hazardCount) {
    setMessage(`위험 표시는 ${game.config.hazardCount}곳까지 할 수 있어요. 기존 표시를 다시 눌러 지운 뒤 바꿔 보세요.`);
  }
  handleTerminalState();
  render();
}

function handleHint() {
  notePlayerAction();
  if (!game.firstClickDone) return setMessage("첫 칸을 열면 논리 힌트를 사용할 수 있어요.");
  const hint = useHint(game);
  if (!hint) return setMessage("현재 열린 단서에서 제안할 논리 힌트가 없어요. 표시를 다시 확인하거나 칸을 더 열어 보세요.");
  if (hint.consumed) updateClock();
  if (hint.stage === 1) setMessage(`논리 힌트 1/3 · ${hint.sourcePosition}의 단서를 먼저 살펴보세요. 힌트 ${game.hintsUsed}/3회를 사용했고 시간 ${hint.penalty}초가 줄었어요.`);
  else if (hint.stage === 2) setMessage(`논리 힌트 2/3 · ${hint.sourcePosition}의 숫자와 ${hint.targetPosition}을 포함한 남은 후보 칸 수를 비교해 보세요.`);
  else setMessage(`논리 힌트 3/3 · ${hint.explanation} 이제 직접 실행해 보세요: ${hint.action}`);
  scheduleIdleHint();
  render();
}

function handleTerminalState() {
  if (game.status === "won" && !game.completionHandled) {
    game.completionHandled = true;
    stopTimer();
    const recordSeconds = game.elapsedSeconds;
    const isBest = saveBestTime(currentLevel, recordSeconds);
    const maxLevel = getMaxLevel();
    const isFinalLevel = currentLevel >= maxLevel;
    const wasFrontier = currentLevel === highestUnlocked;
    if (wasFrontier && !isFinalLevel) {
      highestUnlocked = Math.min(maxLevel, currentLevel + 1);
      saveHighestUnlocked(highestUnlocked);
    }
    game.canAdvanceOnWin = wasFrontier && !isFinalLevel;
    newGameEl.textContent = isFinalLevel ? "마지막 작전 재도전" : game.canAdvanceOnWin ? "다음 구조 작전" : "이 레벨 다시 도전";
    showSuccessEffect(isFinalLevel);
    clearIdleHint();
    setMessage(`구조 성공! ${formatDuration(recordSeconds)} 만에 지안 ${game.config.jianCount}명을 구하고 위험 ${game.config.hazardCount}곳을 모두 표시했어요.${isBest ? " 이 레벨의 새로운 최단 기록이에요!" : ""}${isFinalLevel ? " 마지막 구조 작전 완료!" : game.canAdvanceOnWin ? " 다음 작전으로 곧 출발해요." : " 아래의 완료 레벨에서 다른 작전도 다시 도전할 수 있어요."}`);
    if (game.canAdvanceOnWin) {
      levelAdvanceTimer = window.setTimeout(() => {
        startNewGame({ advanceLevel: true });
      }, 1800);
    }
  }
  if (game.status === "lost") {
    stopTimer();
    clearIdleHint();
    newGameEl.textContent = "같은 작전 재도전";
    setMessage(game.lossReason === "timeout" ? `시간 종료 · 제한 시간 ${formatDuration(game.config.timeLimitSeconds)} 안에 구조하지 못했어요. 같은 레벨에서 다시 시도해 보세요.` : `작전 실패. ${game.config.hazard.label}을 열었어요. 공개된 위치와 주변 단서를 확인하고 다시 시도해 보세요.`);
  }
}

function showSuccessEffect(isFinalLevel) {
  document.querySelector(".success-burst")?.remove();
  const effect = document.createElement("div");
  effect.className = "success-burst";
  effect.setAttribute("role", "status");
  effect.innerHTML = `<div class="success-burst-card"><span class="success-crown">${isFinalLevel ? "👑" : "🎉"}</span><strong>${isFinalLevel ? "모든 구조 작전 완료!" : "지안 구조 성공!"}</strong><small>${isFinalLevel ? "오늘의 구조대, 최고예요." : "다음 레벨로 출발해요"}</small></div><i></i><i></i><i></i><i></i><i></i><i></i>`;
  document.body.appendChild(effect);
  window.setTimeout(() => effect.remove(), 1700);
}

function showJianRescuedEffect(found, total) {
  document.querySelector(".jian-rescue-pop")?.remove();
  const pop = document.createElement("div");
  pop.className = "jian-rescue-pop";
  pop.setAttribute("role", "status");
  pop.innerHTML = `<img src="${currentFaceSrc}" alt="" /><span><b>${found === total ? "지안을 모두 구했어요!" : "지안을 구했어요!"}</b><small>구조 ${found}/${total}</small></span><i aria-hidden="true">✨</i>`;
  document.body.appendChild(pop);
  window.setTimeout(() => pop.remove(), 1500);
}

function render() {
  boardEl.style.setProperty("--columns", String(game.config.cols));
  boardEl.dataset.boardSize = String(game.config.cols);
  boardEl.style.setProperty("--cell", game.config.cols >= 14 ? "34px" : game.config.cols >= 10 ? "clamp(32px, 7vw, 40px)" : "clamp(34px, 8.5vw, 46px)");
  levelEl.textContent = `${currentLevel}/${getMaxLevel()}`;
  jianProgressEl.textContent = `${getFoundJianMarks(game)}/${game.config.jianCount}`;
  hazardProgressEl.textContent = `${game.hazardMarks}/${game.config.hazardCount}`;
  setProgressColor(levelEl, currentLevel, getMaxLevel());
  setProgressColor(jianProgressEl, getFoundJianMarks(game), game.config.jianCount);
  setProgressColor(hazardProgressEl, game.hazardMarks, game.config.hazardCount);
  timerEl.textContent = formatDuration(game.remainingSeconds);
  timerEl.closest(".stat")?.classList.toggle("is-urgent", game.status === "playing" && game.remainingSeconds <= 15);
  bestTimeEl.textContent = formatBestTime(currentLevel);
  renderLevelRoute();
  renderMission();

  const fragment = document.createDocumentFragment();
  for (const row of game.board) for (const cell of row) fragment.appendChild(renderCell(cell));
  boardEl.replaceChildren(fragment);
}

function renderMission() {
  const { hazard, jianCount, hazardCount } = game.config;
  const hintsRemaining = Math.max(game.config.hintCount - game.hintsUsed, 0);
  const activeHintStep = game.activeHint?.stage ?? 0;
  const canContinueHint = activeHintStep > 0 && activeHintStep < 3;
  const hintDisabled = game.status !== "playing" || (!canContinueHint && hintsRemaining === 0);
  const hintAriaAction = activeHintStep >= 3
    ? "새 힌트 시작"
    : activeHintStep
      ? `${activeHintStep + 1}단계 보기`
      : "시작";
  quickHintEl.disabled = hintDisabled;
  quickHintEl.classList.toggle("is-suggested", hintSuggested);
  quickHintEl.setAttribute("aria-label", hintDisabled ? "논리 힌트 사용 불가" : `논리 힌트 ${hintAriaAction}, ${hintsRemaining}회 남음`);
  quickHintCountEl.textContent = activeHintStep ? `${activeHintStep}/3` : game.firstClickDone ? String(hintsRemaining) : "–";
  const tutorial = game.config.tutorial ? `<ol class="tutorial-steps"><li><b>1</b> 지정 칸 열기</li><li><b>2</b> 지안 구조</li><li><b>3</b> 위험 표시</li></ol>` : "";
  const nextHintPenalty = [5, 10, 20][game.hintsUsed] ?? 20;
  const hintGuide = activeHintStep === 3
    ? "결론을 확인했어요. 게임판에서 직접 실행해 보세요"
    : activeHintStep
      ? "한 번 더 누르면 다음 설명을 보여줘요"
      : `단서 → 후보 → 결론 · ${hintsRemaining}회 남음 · 다음 사용 시간 −${nextHintPenalty}초`;
  missionEl.innerHTML = `<div class="mission-kicker">${game.config.tutorial ? "TUTORIAL · 고정 연습판" : `PURE LOGIC · LEVEL ${currentLevel}`}</div><div class="mission-target"><img src="${currentFaceSrc}" alt="구해야 할 지안의 얼굴" width="52" height="52" /><div><span>구해야 할 지안</span><strong>지안 <b>${jianCount}</b>명</strong></div></div><div class="mission-arrow" aria-hidden="true">＋</div><div class="mission-danger"><span class="danger-emoji" aria-hidden="true">${hazard.emoji}</span><div><span>표시해야 할 위험</span><strong>${hazard.label} <b>${hazardCount}</b>곳</strong><small>${hazard.rule} 단서</small></div></div><button id="use-helper" class="helper-item${hintSuggested ? " is-suggested" : ""}" type="button" ${hintDisabled ? "disabled" : ""} aria-label="논리 힌트 사용"><img src="assets/momo-safety-lantern.png" alt="" width="36" height="36" /><span><b>논리 힌트${activeHintStep ? ` ${activeHintStep}/3` : ""}</b><small>${game.firstClickDone ? hintGuide : "첫 칸을 열면 사용할 수 있어요"}</small></span></button><details class="hazard-guide" ${hazard.key === "wind" ? "open" : ""}><summary>${hazard.emoji} ${hazard.label} 단서 읽는 법</summary><p><b>범위:</b> ${hazard.description}</p><p><b>예시:</b> ${hazard.example}</p><button id="show-hazard-practice" type="button">${isNewHazardLevel() ? "새 위험 연습판 시작" : "이 위험 연습판 보기"}</button></details><p>${getHazardStory(hazard)} 위험 숫자는 <b>${hazard.rule}</b>에서 세요.</p>${tutorial}`;
}

function isNewHazardLevel() {
  return !game.config.tutorial && currentLevel === game.config.hazard.fromLevel;
}

function showHazardPractice(force = false) {
  const hazard = game.config.hazard;
  const seen = readHazardPractice();
  if (!force && seen[hazard.key]) return;
  seen[hazard.key] = true;
  localStorage.setItem(HAZARD_PRACTICE_KEY, JSON.stringify(seen));
  document.querySelector(".hazard-practice")?.remove();
  const range = new Set(hazardNeighbors(5, 5, 2, 2, hazard.key).map(([row, col]) => `${row}:${col}`));
  const tiles = Array.from({ length: 25 }, (_, index) => {
    const row = Math.floor(index / 5); const col = index % 5;
    const isCenter = row === 2 && col === 2;
    return `<span class="practice-tile${range.has(`${row}:${col}`) ? " is-range" : ""}${isCenter ? " is-clue" : ""}">${isCenter ? `${hazard.emoji}<b>2</b>` : range.has(`${row}:${col}`) ? "·" : ""}</span>`;
  }).join("");
  const dialog = document.createElement("dialog");
  dialog.className = "hazard-practice";
  dialog.innerHTML = `<form method="dialog"><p class="practice-kicker">새 위험 연습판</p><h2>${hazard.emoji} ${hazard.label} 단서</h2><p class="practice-copy">가운데의 <b>${hazard.emoji} 2</b>는 보라색으로 표시된 칸 안에 위험이 2곳 있다는 뜻이에요.</p><div class="practice-grid" aria-label="${hazard.rule} 범위 예시">${tiles}</div><p class="practice-rule"><b>범위:</b> ${hazard.description}</p><p class="practice-example">${hazard.example}</p><button class="primary-action" type="submit">이해했어요. 본 게임 시작</button></form>`;
  document.body.appendChild(dialog);
  dialog.addEventListener("close", () => dialog.remove());
  dialog.showModal();
}

function readHazardPractice() { try { return JSON.parse(localStorage.getItem(HAZARD_PRACTICE_KEY) ?? "{}"); } catch { return {}; } }

function renderLevelRoute() {
  if (!levelRouteEl) return;
  const replayLast = Math.max(0, highestUnlocked - 1);
  if (!replayLast) { levelRouteEl.hidden = true; return; }
  levelRouteEl.hidden = false;
  const buttons = Array.from({ length: replayLast }, (_, index) => {
    const level = index + 1;
    const selected = level === currentLevel;
    return `<button type="button" class="level-route-button${selected ? " is-current" : ""}" data-level="${level}" aria-pressed="${selected}">Lv.${level}${formatBestTime(level) === "기록 없음" ? "" : " ✓"}</button>`;
  }).join("");
  const returnToLatest = currentLevel < highestUnlocked
    ? `<button type="button" class="level-return-button" data-level="${highestUnlocked}"><span>↪</span> 최신 진행 레벨 ${highestUnlocked}로 돌아가기</button>`
    : "";
  const content = levelRouteEl.querySelector(".level-route-content");
  if (content) content.innerHTML = `${returnToLatest}<small>완료한 레벨을 골라 최단 기록에 다시 도전할 수 있어요.</small><div class="level-route-list">${buttons}</div>`;
}

function getHazardStory(hazard) {
  const stories = {
    puddle: "비가 내려 길 곳곳에 웅덩이가 생겼어요. 지안이 젖지 않게 찾아요.",
    wind: "바람이 세게 불어요. 바람길을 피해 지안을 찾아요.",
    poop: "산책길에 조심해야 할 곳이 생겼어요. 발밑을 살피며 찾아요.",
    spider: "거미줄이 길을 막고 있어요. 얽히지 않게 지안에게 가요.",
    snake: "풀숲에서 뱀이 움직이고 있어요. 조심해서 지안에게 다가가요.",
  };
  return stories[hazard.key] ?? `${hazard.label}을 피해 지안을 찾아요.`;
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
  if (cell.isHazardMarked && !cell.isOpen) {
    button.classList.add("is-hazard-marked");
    button.innerHTML = `<span class="hazard-mark-icon" aria-hidden="true">${game.config.hazard.emoji}</span>`;
  }
  if (cell.isWrongFlag) button.classList.add("is-wrong-flag");
  if (cell.isHinted) button.classList.add("is-hinted");
  if (cell.isHintSource) button.classList.add("is-hint-source");
  if (cell.isHintTarget) button.classList.add("is-hint-target");
  const tutorialTarget = getTutorialTarget();
  if (tutorialTarget && cell.row === tutorialTarget.row && cell.col === tutorialTarget.col) button.classList.add("is-tutorial-target");

  if (cell.isOpen && cell.hasBomb) {
    button.classList.add("is-hazard");
    button.innerHTML = `<span aria-hidden="true">${game.config.hazard.emoji}</span>`;
  } else if (cell.isOpen && cell.hasJian) {
    button.classList.add("is-jian");
    const img = document.createElement("img");
    img.src = currentFaceSrc;
    img.alt = "";
    button.appendChild(img);
  } else if (cell.isOpen && (cell.adjacentCount || cell.adjacentBombCount)) {
    button.innerHTML = `<span class="clue-jian n${cell.adjacentCount}">${cell.adjacentCount}</span><span class="clue-hazard">${game.config.hazard.emoji}${cell.adjacentBombCount}</span>`;
  }
  button.setAttribute("aria-label", describeCell(cell));
  return button;
}

function describeCell(cell) {
  const position = `${cell.row + 1}행 ${cell.col + 1}열`;
  if (cell.isWrongFlag) return `${position}, 잘못된 표시`;
  if (cell.isFlagged && !cell.isOpen) return `${position}, 지안 표시됨`;
  if (cell.isHazardMarked && !cell.isOpen) return `${position}, ${game.config.hazard.label} 후보로 표시됨`;
  if (!cell.isOpen) return `${position}, 닫힘`;
  if (cell.hasBomb) return `${position}, 실제 ${game.config.hazard.label}`;
  if (cell.hasJian) return `${position}, 지안`;
  return `${position}, 주변 지안 ${cell.adjacentCount}명, 주변 ${game.config.hazard.label} ${cell.adjacentBombCount}곳`;
}

function setMessage(message) { messageEl.textContent = message; }
function getTutorialTarget() {
  if (!game.config.tutorial || game.status === "won") return null;
  if (!game.firstClickDone) return { row: 1, col: 1 };
  if (getFoundJianMarks(game) < game.config.jianCount) return { row: 0, col: 3 };
  return { row: 3, col: 3 };
}
function clearLogicalHint() {
  game.activeHint = null;
  for (const cell of game.board.flat()) {
    cell.isHintSource = false;
    cell.isHintTarget = false;
  }
}
function setProgressColor(element, value, total) {
  const ratio = total > 0 ? Math.min(Math.max(value / total, 0), 1) : 0;
  const hue = Math.round(164 - ratio * 154);
  element.style.setProperty("--progress-color", `hsl(${hue} 58% 36%)`);
}
function formatDuration(seconds) {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  return `${minutes}:${String(safeSeconds % 60).padStart(2, "0")}`;
}
function clearIdleHint() {
  if (idleHintTimer) window.clearTimeout(idleHintTimer);
  idleHintTimer = null;
  hintSuggested = false;
}
function scheduleIdleHint() {
  clearIdleHint();
  const hintsRemaining = game.config.hintCount - game.hintsUsed;
  if (game.status !== "playing" || hintsRemaining <= 0) return;
  idleHintTimer = window.setTimeout(() => {
    if (game.status !== "playing") return;
    hintSuggested = true;
    const nextPenalty = [5, 10, 20][game.hintsUsed] ?? 20;
    setMessage(`막혔나요? 논리 힌트가 단서 → 후보 → 결론 순서로 도와줘요. ${hintsRemaining}회 남았고, 다음 사용 시 시간이 ${nextPenalty}초 줄어요.`);
    renderMission();
  }, IDLE_HINT_DELAY_MS);
}
function notePlayerAction() {
  if (game.status === "playing") scheduleIdleHint();
}
function readBestTimes() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}"); } catch { return {}; } }
function bestTimeKey(level) { return `level:${level}`; }
function saveBestTime(level, seconds) { const all = readBestTimes(); const key = bestTimeKey(level); if (typeof all[key] === "number" && all[key] <= seconds) return false; all[key] = seconds; localStorage.setItem(STORAGE_KEY, JSON.stringify(all)); return true; }
function formatBestTime(level) { const best = readBestTimes()[bestTimeKey(level)]; return typeof best === "number" ? formatDuration(best) : "기록 없음"; }
function readCurrentLevel() { const value = Number(localStorage.getItem(LEVEL_KEY)); return Number.isSafeInteger(value) && value > 0 ? clampLevel(value) : 1; }
function readHighestUnlocked(fallback) { const value = Number(localStorage.getItem(UNLOCKED_LEVEL_KEY)); return Number.isSafeInteger(value) && value > 0 ? clampLevel(value) : fallback; }
function saveCurrentLevel(level) { localStorage.setItem(LEVEL_KEY, String(level)); }
function saveHighestUnlocked(level) { localStorage.setItem(UNLOCKED_LEVEL_KEY, String(level)); }
function getFaceForLevel(level) { return FACE_SRCS[(level - 1) % FACE_SRCS.length]; }

boardEl.addEventListener("click", (event) => {
  const target = event.target.closest(".cell"); if (!target) return;
  if (longPressHandled) { longPressHandled = false; return; }
  const row = Number(target.dataset.row); const col = Number(target.dataset.col); focused = { row, col };
  if (boardMode === "hazard") handleMark(row, col, "hazard");
  else handleOpen(row, col);
});
boardEl.addEventListener("contextmenu", (event) => { const target = event.target.closest(".cell"); if (!target) return; event.preventDefault(); if (longPressHandled) return; focused = { row: Number(target.dataset.row), col: Number(target.dataset.col) }; handleMark(focused.row, focused.col, "hazard"); });
boardEl.addEventListener("pointerdown", (event) => {
  if (event.pointerType !== "touch") return;
  const target = event.target.closest(".cell"); if (!target) return;
  longPressHandled = false;
  const row = Number(target.dataset.row); const col = Number(target.dataset.col);
  longPressTimer = window.setTimeout(() => { longPressHandled = true; focused = { row, col }; handleMark(row, col, "hazard"); }, 520);
});
boardEl.addEventListener("pointerup", () => { if (longPressTimer) window.clearTimeout(longPressTimer); longPressTimer = null; });
boardEl.addEventListener("pointercancel", () => { if (longPressTimer) window.clearTimeout(longPressTimer); longPressTimer = null; });
boardEl.addEventListener("keydown", (event) => {
  const { rows, cols } = game.config; let handled = true;
  if (event.key === "ArrowUp") focused.row = Math.max(0, focused.row - 1); else if (event.key === "ArrowDown") focused.row = Math.min(rows - 1, focused.row + 1); else if (event.key === "ArrowLeft") focused.col = Math.max(0, focused.col - 1); else if (event.key === "ArrowRight") focused.col = Math.min(cols - 1, focused.col + 1); else if (event.key === "Enter" || event.key === " ") handleOpen(focused.row, focused.col); else if (event.key.toLowerCase() === "h") handleMark(focused.row, focused.col, "hazard"); else handled = false;
  if (!handled) return; event.preventDefault(); render(); boardEl.querySelector(`[data-row="${focused.row}"][data-col="${focused.col}"]`)?.focus({ preventScroll: true });
});
newGameEl.addEventListener("click", () => startNewGame({ advanceLevel: game.status === "won" && game.canAdvanceOnWin }));
levelRouteEl?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-level]");
  if (!button) return;
  const returningToLatest = button.classList.contains("level-return-button");
  currentLevel = clampLevel(Number(button.dataset.level));
  startNewGame();
  setMessage(returningToLatest ? `최신 진행 레벨 ${currentLevel}로 돌아왔어요. 구조 작전을 이어가세요.` : `레벨 ${currentLevel} 재도전 · 이 레벨의 최단 기록을 갱신해 보세요.`);
});
missionEl.addEventListener("click", (event) => {
  if (event.target.closest("#use-helper")) handleHint();
  if (event.target.closest("#show-hazard-practice")) showHazardPractice(true);
});
quickHintEl.addEventListener("click", handleHint);
document.querySelector(".board-mode-picker")?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-board-mode]");
  if (!button) return;
  clearLogicalHint();
  boardMode = button.dataset.boardMode;
  updateBoardModeControls();
  setMessage(boardMode === "open" ? "열기 모드 · 안전하다고 판단한 칸을 탭하세요." : `${game.config.hazard.emoji} 표시 모드 · 의심되는 칸을 탭하세요. 다시 탭하면 표시가 지워져요.`);
});

function updateBoardModeControls() {
  document.querySelectorAll("[data-board-mode]").forEach((button) => {
    const active = button.dataset.boardMode === boardMode;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
    if (button.dataset.boardMode === "hazard") button.textContent = `${game.config.hazard.emoji} 표시`;
  });
  boardEl.dataset.mode = boardMode;
}

const isIosDevice = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isStandalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
if (isIosDevice && !isStandalone) installAppEl.classList.remove("hidden");
window.addEventListener("beforeinstallprompt", (event) => { event.preventDefault(); deferredInstallPrompt = event; if (!isStandalone) installAppEl.classList.remove("hidden"); });
installAppEl.addEventListener("click", async () => { if (deferredInstallPrompt) { deferredInstallPrompt.prompt(); await deferredInstallPrompt.userChoice; deferredInstallPrompt = null; installAppEl.classList.add("hidden"); } else if (installDialogEl?.showModal) installDialogEl.showModal(); else setMessage("브라우저 메뉴에서 앱 설치를 선택해 주세요."); });
window.addEventListener("appinstalled", () => { deferredInstallPrompt = null; installAppEl.classList.add("hidden"); setMessage("Jian Rescue가 앱으로 설치되었어요."); });
if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
updateBoardModeControls();
render();
if (isNewHazardLevel()) window.setTimeout(() => showHazardPractice(), 150);
