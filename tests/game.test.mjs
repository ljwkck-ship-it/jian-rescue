import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DIFFICULTIES,
  calculateAdjacentCounts,
  createGame,
  getDifficultyConfig,
  getCell,
  openCell,
  placeJians,
  toggleFlag,
  useHint,
} from "../src/game.js";

function seededRandom(seed) {
  let value = seed;
  return () => {
    value = (value * 1664525 + 1013904223) % 4294967296;
    return value / 4294967296;
  };
}

test("각 난이도는 정확한 수의 지안 칸을 배치한다", () => {
  for (const key of Object.keys(DIFFICULTIES)) {
    const game = createGame(key);
    placeJians(game, 0, 0, seededRandom(10));
    const count = game.board.flat().filter((cell) => cell.hasJian).length;
    assert.equal(count, game.config.jianCount);
  }
});

test("초급은 레벨이 오를수록 지안 수가 10명에서 25명까지 증가한다", () => {
  assert.equal(getDifficultyConfig("beginner", 1).jianCount, 10);
  assert.equal(getDifficultyConfig("beginner", 8).jianCount, 17);
  assert.equal(getDifficultyConfig("beginner", 16).jianCount, 25);
  assert.equal(getDifficultyConfig("beginner", 99).jianCount, 25);
});

test("첫 클릭 칸은 120회 반복해도 안전하다", () => {
  for (let i = 0; i < 120; i += 1) {
    const game = createGame("beginner");
    openCell(game, 4, 4, seededRandom(i + 1));
    assert.equal(getCell(game, 4, 4).hasJian, false);
    assert.equal(getCell(game, 4, 4).hasBomb, false);
  }
});

test("초급과 중급은 첫 클릭 주변 8칸도 보호한다", () => {
  for (const key of ["beginner", "intermediate"]) {
    const game = createGame(key);
    openCell(game, 3, 3, seededRandom(99));
    for (let row = 2; row <= 4; row += 1) {
      for (let col = 2; col <= 4; col += 1) {
        assert.equal(getCell(game, row, col).hasJian, false);
        assert.equal(getCell(game, row, col).hasBomb, false);
      }
    }
  }
});

test("모든 숫자는 실제 주변 지안 칸 수와 일치한다", () => {
  const game = createGame("intermediate");
  placeJians(game, 8, 8, seededRandom(1234));
  for (const row of game.board) {
    for (const cell of row) {
      let expected = 0;
      for (let dr = -1; dr <= 1; dr += 1) {
        for (let dc = -1; dc <= 1; dc += 1) {
          if (dr === 0 && dc === 0) continue;
          if (game.board[cell.row + dr]?.[cell.col + dc]?.hasJian) expected += 1;
        }
      }
      assert.equal(cell.adjacentCount, expected);
    }
  }
});

test("폭탄 숫자는 실제 주변 폭탄 칸 수와 일치한다", () => {
  const game = createGame("beginner");
  game.board[1][1].hasBomb = true;
  game.board[1][0].hasBomb = true;
  calculateAdjacentCounts(game.board);
  assert.equal(game.board[0][0].adjacentBombCount, 2);
  assert.equal(game.board[4][4].adjacentBombCount, 0);
});

test("첫 단서를 열기 전에는 지안 표시가 동작하지 않는다", () => {
  const game = createGame("beginner");
  toggleFlag(game, 0, 0);
  openCell(game, 0, 0, seededRandom(5));
  assert.equal(getCell(game, 0, 0).isOpen, true);
  assert.equal(game.status, "playing");
});

test("지안 칸을 열면 찾은 것으로 카운트되고 계속 진행된다", () => {
  const game = createGame("beginner");
  game.config.jianCount = 2;
  game.board[1][1].hasJian = true;
  game.board[2][2].hasJian = true;
  calculateAdjacentCounts(game.board);
  game.firstClickDone = true;
  game.status = "playing";
  openCell(game, 1, 1);
  assert.equal(getCell(game, 1, 1).isFound, true);
  assert.equal(getCell(game, 1, 1).isOpen, true);
  assert.equal(game.status, "playing");
});

test("빈 영역은 큐 기반으로 연쇄 공개된다", () => {
  const game = createGame("beginner");
  game.board[8][8].hasJian = true;
  calculateAdjacentCounts(game.board);
  game.firstClickDone = true;
  game.status = "playing";
  openCell(game, 0, 0);
  assert.equal(getCell(game, 0, 0).isOpen, true);
  assert.equal(getCell(game, 7, 7).isOpen, true);
});

test("폭탄 칸을 열면 패배하고 모든 지안 칸과 폭탄 칸을 공개한다", () => {
  const game = createGame("beginner");
  game.board[1][1].hasJian = true;
  game.board[2][2].hasJian = true;
  game.board[3][3].hasBomb = true;
  calculateAdjacentCounts(game.board);
  game.firstClickDone = true;
  game.status = "playing";
  openCell(game, 3, 3);
  assert.equal(game.status, "lost");
  assert.equal(getCell(game, 2, 2).isOpen, true);
  assert.equal(getCell(game, 3, 3).isOpen, true);
});

test("지안 칸을 여러 개 찾아야만 승리한다", () => {
  const game = createGame("beginner");
  game.config.jianCount = 2;
  game.board[1][1].hasJian = true;
  game.board[2][2].hasJian = true;
  calculateAdjacentCounts(game.board);
  game.firstClickDone = true;
  game.status = "playing";
  openCell(game, 1, 1);
  assert.equal(game.status, "playing");
  openCell(game, 2, 2);
  assert.equal(game.status, "won");
});

test("모든 지안 칸을 정확히 표시하면 승리한다", () => {
  const game = createGame("beginner");
  game.config.jianCount = 2;
  game.board[1][1].hasJian = true;
  game.board[2][2].hasJian = true;
  calculateAdjacentCounts(game.board);
  game.firstClickDone = true;
  game.status = "playing";
  toggleFlag(game, 1, 1);
  assert.equal(game.status, "playing");
  toggleFlag(game, 2, 2);
  assert.equal(game.status, "won");
});

test("정확한 지안 표시는 다시 해제할 수 있다", () => {
  const game = createGame("beginner");
  game.config.jianCount = 2;
  game.board[1][1].hasJian = true;
  game.board[2][2].hasJian = true;
  calculateAdjacentCounts(game.board);
  game.firstClickDone = true;
  game.status = "playing";
  toggleFlag(game, 1, 1);
  toggleFlag(game, 1, 1);
  assert.equal(game.flags, 0);
  assert.equal(getCell(game, 1, 1).isFlagged, false);
  assert.equal(game.status, "playing");
});

test("돋보기 힌트는 레벨별 제한 안에서 안전한 칸 하나를 공개한다", () => {
  const game = createGame("beginner");
  placeJians(game, 0, 0, seededRandom(17));
  const hinted = useHint(game);
  assert.ok(hinted);
  assert.equal(hinted.hasJian, false);
  assert.equal(hinted.hasBomb, false);
  assert.equal(hinted.isOpen, true);
  assert.equal(hinted.isHinted, true);
  assert.equal(game.hintsUsed, 1);
  assert.equal(useHint(game)?.isHinted, true);
  assert.equal(game.hintsUsed, 2);
  assert.equal(useHint(game), null);
  assert.equal(game.hintsUsed, 2);
});

test("정확한 지안 표시가 이어지면 콤보가 증가한다", () => {
  const game = createGame("beginner");
  game.config.jianCount = 3;
  game.board[1][1].hasJian = true;
  game.board[2][2].hasJian = true;
  game.board[3][3].hasJian = true;
  calculateAdjacentCounts(game.board);
  game.firstClickDone = true;
  game.status = "playing";
  toggleFlag(game, 1, 1);
  toggleFlag(game, 2, 2);
  toggleFlag(game, 3, 3);
  assert.equal(game.combo, 3);
  assert.equal(game.bestCombo, 3);
});

test("지안 칸을 모두 찾지 못하면 승리하지 않는다", () => {
  const game = createGame("beginner");
  game.config.jianCount = 2;
  game.board[1][1].hasJian = true;
  game.board[2][2].hasJian = true;
  calculateAdjacentCounts(game.board);
  game.firstClickDone = true;
  game.status = "playing";
  toggleFlag(game, 1, 1);
  assert.equal(game.status, "playing");
});

test("지안이가 아닌 칸에 표시하면 폭탄 실패가 된다", () => {
  const game = createGame("beginner");
  game.config.jianCount = 2;
  game.board[1][1].hasJian = true;
  game.board[2][2].hasJian = true;
  calculateAdjacentCounts(game.board);
  game.firstClickDone = true;
  game.status = "playing";
  toggleFlag(game, 1, 1);
  toggleFlag(game, 0, 0);
  assert.equal(game.status, "lost");
  assert.equal(getCell(game, 0, 0).isWrongFlag, true);
});
