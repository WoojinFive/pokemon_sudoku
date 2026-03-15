/**
 * app.js — UI, state, drag-and-drop
 */
(function () {
  'use strict';

  // ── GameState ─────────────────────────────────────────────
  const GS = {
    puzzle: null,       // Int8Array(81) — 0 = empty
    board: null,        // Int8Array(81) — current state
    solution: null,     // Int8Array(81)
    pokemonMap: null,   // { 1..9: {id, url, fallback, color, label} }
    difficulty: 'easy',
    mistakes: 0,
    hintsLeft: 3,
    selectedCell: -1,   // flat index (for row/col/box highlight only)
    highlightValue: 0,  // value being hovered/dragged from palette
    history: [],        // [{idx, prevValue}]
    notesMode: false,
    notes: null,        // Array(81) of Set
    hintedCells: null,  // Set of cell indices revealed by hint
    timerInterval: null,
    elapsedSeconds: 0,
    paused: false,
    gameOver: false,
    gameWon: false,
  };

  // ── DOM refs ──────────────────────────────────────────────
  const $ = id => document.getElementById(id);
  const grid = $('sudoku-grid');
  const palette = $('pokemon-palette');
  const mistakeCount = $('mistake-count');
  const hintCount = $('hint-count');
  const hintBadge = $('hint-badge');
  const timerDisplay = $('timer-display');
  const loadingOverlay = $('loading-overlay');
  const notesBtn = $('notes-btn');
  const winModal = $('win-modal');
  const gameoverModal = $('gameover-modal');
  const pausedOverlay = $('paused-overlay');

  // ── Utility ───────────────────────────────────────────────
  function formatTime(s) {
    const m = Math.floor(s / 60).toString().padStart(2, '0');
    const sec = (s % 60).toString().padStart(2, '0');
    return `${m}:${sec}`;
  }

  function makePokemonElement(info, small = false) {
    if (!info) return null;
    if (info.url) {
      const img = document.createElement('img');
      img.src = info.url;
      img.alt = `Pokemon ${info.id}`;
      img.draggable = false;
      return img;
    }
    const div = document.createElement('div');
    div.className = 'palette-fallback';
    div.style.background = info.color;
    div.textContent = info.label;
    if (small) div.style.fontSize = '0.6rem';
    return div;
  }

  // ── Timer ─────────────────────────────────────────────────
  function startTimer() {
    stopTimer();
    GS.elapsedSeconds = 0;
    timerDisplay.textContent = '00:00';
    GS.timerInterval = setInterval(() => {
      if (!GS.paused) {
        GS.elapsedSeconds++;
        timerDisplay.textContent = formatTime(GS.elapsedSeconds);
      }
    }, 1000);
  }

  function stopTimer() {
    if (GS.timerInterval) { clearInterval(GS.timerInterval); GS.timerInterval = null; }
  }

  // ── Grid: build once, update in place ────────────────────
  let cellElements = []; // cached DOM refs — rebuilt only on new game

  function buildGrid() {
    grid.innerHTML = '';
    cellElements = [];
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const i = r * 9 + c;
        const cell = document.createElement('div');
        cell.className = 'cell';
        cell.dataset.row = r;
        cell.dataset.col = c;
        cell.dataset.idx = i;
        cell.addEventListener('dragstart', onCellDragStart);
        cell.addEventListener('dragend', onCellDragEnd);
        cell.addEventListener('dragover', onDragOver);
        cell.addEventListener('dragleave', onDragLeave);
        cell.addEventListener('drop', onDrop);
        cell.addEventListener('click', onCellClick);
        cell.addEventListener('pointerdown', onCellPointerDown);
        grid.appendChild(cell);
        cellElements.push(cell);
      }
    }
  }

  // Update all cell classes and content without touching the grid DOM
  function renderGrid() {
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const i = r * 9 + c;
        updateCell(cellElements[i], r, c, i);
      }
    }
  }

  function updateCell(cell, r, c, i) {
    const isGiven = GS.puzzle[i] !== 0;
    const val = GS.board[i];
    const isSelected = i === GS.selectedCell;

    // ── Classes ──
    const cls = ['cell'];
    if (isGiven) cls.push('given');
    if (isSelected) cls.push('selected');

    if (val !== 0 && !isGiven) {
      if (val !== GS.solution[i]) cls.push('error');
    }
    if (val !== 0 && GS.highlightValue !== 0 && val === GS.highlightValue) {
      cls.push('highlight-value');
    }

    if (GS.hintedCells && GS.hintedCells.has(i)) cls.push('hinted');

    if (!isSelected && GS.selectedCell !== -1) {
      const sr = Math.floor(GS.selectedCell / 9);
      const sc = GS.selectedCell % 9;
      const sameBox = Math.floor(r / 3) === Math.floor(sr / 3) &&
                      Math.floor(c / 3) === Math.floor(sc / 3);
      if (r === sr || c === sc || sameBox) cls.push('highlight');
    }

    const newClass = cls.join(' ');
    if (cell.className !== newClass) cell.className = newClass;

    // Filled non-given cells are draggable (drag-out to remove)
    cell.draggable = (!isGiven && val !== 0);

    // ── Content ──
    setCellContent(cell, i, val);
  }

  // Update only the inner content of a cell
  function setCellContent(cell, i, val) {
    if (val !== 0) {
      const info = GS.pokemonMap[val];
      // Check if already showing the right content
      const existing = cell.firstChild;
      if (existing) {
        if (info.url && existing.tagName === 'IMG' && existing.src === info.url) return;
        if (!info.url && existing.classList && existing.classList.contains('palette-fallback') &&
            existing.textContent === info.label) return;
      }
      cell.innerHTML = '';
      const el = makePokemonElement(info);
      if (el) cell.appendChild(el);
    } else {
      const noteSet = GS.notes[i];
      if (noteSet && noteSet.size > 0) {
        // Always rebuild notes (small, cheap)
        cell.innerHTML = '';
        const ng = document.createElement('div');
        ng.className = 'notes-grid';
        for (let v = 1; v <= 9; v++) {
          const nc = document.createElement('div');
          nc.className = 'note-cell';
          if (noteSet.has(v)) {
            const el = makePokemonElement(GS.pokemonMap[v], true);
            if (el) nc.appendChild(el);
          }
          ng.appendChild(nc);
        }
        cell.appendChild(ng);
      } else {
        if (cell.firstChild) cell.innerHTML = '';
      }
    }
  }

  function countOnBoard(v) {
    let n = 0;
    for (let i = 0; i < 81; i++) if (GS.board[i] === v) n++;
    return n;
  }

  function renderPalette() {
    palette.innerHTML = '';
    for (let v = 1; v <= 9; v++) {
      const item = document.createElement('div');
      const complete = countOnBoard(v) >= 9;
      item.className = 'palette-item' + (complete ? ' complete' : '');
      item.dataset.value = v;
      item.draggable = !complete;

      const info = GS.pokemonMap[v];
      const el = makePokemonElement(info);
      if (el) item.appendChild(el);

      if (!complete) {
        item.addEventListener('dragstart', onPaletteDragStart);
        item.addEventListener('dragend', onPaletteDragEnd);
        item.addEventListener('pointerdown', onPointerDown);
      }

      // Hover highlight (mouse)
      item.addEventListener('mouseenter', () => { GS.highlightValue = v; renderGrid(); });
      item.addEventListener('mouseleave', () => { GS.highlightValue = 0; renderGrid(); });

      palette.appendChild(item);
    }
  }

  // Refresh palette complete-state after board changes
  function updatePaletteCompletion() {
    palette.querySelectorAll('.palette-item').forEach(item => {
      const v = parseInt(item.dataset.value);
      const complete = countOnBoard(v) >= 9;
      item.classList.toggle('complete', complete);
      item.draggable = !complete;
    });
  }

  // True if `val` already exists in the same row, col, or 3×3 box (ignoring the cell itself)
  function hasConflict(board, row, col, val) {
    for (let c = 0; c < 9; c++) {
      if (c !== col && board[row * 9 + c] === val) return true;
    }
    for (let r = 0; r < 9; r++) {
      if (r !== row && board[r * 9 + col] === val) return true;
    }
    const br = Math.floor(row / 3) * 3;
    const bc = Math.floor(col / 3) * 3;
    for (let r = br; r < br + 3; r++) {
      for (let c = bc; c < bc + 3; c++) {
        if ((r !== row || c !== col) && board[r * 9 + c] === val) return true;
      }
    }
    return false;
  }

  function updateStats() {
    mistakeCount.textContent = GS.mistakes;
    hintCount.textContent = GS.hintsLeft;
    hintBadge.textContent = GS.hintsLeft;
  }

  // ── Cell click ────────────────────────────────────────────
  function onCellClick(e) {
    if (GS.gameOver || GS.gameWon || GS.paused) return;
    const i = parseInt(e.currentTarget.dataset.idx);

    // If a palette item is highlighted (mobile tap-select), place it
    if (GS.highlightValue !== 0 && GS.puzzle[i] === 0) {
      handleDrop(GS.highlightValue, i);
      GS.highlightValue = 0;
      renderGrid();
      return;
    }

    GS.selectedCell = (GS.selectedCell === i) ? -1 : i;
    renderGrid();
  }

  // ── Core action ───────────────────────────────────────────
  function handleDrop(value, cellIdx) {
    if (GS.gameOver || GS.gameWon || GS.paused) return;
    if (GS.puzzle[cellIdx] !== 0) return; // given cell

    if (GS.notesMode) {
      if (!GS.notes[cellIdx]) GS.notes[cellIdx] = new Set();
      if (GS.notes[cellIdx].has(value)) {
        GS.notes[cellIdx].delete(value);
      } else {
        GS.notes[cellIdx].add(value);
      }
      renderGrid();
      return;
    }

    GS.history.push({ idx: cellIdx, prevValue: GS.board[cellIdx] });
    GS.board[cellIdx] = value;

    GS.selectedCell = cellIdx;
    GS.hintedCells.delete(cellIdx);

    if (GS.notes[cellIdx]) GS.notes[cellIdx].clear();

    if (value !== GS.solution[cellIdx]) {
      GS.mistakes++;
      updateStats();
      if (GS.mistakes >= 3) {
        renderGrid();
        triggerGameOver();
        return;
      }
    }

    if (SudokuEngine.isBoardComplete(GS.board, GS.solution)) {
      renderGrid();
      updatePaletteCompletion();
      triggerWin();
      return;
    }

    renderGrid();
    updatePaletteCompletion();
  }

  // ── Undo ──────────────────────────────────────────────────
  function doUndo() {
    if (GS.history.length === 0 || GS.gameOver || GS.gameWon) return;
    const { idx, prevValue } = GS.history.pop();
    GS.board[idx] = prevValue;
    GS.selectedCell = idx;
    renderGrid();
    updatePaletteCompletion();
  }

  // ── Erase ─────────────────────────────────────────────────
  function doErase() {
    if (GS.selectedCell === -1 || GS.gameOver || GS.gameWon) return;
    const i = GS.selectedCell;
    if (GS.notes[i] && GS.notes[i].size > 0) {
      GS.notes[i].clear();
      renderGrid();
      return;
    }
    eraseCell(i);
  }

  // ── Hint ──────────────────────────────────────────────────
  function doHint() {
    if (GS.hintsLeft <= 0 || GS.gameOver || GS.gameWon) return;
    const empties = [];
    for (let i = 0; i < 81; i++) {
      if (GS.puzzle[i] === 0 && GS.board[i] !== GS.solution[i]) empties.push(i);
    }
    if (empties.length === 0) return;

    const i = empties[Math.floor(Math.random() * empties.length)];
    GS.history.push({ idx: i, prevValue: GS.board[i] });
    GS.board[i] = GS.solution[i];
    if (GS.notes[i]) GS.notes[i].clear();
    GS.hintedCells.add(i);
    GS.hintsLeft--;
    GS.selectedCell = i;
    updateStats();

    if (SudokuEngine.isBoardComplete(GS.board, GS.solution)) {
      renderGrid();
      updatePaletteCompletion();
      triggerWin();
      return;
    }
    renderGrid();
    updatePaletteCompletion();
  }

  // ── Leaderboard ───────────────────────────────────────────
  async function showLeaderboard() {
    const modal = $('leaderboard-modal');
    const list = $('leaderboard-list');
    modal.classList.remove('hidden');
    list.innerHTML = '<p class="lb-loading">Loading...</p>';
    try {
      const lb = window.FirebaseLeaderboard;
      if (!lb) { list.innerHTML = '<p class="lb-loading">Leaderboard unavailable.</p>'; return; }
      const scores = await lb.getTopScores();
      if (scores.length === 0) {
        list.innerHTML = '<p class="lb-loading">No records yet!</p>';
        return;
      }
      const medals = ['🥇','🥈','🥉'];
      list.innerHTML = scores.map((s, idx) => {
        const rankClass = idx < 3 ? ` rank-${idx + 1}` : '';
        const medal = idx < 3
          ? `<span class="leaderboard-medal">${medals[idx]}</span>`
          : `<span class="leaderboard-rank">${idx + 1}</span>`;
        const diffLabel = { easy: 'Easy', medium: 'Med', hard: 'Hard' }[s.difficulty] || s.difficulty || '';
        return `<div class="leaderboard-row${rankClass}">
          ${medal}
          <span class="leaderboard-name">${escapeHtml(s.name)}</span>
          <span class="leaderboard-diff ${s.difficulty || ''}">${diffLabel}</span>
          <span class="leaderboard-time">${formatTime(s.time)}</span>
        </div>`;
      }).join('');
    } catch (err) {
      list.innerHTML = '<p class="lb-loading">Failed to load records.</p>';
      console.error(err);
    }
  }

  function escapeHtml(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // ── Win / Game Over ───────────────────────────────────────
  async function triggerWin() {
    GS.gameWon = true;
    stopTimer();
    const elapsed = GS.elapsedSeconds;

    const p = winModal.querySelector('#win-time');
    if (p) p.textContent = `Time: ${formatTime(elapsed)}`;

    // Reset name input section (hidden by default)
    const nameInput = $('player-name-input');
    const saveBtn = $('save-record-btn');
    const newRecordSection = $('new-record-section');
    if (nameInput) nameInput.value = '';
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save Record'; }
    if (newRecordSection) newRecordSection.classList.add('hidden');

    winModal.classList.remove('hidden');

    // Check top 10 qualification
    let qualifies = true; // default: show input if check can't run
    const lb = window.FirebaseLeaderboard;
    if (lb) {
      try {
        qualifies = await lb.qualifiesForTop10(elapsed);
      } catch (e) {
        console.error('Leaderboard check failed:', e);
        qualifies = true; // fail open: show input on error
      }
    }

    if (qualifies && newRecordSection) {
      newRecordSection.classList.remove('hidden');
      if (nameInput) nameInput.focus();
    }
  }

  function triggerGameOver() {
    GS.gameOver = true;
    stopTimer();
    gameoverModal.classList.remove('hidden');
  }

  // ── Pause ─────────────────────────────────────────────────
  function togglePause() {
    if (GS.gameOver || GS.gameWon) return;
    GS.paused = !GS.paused;
    pausedOverlay.classList.toggle('hidden', !GS.paused);
  }

  // ── Init ──────────────────────────────────────────────────
  async function initGame(difficulty) {
    GS.difficulty = difficulty || GS.difficulty;
    stopTimer();
    loadingOverlay.classList.remove('hidden');
    winModal.classList.add('hidden');
    gameoverModal.classList.add('hidden');
    pausedOverlay.classList.add('hidden');

    GS.mistakes = 0;
    GS.hintsLeft = 3;
    GS.selectedCell = -1;
    GS.history = [];
    GS.notesMode = false;
    GS.paused = false;
    GS.gameOver = false;
    GS.gameWon = false;
    notesBtn.classList.remove('active');
    updateStats();

    await new Promise(resolve => setTimeout(resolve, 10));
    const { puzzle, solution } = SudokuEngine.generatePuzzle(GS.difficulty);
    GS.puzzle = puzzle;
    GS.board = puzzle.slice();
    GS.solution = solution;
    GS.notes = Array.from({ length: 81 }, () => new Set());
    GS.hintedCells = new Set();

    const ids = PokemonLoader.pickRandomPokemon();
    GS.pokemonMap = await PokemonLoader.preloadPokemon(ids);

    loadingOverlay.classList.add('hidden');
    buildGrid();      // rebuild DOM once per new game
    renderGrid();     // apply initial state
    renderPalette();
    startTimer();
  }

  // ── HTML5 Drag & Drop (desktop) ───────────────────────────
  let dragValue = 0;       // value being dragged from palette
  let cellDragIdx = -1;    // source cell index when dragging from a cell
  let dndGhost = null;     // custom ghost element following the cursor

  // 1×1 transparent image to suppress the browser's default drag ghost
  const BLANK_DRAG_IMG = new Image();
  BLANK_DRAG_IMG.src = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';

  function showDndGhost(info, x, y) {
    if (dndGhost) { dndGhost.remove(); dndGhost = null; }
    dndGhost = createGhost(info); // reuse pointer-event ghost creator
    dndGhost.style.left = x + 'px';
    dndGhost.style.top = y + 'px';
  }

  function clearDndGhost() {
    if (dndGhost) { dndGhost.remove(); dndGhost = null; }
  }

  // Move ghost with cursor during drag
  document.addEventListener('dragover', e => {
    if (dndGhost) {
      dndGhost.style.left = e.clientX + 'px';
      dndGhost.style.top = e.clientY + 'px';
    }
  });

  function onPaletteDragStart(e) {
    dragValue = parseInt(e.currentTarget.dataset.value);
    e.dataTransfer.setData('text/plain', String(dragValue));
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setDragImage(BLANK_DRAG_IMG, 0, 0);
    showDndGhost(GS.pokemonMap[dragValue], e.clientX, e.clientY);
    GS.highlightValue = dragValue;
    renderGrid();
  }

  function onPaletteDragEnd() {
    dragValue = 0;
    clearDndGhost();
    GS.highlightValue = 0;
    renderGrid();
    document.querySelectorAll('.cell.drag-over').forEach(c => c.classList.remove('drag-over'));
  }

  // Drag start from a filled cell (to remove by dragging out)
  function onCellDragStart(e) {
    const i = parseInt(e.currentTarget.dataset.idx);
    if (GS.puzzle[i] !== 0 || GS.board[i] === 0) { e.preventDefault(); return; }
    if (GS.gameOver || GS.gameWon || GS.paused) { e.preventDefault(); return; }
    cellDragIdx = i;
    e.dataTransfer.setData('text/plain', '');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setDragImage(BLANK_DRAG_IMG, 0, 0);
    showDndGhost(GS.pokemonMap[GS.board[i]], e.clientX, e.clientY);
  }

  function onCellDragEnd(e) {
    const i = cellDragIdx;
    cellDragIdx = -1;
    clearDndGhost();
    document.querySelectorAll('.cell.drag-over').forEach(c => c.classList.remove('drag-over'));
    if (i !== -1 && e.dataTransfer.dropEffect === 'none') {
      eraseCell(i);
    }
  }

  function onDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = cellDragIdx !== -1 ? 'move' : 'copy';
    e.currentTarget.classList.add('drag-over');
  }

  function onDragLeave(e) {
    e.currentTarget.classList.remove('drag-over');
  }

  function onDrop(e) {
    e.preventDefault();
    const cell = e.currentTarget;
    cell.classList.remove('drag-over');
    const targetIdx = parseInt(cell.dataset.idx);

    if (cellDragIdx !== -1) {
      // Drag from cell → cell: move (remove from source, place on target)
      const srcIdx = cellDragIdx;
      cellDragIdx = -1;
      if (srcIdx === targetIdx) return;
      const val = GS.board[srcIdx];
      eraseCell(srcIdx);
      handleDrop(val, targetIdx);
    } else {
      // Drag from palette
      const value = parseInt(e.dataTransfer.getData('text/plain')) || dragValue;
      if (!value) return;
      handleDrop(value, targetIdx);
    }
  }

  // Erase a non-given cell and push to history
  function eraseCell(i) {
    if (GS.puzzle[i] !== 0 || GS.board[i] === 0) return;
    GS.history.push({ idx: i, prevValue: GS.board[i] });
    GS.board[i] = 0;
    GS.hintedCells.delete(i);
    if (GS.selectedCell === i) GS.selectedCell = -1;
    renderGrid();
    updatePaletteCompletion();
  }

  // ── Pointer Events (mobile drag) ──────────────────────────
  let pointerDragValue = 0;
  let pointerDragSrcCell = -1; // -1 = from palette, >=0 = from cell
  let pointerStartX = 0, pointerStartY = 0;
  let pointerMoved = false;    // true once movement exceeds TAP_THRESHOLD
  let pointerPrevHighlight = 0; // highlightValue BEFORE this interaction started
  let ghostEl = null;
  let pointerActive = false;
  const TAP_THRESHOLD = 10;   // px — below this = tap, above = drag

  function createGhost(info) {
    const g = document.createElement('div');
    g.id = 'drag-ghost';
    const el = makePokemonElement(info);
    if (el) g.appendChild(el);
    document.body.appendChild(g);
    return g;
  }

  function startPointerDrag(e, value, srcCellIdx) {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    pointerDragValue = value;
    pointerDragSrcCell = srcCellIdx;
    pointerStartX = e.clientX;
    pointerStartY = e.clientY;
    pointerMoved = false;
    pointerActive = true;
    pointerPrevHighlight = GS.highlightValue; // save BEFORE changing
    GS.highlightValue = value;
    renderGrid();
    e.currentTarget.addEventListener('pointermove', onPointerMove, { passive: false });
    e.currentTarget.addEventListener('pointerup', onPointerUp);
    e.currentTarget.addEventListener('pointercancel', onPointerCancel);
  }

  // Called from palette items
  function onPointerDown(e) {
    if (e.pointerType === 'mouse') return;
    startPointerDrag(e, parseInt(e.currentTarget.dataset.value), -1);
  }

  // Called from filled non-given cells
  function onCellPointerDown(e) {
    if (e.pointerType === 'mouse') return;
    const i = parseInt(e.currentTarget.dataset.idx);
    if (GS.puzzle[i] !== 0 || GS.board[i] === 0) return;
    if (GS.gameOver || GS.gameWon || GS.paused) return;
    startPointerDrag(e, GS.board[i], i);
  }

  function onPointerMove(e) {
    if (!pointerActive) return;
    e.preventDefault();
    const dx = e.clientX - pointerStartX;
    const dy = e.clientY - pointerStartY;

    // Create ghost only once movement exceeds threshold (avoids ghost on taps)
    if (!pointerMoved && Math.hypot(dx, dy) >= TAP_THRESHOLD) {
      pointerMoved = true;
      ghostEl = createGhost(GS.pokemonMap[pointerDragValue]);
    }

    if (ghostEl) {
      ghostEl.style.left = e.clientX + 'px';
      ghostEl.style.top = e.clientY + 'px';
    }

    if (pointerMoved) {
      document.querySelectorAll('.cell.drag-over').forEach(c => c.classList.remove('drag-over'));
      if (ghostEl) ghostEl.style.visibility = 'hidden';
      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (ghostEl) ghostEl.style.visibility = '';
      const cell = el && el.closest('.cell');
      if (cell) cell.classList.add('drag-over');
    }
  }

  function onPointerUp(e) {
    if (!pointerActive) return;
    pointerActive = false;
    cleanupPointer(e.currentTarget);
    document.querySelectorAll('.cell.drag-over').forEach(c => c.classList.remove('drag-over'));

    const val = pointerDragValue;
    const srcIdx = pointerDragSrcCell;
    const wasDrag = pointerMoved;
    pointerDragValue = 0;
    pointerDragSrcCell = -1;
    pointerMoved = false;

    if (!wasDrag) {
      // ── Tap (no movement) ──
      if (ghostEl) { ghostEl.remove(); ghostEl = null; }

      if (srcIdx === -1) {
        // Tap on palette: keep highlight unless same item was already selected before tap
        GS.highlightValue = (pointerPrevHighlight === val) ? 0 : val;
        renderGrid();
      }
      // Tap on cell: nothing extra (cell click handler covers selection)
      return;
    }

    // ── Drag (movement) ── clear highlight after drop
    if (ghostEl) ghostEl.style.visibility = 'hidden';
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (ghostEl) { ghostEl.remove(); ghostEl = null; }
    const targetCell = el && el.closest('.cell');

    GS.highlightValue = 0;
    renderGrid();

    if (srcIdx !== -1) {
      // Drag from cell
      if (targetCell) {
        const targetIdx = parseInt(targetCell.dataset.idx);
        if (targetIdx !== srcIdx) { eraseCell(srcIdx); handleDrop(val, targetIdx); }
      } else {
        eraseCell(srcIdx);
      }
    } else {
      // Drag from palette
      if (targetCell) handleDrop(val, parseInt(targetCell.dataset.idx));
    }
  }

  function onPointerCancel(e) {
    pointerActive = false;
    cleanupPointer(e.currentTarget);
    if (ghostEl) { ghostEl.remove(); ghostEl = null; }
    document.querySelectorAll('.cell.drag-over').forEach(c => c.classList.remove('drag-over'));
    pointerDragValue = 0;
  }

  function cleanupPointer(el) {
    el.removeEventListener('pointermove', onPointerMove);
    el.removeEventListener('pointerup', onPointerUp);
    el.removeEventListener('pointercancel', onPointerCancel);
  }

  // ── Keyboard support ──────────────────────────────────────
  document.addEventListener('keydown', e => {
    if (GS.paused || GS.gameOver || GS.gameWon) return;

    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      e.preventDefault();
      if (GS.selectedCell === -1) { GS.selectedCell = 0; }
      else {
        const r = Math.floor(GS.selectedCell / 9);
        const c = GS.selectedCell % 9;
        let nr = r, nc = c;
        if (e.key === 'ArrowUp') nr = Math.max(0, r - 1);
        if (e.key === 'ArrowDown') nr = Math.min(8, r + 1);
        if (e.key === 'ArrowLeft') nc = Math.max(0, c - 1);
        if (e.key === 'ArrowRight') nc = Math.min(8, c + 1);
        GS.selectedCell = nr * 9 + nc;
      }
      renderGrid();
      return;
    }

    if (e.key === 'Delete' || e.key === 'Backspace') doErase();
    if (e.key === 'z' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); doUndo(); }
  });

  // ── Button wiring ─────────────────────────────────────────
  $('new-game-btn').addEventListener('click', () => initGame(GS.difficulty));
  $('undo-btn').addEventListener('click', doUndo);
  $('erase-btn').addEventListener('click', doErase);
  $('hint-btn').addEventListener('click', doHint);

  $('notes-btn').addEventListener('click', () => {
    GS.notesMode = !GS.notesMode;
    notesBtn.classList.toggle('active', GS.notesMode);
  });

  $('pause-btn').addEventListener('click', togglePause);
  $('resume-btn').addEventListener('click', togglePause);

  $('records-btn').addEventListener('click', showLeaderboard);
  $('leaderboard-close').addEventListener('click', () => $('leaderboard-modal').classList.add('hidden'));

  $('save-record-btn').addEventListener('click', async () => {
    const btn = $('save-record-btn');
    const nameInput = $('player-name-input');
    const name = (nameInput.value || '').trim() || 'Anonymous';
    const lb = window.FirebaseLeaderboard;
    if (!lb) { alert('Leaderboard not available yet. Try again shortly.'); return; }
    btn.disabled = true;
    btn.textContent = 'Saving...';
    try {
      await lb.addScore(name, GS.elapsedSeconds, GS.difficulty);
      btn.textContent = 'Saved!';
      setTimeout(() => $('new-record-section').classList.add('hidden'), 800);
    } catch (e) {
      console.error('Save failed:', e);
      btn.disabled = false;
      btn.textContent = 'Save Record';
      alert('Failed to save record. Check Firestore rules.');
    }
  });

  $('win-view-records').addEventListener('click', () => {
    winModal.classList.add('hidden');
    showLeaderboard();
  });

  $('win-new-game').addEventListener('click', () => {
    winModal.classList.add('hidden');
    initGame(GS.difficulty);
  });

  $('gameover-new-game').addEventListener('click', () => {
    gameoverModal.classList.add('hidden');
    initGame(GS.difficulty);
  });

  document.querySelectorAll('.diff-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.diff-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      initGame(btn.dataset.diff);
    });
  });

  // ── Start ─────────────────────────────────────────────────
  initGame('easy');
})();
