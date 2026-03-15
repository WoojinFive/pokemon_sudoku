/**
 * sudoku.js — Puzzle generation & validation
 * Exposes: window.SudokuEngine
 */
(function () {
  'use strict';

  // ── Helpers ──────────────────────────────────────────────
  function makeBoard() { return new Int8Array(81); }

  function idx(r, c) { return r * 9 + c; }

  function isValid(board, row, col, num) {
    // Row
    for (let c = 0; c < 9; c++) {
      if (board[idx(row, c)] === num) return false;
    }
    // Col
    for (let r = 0; r < 9; r++) {
      if (board[idx(r, col)] === num) return false;
    }
    // Box
    const br = Math.floor(row / 3) * 3;
    const bc = Math.floor(col / 3) * 3;
    for (let r = br; r < br + 3; r++) {
      for (let c = bc; c < bc + 3; c++) {
        if (board[idx(r, c)] === num) return false;
      }
    }
    return true;
  }

  // ── Shuffle helper ───────────────────────────────────────
  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // ── Fill a single 3×3 box with shuffled 1-9 ─────────────
  function fillBox(board, boxRow, boxCol) {
    const nums = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    let k = 0;
    for (let r = boxRow; r < boxRow + 3; r++) {
      for (let c = boxCol; c < boxCol + 3; c++) {
        board[idx(r, c)] = nums[k++];
      }
    }
  }

  // ── Backtracking solver ──────────────────────────────────
  // Returns true when a solution is found, fills `board` in-place.
  // `limit` stops early after finding `limit` solutions (for uniqueness check).
  function solve(board, limit = 1) {
    let count = 0;

    function bt() {
      if (count >= limit) return true;
      // Find first empty
      let pos = -1;
      for (let i = 0; i < 81; i++) {
        if (board[i] === 0) { pos = i; break; }
      }
      if (pos === -1) { count++; return count >= limit; }

      const row = Math.floor(pos / 9);
      const col = pos % 9;
      const nums = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]);

      for (const n of nums) {
        if (isValid(board, row, col, n)) {
          board[pos] = n;
          if (bt()) return true;
          board[pos] = 0;
        }
      }
      return false;
    }

    bt();
    return count;
  }

  // Solve without shuffling (deterministic, for uniqueness counting)
  function countSolutions(board, limit = 2) {
    let count = 0;
    const b = board.slice();

    function bt() {
      if (count >= limit) return;
      let pos = -1;
      for (let i = 0; i < 81; i++) {
        if (b[i] === 0) { pos = i; break; }
      }
      if (pos === -1) { count++; return; }

      const row = Math.floor(pos / 9);
      const col = pos % 9;

      for (let n = 1; n <= 9; n++) {
        if (isValid(b, row, col, n)) {
          b[pos] = n;
          bt();
          if (count >= limit) return;
          b[pos] = 0;
        }
      }
    }

    bt();
    return count;
  }

  // ── generatePuzzle ───────────────────────────────────────
  const CLUES = { easy: 36, medium: 32, hard: 28 };

  function generatePuzzle(difficulty = 'easy') {
    const clueCount = CLUES[difficulty] || CLUES.easy;

    // 1. Fill diagonal boxes (independent, so no conflict needed)
    const solution = makeBoard();
    fillBox(solution, 0, 0);
    fillBox(solution, 3, 3);
    fillBox(solution, 6, 6);

    // 2. Complete the board with backtracking
    solve(solution);

    // 3. Remove cells while keeping unique solution
    const puzzle = solution.slice();
    const positions = shuffle([...Array(81).keys()]);
    let filled = 81;
    const target = clueCount;

    for (const pos of positions) {
      if (filled <= target) break;
      const backup = puzzle[pos];
      puzzle[pos] = 0;
      if (countSolutions(puzzle, 2) !== 1) {
        puzzle[pos] = backup; // Restore — not unique
      } else {
        filled--;
      }
    }

    return { puzzle, solution };
  }

  // ── Public validation ────────────────────────────────────
  function isValidPlacement(board, row, col, num) {
    return isValid(board, row, col, num);
  }

  function isBoardComplete(board, solution) {
    for (let i = 0; i < 81; i++) {
      if (board[i] !== solution[i]) return false;
    }
    return true;
  }

  window.SudokuEngine = { generatePuzzle, isValidPlacement, isBoardComplete };
})();
