// ─────────────────────────────────────────────────────────────────────────────
// SHARED GRID CORE
// Foundation for both the solo editor and collab grids.
// Grid construction and refresh live here. Interaction (drag-select vs WS
// broadcast) is injected by each tab via callbacks so there's no duplication.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build piano key strips into `el`.
 * @param {HTMLElement}   el       - container element
 * @param {Function|null} onClick  - (midi) => void, or null for display-only
 */
function buildPianoKeys(el, onClick, labelFn) {
  // labelFn(midi) → {text, title} — overrides default note name display
  el.innerHTML = '';
  NOTES.forEach(midi => {
    const key = document.createElement('div');
    if (labelFn) {
      const lbl = labelFn(midi);
      key.className = 'key white drum-key';
      key.textContent = lbl.text;
      key.title = lbl.title;
    } else {
      key.className = `key ${isBlack(midi) ? 'black' : 'white'}${midi % 12 === 0 ? ' c' : ''}`;
      key.textContent = midi % 12 === 0 ? noteName(midi) : '';
      key.title = noteName(midi);
    }
    key.dataset.midi = midi;
    if (onClick) key.addEventListener('click', () => onClick(midi));
    el.appendChild(key);
  });
}

/**
 * Build note grid rows + cells into `innerEl`, populate `cellMap`.
 * @param {HTMLElement} innerEl    - the .ed-roll-inner div
 * @param {number}      steps      - total step count
 * @param {number}      spb        - steps per bar (for bar-start/beat-start CSS)
 * @param {Map}         cellMap    - cleared + repopulated: 'row-step' → cell
 * @param {HTMLElement} playheadEl - grid rows are inserted before this element
 * @param {Function}    onCell     - (cell, midi, step, row) => void — attach listeners here
 */
function buildNoteGrid(innerEl, steps, spb, cellMap, playheadEl, onCell) {
  cellMap.clear();
  innerEl.querySelectorAll('.ed-row').forEach(r => r.remove());
  const frag = document.createDocumentFragment();
  NOTES.forEach((midi, row) => {
    const rowEl = document.createElement('div');
    rowEl.className = `ed-row${isBlack(midi) ? ' is-black' : ''}`;
    for (let s = 0; s < steps; s++) {
      const cell = document.createElement('div');
      const cls  = s % spb === 0 ? 'bar-start' : (s % Math.max(1, Math.round(spb / 2)) === 0 ? 'beat-start' : '');
      cell.className = 'ed-cell' + (cls ? ' ' + cls : '');
      cell.dataset.row  = row;
      cell.dataset.step = s;
      cell.dataset.midi = midi;
      if (onCell) onCell(cell, midi, s, row);
      cellMap.set(`${row}-${s}`, cell);
      rowEl.appendChild(cell);
    }
    frag.appendChild(rowEl);
  });
  innerEl.insertBefore(frag, playheadEl);
}

/**
 * Refresh the visual state of a note grid — clear ed-on, repaint from notes.
 * @param {Array}    notes    - note objects
 * @param {Map}      cellMap  - 'row-step' → cell
 * @param {Function} layerFn  - (note) => number — CSS data-layer value for coloring
 */
function refreshNoteGrid(notes, cellMap, layerFn) {
  cellMap.forEach(cell => {
    cell.classList.remove('ed-on');
    delete cell.dataset.layer;
    cell.style.background = '';
  });

  // separate: short notes (dur==1) get cell background; long notes (dur>1) get overlay only
  const shortLayers = new Map(); // key → [layer, ...]
  const longKeys    = new Set(); // keys covered by any dur>1 note

  notes.forEach(n => {
    const row = edRowMap.get(n.note);
    if (row == null) return;
    const layer = layerFn ? layerFn(n) : 0;
    const dur   = n.duration || 1;
    for (let d = 0; d < dur; d++) {
      const key = `${row}-${n.step + d}`;
      if (dur === 1) {
        if (!shortLayers.has(key)) shortLayers.set(key, []);
        if (!shortLayers.get(key).includes(layer)) shortLayers.get(key).push(layer);
      } else {
        longKeys.add(key);
      }
    }
  });

  // mark ALL occupied cells ed-on (needed for selection highlight + hover)
  longKeys.forEach(key => {
    const cell = cellMap.get(key);
    if (cell) cell.classList.add('ed-on');
    // no data-layer / no background — overlay handles the visual
  });

  // apply colors only for short-note cells
  shortLayers.forEach((layers, key) => {
    const cell = cellMap.get(key);
    if (!cell) return;
    cell.classList.add('ed-on');
    if (layers.length === 1) {
      cell.dataset.layer = layers[0];
    } else {
      // multi-layer: active track gets 55% of the cell, others share 45%
      const active = typeof edActiveTrack !== 'undefined' ? edActiveTrack : 0;
      const sorted = [
        ...layers.filter(l => l === active),
        ...layers.filter(l => l !== active),
      ];
      const hasActive = sorted[0] === active;
      const activeShare = hasActive ? 55 : (100 / sorted.length);
      const otherShare  = hasActive ? (45 / (sorted.length - 1)) : (100 / sorted.length);
      let offset = 0;
      const stops = sorted.map(l => {
        const share = (l === active && hasActive) ? activeShare : otherShare;
        const c = LAYER_COLORS[l % LAYER_COLORS.length];
        const s = offset, e = offset + share;
        offset = e;
        return `${c}D0 ${s.toFixed(1)}% ${e.toFixed(1)}%`;
      });
      cell.style.background = `linear-gradient(to bottom, ${stops.join(', ')})`;
      cell.dataset.layer = sorted[0];
    }
  });
}

// ── extended note overlays (duration > 1) ─────────────────────────────────────
// draws a continuous filled rect over the grid for notes spanning multiple steps
const ED_MEASURE_BAR_H = 17; // measure bar height (16px) + 1px border
const ED_CELL_H        = 14; // .ed-row height
const ED_CELL_W        = 40; // .ed-cell width

function refreshNoteOverlays(notes, layerFn) {
  const inner = document.getElementById('ed-roll-inner');
  if (!inner) return;
  // clear old bars
  inner.querySelectorAll('.ed-note-bar').forEach(el => el.remove());

  const active = typeof edActiveTrack !== 'undefined' ? edActiveTrack : 0;
  notes.forEach((n, i) => {
    if ((n.duration || 1) <= 1) return; // single-step: cell styling is enough
    const row = edRowMap.get(n.note);
    if (row == null) return;
    const layer = layerFn ? layerFn(n) : 0;
    const color = LAYER_COLORS[layer % LAYER_COLORS.length];

    const bar = document.createElement('div');
    bar.className = 'ed-note-bar' + (layer === active ? ' active-layer' : '');
    bar.dataset.noteIdx = i;
    bar.style.top    = (ED_MEASURE_BAR_H + row * ED_CELL_H) + 'px';
    bar.style.left   = (n.step * ED_CELL_W) + 'px';
    bar.style.width  = (n.duration * ED_CELL_W) + 'px';
    bar.style.background = color;
    inner.appendChild(bar);
  });
}

/**
 * Build a measure-number bar as first child of innerEl.
 * Shows bar numbers and step dividers. Call after buildNoteGrid.
 * @param {HTMLElement} innerEl   - the .ed-roll-inner div
 * @param {number}      steps     - total step count
 * @param {number}      spb       - steps per bar
 * @param {boolean}     interactive - if true, adds crosshair cursor (editor loop drag)
 */
function buildMeasureBar(innerEl, steps, spb, interactive) {
  innerEl.querySelectorAll('.ed-measure-bar').forEach(el => el.remove());
  const bar = document.createElement('div');
  bar.className = 'ed-measure-bar' + (interactive ? ' interactive' : '');
  const overlay = document.createElement('div');
  overlay.className = 'ed-loop-region';
  overlay.style.display = 'none';
  bar.appendChild(overlay);
  for (let s = 0; s < steps; s++) {
    const cell = document.createElement('div');
    cell.className = 'ed-measure-cell' + (s % spb === 0 ? ' bar-start' : '');
    cell.dataset.step = s;
    if (s % spb === 0) cell.textContent = s / spb + 1;
    bar.appendChild(cell);
  }
  innerEl.insertBefore(bar, innerEl.firstChild);
}
