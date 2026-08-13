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
} from "./game.js?v=25";

const STORAGE_KEY = "jian-rescue-best-times-v3";
const LEVEL_KEY = "jian-rescue-current-level-v3";
const UNLOCKED_LEVEL_KEY = "jian-rescue-unlocked-level-v4";
const HAZARD_PRACTICE_KEY = "jian-rescue-hazard-practice-v1";
const STARS_KEY = "jian-rescue-level-stars-v1";
const SCORES_KEY = "jian-rescue-level-scores-v1";
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
const scoreEl = document.querySelector("#score");
const comboEl = document.querySelector("#combo");
const levelStarsEl = document.querySelector("#level-stars");

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
  if (!game.config.tutorial && getUnseenHazard()) window.setTimeout(() => showHazardPractice(), 150);
}

function startTimerIfNeeded() {
  if (timerId || game.status !== "playing") return;
  game.startedAt = Date.now();
  if (game.config.tutorialNoTimer) return;
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
  const comboBefore = game.combo;
  openCell(game, row, col);
  const foundAfter = getFoundJianMarks(game);
  if (foundAfter > foundBefore) showJianRescuedEffect(foundAfter, game.config.jianCount);
  else if (game.combo > comboBefore && game.combo >= 3) showComboEffect();
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

function handleMark(row, col, hazardKey) {
  clearLogicalHint();
  notePlayerAction();
  const wasReady = game.status === "ready";
  const before = game.hazardMarks;
  const comboBefore = game.combo;
  toggleHazardMark(game, row, col, hazardKey);
  const after = game.hazardMarks;
  if (wasReady) setMessage("첫 행동은 열기예요. 첫 안전 칸을 열고 단서를 확인하세요.");
  else if (game.status === "playing" && after > before) {
    const hazard = game.config.hazards.find((item) => item.key === hazardKey) ?? game.config.hazard;
    setMessage(game.config.tutorial ? `튜토리얼 3/3 · ${hazard.label}로 의심되는 칸을 표시했어요. 표시는 언제든 다시 눌러 지울 수 있어요.` : `${hazard.emoji} ${hazard.label} 후보를 표시했어요. 단서가 맞지 않으면 다시 눌러 지우세요.`);
    if (game.combo > comboBefore && game.combo >= 3) showComboEffect();
  } else if (game.status === "playing" && after < before) {
    setMessage("표시를 지웠어요. 단서를 다시 확인해 보세요.");
  } else if (game.status === "playing" && before === after) {
    const hazard = game.config.hazards.find((item) => item.key === hazardKey) ?? game.config.hazard;
    setMessage(`${hazard.emoji} ${hazard.label} 표시는 ${game.config.hazardCounts[hazard.key]}곳까지예요. 기존 표시를 지우거나 다른 위험을 선택하세요.`);
  }
  handleTerminalState();
  render();
}

function handleHint() {
  notePlayerAction();
  if (!game.firstClickDone) return setMessage("첫 칸을 열면 논리 힌트를 사용할 수 있어요.");
  const hint = useHint(game);
  if (!hint) return setMessage("현재 열린 단서에서 제안할 논리 힌트가 없어요. 표시를 다시 확인하거나 칸을 더 열어 보세요.");
  if (hint.consumed && !game.config.tutorialNoTimer) updateClock();
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
    const isBest = game.config.tutorialNoTimer ? false : saveBestTime(currentLevel, recordSeconds);
    const maxLevel = getMaxLevel();
    const isFinalLevel = currentLevel >= maxLevel;
    const stars = calculateStars(game);
    const isNewStars = saveStars(currentLevel, stars);
    saveBestScore(currentLevel, game.score);
    if (game.config.tutorial) {
      const seen = readHazardPractice();
      seen.puddle = true;
      localStorage.setItem(HAZARD_PRACTICE_KEY, JSON.stringify(seen));
    }
    const wasFrontier = currentLevel === highestUnlocked;
    if (wasFrontier && !isFinalLevel) {
      highestUnlocked = Math.min(maxLevel, currentLevel + 1);
      saveHighestUnlocked(highestUnlocked);
    }
    game.canAdvanceOnWin = wasFrontier && !isFinalLevel;
    newGameEl.textContent = isFinalLevel ? "마지막 작전 재도전" : game.canAdvanceOnWin ? "다음 구조 작전" : "이 레벨 다시 도전";
    showSuccessEffect(isFinalLevel, stars);
    clearIdleHint();
    setMessage(`구조 성공! ${starsToText(stars)} · ${game.score.toLocaleString("ko-KR")}점 · 최고 콤보 ×${game.bestCombo}.${isBest ? " 새로운 최단 기록!" : ""}${isNewStars ? " 별 기록도 갱신했어요!" : ""}${isFinalLevel ? " 마지막 구조 작전 완료!" : game.canAdvanceOnWin ? " 다음 작전으로 곧 출발해요." : " 완료 레벨 메뉴에서 다시 도전할 수 있어요."}`);
    if (game.canAdvanceOnWin) {
      levelAdvanceTimer = window.setTimeout(() => {
        startNewGame({ advanceLevel: true });
      }, 3000);
    }
  }
  if (game.status === "lost") {
    stopTimer();
    clearIdleHint();
    newGameEl.textContent = "같은 작전 재도전";
    const openedHazard = game.config.hazards.find((hazard) => hazard.key === game.lossHazardKey) ?? game.config.hazard;
    setMessage(game.lossReason === "timeout" ? `시간 종료 · 제한 시간 ${formatDuration(game.config.timeLimitSeconds)} 안에 구조하지 못했어요. 같은 레벨에서 다시 시도해 보세요.` : `작전 실패. ${openedHazard.emoji} ${openedHazard.label}을 열었어요. 공개된 위치와 해당 아이콘 단서를 다시 확인해 보세요.`);
  }
}

function showSuccessEffect(isFinalLevel, stars) {
  document.querySelector(".success-burst")?.remove();
  const effect = document.createElement("div");
  effect.className = "success-burst";
  effect.setAttribute("role", "status");
  effect.innerHTML = `<div class="success-burst-card"><span class="success-crown">${isFinalLevel ? "👑" : "🎉"}</span><strong>${isFinalLevel ? "모든 구조 작전 완료!" : "지안 구조 성공!"}</strong><span class="success-stars" aria-label="별 ${stars}개">${starsToText(stars)}</span><small>${game.score.toLocaleString("ko-KR")}점 · 최고 콤보 ×${game.bestCombo}</small></div><i></i><i></i><i></i><i></i><i></i><i></i>`;
  document.body.appendChild(effect);
  window.setTimeout(() => effect.remove(), 2800);
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

function showComboEffect() {
  document.querySelector(".combo-pop")?.remove();
  const pop = document.createElement("div");
  pop.className = "combo-pop";
  pop.setAttribute("role", "status");
  pop.textContent = `⚡ 구조 콤보 ×${game.combo} · ${game.score.toLocaleString("ko-KR")}점`;
  document.body.appendChild(pop);
  window.setTimeout(() => pop.remove(), 850);
}

function render() {
  boardEl.style.setProperty("--columns", String(game.config.cols));
  boardEl.dataset.boardSize = String(game.config.cols);
  boardEl.style.setProperty("--cell", game.config.cols >= 12 ? "36px" : game.config.cols >= 10 ? "clamp(32px, 7vw, 42px)" : game.config.cols >= 9 ? "clamp(34px, 8vw, 50px)" : "clamp(34px, 8.5vw, 54px)");
  levelEl.textContent = `${currentLevel}/${getMaxLevel()}`;
  jianProgressEl.textContent = `${getFoundJianMarks(game)}/${game.config.jianCount}`;
  hazardProgressEl.textContent = `${game.hazardMarks}/${game.config.hazardCount}`;
  setProgressColor(levelEl, currentLevel, getMaxLevel());
  setProgressColor(jianProgressEl, getFoundJianMarks(game), game.config.jianCount);
  setProgressColor(hazardProgressEl, game.hazardMarks, game.config.hazardCount);
  timerEl.textContent = game.config.tutorialNoTimer ? "연습" : formatDuration(game.remainingSeconds);
  timerEl.closest(".stat")?.classList.toggle("is-urgent", !game.config.tutorialNoTimer && game.status === "playing" && game.remainingSeconds <= 15);
  bestTimeEl.textContent = game.config.tutorialNoTimer ? "연습 레벨" : formatBestTime(currentLevel);
  scoreEl.textContent = game.score.toLocaleString("ko-KR");
  comboEl.textContent = `×${game.combo}`;
  comboEl.closest(".combo-meter")?.classList.toggle("is-hot", game.combo >= 3);
  const savedStars = readStars()[bestTimeKey(currentLevel)] ?? 0;
  levelStarsEl.textContent = starsToText(savedStars);
  levelStarsEl.setAttribute("aria-label", `별 ${savedStars}개 획득`);
  updateBoardModeControls();
  renderLevelRoute();
  renderMission();

  const fragment = document.createDocumentFragment();
  for (const row of game.board) for (const cell of row) fragment.appendChild(renderCell(cell));
  boardEl.replaceChildren(fragment);
}

function renderMission() {
  const { hazards, jianCount, hazardCount, hazardCounts } = game.config;
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
  const dangerCards = hazards.map((hazard) => `<div class="mission-danger"><span class="danger-emoji" aria-hidden="true">${hazard.emoji}</span><div><span>표시할 위험</span><strong>${hazard.label} <b>${hazardCounts[hazard.key]}</b>곳</strong><small>${hazard.rule}</small></div></div>`).join("");
  const guides = hazards.map((hazard) => `<details class="hazard-guide"><summary>${hazard.emoji} ${hazard.label} 단서 읽는 법</summary><p><b>범위:</b> ${hazard.description}</p><p><b>예시:</b> ${hazard.example}</p><button type="button" data-practice-hazard="${hazard.key}">직접 연습하기</button></details>`).join("");
  const mixedNotice = hazards.length > 1 ? `<p class="mixed-mission-note">복합 작전 · 위험마다 표시 버튼과 숫자 범위가 달라요.</p>` : "";
  missionEl.innerHTML = `<div class="mission-kicker">${game.config.tutorial ? "TUTORIAL · 시간 제한 없는 연습" : `PURE LOGIC · LEVEL ${currentLevel}`}</div><div class="mission-target"><img src="${currentFaceSrc}" alt="구해야 할 지안의 얼굴" width="52" height="52" /><div><span>구해야 할 지안</span><strong>지안 <b>${jianCount}</b>명</strong></div></div><div class="mission-arrow" aria-hidden="true">＋</div><div class="mission-danger-list">${dangerCards}</div><button id="use-helper" class="helper-item${hintSuggested ? " is-suggested" : ""}" type="button" ${hintDisabled ? "disabled" : ""} aria-label="논리 힌트 사용"><img src="assets/momo-safety-lantern.png" alt="" width="36" height="36" /><span><b>논리 힌트${activeHintStep ? ` ${activeHintStep}/3` : ""}</b><small>${game.firstClickDone ? hintGuide : "첫 칸을 열면 사용할 수 있어요"}</small></span></button>${mixedNotice}<div class="hazard-guides">${guides}</div><p>${hazards.map((hazard) => `${hazard.emoji} ${hazard.rule}`).join(" · ")}</p>${tutorial}`;
}

function getUnseenHazard() {
  const seen = readHazardPractice();
  return game.config.hazards.find((hazard) => !seen[hazard.key]) ?? null;
}

function showHazardPractice(hazardKey = getUnseenHazard()?.key, force = false) {
  const hazard = game.config.hazards.find((item) => item.key === hazardKey);
  if (!hazard) return;
  const seen = readHazardPractice();
  if (!force && seen[hazard.key]) return;
  document.querySelector(".hazard-practice")?.remove();
  const rangeCells = hazardNeighbors(5, 5, 2, 2, hazard.key);
  const range = new Set(rangeCells.map(([row, col]) => `${row}:${col}`));
  const targets = new Set([rangeCells[1] ?? rangeCells[0], rangeCells.at(-2) ?? rangeCells.at(-1)].map(([row, col]) => `${row}:${col}`));
  const tiles = Array.from({ length: 25 }, (_, index) => {
    const row = Math.floor(index / 5); const col = index % 5;
    const isCenter = row === 2 && col === 2;
    const key = `${row}:${col}`;
    if (isCenter) return `<span class="practice-tile is-clue">${hazard.emoji}<b>2</b></span>`;
    return `<button type="button" class="practice-tile${range.has(key) ? " is-range" : ""}" data-practice-cell="${key}" data-target="${targets.has(key)}" ${range.has(key) ? "" : "disabled"} aria-label="연습 칸 ${row + 1}행 ${col + 1}열">${range.has(key) ? "?" : ""}</button>`;
  }).join("");
  const dialog = document.createElement("dialog");
  dialog.className = "hazard-practice";
  dialog.innerHTML = `<form method="dialog"><p class="practice-kicker">직접 해보는 위험 연습</p><h2>${hazard.emoji} ${hazard.label} 단서</h2><p class="practice-copy">가운데 <b>${hazard.emoji} 2</b>의 범위 안에 숨은 ${hazard.label} 2곳을 눌러 보세요.</p><div class="practice-grid" aria-label="${hazard.rule} 범위 미니 퍼즐">${tiles}</div><p class="practice-feedback" aria-live="polite">보라색 범위에서 위험 2곳을 찾아보세요.</p><p class="practice-rule"><b>범위:</b> ${hazard.description}</p><button class="primary-action practice-complete" type="submit" disabled>2곳을 찾으면 시작할 수 있어요</button></form>`;
  document.body.appendChild(dialog);
  let found = 0;
  dialog.querySelector(".practice-grid").addEventListener("click", (event) => {
    const tile = event.target.closest("[data-practice-cell]");
    if (!tile || tile.classList.contains("is-found")) return;
    const feedback = dialog.querySelector(".practice-feedback");
    if (tile.dataset.target === "true") {
      tile.classList.add("is-found"); tile.textContent = hazard.emoji; found += 1;
      feedback.textContent = found === 2 ? `정답이에요! ${hazard.label}의 숫자 범위를 이해했어요.` : `맞아요! 한 곳 더 찾아보세요.`;
      if (found === 2) {
        seen[hazard.key] = true;
        localStorage.setItem(HAZARD_PRACTICE_KEY, JSON.stringify(seen));
        const complete = dialog.querySelector(".practice-complete");
        complete.disabled = false; complete.textContent = "이해했어요. 본 게임 시작";
      }
    } else {
      tile.classList.add("is-miss");
      feedback.textContent = `여기는 아니에요. ${hazard.rule} 범위 안의 다른 칸을 살펴보세요.`;
      window.setTimeout(() => tile.classList.remove("is-miss"), 500);
    }
  });
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
    const stars = readStars()[bestTimeKey(level)] ?? 0;
    return `<button type="button" class="level-route-button${selected ? " is-current" : ""}" data-level="${level}" aria-pressed="${selected}">Lv.${level} ${stars ? starsToText(stars) : ""}</button>`;
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
    const markedHazard = game.config.hazards.find((hazard) => hazard.key === cell.hazardMarkKey) ?? game.config.hazard;
    button.innerHTML = `<span class="hazard-mark-icon" aria-hidden="true">${markedHazard.emoji}</span>`;
  }
  if (cell.isWrongFlag) button.classList.add("is-wrong-flag");
  if (cell.isHinted) button.classList.add("is-hinted");
  if (cell.isHintSource) button.classList.add("is-hint-source");
  if (cell.isHintTarget) button.classList.add("is-hint-target");
  const tutorialTarget = getTutorialTarget();
  if (tutorialTarget && cell.row === tutorialTarget.row && cell.col === tutorialTarget.col) button.classList.add("is-tutorial-target");

  if (cell.isOpen && cell.hasBomb) {
    button.classList.add("is-hazard");
    const actualHazard = game.config.hazards.find((hazard) => hazard.key === cell.hazardKey) ?? game.config.hazard;
    button.innerHTML = `<span aria-hidden="true">${actualHazard.emoji}</span>`;
  } else if (cell.isOpen && cell.hasJian) {
    button.classList.add("is-jian");
    const img = document.createElement("img");
    img.src = currentFaceSrc;
    img.alt = "";
    button.appendChild(img);
  } else if (cell.isOpen && (cell.adjacentCount || cell.adjacentBombCount)) {
    const hazardClues = game.config.hazards.map((hazard) => `<span class="clue-hazard">${hazard.emoji}${cell.adjacentHazardCounts[hazard.key] ?? 0}</span>`).join("");
    button.innerHTML = `<span class="clue-jian n${cell.adjacentCount}">${cell.adjacentCount}</span><span class="clue-hazards">${hazardClues}</span>`;
  }
  button.setAttribute("aria-label", describeCell(cell));
  return button;
}

function describeCell(cell) {
  const position = `${cell.row + 1}행 ${cell.col + 1}열`;
  if (cell.isWrongFlag) return `${position}, 잘못된 표시`;
  if (cell.isFlagged && !cell.isOpen) return `${position}, 지안 표시됨`;
  if (cell.isHazardMarked && !cell.isOpen) return `${position}, ${game.config.hazards.find((hazard) => hazard.key === cell.hazardMarkKey)?.label ?? "위험"} 후보로 표시됨`;
  if (!cell.isOpen) return `${position}, 닫힘`;
  if (cell.hasBomb) return `${position}, 실제 ${game.config.hazards.find((hazard) => hazard.key === cell.hazardKey)?.label ?? "위험"}`;
  if (cell.hasJian) return `${position}, 지안`;
  return `${position}, 주변 지안 ${cell.adjacentCount}명, ${game.config.hazards.map((hazard) => `${hazard.label} ${cell.adjacentHazardCounts[hazard.key] ?? 0}곳`).join(", ")}`;
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
function readStars() { try { return JSON.parse(localStorage.getItem(STARS_KEY) ?? "{}"); } catch { return {}; } }
function saveStars(level, stars) { const all = readStars(); const key = bestTimeKey(level); if ((all[key] ?? 0) >= stars) return false; all[key] = stars; localStorage.setItem(STARS_KEY, JSON.stringify(all)); return true; }
function calculateStars(currentGame) { if (currentGame.status !== "won") return 0; let stars = 1; if (currentGame.config.tutorialNoTimer || currentGame.elapsedSeconds <= currentGame.config.timeLimitSeconds * .75) stars += 1; if (currentGame.hintsUsed === 0) stars += 1; return stars; }
function starsToText(stars) { return `${"★".repeat(stars)}${"☆".repeat(Math.max(0, 3 - stars))}`; }
function readScores() { try { return JSON.parse(localStorage.getItem(SCORES_KEY) ?? "{}"); } catch { return {}; } }
function saveBestScore(level, score) { const all = readScores(); const key = bestTimeKey(level); if ((all[key] ?? 0) >= score) return false; all[key] = score; localStorage.setItem(SCORES_KEY, JSON.stringify(all)); return true; }
function readCurrentLevel() { const value = Number(localStorage.getItem(LEVEL_KEY)); return Number.isSafeInteger(value) && value > 0 ? clampLevel(value) : 1; }
function readHighestUnlocked(fallback) { const value = Number(localStorage.getItem(UNLOCKED_LEVEL_KEY)); return Number.isSafeInteger(value) && value > 0 ? clampLevel(value) : fallback; }
function saveCurrentLevel(level) { localStorage.setItem(LEVEL_KEY, String(level)); }
function saveHighestUnlocked(level) { localStorage.setItem(UNLOCKED_LEVEL_KEY, String(level)); }
function getFaceForLevel(level) { return FACE_SRCS[(level - 1) % FACE_SRCS.length]; }

boardEl.addEventListener("click", (event) => {
  const target = event.target.closest(".cell"); if (!target) return;
  if (longPressHandled) { longPressHandled = false; return; }
  const row = Number(target.dataset.row); const col = Number(target.dataset.col); focused = { row, col };
  if (boardMode !== "open") handleMark(row, col, boardMode);
  else handleOpen(row, col);
});
boardEl.addEventListener("contextmenu", (event) => { const target = event.target.closest(".cell"); if (!target) return; event.preventDefault(); if (longPressHandled) return; focused = { row: Number(target.dataset.row), col: Number(target.dataset.col) }; handleMark(focused.row, focused.col, boardMode === "open" ? game.config.hazard.key : boardMode); });
boardEl.addEventListener("pointerdown", (event) => {
  if (event.pointerType !== "touch") return;
  const target = event.target.closest(".cell"); if (!target) return;
  longPressHandled = false;
  const row = Number(target.dataset.row); const col = Number(target.dataset.col);
  longPressTimer = window.setTimeout(() => { longPressHandled = true; focused = { row, col }; handleMark(row, col, boardMode === "open" ? game.config.hazard.key : boardMode); }, 520);
});
boardEl.addEventListener("pointerup", () => { if (longPressTimer) window.clearTimeout(longPressTimer); longPressTimer = null; });
boardEl.addEventListener("pointercancel", () => { if (longPressTimer) window.clearTimeout(longPressTimer); longPressTimer = null; });
boardEl.addEventListener("keydown", (event) => {
  const { rows, cols } = game.config; let handled = true;
  if (event.key === "ArrowUp") focused.row = Math.max(0, focused.row - 1); else if (event.key === "ArrowDown") focused.row = Math.min(rows - 1, focused.row + 1); else if (event.key === "ArrowLeft") focused.col = Math.max(0, focused.col - 1); else if (event.key === "ArrowRight") focused.col = Math.min(cols - 1, focused.col + 1); else if (event.key === "Enter" || event.key === " ") handleOpen(focused.row, focused.col); else if (event.key.toLowerCase() === "h") handleMark(focused.row, focused.col, boardMode === "open" ? game.config.hazard.key : boardMode); else handled = false;
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
  const practiceButton = event.target.closest("[data-practice-hazard]");
  if (practiceButton) showHazardPractice(practiceButton.dataset.practiceHazard, true);
});
quickHintEl.addEventListener("click", handleHint);
document.querySelector(".board-mode-picker")?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-board-mode]");
  if (!button) return;
  clearLogicalHint();
  boardMode = button.dataset.boardMode;
  updateBoardModeControls();
  const hazard = game.config.hazards.find((item) => item.key === boardMode);
  setMessage(boardMode === "open" ? "열기 모드 · 안전하다고 판단한 칸을 탭하세요." : `${hazard.emoji} ${hazard.label} 표시 모드 · 의심되는 칸을 탭하세요.`);
});

function updateBoardModeControls() {
  const picker = document.querySelector(".board-mode-picker");
  picker.innerHTML = `<button class="mode-button" type="button" data-board-mode="open">열기</button>${game.config.hazards.map((hazard) => `<button class="mode-button" type="button" data-board-mode="${hazard.key}">${hazard.emoji} ${game.hazardMarkCounts[hazard.key] ?? 0}/${game.config.hazardCounts[hazard.key]}</button>`).join("")}`;
  document.querySelectorAll("[data-board-mode]").forEach((button) => {
    const active = button.dataset.boardMode === boardMode;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
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
if (!game.config.tutorial && getUnseenHazard()) window.setTimeout(() => showHazardPractice(), 150);
