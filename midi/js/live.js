// ─────────────────────────────────────────────────────────────────────────────
// TAB SWITCHING
// ─────────────────────────────────────────────────────────────────────────────
let activeTab = 'radio';

function switchTab(tab) {
  activeTab = tab;
  location.hash = tab;
  document.getElementById('tab-editor-btn').classList.toggle('active', tab === 'editor');
  document.getElementById('tab-radio-btn').classList.toggle('active', tab === 'radio');
  document.getElementById('panel-live').classList.toggle('active', false);
  document.getElementById('panel-editor').classList.toggle('active', tab === 'editor');
  document.getElementById('panel-radio').classList.toggle('active', tab === 'radio');
  if (tab === 'radio') {
    history.replaceState(null, '', location.pathname + '#radio');
    if (typeof edStop === 'function' && edIsPlaying) edStop();
    radioInit();
    if (radioAudio && radioAudio.paused && !radioUserPaused) {
      radioAudio.play().catch(() => {});
      if (!radioAnimFrame) radioAnimFrame = requestAnimationFrame(radioDraw);
    }
  } else {
    if (radioAnimFrame) { cancelAnimationFrame(radioAnimFrame); radioAnimFrame = null; }
    if (radioAudio) { radioAudio.pause(); }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// LIVE TAB
// ─────────────────────────────────────────────────────────────────────────────
let currentNoteKeys = new Set();
let currentState    = null;
let cellMap         = new Map();
let rowMap          = new Map();
let stepsBuilt      = 0;

NOTES.forEach((n, i) => rowMap.set(n, i));

function buildKeys() {
  const keysEl = document.getElementById('keys');
  keysEl.innerHTML = '';
  NOTES.forEach(midi => {
    const black = isBlack(midi);
    const isC   = (midi % 12) === 0;
    const key   = document.createElement('div');
    key.className = `key ${black ? 'black' : 'white'}${isC ? ' c' : ''}`;
    key.textContent = isC ? noteName(midi) : '';
    key.title = noteName(midi);
    key.dataset.midi = midi;
    key.addEventListener('click', () => previewNote(midi));
    keysEl.appendChild(key);
  });
}

function buildGrid(steps) {
  if (steps === stepsBuilt && cellMap.size > 0) return;
  stepsBuilt = steps;
  cellMap.clear();

  const inner = document.getElementById('grid-inner');
  inner.querySelectorAll('.grid-row').forEach(r => r.remove());

  const frag = document.createDocumentFragment();
  NOTES.forEach((midi, row) => {
    const rowEl = document.createElement('div');
    rowEl.className = `grid-row${isBlack(midi) ? ' is-black' : ''}`;
    rowEl.dataset.row = row;

    for (let s = 0; s < steps; s++) {
      const cell = document.createElement('div');
      const cls  = s % 4 === 0 ? 'bar-start' : (s % 2 === 0 ? 'beat-start' : '');
      cell.className = 'cell' + (cls ? ' ' + cls : '');
      cell.dataset.row  = row;
      cell.dataset.step = s;
      cell.dataset.midi = midi;
      cell.addEventListener('click', () => {
        if (currentState && currentState.notes.length) previewNote(midi);
      });
      cellMap.set(`${row}-${s}`, cell);
      rowEl.appendChild(cell);
    }
    frag.appendChild(rowEl);
  });

  const overlay = document.getElementById('idle-overlay');
  inner.insertBefore(frag, overlay);
}

function updateLegend(layers) {
  const el = document.getElementById('legend');
  el.innerHTML = '';
  layers.forEach((info, lid) => {
    const item = document.createElement('div');
    item.className = 'legend-item';
    item.innerHTML = `<div class="legend-swatch" style="background:${info.color}"></div>${info.instrument || ('layer ' + lid)}`;
    el.appendChild(item);
  });
}

const cellMeta = new Map();
const tipEl   = document.getElementById('note-tip');
const tipNote = document.getElementById('tip-note');
const tipInst = document.getElementById('tip-inst');
document.addEventListener('mousemove', e => {
  if (tipEl.style.display === 'block') {
    tipEl.style.left = (e.clientX + 12) + 'px';
    tipEl.style.top  = (e.clientY - 32) + 'px';
  }
});

function applyState(state, animate = false) {
  currentState = state;
  const steps = state.steps || 16;
  buildGrid(steps);

  const layerInfo = new Map();
  const newKeys   = new Set();
  const newMeta   = new Map();

  (state.notes || []).forEach(n => {
    const row = rowMap.get(n.note);
    if (row == null) return;
    const lid   = n.layer ?? 0;
    const color = LAYER_COLORS[lid % LAYER_COLORS.length];
    const inst  = n._instName || resolveInstrumentName(state.sf, n.program, n.bank);
    if (!layerInfo.has(lid)) layerInfo.set(lid, {instrument: inst, color});
    for (let d = 0; d < (n.duration || 1); d++) {
      const key = `${row}-${n.step + d}`;
      newKeys.add(key);
      newMeta.set(key, {layer: lid, midi: n.note, instrument: inst});
    }
  });

  const added   = [...newKeys].filter(k => !currentNoteKeys.has(k));
  const removed = [...currentNoteKeys].filter(k => !newKeys.has(k));

  removed.forEach(k => {
    const cell = cellMap.get(k);
    if (cell) {
      cell.classList.remove('on', 'flash');
      cell.removeAttribute('data-layer');
      cell.onmouseenter = null;
      cell.onmouseleave = null;
    }
    cellMeta.delete(k);
  });

  added.forEach(k => {
    const cell = cellMap.get(k);
    if (!cell) return;
    const meta = newMeta.get(k);
    cell.classList.add('on');
    cell.dataset.layer = meta.layer;
    cellMeta.set(k, meta);
    cell.onmouseenter = () => {
      tipNote.textContent = noteName(meta.midi);
      tipInst.textContent = ' · ' + meta.instrument;
      tipEl.style.display = 'block';
    };
    cell.onmouseleave = () => { tipEl.style.display = 'none'; };
    if (animate) {
      cell.classList.remove('flash');
      void cell.offsetWidth;
      cell.classList.add('flash');
      setTimeout(() => cell.classList.remove('flash'), 600);
    }
  });

  newKeys.forEach(k => {
    const cell = cellMap.get(k);
    const meta = newMeta.get(k);
    if (cell && meta) cell.dataset.layer = meta.layer;
  });

  currentNoteKeys = newKeys;

  document.getElementById('hdr-sf').textContent   = state.sf || '—';
  document.getElementById('hdr-inst').textContent  = state.instrument || '—';
  const bpmEl = document.getElementById('hdr-bpm');
  if (state.bpm) {
    bpmEl.style.display = '';
    document.getElementById('bpm-val').textContent = state.bpm;
  }
  document.getElementById('hdr-label').textContent = state.label || '';
  document.getElementById('note-count').textContent = (state.notes || []).length;

  if (state.bpm && state.steps && state.step_beats) {
    const beats = state.steps * state.step_beats;
    const secs  = (beats * 60 / state.bpm).toFixed(1);
    document.getElementById('ftr-loop').textContent = `loop: ${beats} beats · ${secs}s`;
  }

  const overlay = document.getElementById('idle-overlay');
  if ((state.notes || []).length > 0) {
    overlay.classList.add('hidden');
  } else {
    overlay.classList.remove('hidden');
  }

  const layers = [];
  layerInfo.forEach((info, lid) => { layers[lid] = info; });
  updateLegend(layers.filter(Boolean));
}

function setStatus(status, label) {
  const el = document.getElementById('hdr-status');
  el.className = `hdr-status ${status}`;
  const map = { idle: 'idle', composing: 'composing…', rendering: 'rendering…', playing: 'playing ↺' };
  el.textContent = map[status] || status;
  if (label) document.getElementById('hdr-label').textContent = label;
}

function liveStopPlayback() {
  if (livePlaySource) { try { livePlaySource.stop(); } catch(e) {} livePlaySource = null; }
  liveIsPlaying = false;
  if (liveAnimId) { cancelAnimationFrame(liveAnimId); liveAnimId = null; }
  document.getElementById('playhead').style.display = 'none';
}

async function livePlayAudio(b64, bpm, steps, stepBeats) {
  liveStopPlayback();
  const ctx = getCtx();
  let audioBuf;
  try { audioBuf = await ctx.decodeAudioData(b64ToArrayBuffer(b64)); }
  catch(e) { console.error('decode error', e); return; }

  const exactDuration = steps * stepBeats * (60 / bpm);
  livePlayDur = exactDuration;

  const src = ctx.createBufferSource();
  src.buffer    = audioBuf;
  src.loop      = true;
  src.loopStart = 0;
  src.loopEnd   = exactDuration;
  src.connect(gainNode || ctx.destination);
  src.start();
  livePlaySource = src;
  liveIsPlaying  = true;
  livePlayStart  = ctx.currentTime;

  setStatus('playing');
  liveAnimatePlayhead(steps, stepBeats, bpm);
}

function liveAnimatePlayhead(steps, stepBeats, bpm) {
  const ph        = document.getElementById('playhead');
  const totalSec  = steps * stepBeats * (60 / bpm);
  ph.style.display = 'block';

  function frame() {
    if (!liveIsPlaying) return;
    const ctx     = getCtx();
    const elapsed = (ctx.currentTime - livePlayStart) % totalSec;
    ph.style.left = (elapsed / totalSec * steps * 40) + 'px';
    liveAnimId = requestAnimationFrame(frame);
  }
  frame();
}

function previewNote(midi) {
  if (!wsReady) return;
  const prog = currentState?.notes?.[0]?.program ?? 0;
  const bank = currentState?.notes?.[0]?.bank ?? 0;
  ws.send(JSON.stringify({ type: 'preview', note: midi, velocity: 72, duration: 0.8, program: prog, bank }));
}
