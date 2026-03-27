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
    bonusHintUsed: false,  // bonus quiz attempted (only once per game)
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
    updateHintButton();
  }

  function updateHintButton() {
    const btn = $('hint-btn');
    if (GS.hintsLeft === 0 && !GS.bonusHintUsed && !GS.gameOver && !GS.gameWon) {
      btn.classList.add('get-hints');
      btn.innerHTML = '🎁 Get Hints!';
    } else {
      btn.classList.remove('get-hints');
      btn.innerHTML = `💡 Hint <span id="hint-badge">${GS.hintsLeft}</span>`;
    }
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

  // ── Bonus Hint Quiz ────────────────────────────────────────
  function randInt(max) { return Math.floor(Math.random() * max); }

  function shuffleArr(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = randInt(i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  async function fetchPokemonName(id, lang = 'en') {
    if (lang === 'ko') {
      const res = await fetch(`https://pokeapi.co/api/v2/pokemon-species/${id}`);
      if (!res.ok) throw new Error(`Species ${id} not found`);
      const data = await res.json();
      const entry = data.names.find(n => n.language.name === 'ko');
      return entry ? entry.name : data.name;
    } else {
      const res = await fetch(`https://pokeapi.co/api/v2/pokemon/${id}`);
      if (!res.ok) throw new Error(`Pokemon ${id} not found`);
      const data = await res.json();
      return data.name;
    }
  }

  function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1).replace(/-/g, ' ');
  }

  async function showBonusHintQuiz() {
    if (GS.bonusHintUsed || GS.gameOver || GS.gameWon || GS.paused) return;

    // Open modal with loading state (don't mark as used yet — close button is free)
    const modal = $('bonus-hint-modal');
    $('bonus-hint-desc').innerHTML = 'Loading...';
    $('bonus-hint-pokemon').innerHTML = '';
    $('bonus-hint-choices').innerHTML = '';
    modal.classList.remove('hidden');

    // Pick answer ID from 1–1025
    const answerID = randInt(1025) + 1;

    // Pick 3 distinct wrong IDs
    const wrongIDs = new Set();
    while (wrongIDs.size < 3) {
      const id = randInt(1025) + 1;
      if (id !== answerID) wrongIDs.add(id);
    }
    const allIDs = [answerID, ...[...wrongIDs]];

    try {
      const names = await Promise.all(allIDs.map(fetchPokemonName));
      const answerName = names[0];
      const choices = shuffleArr(names.map((name, i) => ({ name, correct: i === 0 })));

      // Show Pokemon image
      const pokemonEl = $('bonus-hint-pokemon');
      pokemonEl.innerHTML = '';
      const img = document.createElement('img');
      img.src = `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${answerID}.png`;
      img.onerror = () => { img.src = `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${answerID}.png`; };
      img.alt = answerName;
      pokemonEl.appendChild(img);

      // Show 4 name choice buttons
      const choicesEl = $('bonus-hint-choices');
      choicesEl.innerHTML = '';
      choices.forEach(({ name, correct }) => {
        const btn = document.createElement('button');
        btn.className = 'bonus-choice-name';
        btn.textContent = capitalize(name);
        btn.dataset.correct = correct ? 'true' : 'false';
        btn.addEventListener('click', () => handleBonusAnswer(btn, correct, choicesEl));
        choicesEl.appendChild(btn);
      });

      $('bonus-hint-desc').innerHTML = "What's this Pokémon's name?<br><small>One attempt — or close to try later.</small>";

    } catch (e) {
      console.error(e);
      $('bonus-hint-desc').innerHTML = 'Failed to load. Close and try again.';
    }
  }

  function handleBonusAnswer(clickedBtn, correct, choicesEl) {
    // Mark as used — no more quiz this game
    GS.bonusHintUsed = true;
    updateHintButton();

    // Disable all, mark clicked, reveal correct answer
    choicesEl.querySelectorAll('.bonus-choice-name').forEach(b => {
      b.disabled = true;
      if (b.dataset.correct === 'true') b.classList.add('correct');
    });
    if (!correct) clickedBtn.classList.add('wrong');

    // Reveal silhouette → actual image
    const img = $('bonus-hint-pokemon').querySelector('img');
    if (img) img.classList.add('revealed');

    const desc = $('bonus-hint-desc');
    if (correct) {
      desc.innerHTML = '🎉 Correct! You earned 3 hints!';
      GS.hintsLeft = 3;
      updateStats();
    } else {
      desc.innerHTML = '❌ Wrong! No extra hints this time.';
    }

  }

  // ── Pokemon Name Quiz (standalone) ────────────────────────
  const NQ = { correct: 0, wrong: 0, lang: 'en', answerID: null, wrongIDs: [] };

  function openNameQuiz() {
    NQ.correct = 0;
    NQ.wrong = 0;
    updateNQScore();
    $('name-quiz-choices').innerHTML = '';
    $('name-quiz-desc').textContent = '';
    $('name-quiz-modal').classList.remove('hidden');
    loadNQRound();
  }

  function updateNQScore() {
    $('nq-correct').textContent = NQ.correct;
    $('nq-wrong').textContent = NQ.wrong;
  }

  function updateNQNextLabel() {
    $('name-quiz-next').textContent = NQ.lang === 'ko' ? '다음' : 'Next';
  }

  // New round: pick new Pokemon IDs then render
  async function loadNQRound() {
    NQ.answerID = randInt(1025) + 1;
    NQ.wrongIDs = [];
    const used = new Set([NQ.answerID]);
    while (NQ.wrongIDs.length < 3) {
      const id = randInt(1025) + 1;
      if (!used.has(id)) { used.add(id); NQ.wrongIDs.push(id); }
    }

    // Render image fresh
    $('name-quiz-pokemon').innerHTML = '';
    const img = document.createElement('img');
    img.src = `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${NQ.answerID}.png`;
    img.onerror = () => { img.src = `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${NQ.answerID}.png`; };
    $('name-quiz-pokemon').appendChild(img);

    await renderNQChoices();
  }

  // Render choices only (reuse current Pokemon IDs) — called on round load or lang switch
  async function renderNQChoices() {
    const nextBtn = $('name-quiz-next');
    nextBtn.classList.remove('visible');
    updateNQNextLabel();
    $('name-quiz-choices').innerHTML = '';
    $('name-quiz-desc').textContent = 'Loading...';

    try {
      const lang = NQ.lang;
      const ids = [NQ.answerID, ...NQ.wrongIDs];
      const names = await Promise.all(ids.map(id => fetchPokemonName(id, lang)));
      const choices = shuffleArr(names.map((name, i) => ({ name, correct: i === 0 })));

      const img = $('name-quiz-pokemon').querySelector('img');
      const choicesEl = $('name-quiz-choices');
      choicesEl.innerHTML = '';
      choices.forEach(({ name, correct }) => {
        const btn = document.createElement('button');
        btn.className = 'bonus-choice-name';
        btn.textContent = lang === 'en' ? capitalize(name) : name;
        btn.dataset.correct = correct ? 'true' : 'false';
        btn.addEventListener('click', () => handleNQAnswer(btn, correct, choicesEl, img));
        choicesEl.appendChild(btn);
      });

      $('name-quiz-desc').textContent = lang === 'ko' ? '이 포켓몬의 이름은?' : "What's this Pokémon's name?";

    } catch (e) {
      console.error(e);
      $('name-quiz-desc').textContent = 'Failed to load.';
      $('name-quiz-next').classList.add('visible');
    }
  }

  function handleNQAnswer(clickedBtn, correct, choicesEl, img) {
    choicesEl.querySelectorAll('.bonus-choice-name').forEach(b => {
      b.disabled = true;
      if (b.dataset.correct === 'true') b.classList.add('correct');
    });
    if (!correct) clickedBtn.classList.add('wrong');
    if (img) img.classList.add('revealed');

    if (correct) {
      NQ.correct++;
      $('name-quiz-desc').textContent = '🎉 ' + (NQ.lang === 'ko' ? '정답!' : 'Correct!');
    } else {
      NQ.wrong++;
      $('name-quiz-desc').textContent = '❌ ' + (NQ.lang === 'ko' ? '틀렸습니다!' : 'Wrong!');
    }
    updateNQScore();
    $('name-quiz-next').classList.add('visible');
  }

  // ── Hint ──────────────────────────────────────────────────
  function doHint() {
    if (GS.gameOver || GS.gameWon || GS.paused) return;
    if (GS.hintsLeft <= 0) {
      if (!GS.bonusHintUsed) showBonusHintQuiz();
      return;
    }
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
  async function showLeaderboard(diff) {
    const modal = $('leaderboard-modal');
    const list = $('leaderboard-list');
    diff = diff || 'easy';

    // Activate correct tab
    modal.querySelectorAll('.lb-tab').forEach(t =>
      t.classList.toggle('active', t.dataset.diff === diff)
    );

    modal.classList.remove('hidden');
    list.innerHTML = '<p class="lb-loading">Loading...</p>';
    try {
      const lb = window.FirebaseLeaderboard;
      if (!lb) { list.innerHTML = '<p class="lb-loading">Leaderboard unavailable.</p>'; return; }
      const scores = await lb.getTopScores(diff);
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
        return `<div class="leaderboard-row${rankClass}">
          ${medal}
          <span class="leaderboard-name">${escapeHtml(s.name)}</span>
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
        qualifies = await lb.qualifiesForTop10(elapsed, GS.difficulty);
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
    GS.bonusHintUsed = false;
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

  // ── Pokemon Coloring Game ────────────────────────────────
  const CG = {
    pokemonID: null,
    selectedColor: '#FF5252',
    brushSize: 3,
    canvasSize: 280,
    erasing: false,
    lastX: 0,
    lastY: 0,
    colorCtx: null,
    outlineCtx: null,
    painting: false,
    busy: false,
    history: [],
  };
  const CG_MAX_HISTORY = 20;
  const CG_PALETTE = [
    '#FF5252', '#FF9800', '#FFEB3B', '#4CAF50',
    '#2196F3', '#9C27B0', '#F06292', '#795548',
    '#00BCD4', '#8BC34A', '#FF5722', '#607D8B',
    '#E91E63', '#3F51B5', '#009688', '#FFC107',
    '#B0BEC5', '#CE93D8', '#A5D6A7', '#FFE0B2',
    '#000000',
  ];

  function openColoringGame() {
    $('coloring-modal').classList.remove('hidden');
    // Set canvas resolution based on actual display size (capped for performance)
    const wrap = document.querySelector('.cg-canvas-wrap');
    const displaySize = Math.round(wrap.clientWidth);
    const res = Math.min(420, Math.max(280, displaySize));
    const colorCanvas = $('cg-color-canvas');
    const outlineCanvas = $('cg-outline-canvas');
    colorCanvas.width = res;
    colorCanvas.height = res;
    outlineCanvas.width = res;
    outlineCanvas.height = res;
    CG.canvasSize = res;
    CG.colorCtx = colorCanvas.getContext('2d');
    CG.outlineCtx = outlineCanvas.getContext('2d');
    CG.history = [];
    renderCGPalette();
    loadCGRound();
    const cgMax = getMaxBrushSize(colorCanvas, CG.canvasSize);
    $('cg-brush-range').max = cgMax;
    if (CG.brushSize > cgMax) { CG.brushSize = cgMax; $('cg-brush-range').value = cgMax; $('cg-brush-label').textContent = cgMax; }
    updateBrushCursor(colorCanvas, CG.brushSize, CG.canvasSize);
  }

  function renderCGPalette() {
    const palette = $('cg-palette');
    palette.innerHTML = '';
    CG_PALETTE.forEach(hex => {
      const btn = document.createElement('button');
      btn.className = 'cg-swatch' + (hex === CG.selectedColor ? ' selected' : '');
      btn.style.background = hex;
      btn.dataset.color = hex;
      if (hex === '#FFFFFF') btn.style.border = '2px solid #ccc';
      btn.addEventListener('click', () => selectCGColor(hex));
      palette.appendChild(btn);
    });
  }

  function selectCGColor(color) {
    CG.selectedColor = color;
    CG.erasing = false;
    // Deactivate eraser button, re-activate last brush size button
    const eraserBtn = $('cg-eraser-btn');
    if (eraserBtn) eraserBtn.classList.remove('active');
    $('cg-palette').querySelectorAll('.cg-swatch').forEach(s => {
      s.classList.toggle('selected', s.dataset.color === color);
      if (s.dataset.color !== '#FFFFFF') s.style.border = '';
      if (s.dataset.color === '#FFFFFF') s.style.border = '3px solid #ccc';
      if (s.classList.contains('selected') && s.dataset.color === '#FFFFFF') {
        s.style.border = '3px solid #2980b9';
      }
    });
  }

  async function loadCGRound() {
    if (CG.busy) return;
    CG.busy = true;
    CG.history = [];
    const wrap = document.querySelector('.cg-canvas-wrap');
    wrap.classList.add('cg-loading');

    const id = Math.floor(Math.random() * 1025) + 1;
    CG.pokemonID = id;

    $('cg-pokemon-name').textContent = '...';

    const refImg = $('cg-ref-img');
    refImg.src = `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png`;
    refImg.onerror = () => {
      refImg.src = `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${id}.png`;
    };

    try {
      await processImageToOutline(id);
    } catch (e) {
      console.error('Coloring outline failed:', e);
    }

    // Fetch and display pokemon name (don't block on failure)
    fetchPokemonName(id, 'en').then(name => {
      $('cg-pokemon-name').textContent = name ? name.charAt(0).toUpperCase() + name.slice(1) : `#${id}`;
    }).catch(() => {
      $('cg-pokemon-name').textContent = `#${id}`;
    });

    wrap.classList.remove('cg-loading');
    CG.busy = false;
  }

  // Shared outline generator — returns { srcImageData } for optional further use (FBC)
  function applyOutline(img, outlineCtx, colorCtx, SIZE) {
    const PAD = 12;
    const off = document.createElement('canvas');
    off.width = SIZE;
    off.height = SIZE;
    const ctx = off.getContext('2d');

    const scale = Math.min((SIZE - PAD * 2) / img.width, (SIZE - PAD * 2) / img.height);
    const dw = img.width * scale;
    const dh = img.height * scale;
    const dx = (SIZE - dw) / 2;
    const dy = (SIZE - dh) / 2;
    ctx.drawImage(img, dx, dy, dw, dh);

    const src = ctx.getImageData(0, 0, SIZE, SIZE);
    const s = src.data;
    const dst = ctx.createImageData(SIZE, SIZE);
    const d = dst.data;
    const N = SIZE * SIZE;

    const EDGE_THRESH = 48;
    const edge = new Uint8Array(N);
    const dirs4dx = [1, 0, -1, 0];
    const dirs4dy = [0, 1, 0, -1];

    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const idx = y * SIZE + x;
        const a0 = s[idx * 4 + 3];
        if (a0 < 10) continue;
        const r0 = s[idx * 4], g0 = s[idx * 4 + 1], b0 = s[idx * 4 + 2];
        let isAlpha = false;
        for (let dd = 0; dd < 4; dd++) {
          const nx = x + dirs4dx[dd], ny = y + dirs4dy[dd];
          if (nx < 0 || nx >= SIZE || ny < 0 || ny >= SIZE ||
              s[(ny * SIZE + nx) * 4 + 3] < 10) {
            isAlpha = true; break;
          }
        }
        if (isAlpha) { edge[idx] = 1; continue; }
        for (let dd = 0; dd < 4; dd++) {
          const nx = x + dirs4dx[dd], ny = y + dirs4dy[dd];
          if (nx < 0 || nx >= SIZE || ny < 0 || ny >= SIZE) continue;
          const ni = ny * SIZE + nx;
          if (s[ni * 4 + 3] < 10) continue;
          const dr = r0 - s[ni * 4];
          const dg = g0 - s[ni * 4 + 1];
          const db = b0 - s[ni * 4 + 2];
          const dist = Math.sqrt(dr * dr + dg * dg + db * db);
          if (dist > EDGE_THRESH) { edge[idx] = 1; break; }
        }
      }
    }

    const dirs8 = [-SIZE - 1, -SIZE, -SIZE + 1, -1, 1, SIZE - 1, SIZE, SIZE + 1];
    const clean = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      if (!edge[i]) continue;
      let neighbors = 0;
      for (let di = 0; di < 8; di++) {
        const ni = i + dirs8[di];
        if (ni >= 0 && ni < N && edge[ni]) neighbors++;
      }
      clean[i] = (neighbors >= 1) ? 1 : 0;
    }

    for (let i = 0; i < N; i++) {
      if (clean[i]) {
        d[i * 4] = 0; d[i * 4 + 1] = 0; d[i * 4 + 2] = 0; d[i * 4 + 3] = 255;
      }
    }

    outlineCtx.clearRect(0, 0, SIZE, SIZE);
    outlineCtx.putImageData(dst, 0, 0);

    colorCtx.fillStyle = 'white';
    colorCtx.fillRect(0, 0, SIZE, SIZE);

    return { srcImageData: src };
  }

  function processImageToOutline(id) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        applyOutline(img, CG.outlineCtx, CG.colorCtx, CG.canvasSize || 280);
        resolve();
      };
      img.onerror = () => {
        const fallback = new Image();
        fallback.crossOrigin = 'anonymous';
        fallback.onload = () => {
          applyOutline(fallback, CG.outlineCtx, CG.colorCtx, CG.canvasSize || 280);
          resolve();
        };
        fallback.onerror = reject;
        fallback.src = `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${id}.png`;
      };
      img.src = `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png`;
    });
  }

  // ── Custom brush cursor (shared by CG & FBC) ──
  function getMaxBrushSize(canvas, canvasSize) {
    const rect = canvas.getBoundingClientRect();
    const displayScale = rect.width / canvasSize;
    return Math.floor(63 / displayScale);
  }

  function updateBrushCursor(canvas, brushSize, canvasSize) {
    const rect = canvas.getBoundingClientRect();
    const displayScale = rect.width / canvasSize;
    const diameter = Math.max(4, Math.round(brushSize * 2 * displayScale));
    const r = diameter / 2;
    const size = diameter + 2;
    const half = size / 2;
    const svgCircle = `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}'><circle cx='${half}' cy='${half}' r='${r}' fill='none' stroke='black' stroke-width='1'/><circle cx='${half}' cy='${half}' r='${r}' fill='none' stroke='white' stroke-width='0.5'/></svg>`;
    const encoded = 'data:image/svg+xml;base64,' + btoa(svgCircle);
    canvas.style.cursor = `url("${encoded}") ${half} ${half}, crosshair`;
  }

  function getCGCoords(e) {
    const canvas = $('cg-color-canvas');
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const clientX = e.clientX ?? (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
    const clientY = e.clientY ?? (e.touches && e.touches[0] ? e.touches[0].clientY : 0);
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    };
  }

  function paintStroke(x0, y0, x1, y1) {
    const ctx = CG.colorCtx;
    const color = CG.erasing ? '#FFFFFF' : CG.selectedColor;
    const r = CG.brushSize;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = r * 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }

  function paintDot(x, y) {
    const ctx = CG.colorCtx;
    ctx.beginPath();
    ctx.arc(x, y, CG.brushSize, 0, Math.PI * 2);
    ctx.fillStyle = CG.erasing ? '#FFFFFF' : CG.selectedColor;
    ctx.fill();
  }

  function onBrushDown(e) {
    e.preventDefault();
    // Save snapshot for undo
    const cSize = CG.canvasSize || 280;
    const snap = CG.colorCtx.getImageData(0, 0, cSize, cSize);
    CG.history.push(new ImageData(new Uint8ClampedArray(snap.data), snap.width, snap.height));
    if (CG.history.length > CG_MAX_HISTORY) CG.history.shift();
    CG.painting = true;
    const { x, y } = getCGCoords(e);
    CG.lastX = x;
    CG.lastY = y;
    paintDot(x, y);
  }

  function onBrushMove(e) {
    if (!CG.painting) return;
    e.preventDefault();
    const { x, y } = getCGCoords(e);
    paintStroke(CG.lastX, CG.lastY, x, y);
    CG.lastX = x;
    CG.lastY = y;
  }

  function onBrushUp() {
    CG.painting = false;
  }

  function clearCanvas() {
    CG.colorCtx.fillStyle = 'white';
    CG.colorCtx.fillRect(0, 0, CG.canvasSize || 280, CG.canvasSize || 280);
    CG.history = [];
  }

  function undoCG() {
    if (CG.history.length === 0) return;
    const snap = CG.history.pop();
    CG.colorCtx.putImageData(snap, 0, 0);
  }

  // Wire coloring canvas events
  const cgColorCanvas = $('cg-color-canvas');
  cgColorCanvas.addEventListener('pointerdown', onBrushDown);
  cgColorCanvas.addEventListener('pointermove', onBrushMove);
  cgColorCanvas.addEventListener('pointerup', onBrushUp);
  cgColorCanvas.addEventListener('pointercancel', onBrushUp);

  // CG brush range slider
  const cgBrushRange = $('cg-brush-range');
  const cgBrushLabel = $('cg-brush-label');
  cgBrushRange.addEventListener('input', () => {
    CG.brushSize = parseInt(cgBrushRange.value);
    cgBrushLabel.textContent = cgBrushRange.value;
    CG.erasing = false;
    $('cg-eraser-btn').classList.remove('active');
    updateBrushCursor($('cg-color-canvas'), CG.brushSize, CG.canvasSize);
  });
  $('cg-eraser-btn').addEventListener('click', () => {
    CG.erasing = !CG.erasing;
    $('cg-eraser-btn').classList.toggle('active', CG.erasing);
    updateBrushCursor($('cg-color-canvas'), CG.brushSize, CG.canvasSize);
  });

  $('coloring-btn').addEventListener('click', openColoringGame);
  $('coloring-close').addEventListener('click', () => $('coloring-modal').classList.add('hidden'));
  $('cg-next-btn').addEventListener('click', loadCGRound);
  $('cg-clear-btn').addEventListener('click', clearCanvas);
  $('cg-undo-btn').addEventListener('click', undoCG);

  // ── Fill by Color Game ─────────────────────────────────────
  const FBC = {
    pokemonID: null,
    canvasSize: 280,
    colorCtx: null,
    outlineCtx: null,
    painting: false,
    busy: false,
    lastX: 0, lastY: 0,
    brushSize: 7,
    erasing: false,
    selectedColorIdx: -1,
    quantizedPalette: [],
    colorMap: null,
    filledMask: null,
    canvasImageData: null,
    history: [],
    pixelsPerColor: [],
    filledPerColor: [],
    completedShown: false,
  };
  const FBC_MAX_HISTORY = 20;

  function openFBCGame() {
    $('fbc-modal').classList.remove('hidden');
    const wrap = document.querySelector('.fbc-canvas-wrap');
    const displaySize = Math.round(wrap.clientWidth);
    const res = Math.min(420, Math.max(280, displaySize));
    const colorCanvas = $('fbc-color-canvas');
    const outlineCanvas = $('fbc-outline-canvas');
    colorCanvas.width = res;
    colorCanvas.height = res;
    outlineCanvas.width = res;
    outlineCanvas.height = res;
    FBC.canvasSize = res;
    FBC.colorCtx = colorCanvas.getContext('2d');
    FBC.outlineCtx = outlineCanvas.getContext('2d');
    FBC.history = [];
    loadFBCRound();
    const fbcMax = getMaxBrushSize(colorCanvas, FBC.canvasSize);
    $('fbc-brush-range').max = fbcMax;
    if (FBC.brushSize > fbcMax) { FBC.brushSize = fbcMax; $('fbc-brush-range').value = fbcMax; $('fbc-brush-label').textContent = fbcMax; }
    updateBrushCursor(colorCanvas, FBC.brushSize, FBC.canvasSize);
  }

  async function loadFBCRound() {
    if (FBC.busy) return;
    FBC.busy = true;
    FBC.history = [];
    FBC.selectedColorIdx = -1;
    FBC.erasing = false;
    FBC.completedShown = false;

    const wrap = document.querySelector('.fbc-canvas-wrap');
    wrap.classList.add('fbc-loading');

    const id = Math.floor(Math.random() * 1025) + 1;
    FBC.pokemonID = id;
    $('fbc-pokemon-name').textContent = '...';

    const refImg = $('fbc-ref-img');
    refImg.src = `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png`;
    refImg.onerror = () => {
      refImg.src = `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${id}.png`;
    };

    try {
      await processFBCImage(id);
    } catch (e) {
      console.error('FBC image processing failed:', e);
    }

    fetchPokemonName(id, 'en').then(name => {
      $('fbc-pokemon-name').textContent = name ? name.charAt(0).toUpperCase() + name.slice(1) : `#${id}`;
    }).catch(() => {
      $('fbc-pokemon-name').textContent = `#${id}`;
    });

    wrap.classList.remove('fbc-loading');
    FBC.busy = false;
  }

  function processFBCImage(id) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => { finishFBCProcess(img); resolve(); };
      img.onerror = () => {
        const fallback = new Image();
        fallback.crossOrigin = 'anonymous';
        fallback.onload = () => { finishFBCProcess(fallback); resolve(); };
        fallback.onerror = reject;
        fallback.src = `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${id}.png`;
      };
      img.src = `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png`;
    });
  }

  function finishFBCProcess(img) {
    const SIZE = FBC.canvasSize;
    const { srcImageData } = applyOutline(img, FBC.outlineCtx, FBC.colorCtx, SIZE);
    const palette = medianCut(srcImageData, 20);
    const merged = mergeSimilarColors(palette, 25);
    const { colorMap, pixelsPerColor } = buildColorMap(srcImageData, merged, SIZE);
    FBC.colorMap = colorMap;

    // Region-based cleanup: find same-color connected components,
    // remove colors that have NO region >= MIN_VISIBLE pixels,
    // and remove individual tiny same-color patches.
    const MIN_VISIBLE = 200;
    const hasVisibleRegion = new Uint8Array(merged.length);
    {
      const visited = new Uint8Array(SIZE * SIZE);
      const dirs = [1, -1, SIZE, -SIZE];
      for (let i = 0; i < SIZE * SIZE; i++) {
        if (visited[i] || colorMap[i] === 255) continue;
        const ci = colorMap[i];
        const queue = [i];
        visited[i] = 1;
        let head = 0;
        while (head < queue.length) {
          const p = queue[head++];
          for (let d = 0; d < 4; d++) {
            const np = p + dirs[d];
            if (np < 0 || np >= SIZE * SIZE) continue;
            if (dirs[d] === 1 && (p % SIZE) === SIZE - 1) continue;
            if (dirs[d] === -1 && (p % SIZE) === 0) continue;
            if (visited[np] || colorMap[np] !== ci) continue;
            visited[np] = 1;
            queue.push(np);
          }
        }
        if (queue.length >= MIN_VISIBLE) {
          hasVisibleRegion[ci] = 1;
        } else {
          // Tiny same-color patch: mark unpaintable
          for (let j = 0; j < queue.length; j++) {
            pixelsPerColor[colorMap[queue[j]]]--;
            colorMap[queue[j]] = 255;
          }
        }
      }
    }
    // Remove colors with no visible region at all
    for (let ci = 0; ci < merged.length; ci++) {
      if (!hasVisibleRegion[ci] && pixelsPerColor[ci] > 0) {
        for (let i = 0; i < SIZE * SIZE; i++) {
          if (colorMap[i] === ci) colorMap[i] = 255;
        }
        pixelsPerColor[ci] = 0;
      }
    }

    // Compact palette: remove zero-pixel colors, remap colorMap
    const kept = [];
    const remap = new Array(merged.length).fill(255);
    for (let ci = 0; ci < merged.length; ci++) {
      if (pixelsPerColor[ci] > 0) {
        remap[ci] = kept.length;
        kept.push({ color: merged[ci], pixels: pixelsPerColor[ci] });
      }
    }
    for (let i = 0; i < SIZE * SIZE; i++) {
      if (colorMap[i] !== 255) colorMap[i] = remap[colorMap[i]];
    }
    FBC.quantizedPalette = kept.map(k => k.color);
    FBC.pixelsPerColor = kept.map(k => k.pixels);
    FBC.filledPerColor = new Array(FBC.quantizedPalette.length).fill(0);
    FBC.filledMask = new Uint8Array(SIZE * SIZE);

    FBC.canvasImageData = FBC.colorCtx.getImageData(0, 0, SIZE, SIZE);
    // Save outline image before drawing numbers (for later redraw)
    FBC.outlineImageData = FBC.outlineCtx.getImageData(0, 0, SIZE, SIZE);
    const { regions, regionMap } = findColorRegions(FBC.colorMap, FBC.canvasSize);
    FBC.regions = regions;
    FBC.regionMap = regionMap;
    FBC.filledPerRegion = new Array(regions.length).fill(0);
    renderFBCPalette();
    drawFBCNumbers();
    // Auto-select first color
    if (FBC.quantizedPalette.length > 0) selectFBCColor(0);
    updateFBCSwatches();
  }

  // ── Median Cut Color Quantization ──
  function medianCut(imageData, targetCount) {
    const s = imageData.data;
    const N = imageData.width * imageData.height;
    const pixels = [];
    for (let i = 0; i < N; i++) {
      if (s[i * 4 + 3] > 20) {
        const pr = s[i * 4], pg = s[i * 4 + 1], pb = s[i * 4 + 2];
        // Exclude near-black (outline edges) and near-white from quantization
        if (pr < 30 && pg < 30 && pb < 30) continue;
        if (pr > 230 && pg > 230 && pb > 230) continue;
        pixels.push([pr, pg, pb]);
      }
    }
    if (pixels.length === 0) return [{ r: 128, g: 128, b: 128, hex: '#808080' }];

    let buckets = [pixels];
    while (buckets.length < targetCount) {
      // Find bucket with largest range
      let bestIdx = 0, bestRange = -1, bestChannel = 0;
      for (let bi = 0; bi < buckets.length; bi++) {
        const b = buckets[bi];
        if (b.length < 2) continue;
        for (let ch = 0; ch < 3; ch++) {
          let mn = 255, mx = 0;
          for (let pi = 0; pi < b.length; pi++) {
            if (b[pi][ch] < mn) mn = b[pi][ch];
            if (b[pi][ch] > mx) mx = b[pi][ch];
          }
          const range = mx - mn;
          if (range > bestRange) { bestRange = range; bestIdx = bi; bestChannel = ch; }
        }
      }
      if (bestRange <= 0) break;
      const bucket = buckets[bestIdx];
      bucket.sort((a, b) => a[bestChannel] - b[bestChannel]);
      const mid = Math.floor(bucket.length / 2);
      buckets.splice(bestIdx, 1, bucket.slice(0, mid), bucket.slice(mid));
    }

    return buckets.map(b => {
      // Use median pixel (after sorting by luminance) for more representative color
      b.sort((a, c) => (a[0] * 299 + a[1] * 587 + a[2] * 114) - (c[0] * 299 + c[1] * 587 + c[2] * 114));
      const mid = b[Math.floor(b.length / 2)];
      const r = mid[0], g = mid[1], bl = mid[2];
      return { r, g, b: bl, hex: '#' + ((1 << 24) + (r << 16) + (g << 8) + bl).toString(16).slice(1) };
    });
  }

  function mergeSimilarColors(palette, threshold) {
    const merged = [...palette];
    // Remove white/near-white and black/near-black colors
    // (white needs no painting; black is usually outline edges, not actual fill area)
    for (let i = merged.length - 1; i >= 0; i--) {
      const c = merged[i];
      if ((c.r > 230 && c.g > 230 && c.b > 230) ||
          (c.r < 30 && c.g < 30 && c.b < 30)) {
        merged.splice(i, 1);
        continue;
      }
    }
    for (let i = merged.length - 1; i >= 0; i--) {
      for (let j = 0; j < i; j++) {
        const dr = merged[i].r - merged[j].r;
        const dg = merged[i].g - merged[j].g;
        const db = merged[i].b - merged[j].b;
        if (Math.sqrt(dr * dr + dg * dg + db * db) < threshold) {
          merged.splice(i, 1);
          break;
        }
      }
    }
    return merged;
  }

  function buildColorMap(imageData, palette, SIZE) {
    const s = imageData.data;
    const N = SIZE * SIZE;
    const colorMap = new Uint8Array(N);
    colorMap.fill(255);
    const pixelsPerColor = new Array(palette.length).fill(0);

    for (let i = 0; i < N; i++) {
      if (s[i * 4 + 3] <= 20) continue;
      const r = s[i * 4], g = s[i * 4 + 1], b = s[i * 4 + 2];
      // Skip white/near-white and black/near-black pixels (outlines, edges)
      if (r > 230 && g > 230 && b > 230) continue;
      if (r < 30 && g < 30 && b < 30) continue;
      let bestDist = Infinity, bestIdx = 0;
      for (let ci = 0; ci < palette.length; ci++) {
        const dr = r - palette[ci].r;
        const dg = g - palette[ci].g;
        const db = b - palette[ci].b;
        const dist = dr * dr + dg * dg + db * db;
        if (dist < bestDist) { bestDist = dist; bestIdx = ci; }
      }
      colorMap[i] = bestIdx;
      pixelsPerColor[bestIdx]++;
    }

    // Remove tiny paintable regions — flood-fill ANY paintable neighbor (color-agnostic)
    // so narrow crevices between outlines are treated as one small region and removed.
    const MIN_REGION = 150;
    const visited = new Uint8Array(N);
    const dx4 = [1, -1, SIZE, -SIZE];
    for (let i = 0; i < N; i++) {
      if (visited[i] || colorMap[i] === 255) continue;
      const queue = [i];
      const region = [];
      visited[i] = 1;
      while (queue.length > 0) {
        const cur = queue.pop();
        region.push(cur);
        for (let d = 0; d < 4; d++) {
          const ni = cur + dx4[d];
          if (d === 0 && (cur % SIZE) === SIZE - 1) continue;
          if (d === 1 && (cur % SIZE) === 0) continue;
          if (ni < 0 || ni >= N || visited[ni]) continue;
          if (colorMap[ni] !== 255) {
            visited[ni] = 1;
            queue.push(ni);
          }
        }
      }
      if (region.length < MIN_REGION) {
        for (let ri = 0; ri < region.length; ri++) {
          const ci = colorMap[region[ri]];
          pixelsPerColor[ci]--;
          colorMap[region[ri]] = 255;
        }
      }
    }

    return { colorMap, pixelsPerColor };
  }

  function renderFBCPalette() {
    const pal = $('fbc-palette');
    pal.innerHTML = '';
    FBC.quantizedPalette.forEach((c, idx) => {
      const btn = document.createElement('button');
      btn.className = 'fbc-swatch' + (idx === FBC.selectedColorIdx ? ' selected' : '');
      btn.style.background = c.hex;
      btn.dataset.idx = idx;
      btn.addEventListener('click', () => selectFBCColor(idx));
      const label = document.createElement('span');
      label.className = 'fbc-swatch-num';
      label.textContent = idx + 1;
      btn.appendChild(label);
      pal.appendChild(btn);
    });
  }

  function findColorRegions(colorMap, SIZE) {
    // regionMap: pixel index → region index (0xFFFF = none)
    const regionMap = new Uint16Array(SIZE * SIZE);
    regionMap.fill(0xFFFF);
    const regions = [];
    const dirs = [1, -1, SIZE, -SIZE];
    for (let i = 0; i < SIZE * SIZE; i++) {
      if (regionMap[i] !== 0xFFFF || colorMap[i] === 255) continue;
      const ci = colorMap[i];
      const queue = [i];
      regionMap[i] = regions.length; // tentative
      let sumX = 0, sumY = 0, count = 0;
      let head = 0;
      while (head < queue.length) {
        const p = queue[head++];
        const px = p % SIZE, py = (p - px) / SIZE;
        sumX += px; sumY += py; count++;
        for (let d = 0; d < 4; d++) {
          const np = p + dirs[d];
          if (np < 0 || np >= SIZE * SIZE) continue;
          if (dirs[d] === 1 && (p % SIZE) === SIZE - 1) continue;
          if (dirs[d] === -1 && (p % SIZE) === 0) continue;
          if (regionMap[np] !== 0xFFFF || colorMap[np] !== ci) continue;
          regionMap[np] = regions.length;
          queue.push(np);
        }
      }
      if (count >= 200) {
        regions.push({ colorIdx: ci, cx: Math.round(sumX / count), cy: Math.round(sumY / count), size: count });
      } else {
        // Too small — clear regionMap for these pixels
        for (let j = 0; j < queue.length; j++) regionMap[queue[j]] = 0xFFFF;
      }
    }
    return { regions, regionMap };
  }

  function drawFBCNumbers() {
    // Restore clean outline first
    if (FBC.outlineImageData) {
      FBC.outlineCtx.putImageData(FBC.outlineImageData, 0, 0);
    }
    const regions = FBC.regions || [];
    const filledPerRegion = FBC.filledPerRegion || [];
    const ctx = FBC.outlineCtx;
    regions.forEach((r, ri) => {
      // Skip if this individual region is fully painted
      if (filledPerRegion[ri] >= r.size) return;
      const num = String(r.colorIdx + 1);
      const fontSize = Math.max(8, Math.min(16, Math.sqrt(r.size) / 4));
      ctx.font = `bold ${fontSize}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      // white background circle
      ctx.beginPath();
      ctx.arc(r.cx, r.cy, fontSize * 0.7, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fill();
      // number
      ctx.fillStyle = '#333';
      ctx.fillText(num, r.cx, r.cy);
    });
  }

  function selectFBCColor(idx) {
    FBC.selectedColorIdx = idx;
    FBC.erasing = false;
    const eraserBtn = $('fbc-eraser-btn');
    if (eraserBtn) eraserBtn.classList.remove('active');
    // Re-activate last brush size btn if eraser was active
    document.querySelectorAll('.fbc-brush-btn').forEach(b => {
      if (b.id === 'fbc-eraser-btn') return;
      // keep current active size
    });
    $('fbc-palette').querySelectorAll('.fbc-swatch').forEach(s => {
      s.classList.toggle('selected', parseInt(s.dataset.idx) === idx);
    });
  }

  function fbcPaintPixels(cx, cy, radius) {
    const data = FBC.canvasImageData.data;
    const SIZE = FBC.canvasSize;
    const cm = FBC.colorMap;
    const fm = FBC.filledMask;
    const r2 = radius * radius;
    const selIdx = FBC.selectedColorIdx;
    const selColor = FBC.quantizedPalette[selIdx];

    const xMin = Math.max(0, Math.floor(cx - radius));
    const xMax = Math.min(SIZE - 1, Math.ceil(cx + radius));
    const yMin = Math.max(0, Math.floor(cy - radius));
    const yMax = Math.min(SIZE - 1, Math.ceil(cy + radius));

    for (let py = yMin; py <= yMax; py++) {
      for (let px = xMin; px <= xMax; px++) {
        const ddx = px - cx, ddy = py - cy;
        if (ddx * ddx + ddy * ddy > r2) continue;
        const idx = py * SIZE + px;
        if (cm[idx] === 255) continue;

        const pi = idx * 4;
        if (FBC.erasing) {
          data[pi] = 255; data[pi + 1] = 255; data[pi + 2] = 255; data[pi + 3] = 255;
          if (fm[idx] === 1) {
            fm[idx] = 0; FBC.filledPerColor[cm[idx]]--;
            const ri = FBC.regionMap[idx];
            if (ri !== 0xFFFF) FBC.filledPerRegion[ri]--;
          }
        } else if (cm[idx] === selIdx) {
          data[pi] = selColor.r; data[pi + 1] = selColor.g; data[pi + 2] = selColor.b; data[pi + 3] = 255;
          if (fm[idx] === 0) {
            fm[idx] = 1; FBC.filledPerColor[cm[idx]]++;
            const ri = FBC.regionMap[idx];
            if (ri !== 0xFFFF) FBC.filledPerRegion[ri]++;
          }
        }
      }
    }
    FBC.colorCtx.putImageData(FBC.canvasImageData, 0, 0);
  }

  function getFBCCoords(e) {
    const canvas = $('fbc-color-canvas');
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const clientX = e.clientX ?? (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
    const clientY = e.clientY ?? (e.touches && e.touches[0] ? e.touches[0].clientY : 0);
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    };
  }

  function onFBCDown(e) {
    if (!FBC.erasing && FBC.selectedColorIdx < 0) return;
    e.preventDefault();
    // Save undo snapshot
    const SIZE = FBC.canvasSize;
    const snap = FBC.colorCtx.getImageData(0, 0, SIZE, SIZE);
    const maskSnap = new Uint8Array(FBC.filledMask);
    const filledSnap = [...FBC.filledPerColor];
    const regionSnap = [...FBC.filledPerRegion];
    FBC.history.push({ imageData: new ImageData(new Uint8ClampedArray(snap.data), snap.width, snap.height), mask: maskSnap, filled: filledSnap, filledRegion: regionSnap });
    if (FBC.history.length > FBC_MAX_HISTORY) FBC.history.shift();

    FBC.painting = true;
    const { x, y } = getFBCCoords(e);
    FBC.lastX = x;
    FBC.lastY = y;
    fbcPaintPixels(x, y, FBC.brushSize);
  }

  function onFBCMove(e) {
    if (!FBC.painting) return;
    e.preventDefault();
    const { x, y } = getFBCCoords(e);
    // Linear interpolation for smooth strokes
    const dx = x - FBC.lastX;
    const dy = y - FBC.lastY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const steps = Math.max(1, Math.floor(dist));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      fbcPaintPixels(FBC.lastX + dx * t, FBC.lastY + dy * t, FBC.brushSize);
    }
    FBC.lastX = x;
    FBC.lastY = y;
  }

  function onFBCUp() {
    if (!FBC.painting) return;
    FBC.painting = false;
    updateFBCSwatches();
  }

  function updateFBCSwatches() {
    let totalPixels = 0, totalFilled = 0;
    $('fbc-palette').querySelectorAll('.fbc-swatch').forEach(s => {
      const ci = parseInt(s.dataset.idx);
      const total = FBC.pixelsPerColor[ci] || 0;
      const filled = FBC.filledPerColor[ci] || 0;
      totalPixels += total;
      totalFilled += filled;
      s.classList.toggle('completed', total > 0 && filled >= total);
    });
    // Redraw numbers (hides individually completed regions)
    drawFBCNumbers();
    // Overall completion — show once only
    if (totalPixels > 0 && totalFilled >= totalPixels * 0.99 && !FBC.completedShown) {
      FBC.completedShown = true;
      const wrap = document.querySelector('.fbc-canvas-wrap');
      const overlay = document.createElement('div');
      overlay.className = 'fbc-complete-overlay';
      overlay.innerHTML = '<span>Complete!</span>';
      overlay.addEventListener('click', () => overlay.remove());
      wrap.appendChild(overlay);
    }
  }

  function clearFBC() {
    const SIZE = FBC.canvasSize;
    FBC.colorCtx.fillStyle = 'white';
    FBC.colorCtx.fillRect(0, 0, SIZE, SIZE);
    FBC.canvasImageData = FBC.colorCtx.getImageData(0, 0, SIZE, SIZE);
    FBC.filledMask = new Uint8Array(SIZE * SIZE);
    FBC.filledPerColor = new Array(FBC.quantizedPalette.length).fill(0);
    FBC.filledPerRegion = new Array((FBC.regions || []).length).fill(0);
    FBC.history = [];
    FBC.completedShown = false;
    const wrap = document.querySelector('.fbc-canvas-wrap');
    const overlay = wrap.querySelector('.fbc-complete-overlay');
    if (overlay) overlay.remove();
    // Redraw all numbers
    drawFBCNumbers();
    updateFBCSwatches();
  }

  function undoFBC() {
    if (FBC.history.length === 0) return;
    const snap = FBC.history.pop();
    FBC.colorCtx.putImageData(snap.imageData, 0, 0);
    FBC.canvasImageData = FBC.colorCtx.getImageData(0, 0, FBC.canvasSize, FBC.canvasSize);
    FBC.filledMask = snap.mask;
    FBC.filledPerColor = snap.filled;
    FBC.filledPerRegion = snap.filledRegion || new Array((FBC.regions || []).length).fill(0);
    updateFBCSwatches();
  }

  // Wire FBC canvas events
  const fbcColorCanvas = $('fbc-color-canvas');
  fbcColorCanvas.addEventListener('pointerdown', onFBCDown);
  fbcColorCanvas.addEventListener('pointermove', onFBCMove);
  fbcColorCanvas.addEventListener('pointerup', onFBCUp);
  fbcColorCanvas.addEventListener('pointercancel', onFBCUp);

  // FBC brush range slider
  const fbcBrushRange = $('fbc-brush-range');
  const fbcBrushLabel = $('fbc-brush-label');
  fbcBrushRange.addEventListener('input', () => {
    FBC.brushSize = parseInt(fbcBrushRange.value);
    fbcBrushLabel.textContent = fbcBrushRange.value;
    FBC.erasing = false;
    $('fbc-eraser-btn').classList.remove('active');
    updateBrushCursor($('fbc-color-canvas'), FBC.brushSize, FBC.canvasSize);
  });
  $('fbc-eraser-btn').addEventListener('click', () => {
    FBC.erasing = !FBC.erasing;
    $('fbc-eraser-btn').classList.toggle('active', FBC.erasing);
    updateBrushCursor($('fbc-color-canvas'), FBC.brushSize, FBC.canvasSize);
  });

  $('fill-color-btn').addEventListener('click', openFBCGame);
  $('fbc-close').addEventListener('click', () => $('fbc-modal').classList.add('hidden'));
  $('fbc-next-btn').addEventListener('click', loadFBCRound);
  $('fbc-clear-btn').addEventListener('click', clearFBC);
  $('fbc-undo-btn').addEventListener('click', undoFBC);

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

  $('bonus-hint-close').addEventListener('click', () => $('bonus-hint-modal').classList.add('hidden'));

  $('name-quiz-btn').addEventListener('click', openNameQuiz);
  $('name-quiz-close').addEventListener('click', () => $('name-quiz-modal').classList.add('hidden'));
  $('name-quiz-next').addEventListener('click', loadNQRound);
  document.querySelectorAll('.nq-lang-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (NQ.lang === btn.dataset.lang) return;
      NQ.lang = btn.dataset.lang;
      document.querySelectorAll('.nq-lang-btn').forEach(b => b.classList.toggle('active', b === btn));
      if (NQ.answerID) renderNQChoices(); else updateNQNextLabel();
    });
  });

  $('records-btn').addEventListener('click', () => showLeaderboard('easy'));
  $('leaderboard-close').addEventListener('click', () => $('leaderboard-modal').classList.add('hidden'));
  document.querySelectorAll('.lb-tab').forEach(tab => {
    tab.addEventListener('click', () => showLeaderboard(tab.dataset.diff));
  });

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
