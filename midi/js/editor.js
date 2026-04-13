// ─────────────────────────────────────────────────────────────────────────────
// EDITOR TAB
// ─────────────────────────────────────────────────────────────────────────────

// per-SF sensible defaults: [lead, bass, drums] as {bank, program}
const SF_DEFAULTS = {
  pokemon:   [{bank:0, program:0},  {bank:0, program:33}, {bank:128, program:0}],
  megadrive: [{bank:0, program:0},  {bank:0, program:32}, {bank:128, program:0}],
  msgs:      [{bank:0, program:0},  {bank:0, program:33}, {bank:128, program:0}],
};

// remembered instrument settings per SF — populated when user switches away
const sfMemory = {};

// editor state — starts with pokemon defaults
const ED_TRACKS = [
  { name: 'lead',  sf: 'pokemon', bank: 0,   program: 0,  mute: false, solo: false },
  { name: 'bass',  sf: 'pokemon', bank: 0,   program: 33, mute: false, solo: false },
  { name: 'drums', sf: 'pokemon', bank: 128, program: 0,  mute: false, solo: false },
];
let edActiveTrack = 0;

// notes: { note(midi), step, velocity, duration, track }
let edNotes = [];

let edCellMap  = new Map(); // `${row}-${step}` → cell DOM
let edRowMap   = new Map(); // midi → row index
let edBuilt    = 0;

NOTES.forEach((n, i) => edRowMap.set(n, i));

// ── instrument selector helpers ───────────────────────────────────────────────
function buildInstOptions(sfKey, bankNum) {
  const sf    = INST_DATA[sfKey];
  if (!sf) return '';
  const presets = sf.banks[bankNum] || sf.banks[0] || [];
  return presets.map(([p, name]) => `<option value="${p}">${name}</option>`).join('');
}

function buildBankOptions(sfKey) {
  const sf = INST_DATA[sfKey];
  if (!sf) return '<option value="0">0</option>';
  return Object.keys(sf.banks).map(b => `<option value="${b}">bank ${b}</option>`).join('');
}

// ── build track controls ──────────────────────────────────────────────────────
function buildTrackUI() {
  const container = document.getElementById('ed-tracks');
  container.innerHTML = '';

  // in collab mode show role-based track rows with usernames
  if (cbInRoom) {
    const roleOrder = CB_ROLES; // ['lead', 'bass', 'drums']
    roleOrder.forEach((role, idx) => {
      const user       = cbRoomUsers.find(u => u.role === role);
      const colorIdx   = user ? user.color_idx : idx;
      const color      = user ? user.color : LAYER_COLORS[idx % LAYER_COLORS.length];
      const isMine     = colorIdx === cbMyColorIdx;
      const inst       = cbRoleInstruments[role] || { bank: 0, program: 0 };

      const el = document.createElement('div');
      el.className = 'ed-track' + (isMine ? ' active' : '') + (!user ? ' empty-slot' : '');
      el.id = `ed-track-row-${colorIdx}`;

      el.innerHTML = `
        <div class="ed-track-swatch" style="background:${color}"></div>
        <div class="ed-track-name">${CB_ROLE_ICONS[role] || ''} ${role}
          ${user ? `<span style="font-size:0.5rem;opacity:0.6;margin-left:4px">${user.name}</span>` : '<span style="opacity:0.3">empty</span>'}
        </div>
        ${isMine ? `
        <select class="ed-track-sf-sel" id="cb-track-sf-${role}" onchange="cbInstSfChange()">
          <option value="pokemon">Pokemon</option>
          <option value="megadrive">Megadrive</option>
          <option value="msgs">MSGS</option>
        </select>
        <select class="ed-track-inst-sel" id="cb-track-prog-${role}" onchange="cbInstProgChange()"></select>
        ` : `<span style="font-size:0.5rem;color:var(--muted);margin-left:4px">${inst.program ? `prog ${inst.program}` : ''}</span>`}
      `;

      if (isMine) {
        el.addEventListener('click', e => { if (e.target.tagName !== 'SELECT') cbBuildInstPicker(); });
        // populate instrument selectors after DOM is ready
        setTimeout(() => cbBuildInstPicker(), 0);
      }
      container.appendChild(el);
    });
    return;
  }

  // solo mode — original behavior
  ED_TRACKS.forEach((track, idx) => {
    const el = document.createElement('div');
    el.className = 'ed-track' + (idx === edActiveTrack ? ' active' : '');
    el.id = `ed-track-row-${idx}`;

    const color = LAYER_COLORS[idx % LAYER_COLORS.length];
    const instOpts = buildInstOptions(track.sf, track.bank);

    el.innerHTML = `
      <div class="ed-track-swatch" style="background:${color}"></div>
      <div class="ed-track-name">${track.name}</div>
      <select class="ed-track-sf-sel" id="ed-bank-${idx}" onchange="onTrackBankChange(${idx})">
        ${buildBankOptions(track.sf)}
      </select>
      <select class="ed-track-inst-sel" id="ed-inst-${idx}" onchange="onTrackInstChange(${idx})">
        ${instOpts}
      </select>
      <button class="ed-track-mute${track.mute?' active':''}" onclick="toggleMute(${idx},event)">M</button>
      <button class="ed-track-solo${track.solo?' active':''}" onclick="toggleSolo(${idx},event)">S</button>
      <button class="ed-track-del" onclick="removeTrack(${idx},event)" title="remove track">×</button>
    `;

    el.addEventListener('click', e => {
      if (e.target.tagName === 'SELECT' || e.target.tagName === 'BUTTON') return;
      setActiveTrack(idx);
    });

    const bankSel = el.querySelector(`#ed-bank-${idx}`);
    bankSel.value = track.bank;
    const instSel = el.querySelector(`#ed-inst-${idx}`);
    instSel.value = track.program;

    container.appendChild(el);
  });

  // add-track row
  const addRow = document.createElement('div');
  addRow.className = 'ed-tracks-add-row';
  addRow.innerHTML = `<button class="ed-tracks-add-btn" onclick="addTrack()">+ add track</button>`;
  container.appendChild(addRow);
}

function addTrack() {
  ED_TRACKS.push({ name: `track ${ED_TRACKS.length + 1}`, sf: 'pokemon', bank: 0, program: 80, mute: false, solo: false });
  buildTrackUI();
  setActiveTrack(ED_TRACKS.length - 1);
}

function removeTrack(idx, e) {
  e.stopPropagation();
  if (ED_TRACKS.length <= 1) return;
  ED_TRACKS.splice(idx, 1);
  edNotes = edNotes
    .filter(n => n.track !== idx)
    .map(n => ({ ...n, track: n.track > idx ? n.track - 1 : n.track }));
  if (edActiveTrack >= ED_TRACKS.length) edActiveTrack = ED_TRACKS.length - 1;
  buildTrackUI();
  setActiveTrack(edActiveTrack);
  edRefreshGrid();
  edUpdateFooter();
}

function setActiveTrack(idx) {
  edActiveTrack = idx;
  edSelected.clear();
  document.querySelectorAll('.ed-track').forEach((el, i) => {
    el.classList.toggle('active', i === idx);
  });
  edRefreshGrid();
}

// update velocity slider to reflect the selected notes' velocity
// shows the value if all selected notes match, '-' if mixed
function edSyncVelToSelection() {
  if (!edSelected.size) return;
  const notes = edGetActiveNotes();
  const vels  = [...edSelected].map(i => notes[i]?.velocity ?? 90).filter(v => v != null);
  if (!vels.length) return;
  const allSame = vels.every(v => v === vels[0]);
  const velEl   = document.getElementById('ed-vel');
  const valEl   = document.getElementById('ed-vel-val');
  if (allSame) {
    velEl.value        = vels[0];
    valEl.textContent  = vels[0];
  } else {
    velEl.value        = Math.round(vels.reduce((a, b) => a + b, 0) / vels.length);
    valEl.textContent  = '-';
  }
}

function onGlobalSfChange() {
  const oldSf = ED_TRACKS[0]?.sf || 'pokemon';
  const newSf = document.getElementById('ed-sf-global').value;

  // save current settings for old SF
  sfMemory[oldSf] = ED_TRACKS.map(t => ({ bank: t.bank, program: t.program }));

  // restore from memory or use SF defaults
  const restore = sfMemory[newSf] || SF_DEFAULTS[newSf] || SF_DEFAULTS.pokemon;
  ED_TRACKS.forEach((t, i) => {
    t.sf      = newSf;
    t.bank    = restore[i]?.bank    ?? 0;
    t.program = restore[i]?.program ?? 0;
  });

  buildTrackUI();
  edSaveToURL();
  edScheduleLiveUpdate();
}

function onTrackBankChange(idx) {
  const bank = parseInt(document.getElementById(`ed-bank-${idx}`).value);
  ED_TRACKS[idx].bank = bank;
  const sf = ED_TRACKS[idx].sf;
  const instSel = document.getElementById(`ed-inst-${idx}`);
  instSel.innerHTML = buildInstOptions(sf, bank);
  const firstProg = INST_DATA[sf]?.banks[bank]?.[0]?.[0] ?? 0;
  instSel.value = firstProg;
  ED_TRACKS[idx].program = parseInt(firstProg);
  edSaveToURL();
  edScheduleLiveUpdate();
}

function onTrackInstChange(idx) {
  ED_TRACKS[idx].program = parseInt(document.getElementById(`ed-inst-${idx}`).value);
  edSaveToURL();
  edScheduleLiveUpdate();
}

function toggleMute(idx, e) {
  e.stopPropagation();
  ED_TRACKS[idx].mute = !ED_TRACKS[idx].mute;
  e.target.classList.toggle('active', ED_TRACKS[idx].mute);
}

function toggleSolo(idx, e) {
  e.stopPropagation();
  ED_TRACKS[idx].solo = !ED_TRACKS[idx].solo;
  e.target.classList.toggle('active', ED_TRACKS[idx].solo);
}

// ── build editor piano keys ───────────────────────────────────────────────────
function buildEdKeys() {
  const el = document.getElementById('ed-keys');
  buildPianoKeys(el, edPreviewNote);
  const spacer = document.createElement('div');
  spacer.style.cssText = 'height:16px;flex-shrink:0;border-bottom:1px solid rgba(75,139,200,0.2);background:#111120;';
  el.insertBefore(spacer, el.firstChild);
}

// ── build editor grid ─────────────────────────────────────────────────────────
function buildEdGrid(steps) {
  if (steps === edBuilt && edCellMap.size > 0) return;
  edBuilt = steps;
  const spb = edGetStepsPerBar();
  buildNoteGrid(
    document.getElementById('ed-roll-inner'),
    steps,
    spb,
    edCellMap,
    document.getElementById('ed-playhead'),
    (cell, midi, s, row) => {
      cell.addEventListener('mousedown', e => {
        e.preventDefault();
        edMouseDownCell = { row, step: s, midi, ctrl: e.ctrlKey || e.metaKey };
        edDragged = false;
      });
      cell.addEventListener('mouseenter', e => {
        // collab: broadcast cursor position to other users
        if (cbInRoom && wsReady) cbSendCursor(midi, s);
        if (e.buttons !== 1 || !edMouseDownCell) return;
        if (!edDragged) {
          edDragged = true;
          edSelecting = true;
          if (!edMouseDownCell.ctrl) edClearSelection();
          edSelBox = { r1: edMouseDownCell.row, s1: edMouseDownCell.step, r2: row, s2: s };
        } else if (edSelecting) {
          edSelBox.r2 = row; edSelBox.s2 = s;
        }
        edUpdateSelBox();
      });
    }
  );
  buildMeasureBar(document.getElementById('ed-roll-inner'), steps, spb, true);
  edSetupLoopDrag();
  edUpdateLoopOverlay();
  edRefreshGrid();
}

// ── click handler ─────────────────────────────────────────────────────────────
function edCellClick(midi, step, row, cell) {
  const steps   = edGetSteps();
  const notelen = parseInt(document.getElementById('ed-notelen').value);
  const vel     = parseInt(document.getElementById('ed-vel').value);
  const tid     = edGetActiveTrack();
  const notes   = edGetActiveNotes();

  const existing = notes.find(n =>
    (cbInRoom ? (n.user_idx ?? 0) : (n.track ?? 0)) === tid &&
    n.note === midi && step >= n.step && step < n.step + (n.duration || 1));

  if (cbInRoom) {
    if (!wsReady) return;
    if (existing) {
      ws.send(JSON.stringify({ type: 'collab_note', action: 'remove', note: existing.note, step: existing.step }));
    } else {
      const dur = Math.min(notelen, steps - step);
      ws.send(JSON.stringify({ type: 'collab_note', action: 'add', note: midi, step, duration: dur, velocity: vel }));
      cbPreviewNote(midi);
    }
    return;
  }

  edPushUndo();
  if (existing) {
    edNotes = edNotes.filter(n => n !== existing);
  } else {
    const dur = Math.min(notelen, steps - step);
    edNotes.push({ note: midi, step, velocity: vel, duration: dur, track: tid });
    edPreviewNote(midi);
  }
  edRefreshGrid();
  edUpdateFooter();
  edScheduleLiveUpdate();
  edSaveToURL();
}

// ── live playback update ──────────────────────────────────────────────────────
function edScheduleLiveUpdate() {
  if (!edIsPlaying) return;
  if (edLiveUpdateTimer) clearTimeout(edLiveUpdateTimer);
  edLiveUpdateTimer = setTimeout(() => {
    edLiveUpdateTimer = null;
    if (!edIsPlaying || edPendingRender) return;
    edPlay();
  }, 350);
}

// ── refresh grid display ──────────────────────────────────────────────────────
function edRefreshGrid() {
  const notes   = edGetActiveNotes();
  const layerFn = cbInRoom ? (n => n.user_idx ?? 0) : (n => n.track ?? 0);
  refreshNoteGrid(notes, edCellMap, layerFn);
  refreshNoteOverlays(notes, layerFn);
  // selection highlight is editor-only — apply after base refresh
  edCellMap.forEach(cell => cell.classList.remove('ed-selected'));
  document.getElementById('ed-roll-inner')?.querySelectorAll('.ed-note-bar.ed-selected')
    .forEach(el => el.classList.remove('ed-selected'));

  edSelected.forEach(idx => {
    const n = notes[idx];
    if (!n) return;
    const row = edRowMap.get(n.note);
    if (row == null) return;
    if ((n.duration || 1) > 1) {
      const bar = document.getElementById('ed-roll-inner')
        ?.querySelector(`.ed-note-bar[data-note-idx="${idx}"]`);
      if (bar) bar.classList.add('ed-selected');
    } else {
      const cell = edCellMap.get(`${row}-${n.step}`);
      if (cell) cell.classList.add('ed-selected');
    }
  });

  // sync velocity slider to selection
  edSyncVelToSelection();
}

// collab refresh delegates to the unified editor refresh
function cbRefreshGrid() { edSelected.clear(); edRefreshGrid(); }

// ── selection helpers ─────────────────────────────────────────────────────────
function edPushUndo() {
  edUndoStack.push(edNotes.map(n => ({...n})));
  if (edUndoStack.length > ED_UNDO_MAX) edUndoStack.shift();
}

function edUndo() {
  if (!edUndoStack.length) return;
  edNotes = edUndoStack.pop();
  edSelected.clear();
  edRefreshGrid();
  edUpdateFooter();
  edScheduleLiveUpdate();
  edSaveToURL();
}

function edClearSelection() {
  edSelected.clear();
  edRefreshGrid();
}

function edSelectAll() {
  const tid   = edGetActiveTrack();
  const notes = edGetActiveNotes();
  edSelected  = new Set(notes
    .map((n, i) => ({ n, i }))
    .filter(({ n }) => (cbInRoom ? (n.user_idx ?? 0) : (n.track ?? 0)) === tid)
    .map(({ i }) => i));
  edRefreshGrid();
}

function edDeleteSelected() {
  if (!edSelected.size) return;
  const tid   = edGetActiveTrack();
  const notes = edGetActiveNotes();
  if (cbInRoom) {
    if (!wsReady) return;
    [...edSelected].forEach(i => {
      const n = notes[i];
      if (n && (n.user_idx ?? 0) === tid)
        ws.send(JSON.stringify({ type: 'collab_note', action: 'remove', note: n.note, step: n.step }));
    });
    edSelected.clear();
    return;
  }
  edPushUndo();
  edNotes = edNotes.filter((n, i) => !edSelected.has(i) || (n.track ?? 0) !== edActiveTrack);
  edSelected.clear();
  edRefreshGrid();
  edUpdateFooter();
  edScheduleLiveUpdate();
  edSaveToURL();
}

// ── copy / paste ──────────────────────────────────────────────────────────────
let edClipboard = [];

function edCopy() {
  if (!edSelected.size) return;
  const sel = [...edSelected].map(i => edGetActiveNotes()[i]);
  if (!sel.length) return;
  const minStep = Math.min(...sel.map(n => n.step));
  // store relative to selection start, preserve track
  edClipboard = sel.map(n => ({ ...n, step: n.step - minStep }));
  edSetStatus(`copied ${edClipboard.length}`);
}

function edPaste() {
  if (!edClipboard.length) return;
  const totalSteps = edGetSteps();
  const pasteAt = edCursorStep ?? 0;
  edPushUndo();
  const newNotes = edClipboard
    .map(n => ({ ...n, step: n.step + pasteAt }))
    .filter(n => n.step < totalSteps);
  if (!newNotes.length) return;
  const offset = edNotes.length;
  edNotes = [...edNotes, ...newNotes];
  edSelected = new Set(newNotes.map((_, i) => offset + i));
  edRefreshGrid();
  edUpdateFooter();
  edScheduleLiveUpdate();
  edSaveToURL();
}

function edShiftNotes(stepDelta, noteDelta) {
  if (!edSelected.size) return;
  const tid        = edGetActiveTrack();
  const notes      = edGetActiveNotes();
  const totalSteps = edGetSteps();

  // boundary check — refuse the whole move if any note would go out of bounds
  for (const i of edSelected) {
    const n = notes[i];
    if (!n) continue;
    if (n.step + stepDelta < 0 || n.step + stepDelta + (n.duration || 1) > totalSteps) return;
    if (n.note + noteDelta < NOTE_BOT || n.note + noteDelta > NOTE_TOP) return;
  }

  if (cbInRoom) {
    if (!wsReady) return;
    [...edSelected].forEach(i => {
      const n = notes[i];
      if (!n || (n.user_idx ?? 0) !== tid) return;
      ws.send(JSON.stringify({ type: 'collab_note', action: 'remove', note: n.note, step: n.step }));
      ws.send(JSON.stringify({ type: 'collab_note', action: 'add',
        note: n.note + noteDelta, step: n.step + stepDelta,
        duration: n.duration || 1, velocity: n.velocity || 90 }));
    });
    edSelected.clear();
    return;
  }

  edPushUndo();
  edNotes = edNotes.map((n, i) => {
    if (!edSelected.has(i)) return n;
    return { ...n, step: n.step + stepDelta, note: n.note + noteDelta };
  });
  edRefreshGrid();
  edUpdateFooter();
  edScheduleLiveUpdate();
  edSaveToURL();
}

function edDuplicateSelected() {
  if (!edSelected.size) return;
  const sel = [...edSelected].map(i => edNotes[i]);
  if (!sel.length) return;
  const minStep = Math.min(...sel.map(n => n.step));
  const maxEnd  = Math.max(...sel.map(n => n.step + (n.duration || 1)));
  const span    = maxEnd - minStep;
  const totalSteps = edGetSteps();
  edPushUndo();
  const newNotes = sel
    .map(n => ({ ...n, step: n.step + span }))
    .filter(n => n.step < totalSteps);
  const offset = edNotes.length;
  edNotes = [...edNotes, ...newNotes];
  edSelected = new Set(newNotes.map((_, i) => offset + i));
  edRefreshGrid();
  edUpdateFooter();
  edScheduleLiveUpdate();
  edSaveToURL();
}

// ── loop region ───────────────────────────────────────────────────────────────
function edUpdateLoopOverlay() {
  const overlay = document.querySelector('#ed-roll-inner .ed-loop-region');
  if (!overlay) return;
  const steps = edGetSteps();
  const end   = edLoopEnd < 0 ? steps : edLoopEnd;
  if (edLoopEnd < 0 || edLoopStart >= end) {
    overlay.style.display = 'none';
    return;
  }
  overlay.style.display = 'block';
  overlay.style.left    = (edLoopStart * 40) + 'px';
  overlay.style.width   = ((end - edLoopStart) * 40) + 'px';
}

function edApplyLoopToSource() {
  if (!edPlaySource) return;
  const bpm      = parseFloat(document.getElementById('ed-bpm').value) || 120;
  const stepB    = edGetStepBeats();
  const steps    = edGetSteps();
  const totalSec = steps * stepB * (60 / bpm);
  const end      = edLoopEnd < 0 ? steps : edLoopEnd;

  const hasRegion = edLoopEnd >= 0 && edLoopStart < end;
  const newLs = hasRegion ? edLoopStart * stepB * (60 / bpm) : 0;
  const newLe = hasRegion ? end         * stepB * (60 / bpm) : totalSec;

  // re-anchor edPlayStart so rawElapsed stays meaningful after the loop region changes
  if (edIsPlaying) {
    const ctx        = getEdCtx();
    const rawElapsed = ctx.currentTime - edPlayStart;
    const oldLs      = edPlaySource.loopStart;
    const oldLe      = edPlaySource.loopEnd;
    const oldDur     = oldLe - oldLs;

    // compute actual buffer position from OLD loop geometry
    let currentPos;
    if (oldDur > 0 && rawElapsed >= oldLe) {
      currentPos = oldLs + ((rawElapsed - oldLe) % oldDur);
    } else {
      currentPos = rawElapsed % totalSec;
    }

    // if position is already past the new loop end, snap to loop start.
    const newDur = newLe - newLs;
    if (newDur > 0 && currentPos >= newLe) {
      currentPos = newLs;
    }

    edPlayStart = ctx.currentTime - currentPos;
  }

  edPlaySource.loopStart = newLs;
  edPlaySource.loopEnd   = newLe;
}

function edSetupLoopDrag() {
  const bar = document.querySelector('#ed-roll-inner .ed-measure-bar');
  if (!bar) return;
  bar.addEventListener('mousedown', e => {
    e.preventDefault();
    e.stopPropagation();
    const rect  = bar.getBoundingClientRect();
    const s     = Math.max(0, Math.floor((e.clientX - rect.left) / 40));
    edLoopStart = s;
    edLoopEnd   = Math.min(edGetSteps(), s + edGetStepsPerBar());
    edLoopDragging = true;
    edUpdateLoopOverlay();
  });
  bar.addEventListener('mousemove', e => {
    if (!edLoopDragging) return;
    const rect = bar.getBoundingClientRect();
    const s    = Math.ceil((e.clientX - rect.left) / 40);
    edLoopEnd  = Math.min(edGetSteps(), Math.max(edLoopStart + 1, s));
    edUpdateLoopOverlay();
  });
}

// drag-select box
function edUpdateSelBox() {
  const el = document.getElementById('ed-sel-box');
  if (!el) return;
  const r1 = Math.min(edSelBox.r1, edSelBox.r2);
  const r2 = Math.max(edSelBox.r1, edSelBox.r2);
  const s1 = Math.min(edSelBox.s1, edSelBox.s2);
  const s2 = Math.max(edSelBox.s1, edSelBox.s2);
  el.style.display = 'block';
  el.style.left    = (s1 * 40) + 'px';
  el.style.top     = (ED_MEASURE_BAR_H + r1 * 14) + 'px';
  el.style.width   = ((s2 - s1 + 1) * 40) + 'px';
  el.style.height  = ((r2 - r1 + 1) * 14) + 'px';
}

function edFinalizeSelBox() {
  const r1 = Math.min(edSelBox.r1, edSelBox.r2);
  const r2 = Math.max(edSelBox.r1, edSelBox.r2);
  const s1 = Math.min(edSelBox.s1, edSelBox.s2);
  const s2 = Math.max(edSelBox.s1, edSelBox.s2);
  const tid   = edGetActiveTrack();
  const notes = edGetActiveNotes();
  edSelected.clear();
  notes.forEach((n, i) => {
    const nTid = cbInRoom ? (n.user_idx ?? 0) : (n.track ?? 0);
    if (nTid !== tid) return;
    const row = edRowMap.get(n.note);
    if (row == null || row < r1 || row > r2) return;
    const nEnd = n.step + (n.duration || 1) - 1;
    if (nEnd >= s1 && n.step <= s2) edSelected.add(i);
  });
  document.getElementById('ed-sel-box').style.display = 'none';
  edRefreshGrid();
}

// ── bars / steps ──────────────────────────────────────────────────────────────
let edBarCount = 4;

function edGetStepBeats() {
  if (cbInRoom) return cbStepBeats;
  return parseFloat(document.getElementById('ed-stepsize').value) || 0.5;
}

function edGetStepsPerBar(stepB) {
  return Math.round(4 / (stepB || edGetStepBeats()));
}

function edGetSteps() {
  if (cbInRoom) return cbSteps;
  return edBarCount * edGetStepsPerBar();
}

// ── collab/solo adapters ──────────────────────────────────────────────────────
function edGetActiveNotes()  { return cbInRoom ? cbNotes         : edNotes;        }
function edGetActiveTrack()  { return cbInRoom ? cbMyColorIdx    : edActiveTrack;  }

function edAddBars(delta) {
  edBarCount = Math.max(1, edBarCount + delta);
  document.getElementById('ed-bars-display').textContent = edBarCount;
  const newSteps = edGetSteps();
  // clip notes that now fall outside the grid
  if (delta < 0) {
    edNotes = edNotes.filter(n => n.step < newSteps);
  }
  edBuilt = 0;
  buildEdGrid(newSteps);
  edRefreshGrid();
  edUpdateFooter();
  edSaveToURL();
}

// rebuild when step size changes (bar count stays, step count changes)
document.getElementById('ed-stepsize').addEventListener('change', () => {
  edBuilt = 0;
  buildEdGrid(edGetSteps());
  edUpdateFooter();
  edSaveToURL();
});

// live BPM — re-render if playing
document.getElementById('ed-bpm').addEventListener('input', () => {
  if (cbInRoom && wsReady) {
    const bpm = parseFloat(document.getElementById('ed-bpm').value) || 120;
    if (bpm >= 40 && bpm <= 280) ws.send(JSON.stringify({ type: 'collab_bpm', bpm }));
  }
  edUpdateFooter();
  edScheduleLiveUpdate();
  edSaveToURL();
});

// clicking grid background (not a cell) clears selection
document.getElementById('ed-roll-wrap').addEventListener('mousedown', e => {
  if (!e.target.classList.contains('ed-cell')) edClearSelection();
});

document.addEventListener('mouseup', () => {
  if (edLoopDragging) {
    edLoopDragging = false;
    edApplyLoopToSource();
    return;
  }
  if (edSelecting) {
    edFinalizeSelBox();
    edSelecting = false;
  } else if (edMouseDownCell && !edDragged) {
    const { row, step, midi: m, ctrl } = edMouseDownCell;
    if (ctrl) {
      // ctrl+click: add/remove note from selection (active track only, no note creation)
      const tid = edGetActiveTrack();
      const existIdx = edGetActiveNotes().findIndex(n =>
        (cbInRoom ? (n.user_idx ?? 0) : (n.track ?? 0)) === tid && n.note === m &&
        step >= n.step && step < n.step + (n.duration || 1));
      if (existIdx >= 0) {
        if (edSelected.has(existIdx)) edSelected.delete(existIdx);
        else edSelected.add(existIdx);
        edRefreshGrid();
      }
    } else {
      // plain click — clear selection, toggle note
      edClearSelection();
      const c = edCellMap.get(`${row}-${step}`);
      if (c) { edCellClick(m, step, row, c); edSaveToURL(); }
    }
  }
  edMouseDownCell = null;
  edDragged = false;
});

// stop editor playback when browser tab goes to background
document.addEventListener('visibilitychange', () => {
  if (document.hidden && typeof edStop === 'function' && edIsPlaying) edStop();
});

document.addEventListener('keydown', e => {
  if (!document.getElementById('panel-editor').classList.contains('active')) return;
  const tag = document.activeElement?.tagName;
  const inInput = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';

  if (e.code === 'Space' && !inInput) {
    e.preventDefault();
    if (edIsPlaying) {
      const spb   = edGetStepsPerBar();
      const total = edGetSteps();
      const elapsed = (getEdCtx().currentTime - edPlayStart) % edPlayDur;
      const stepF  = (elapsed / edPlayDur) * total;
      edCursorStep = Math.floor(stepF / spb) * spb;
      edStop();
    } else {
      const stepB = edGetStepBeats();
      const bpm   = parseFloat(document.getElementById('ed-bpm').value) || 120;
      edCursorOfs = edCursorStep * stepB * (60 / bpm);
      edPlay();
    }
    return;
  }

  if (e.key === 'Escape') { edClearSelection(); return; }

  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (!inInput && edSelected.size > 0) {
      e.preventDefault();
      edDeleteSelected();
    }
    return;
  }

  if (e.ctrlKey || e.metaKey) {
    if (e.key === 'a') { e.preventDefault(); edSelectAll(); }
    if (e.key === 'd') { e.preventDefault(); edDuplicateSelected(); }
    if (e.key === 'z') { e.preventDefault(); edUndo(); }
    if (e.key === 'c') { e.preventDefault(); edCopy(); }
    if (e.key === 'v') { e.preventDefault(); edPaste(); }
    return;
  }

  // arrow keys — shift selected notes
  if (edSelected.size > 0 && !inInput) {
    const dx = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    const dy = e.key === 'ArrowUp'    ? 1 : e.key === 'ArrowDown'  ? -1 : 0;
    if (dx || dy) { e.preventDefault(); edShiftNotes(dx, dy); return; }
  }
});

// ── velocity display ──────────────────────────────────────────────────────────
document.getElementById('ed-vel').addEventListener('input', e => {
  const vel   = parseInt(e.target.value);
  document.getElementById('ed-vel-val').textContent = vel;
  if (edSelected.size > 0) {
    const tid   = edGetActiveTrack();
    const notes = edGetActiveNotes();
    if (cbInRoom && wsReady) {
      [...edSelected].forEach(i => {
        const n = notes[i];
        if (!n || (n.user_idx ?? 0) !== tid) return;
        ws.send(JSON.stringify({ type: 'collab_note', action: 'remove', note: n.note, step: n.step }));
        ws.send(JSON.stringify({ type: 'collab_note', action: 'add',
          note: n.note, step: n.step, duration: n.duration || 1, velocity: vel }));
      });
    } else {
      edSelected.forEach(i => {
        if (edNotes[i] && (edNotes[i].track ?? 0) === edActiveTrack) edNotes[i].velocity = vel;
      });
      edRefreshGrid();
      edSaveToURL();
    }
  }
});

// ── footer update ─────────────────────────────────────────────────────────────
function edUpdateFooter() {
  const bpm      = parseFloat(document.getElementById('ed-bpm').value) || 120;
  const steps    = edGetSteps();
  const stepB    = edGetStepBeats();
  const beats    = steps * stepB;
  const secs     = (beats * 60 / bpm).toFixed(1);
  document.getElementById('ed-note-count').textContent = edNotes.length;
  document.getElementById('ed-loop-info').textContent  = `loop: ${beats} beats · ${secs}s`;
}

// ── preview note ──────────────────────────────────────────────────────────────
function edPreviewNote(midi) {
  if (!wsReady) { ensureWS(); return; }
  const track = ED_TRACKS[edActiveTrack];
  ws.send(JSON.stringify({
    type: 'preview',
    note: midi,
    velocity: parseInt(document.getElementById('ed-vel').value),
    duration: 0.6,
    program: track.program,
    bank: track.bank,
    sf: track.sf,
  }));
}

// ── play ──────────────────────────────────────────────────────────────────────
function edPlay() {
  if (edPendingRender) return;
  ensureWS(() => {
    const bpm      = parseFloat(document.getElementById('ed-bpm').value) || 120;
    const steps    = edGetSteps();
    const stepB    = edGetStepBeats();

    const anySolo = ED_TRACKS.some(t => t.solo);
    const activeTracks = new Set(ED_TRACKS.map((t, i) => i)
      .filter(i => !ED_TRACKS[i].mute && (!anySolo || ED_TRACKS[i].solo)));

    if (edNotes.length === 0) { edSetStatus('no notes'); return; }

    const sfCounts = {};
    activeTracks.forEach(i => {
      sfCounts[ED_TRACKS[i].sf] = (sfCounts[ED_TRACKS[i].sf] || 0) + 1;
    });
    const sf = Object.entries(sfCounts).sort((a,b) => b[1]-a[1])[0]?.[0] || 'pokemon';

    const notes = edNotes
      .filter(n => activeTracks.has(n.track))
      .map(n => {
        const t = ED_TRACKS[n.track];
        return {
          note: n.note,
          step: n.step,
          velocity: n.velocity,
          duration: n.duration,
          program: t.program,
          bank: t.bank,
          layer: n.track,
        };
      });

    edPendingRender = true;
    edSetStatus('rendering…');
    document.getElementById('ed-play-btn').disabled = true;

    ws.send(JSON.stringify({
      type: 'render',
      sf,
      sequence: { bpm, steps, step_beats: stepB, notes }
    }));
  });
}

// ── stop ──────────────────────────────────────────────────────────────────────
function edStop() {
  if (edLiveUpdateTimer) { clearTimeout(edLiveUpdateTimer); edLiveUpdateTimer = null; }
  if (edPlaySource) { try { edPlaySource.stop(); } catch(e) {} edPlaySource = null; }
  edIsPlaying = false;
  if (edAnimId) { cancelAnimationFrame(edAnimId); edAnimId = null; }
  document.getElementById('ed-playhead').style.display = 'none';
  document.getElementById('ed-play-btn').disabled = false;
  document.getElementById('ed-stop-btn').disabled = true;
  document.getElementById('ed-play-btn').classList.remove('active');
  edSetStatus('');
}

// ── clear ─────────────────────────────────────────────────────────────────────
function edClear(all) {
  if (all) {
    edNotes = [];
  } else {
    edNotes = edNotes.filter(n => n.track !== edActiveTrack);
  }
  edRefreshGrid();
  edUpdateFooter();
  edSaveToURL();
}

// ── set editor status ─────────────────────────────────────────────────────────
function edSetStatus(txt) {
  document.getElementById('ed-status').textContent = txt;
}

// ── handle incoming audio for editor ─────────────────────────────────────────
async function edReceiveAudio(msg) {
  edPendingRender = false;
  document.getElementById('ed-play-btn').disabled = false;

  const { bpm, steps, step_beats, data } = msg;
  const exactDur = steps * step_beats * (60 / bpm);

  let resumeOffset = 0;
  let resumeCalcAt = 0;
  if (edIsPlaying && edPlayDur > 0) {
    const ctx0 = getEdCtx();
    resumeCalcAt  = ctx0.currentTime;
    resumeOffset  = (ctx0.currentTime - edPlayStart) % edPlayDur;
    resumeOffset  = Math.min(resumeOffset, exactDur - 0.01);
  } else if (edCursorOfs > 0) {
    resumeOffset = Math.min(edCursorOfs, exactDur - 0.01);
    edCursorOfs  = 0;
  }

  edStop();
  const ctx = getEdCtx();
  let audioBuf;
  try { audioBuf = await ctx.decodeAudioData(b64ToArrayBuffer(data)); }
  catch(e) { console.error('editor decode error', e); edSetStatus('decode error'); return; }

  if (resumeCalcAt > 0) {
    const lag = ctx.currentTime - resumeCalcAt;
    resumeOffset = (resumeOffset + lag) % exactDur;
    resumeOffset = Math.min(resumeOffset, exactDur - 0.01);
  }

  edPlayDur = exactDur;

  const src = ctx.createBufferSource();
  src.buffer    = audioBuf;
  src.loop      = true;
  src.loopStart = 0;
  src.loopEnd   = exactDur;
  src.connect(edGainNode || ctx.destination);
  src.start(0, resumeOffset);
  edPlaySource  = src;
  edIsPlaying   = true;
  edPlayStart   = ctx.currentTime - resumeOffset;

  edApplyLoopToSource();

  document.getElementById('ed-play-btn').classList.add('active');
  document.getElementById('ed-stop-btn').disabled = false;
  edSetStatus('playing ↺');
  edAnimatePlayhead(steps, step_beats, bpm);
}

function edAnimatePlayhead(steps, stepBeats, bpm) {
  const ph       = document.getElementById('ed-playhead');
  const rollWrap = document.getElementById('ed-roll-wrap');
  const totalSec = steps * stepBeats * (60 / bpm);
  ph.style.display = 'block';
  let lastPos = -1;

  function frame() {
    if (!edIsPlaying) return;
    const ctx        = getEdCtx();
    const rawElapsed = ctx.currentTime - edPlayStart;

    let pos;
    if (edLoopEnabled && edPlaySource) {
      const ls      = edPlaySource.loopStart;
      const le      = edPlaySource.loopEnd;
      const loopDur = le - ls;
      if (loopDur > 0 && rawElapsed >= le) {
        pos = ls + ((rawElapsed - le) % loopDur);
      } else {
        pos = Math.min(rawElapsed, le > 0 ? le : totalSec);
      }
    } else {
      pos = rawElapsed % totalSec;
    }

    const pxPos = (pos / totalSec) * steps * 40;
    ph.style.left = pxPos + 'px';

    const visW      = rollWrap.clientWidth;
    const gridW     = steps * 40;
    const canScroll = visW > 0 && gridW > visW;
    const loopWrap  = lastPos >= 0 && pos < lastPos - totalSec * 0.3;

    if (loopWrap) {
      const loopStartPx = edLoopEnabled ? edLoopStart * 40 : 0;
      rollWrap.scrollLeft = Math.max(0, loopStartPx - 20);
      ph.style.opacity = '0.3';
      setTimeout(() => { ph.style.opacity = '1'; }, 80);
    } else if (canScroll && pxPos > rollWrap.scrollLeft + visW - 80) {
      rollWrap.scrollLeft = pxPos - 60;
    }

    lastPos = pos;
    edAnimId = requestAnimationFrame(frame);
  }
  frame();
}

// ─────────────────────────────────────────────────────────────────────────────
// MIDI EXPORT (pure JS)
// ─────────────────────────────────────────────────────────────────────────────
function writeMidi(notes, bpm, steps, stepBeats) {
  const BEAT_TICKS = 480;

  function writeVarLen(val) {
    if (val < 0x80) return [val];
    const bytes = [];
    bytes.unshift(val & 0x7f);
    val >>= 7;
    while (val > 0) { bytes.unshift((val & 0x7f) | 0x80); val >>= 7; }
    return bytes;
  }

  function be4(val) {
    return [(val >> 24) & 0xff, (val >> 16) & 0xff, (val >> 8) & 0xff, val & 0xff];
  }

  function be2(val) {
    return [(val >> 8) & 0xff, val & 0xff];
  }

  function makeTrack(events) {
    events.sort((a,b) => a.tick - b.tick);
    const bytes = [];
    let lastTick = 0;
    for (const ev of events) {
      const delta = ev.tick - lastTick;
      lastTick = ev.tick;
      bytes.push(...writeVarLen(delta));
      bytes.push(...ev.data);
    }
    bytes.push(0x00, 0xff, 0x2f, 0x00);
    return bytes;
  }

  const stepTicks = Math.round(BEAT_TICKS * stepBeats);
  const tempo     = Math.round(60000000 / bpm);

  const tempoTrack = makeTrack([{
    tick: 0,
    data: [0xff, 0x51, 0x03, (tempo>>16)&0xff, (tempo>>8)&0xff, tempo&0xff]
  }]);

  const byTrack = new Map();
  ED_TRACKS.forEach((_, tid) => byTrack.set(tid, []));
  notes.forEach(n => {
    if (!byTrack.has(n.track)) byTrack.set(n.track, []);
    byTrack.get(n.track).push(n);
  });

  const midiTracks = [tempoTrack];
  let chIdx = 0;
  byTrack.forEach((tNotes, tid) => {
    const ch = chIdx++;
    const track   = ED_TRACKS[tid] || { program: 0, bank: 0 };
    const events  = [];

    events.push({ tick: 0, data: [0xC0 | ch, track.program & 0x7f] });
    if (track.bank > 0) {
      events.push({ tick: 0, data: [0xB0 | ch, 0x00, (track.bank >> 7) & 0x7f] });
      events.push({ tick: 0, data: [0xB0 | ch, 0x20, track.bank & 0x7f] });
    }

    tNotes.forEach(n => {
      const startTick = n.step * stepTicks;
      const endTick   = startTick + n.duration * stepTicks - 1;
      const vel       = n.velocity || 90;
      events.push({ tick: startTick, data: [0x90 | ch, n.note & 0x7f, vel & 0x7f] });
      events.push({ tick: endTick,   data: [0x80 | ch, n.note & 0x7f, 0x00] });
    });

    midiTracks.push(makeTrack(events));
  });

  const numTracks = midiTracks.length;
  const header = [
    0x4d, 0x54, 0x68, 0x64,
    0x00, 0x00, 0x00, 0x06,
    0x00, 0x01,
    ...be2(numTracks),
    ...be2(BEAT_TICKS),
  ];

  const all = [...header];
  midiTracks.forEach(t => {
    all.push(0x4d, 0x54, 0x72, 0x6b);
    all.push(...be4(t.length));
    all.push(...t);
  });

  return new Uint8Array(all).buffer;
}

function edExportMidi() {
  if (edNotes.length === 0) { edSetStatus('nothing to export'); return; }
  const bpm    = parseFloat(document.getElementById('ed-bpm').value) || 120;
  const steps  = edGetSteps();
  const stepB  = edGetStepBeats();

  const projectName = (document.getElementById('ed-project-name')?.value.trim() || 'barn-midi')
    .replace(/[^a-z0-9_\-\s]/gi, '').replace(/\s+/g, '-') || 'barn-midi';
  const buf  = writeMidi(edNotes, bpm, steps, stepB);
  const blob = new Blob([buf], {type: 'audio/midi'});
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = projectName + '.mid';
  a.click();
  URL.revokeObjectURL(url);
  edSetStatus('exported');
}
