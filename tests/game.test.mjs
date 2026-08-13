import assert from "node:assert/strict";
import { test } from "node:test";
import {
  calculateAdjacentCounts,
  createGame,
  getCell,
  getLevelConfig,
  getTimeLimitForLevel,
  getHazardForLevel,
  getHazardsForLevel,
  getMaxLevel,
  getLogicalHint,
  hazardNeighbors,
  isLogicallySolvable,
  expireGame,
  openCell,
  placeJians,
  toggleFlag,
  toggleHazardMark,
  useHint,
} from "../src/game.js";

function seededRandom(seed) {
  let value = seed;
  return () => ((value = (value * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

test("각 레벨은 지안과 위험요소를 정확한 수만큼 배치한다", () => {
  for (const level of [1, 12, 20, 35, 50]) {
    const game = createGame(level);
    placeJians(game, 0, 0, seededRandom(10));
    assert.equal(game.board.flat().filter((cell) => cell.hasJian).length, game.config.jianCount);
    assert.equal(game.board.flat().filter((cell) => cell.hasBomb).length, game.config.hazardCount);
  }
});

test("레벨이 오르면 위험요소가 웅덩이에서 뱀으로 바뀐다", () => {
  assert.equal(getHazardForLevel(1).key, "puddle");
  assert.equal(getHazardForLevel(4).key, "wind");
  assert.equal(getHazardForLevel(7).key, "poop");
  assert.equal(getHazardForLevel(10).key, "spider");
  assert.equal(getHazardForLevel(16).key, "snake");
  assert.equal(getLevelConfig(16).hazard.label, "뱀");
});

test("20레벨 이후에는 쉬운 조합부터 복합 위험이 단계적으로 등장한다", () => {
  assert.deepEqual(getHazardsForLevel(20).map((hazard) => hazard.key), ["puddle", "snake"]);
  assert.deepEqual(getHazardsForLevel(25).map((hazard) => hazard.key), ["puddle", "wind"]);
  assert.deepEqual(getHazardsForLevel(35).map((hazard) => hazard.key), ["puddle", "spider"]);
  assert.deepEqual(getHazardsForLevel(50).map((hazard) => hazard.key), ["wind", "poop", "spider"]);
  assert.equal(getMaxLevel(), 50);
});

test("1레벨은 4×4 보드의 쉬운 튜토리얼이다", () => {
  const game = createGame(1);
  assert.equal(game.config.rows, 4);
  assert.equal(game.config.cols, 4);
  assert.equal(game.config.jianCount, 1);
  assert.equal(game.config.hazardCount, 1);
  assert.equal(game.config.tutorial, true);
  assert.deepEqual(game.config.tutorialStart, [1, 1]);
});

test("튜토리얼은 지정된 첫 칸과 고정된 정답을 사용한다", () => {
  const game = createGame(1);
  openCell(game, 0, 0, seededRandom(1));
  assert.equal(game.firstClickDone, false);
  openCell(game, 1, 1, seededRandom(1));
  assert.equal(game.firstClickDone, true);
  assert.equal(getCell(game, 0, 3).hasJian, true);
  assert.equal(getCell(game, 3, 3).hasBomb, true);
  assert.equal(game.isLogicVerified, true);
});

test("위험 종류마다 숫자가 바라보는 칸이 다르다", () => {
  assert.equal(hazardNeighbors(5, 5, 2, 2, "puddle").length, 8);
  assert.equal(hazardNeighbors(5, 5, 2, 2, "wind").length, 8);
  assert.equal(hazardNeighbors(5, 5, 2, 2, "poop").length, 10);
  assert.equal(hazardNeighbors(5, 5, 2, 2, "spider").length, 8);
  assert.equal(hazardNeighbors(5, 5, 2, 2, "snake").length, 4);
});

test("레벨이 오르면 보드와 구조·위험 목표가 함께 증가한다", () => {
  const early = getLevelConfig(2);
  const late = getLevelConfig(50);
  assert.ok(late.rows > early.rows);
  assert.ok(late.jianCount > early.jianCount);
  assert.ok(late.hazardCount > early.hazardCount);
  assert.ok(late.timeLimitSeconds > early.timeLimitSeconds);
  assert.equal(late.timeLimitSeconds, getTimeLimitForLevel(50));
  assert.equal(late.hintCount, 3);
});

test("제한 시간이 끝나면 판이 실패하고 위치를 공개한다", () => {
  const game = createGame(1);
  game.board[1][1].hasJian = true;
  game.board[2][2].hasBomb = true;
  game.status = "playing";
  expireGame(game);
  assert.equal(game.status, "lost");
  assert.equal(game.lossReason, "timeout");
  assert.equal(game.remainingSeconds, 0);
  assert.equal(game.board[1][1].isOpen, true);
});

test("첫 클릭 칸과 주변은 안전하다", () => {
  for (let i = 0; i < 30; i += 1) {
    const game = createGame(2);
    const center = Math.floor(game.config.rows / 2);
    openCell(game, center, center, seededRandom(i + 1));
    for (let row = center - 1; row <= center + 1; row += 1) for (let col = center - 1; col <= center + 1; col += 1) {
      assert.equal(getCell(game, row, col).hasJian, false);
      assert.equal(getCell(game, row, col).hasBomb, false);
    }
  }
});

test("논리 힌트는 칸을 열지 않고 3단계 설명만 제공한다", () => {
  const game = createGame(1);
  openCell(game, 1, 1, seededRandom(1));
  const openBefore = game.board.flat().filter((cell) => cell.isOpen).length;
  const first = useHint(game);
  const second = useHint(game);
  const third = useHint(game);
  assert.equal(first.stage, 1);
  assert.equal(first.consumed, true);
  assert.equal(second.stage, 2);
  assert.equal(second.consumed, false);
  assert.equal(third.stage, 3);
  assert.equal(game.hintsUsed, 1);
  assert.equal(game.board.flat().filter((cell) => cell.isOpen).length, openBefore);
  assert.ok(getLogicalHint(game));
});

test("논리 힌트는 세 번까지 쓰고 누적 시간 페널티가 커진다", () => {
  const game = createGame(1);
  openCell(game, 1, 1, seededRandom(1));
  const first = useHint(game);
  useHint(game); useHint(game);
  const second = useHint(game);
  useHint(game); useHint(game);
  const third = useHint(game);
  assert.equal(first.penalty, 5);
  assert.equal(second.penalty, 10);
  assert.equal(third.penalty, 20);
  assert.equal(game.hintsUsed, 3);
  assert.equal(game.hintPenaltySeconds, 35);
});

test("생성된 보드는 지안·위험 단서만으로 추측 없이 풀 수 있다", () => {
  for (const level of [1, 5, 13, 20, 25, 35, 45, 50]) {
    for (let seed = 1; seed <= 8; seed += 1) {
      const game = createGame(level);
      const row = level === 1 ? 1 : seed % game.config.rows;
      const col = level === 1 ? 1 : (seed * 3) % game.config.cols;
      openCell(game, row, col, seededRandom(level * 100 + seed));
      assert.equal(game.isLogicVerified, true, `레벨 ${level}, 시드 ${seed}`);
      assert.equal(
        isLogicallySolvable(game.board, row, col, game.config.jianCount, game.config.hazardCounts, game.config.hazards),
        true,
      );
    }
  }
});

test("위험요소를 열면 실패하고 위험요소와 지안 위치를 공개한다", () => {
  const game = createGame(1);
  game.config = { ...game.config, jianCount: 1, hazardCount: 1 };
  game.board[1][1].hasJian = true;
  game.board[2][2].hasBomb = true;
  calculateAdjacentCounts(game.board);
  game.firstClickDone = true; game.status = "playing";
  openCell(game, 2, 2);
  assert.equal(game.status, "lost");
  assert.equal(getCell(game, 1, 1).isOpen, true);
});

test("지안 구조와 정확한 위험 표시를 모두 마쳐야 성공한다", () => {
  const game = createGame(1);
  game.config = { ...game.config, jianCount: 1, hazardCount: 1 };
  game.board[1][1].hasJian = true;
  game.board[2][2].hasBomb = true;
  calculateAdjacentCounts(game.board);
  game.firstClickDone = true; game.status = "playing";
  toggleFlag(game, 1, 1);
  assert.equal(game.status, "playing");
  toggleHazardMark(game, 2, 2);
  assert.equal(game.status, "won");
});

test("위험 표시는 후보 메모이며 다시 누르면 지울 수 있다", () => {
  const game = createGame(1);
  game.firstClickDone = true; game.status = "playing";
  toggleHazardMark(game, 0, 0);
  assert.equal(game.status, "playing");
  assert.equal(getCell(game, 0, 0).isHazardMarked, true);
  openCell(game, 0, 0);
  assert.equal(getCell(game, 0, 0).isOpen, false);
  toggleHazardMark(game, 0, 0);
  assert.equal(getCell(game, 0, 0).isHazardMarked, false);
});

test("위험 표시는 이번 레벨의 위험 수를 넘길 수 없다", () => {
  const game = createGame(1);
  game.firstClickDone = true; game.status = "playing";
  toggleHazardMark(game, 0, 0);
  toggleHazardMark(game, 0, 1);
  assert.equal(game.hazardMarks, 1);
  assert.equal(getCell(game, 0, 1).isHazardMarked, false);
});

test("복합 작전은 위험 종류별 개수와 표시 종류를 따로 판정한다", () => {
  const game = createGame(20);
  assert.equal(game.config.hazards.length, 2);
  assert.equal(Object.values(game.config.hazardCounts).reduce((sum, count) => sum + count, 0), game.config.hazardCount);
  game.firstClickDone = true; game.status = "playing";
  const [first, second] = game.config.hazards;
  toggleHazardMark(game, 0, 0, first.key);
  toggleHazardMark(game, 0, 1, second.key);
  assert.equal(getCell(game, 0, 0).hazardMarkKey, first.key);
  assert.equal(getCell(game, 0, 1).hazardMarkKey, second.key);
  assert.equal(game.hazardMarkCounts[first.key], 1);
  assert.equal(game.hazardMarkCounts[second.key], 1);
});

test("튜토리얼은 시간 제한 없이 진행한다", () => {
  const game = createGame(1);
  assert.equal(game.config.tutorialNoTimer, true);
  assert.equal(game.config.timeLimitSeconds, 0);
});

test("안전 행동과 구조는 점수와 콤보를 올리고 힌트는 콤보를 끊는다", () => {
  const game = createGame(1);
  openCell(game, 1, 1, seededRandom(1));
  assert.ok(game.score > 0);
  assert.ok(game.combo > 0);
  useHint(game);
  assert.equal(game.combo, 0);
});
