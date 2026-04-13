// ─────────────────────────────────────────────────────────────────────────────
// COLLAB TAB
// ─────────────────────────────────────────────────────────────────────────────
let cbInRoom        = false;
let cbRoomCode      = null;
let cbIsHost        = false;
let cbMyColorIdx    = 0;
let cbMyRole        = null;       // 'lead'|'bass'|'drums'
let cbSelectedRole  = null;       // picked in lobby
let cbRoomUsers     = [];         // [{name,color,color_idx,is_host,role}]
let cbNotes         = [];         // [{note,step,duration,velocity,user_idx}]
let cbCellMap       = new Map();
let cbBuilt         = 0;
let cbBpm           = 120;
let cbSteps         = 32;
let cbStepBeats     = 0.5;
let cbAudioSource   = null;
let cbIsPlaying     = false;
let cbPlayCtxStart  = 0;    // ctx.currentTime when current playback loop began
let cbPlayLoopSecs  = 0;    // duration of one loop in seconds (for resume-on-rerender)
let cbSf            = 'pokemon';
let cbRoleInstruments = {
  lead:  { bank: 0,   program: 80 },
  bass:  { bank: 0,   program: 38 },
  drums: { bank: 128, program: 0  },
};

const CB_ROLES      = ['lead', 'bass', 'drums'];
const CB_ROLE_ICONS = { lead: '♪', bass: '♩', drums: '♦' };
const CB_ROLE_COLORS = { lead: '#c8a84b', bass: '#4b8bc8', drums: '#5ca87a' };

// ── sample cache — one AudioBuffer covers all notes, manifest maps midi→start_s ──
let cbSampleBuffer   = null;
let cbSampleManifest = {};
let cbSampleSlotDur  = 0.45;
let cbSampleKey      = null;  // "${sf}:${bank}:${program}" — invalidate on change

function cbPrefetchSamples() {
  if (!wsReady || !cbMyRole) return;
  const inst = cbRoleInstruments[cbMyRole] || { bank: 0, program: 0 };
  const key  = `${cbSf}:${inst.bank}:${inst.program}`;
  if (key === cbSampleKey) return;
  cbSampleBuffer  = null;
  cbSampleManifest = {};
  cbSampleKey     = null;
  ws.send(JSON.stringify({
    type: 'preview_samples',
    bank: inst.bank, program: inst.program, sf: cbSf,
    note_bot: NOTE_BOT, note_top: NOTE_TOP,
  }));
}

function cbSelectRole(role) {
  const btn = document.getElementById(`cb-role-btn-${role}`);
  if (btn && btn.disabled) return;
  cbSelectedRole = role;
  CB_ROLES.forEach(r => document.getElementById(`cb-role-btn-${r}`)?.classList.toggle('selected', r === role));
}

function cbCodeChanged() {
  const code = document.getElementById('cb-code-input').value.trim();
  if (code.length === 4 && wsReady) {
    ws.send(JSON.stringify({ type: 'collab_room_info', code }));
  } else if (code.length < 4) {
    cbResetRoleBtns({});
  }
}

function cbResetRoleBtns(roleInfo) {
  CB_ROLES.forEach(r => {
    const btn  = document.getElementById(`cb-role-btn-${r}`);
    const user = document.getElementById(`cb-role-user-${r}`);
    if (!btn) return;
    const taken = !!(roleInfo && roleInfo[r]);
    btn.disabled = taken;
    btn.classList.toggle('selected', cbSelectedRole === r && !taken);
    if (user) user.textContent = taken ? roleInfo[r].name : '';
    if (taken && cbSelectedRole === r) cbSelectedRole = null;
  });
}

function cbGetSpb() {
  return Math.round(1 / cbStepBeats) * 2;
}

function cbPreviewNote(midi) {
  const ctx  = getEdCtx();
  const dest = edGainNode || ctx.destination;

  if (cbSampleBuffer && cbSampleManifest[midi] != null) {
    const offset = cbSampleManifest[midi];
    const playDur = cbSampleSlotDur * 0.9;
    const src  = ctx.createBufferSource();
    src.buffer = cbSampleBuffer;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.85, ctx.currentTime);
    gain.gain.setValueAtTime(0.85, ctx.currentTime + playDur * 0.6);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + playDur);
    src.connect(gain); gain.connect(dest);
    src.start(ctx.currentTime, offset, playDur);
    return;
  }

  cbPrefetchSamples();
}

function buildCbKeys() {
  const el = document.getElementById('ed-keys');
  if (!el) return;
  while (el.firstChild) el.removeChild(el.firstChild);
  const isDrums = cbMyRole === 'drums';
  const labelFn = isDrums
    ? midi => ({ text: GM_DRUM[midi]?.[0] ?? '?', title: GM_DRUM[midi]?.[1] ?? `Note ${midi}` })
    : null;
  buildPianoKeys(el, cbPreviewNote, labelFn);
  const spacer = document.createElement('div');
  spacer.style.cssText = 'height:16px;flex-shrink:0;border-bottom:1px solid rgba(75,139,200,0.2);background:#111120;';
  el.insertBefore(spacer, el.firstChild);
}

function buildCbGrid(steps) {
  edBuilt = 0;
  buildEdGrid(steps);
}

function cbCellClick(midi, step) {
  if (!cbInRoom || !wsReady) return;
  const existing = cbNotes.find(n => n.note === midi && step >= n.step && step < n.step + (n.duration || 1));
  if (existing) {
    ws.send(JSON.stringify({ type: 'collab_note', action: 'remove', note: existing.note, step: existing.step }));
  } else {
    ws.send(JSON.stringify({ type: 'collab_note', action: 'add', note: midi, step, duration: 1, velocity: 90 }));
  }
}

let cbReRenderTimer = null;
function cbApplyNote(action, note, step, duration, velocity, user_idx) {
  cbNotes = cbNotes.filter(n => !(n.note === note && n.step === step));
  if (action === 'add') cbNotes.push({ note, step, duration: duration || 1, velocity: velocity || 90, user_idx: user_idx || 0 });
  cbRefreshGrid();
  document.getElementById('ed-note-count').textContent = cbNotes.length;
  if ((cbIsPlaying || cbAudioSource) && wsReady) {
    clearTimeout(cbReRenderTimer);
    cbReRenderTimer = setTimeout(() => {
      if (!wsReady) return;
      if (cbNotes.length === 0) {
        ws.send(JSON.stringify({ type: 'collab_play', action: 'stop' }));
        cbStopPlayback();
      } else {
        ws.send(JSON.stringify({ type: 'collab_play', action: 'play' }));
      }
    }, 600);
  }
}

function cbUpdateUsers(users) {
  cbRoomUsers = users;
  const el = document.getElementById('cb-users');
  if (el) {
    el.innerHTML = users.map(u => {
      const isMe = u.color_idx === cbMyColorIdx;
      return `<span class="cb-user-pill${isMe ? ' is-me' : ''}"
        style="border-color:${u.color};color:${u.color}"
        title="${isMe ? 'click to rename' : ''}"
        ${isMe ? 'onclick="cbStartRename(this)"' : ''}>
        ${u.is_host ? '★ ' : ''}${CB_ROLE_ICONS[u.role] || ''} ${u.name}</span>`;
    }).join('');
  }
  ['cb-role-switch', 'cb-role-switch-strip'].forEach(id => {
    const sw = document.getElementById(id);
    if (!sw) return;
    const takenRoles = new Set(users.map(u => u.role));
    sw.innerHTML = CB_ROLES.map(r => {
      const isMine = r === cbMyRole;
      const taken  = takenRoles.has(r) && !isMine;
      return `<button class="cb-role-switch-btn${isMine ? ' mine' : ''}"
        ${taken ? 'disabled' : ''}
        onclick="cbChangeRole('${r}')"
        title="${taken ? users.find(u=>u.role===r)?.name||'taken' : 'switch to '+r}"
      >${CB_ROLE_ICONS[r]} ${r}</button>`;
    }).join('');
  });
  const stripUsers = document.getElementById('cb-users-strip');
  if (stripUsers) {
    stripUsers.innerHTML = users.map(u => {
      const isMe = u.color_idx === cbMyColorIdx;
      return `<span class="cb-user-pill${isMe ? ' is-me' : ''}"
        style="border-color:${u.color};color:${u.color}"
        title="${isMe ? 'click to rename' : ''}"
        ${isMe ? 'onclick="cbStartRename(this)"' : ''}>
        ${u.is_host ? '★ ' : ''}${CB_ROLE_ICONS[u.role] || ''} ${u.name}</span>`;
    }).join('');
  }
  if (cbInRoom) buildTrackUI();
}

// ── name change ───────────────────────────────────────────────────────────────
function cbStartRename(pill) {
  if (pill.querySelector('.rename-input')) return;
  const currentName = pill.textContent.replace(/^[★♪♩♦]\s*/, '').trim();
  const input = document.createElement('input');
  input.className = 'rename-input';
  input.value     = currentName;
  input.maxLength = 20;
  pill.innerHTML  = '';
  pill.appendChild(input);
  input.focus();
  input.select();
  function commit() {
    const name = input.value.trim() || currentName;
    if (name !== currentName && wsReady && cbInRoom) {
      ws.send(JSON.stringify({ type: 'collab_rename', name }));
    }
    pill.textContent = name;
  }
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); if (e.key === 'Escape') { input.value = currentName; input.blur(); } });
}

// ── cursors ───────────────────────────────────────────────────────────────────
const cbCursors = new Map(); // user_idx → last cell el
let cbCursorTimer = null;

function cbSendCursor(midi, step) {
  if (!wsReady || !cbInRoom) return;
  clearTimeout(cbCursorTimer);
  cbCursorTimer = setTimeout(() => {
    ws.send(JSON.stringify({ type: 'collab_cursor', midi, step }));
  }, 60);
}

function cbSetCursor(userIdx, color, midi, step) {
  const oldEl = cbCursors.get(userIdx);
  if (oldEl) { const dot = oldEl.querySelector(`.cb-cursor-dot[data-user="${userIdx}"]`); if (dot) dot.remove(); }
  if (midi == null || step == null) { cbCursors.delete(userIdx); return; }
  const rowIdx = NOTES.indexOf(midi);
  if (rowIdx < 0) return;
  const cell = cbCellMap.get(`${rowIdx}-${step}`);
  if (!cell) return;
  cbCursors.set(userIdx, cell);
  const dot = document.createElement('div');
  dot.className = 'cb-cursor-dot';
  dot.dataset.user = userIdx;
  dot.style.background = color;
  cell.appendChild(dot);
}

function cbClearAllCursors() {
  cbCursors.forEach((el, idx) => { const dot = el?.querySelector(`.cb-cursor-dot[data-user="${idx}"]`); if (dot) dot.remove(); });
  cbCursors.clear();
}

function cbShowRoom(code) {
  document.getElementById('cb-lobby').style.display = 'none';
  document.getElementById('cb-room').style.display  = 'flex';
  document.getElementById('cb-room-code').textContent = code;
}

function cbCreate() {
  if (!wsReady) { document.getElementById('cb-error').textContent = 'not connected'; return; }
  if (!cbSelectedRole) { document.getElementById('cb-error').textContent = 'pick a role first'; return; }
  const name = document.getElementById('cb-name-input').value.trim() || 'anon';
  document.getElementById('cb-error').textContent = '';
  ws.send(JSON.stringify({ type: 'collab_create', name, role: cbSelectedRole }));
}

function cbJoin() {
  if (!wsReady) { document.getElementById('cb-error').textContent = 'not connected'; return; }
  if (!cbSelectedRole) { document.getElementById('cb-error').textContent = 'pick a role first'; return; }
  const name = document.getElementById('cb-name-input').value.trim() || 'anon';
  const code = document.getElementById('cb-code-input').value.trim();
  if (!code) { document.getElementById('cb-error').textContent = 'enter a room code'; return; }
  document.getElementById('cb-error').textContent = '';
  ws.send(JSON.stringify({ type: 'collab_join', name, code, role: cbSelectedRole }));
}

function cbChangeRole(newRole) {
  if (!wsReady || !cbInRoom || newRole === cbMyRole) return;
  ws.send(JSON.stringify({ type: 'collab_change_role', role: newRole }));
}

function cbLeave() {
  if (!wsReady || !cbInRoom) return;
  ws.send(JSON.stringify({ type: 'collab_leave' }));
  cbInRoom = false;
  cbRoomCode = null;
  cbNotes = [];
  cbCellMap.clear();
  cbBuilt = 0;
  cbStopPlayback();
}

function cbSendBpm() {
  if (!wsReady || !cbInRoom) return;
  const bpm = parseInt(document.getElementById('cb-bpm').value);
  if (bpm >= 40 && bpm <= 280) ws.send(JSON.stringify({ type: 'collab_bpm', bpm }));
}

function cbPlay() {
  if (!wsReady || !cbInRoom) return;
  document.getElementById('ed-status').textContent = 'rendering…';
  ws.send(JSON.stringify({ type: 'collab_play', action: 'play' }));
}

function cbStop() {
  if (!wsReady || !cbInRoom) return;
  ws.send(JSON.stringify({ type: 'collab_play', action: 'stop' }));
}

function cbStopPlayback() {
  if (cbAudioSource) { try { cbAudioSource.stop(); } catch(e){} cbAudioSource = null; }
  cbIsPlaying    = false;
  cbPlayCtxStart = 0;
  cbPlayLoopSecs = 0;
  const ph = document.getElementById('ed-playhead');
  if (ph) ph.style.display = 'none';
  document.getElementById('ed-status').textContent = '';
}

async function cbReceiveAudio(audioB64, bpm, steps, stepBeats) {
  const ctx0 = getCtx();
  let resumeOffset = 0;
  if (cbAudioSource && cbPlayLoopSecs > 0) {
    resumeOffset = (ctx0.currentTime - cbPlayCtxStart) % cbPlayLoopSecs;
  }
  cbStopPlayback();
  const ctx = getCtx();
  try {
    const buf = await ctx.decodeAudioData(b64ToArrayBuffer(audioB64));
    const src = ctx.createBufferSource();
    const cbLooping = document.getElementById('cb-loop-toggle')?.checked ?? true;
    src.buffer = buf;
    src.loop = cbLooping;
    src.connect(gainNode || ctx.destination);
    const loopSecs  = steps * stepBeats * (60 / bpm);
    const safeOffset = resumeOffset % loopSecs;
    src.start(0, safeOffset);
    cbAudioSource  = src;
    cbIsPlaying    = true;
    cbPlayLoopSecs = loopSecs;
    cbPlayCtxStart = ctx.currentTime - safeOffset;
    document.getElementById('ed-status').textContent = cbLooping ? 'playing ↺' : 'playing';
    src.onended = () => { if (!cbLooping) cbStopPlayback(); };
    const totalPx = steps * 40;
    const ph      = document.getElementById('ed-playhead');
    if (ph) {
      ph.style.display = 'block';
      function animCb() {
        if (!cbIsPlaying || !cbAudioSource) { ph.style.display = 'none'; return; }
        const elapsed = cbLooping
          ? (ctx.currentTime - cbPlayCtxStart) % loopSecs
          : Math.min(ctx.currentTime - cbPlayCtxStart, loopSecs);
        ph.style.left = (elapsed / loopSecs * totalPx) + 'px';
        requestAnimationFrame(animCb);
      }
      requestAnimationFrame(animCb);
    }
  } catch(e) { console.error('cb audio:', e); document.getElementById('ed-status').textContent = 'audio error'; }
}

function cbExportMidi() {
  if (!cbNotes.length) { document.getElementById('ed-status').textContent = 'nothing to export'; return; }
  const buf  = writeMidi(cbNotes, cbBpm, cbSteps, cbStepBeats);
  const blob = new Blob([buf], {type: 'audio/midi'});
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `collab-${cbRoomCode || 'room'}.mid`;
  a.click();
  URL.revokeObjectURL(url);
}

function cbImportMidi(input) {
  const file = input.files[0];
  if (!file) return;
  if (!confirm(`import "${file.name}" for everyone in this room? this will replace all current notes.`)) {
    input.value = ''; return;
  }
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const { bpm, stepBeats, notes } = parseMidi(e.target.result);
      const maxStep = notes.reduce((m, n) => Math.max(m, n.step + n.duration), 0);
      let steps = 16;
      if (maxStep > 16) steps = 32;
      if (maxStep > 32) steps = 64;
      const filtered = notes.filter(n => n.note >= NOTE_BOT && n.note <= NOTE_TOP && n.step < steps);
      if (!wsReady || !cbInRoom) return;
      ws.send(JSON.stringify({
        type: 'collab_import_request',
        data: { notes: filtered, bpm, stepBeats, steps },
      }));
    } catch(err) { document.getElementById('ed-status').textContent = 'import parse failed'; }
  };
  reader.readAsArrayBuffer(file);
  input.value = '';
}

function cbImportVote(accept) {
  if (!wsReady || !cbInRoom) return;
  ws.send(JSON.stringify({ type: 'collab_import_vote', accept }));
  document.getElementById('cb-import-waiting').textContent = accept ? 'waiting for others…' : '';
  if (!accept) document.getElementById('cb-import-overlay').style.display = 'none';
  document.querySelectorAll('#cb-import-overlay button').forEach(b => b.disabled = true);
}

function cbClearAll() {
  if (!wsReady || !cbInRoom) return;
  if (!confirm('clear all notes for everyone in this room?')) return;
  ws.send(JSON.stringify({ type: 'collab_clear' }));
}

// wrap solo clear-all so it works while in a room
const _edClear_orig = window.edClear;
function edClear(allTracks) {
  if (cbInRoom && allTracks) {
    if (!confirm('clear all notes for everyone in this room?')) return;
    ws.send(JSON.stringify({ type: 'collab_clear' }));
    return;
  }
  if (typeof _edClear_orig === 'function') _edClear_orig(allTracks);
}

// ── collab instrument picker ──────────────────────────────────────────────────
function cbGetInstEls() {
  const role = cbMyRole;
  if (cbInRoom && role) {
    return {
      sfSel: document.getElementById(`cb-track-sf-${role}`),
      pgSel: document.getElementById(`cb-track-prog-${role}`),
    };
  }
  return {
    sfSel: document.getElementById('cb-inst-sf'),
    pgSel: document.getElementById('cb-inst-prog'),
  };
}

function cbBuildInstPicker() {
  const role = cbMyRole;
  if (!role) return;
  const { sfSel, pgSel } = cbGetInstEls();
  if (!sfSel || !pgSel) return;

  sfSel.value = cbSf;

  const inst    = cbRoleInstruments[role] || {};
  const bankNum = role === 'drums' ? 128 : (inst.bank ?? 0);
  const sfData  = INST_DATA[cbSf];
  const presets = sfData?.banks[bankNum] || [];
  pgSel.innerHTML = presets.map(([p, name]) => `<option value="${p}">${name}</option>`).join('');
  pgSel.value = inst.program ?? presets[0]?.[0] ?? 0;
}

function cbInstSfChange() {
  const { sfSel } = cbGetInstEls();
  if (!sfSel) return;
  cbSf = sfSel.value;
  cbBuildInstPicker();
  cbSendInstChange();
  cbPrefetchSamples();
}

function cbInstProgChange() {
  if (!cbMyRole) return;
  const { pgSel } = cbGetInstEls();
  if (!pgSel) return;
  const prog = parseInt(pgSel.value);
  const bank = cbMyRole === 'drums' ? 128 : (cbRoleInstruments[cbMyRole]?.bank ?? 0);
  cbRoleInstruments[cbMyRole] = { bank, program: prog };
  cbSendInstChange();
  cbPrefetchSamples();
}

function cbSendInstChange() {
  if (!wsReady || !cbInRoom || !cbMyRole) return;
  const inst = cbRoleInstruments[cbMyRole];
  ws.send(JSON.stringify({
    type: 'collab_inst_change',
    bank: inst.bank, program: inst.program, sf: cbSf,
  }));
}

// handle collab WS messages (called from ws.onmessage)
async function cbHandleMessage(msg) {
  if (msg.type === 'preview_samples') {
    const key  = `${msg.sf}:${msg.bank}:${msg.program}`;
    try {
      const decoded = await getEdCtx().decodeAudioData(b64ToArrayBuffer(msg.audio));
      cbSampleBuffer   = decoded;
      cbSampleManifest = msg.manifest;
      cbSampleSlotDur  = msg.slot_dur;
      cbSampleKey      = key;
    } catch (e) { console.warn('sample decode failed', e); }
    return;
  }
  if (msg.type === 'collab_room_info') {
    cbResetRoleBtns(msg.roles);
    joinResetRoleBtns(msg.roles);
    return;
  }
  if (msg.type === 'collab_joined') {
    cbInRoom     = true;
    cbRoomCode   = msg.code;
    cbIsHost     = msg.is_host;
    cbMyColorIdx = msg.your_color_idx;
    cbMyRole     = msg.your_role;
    cbBpm        = msg.state.bpm;
    cbSteps      = msg.state.steps;
    cbStepBeats  = msg.state.step_beats;
    cbNotes      = msg.state.notes || [];
    cbSf         = msg.state.sf || 'pokemon';
    if (msg.state.instruments) {
      Object.assign(cbRoleInstruments, msg.state.instruments);
    }
    document.getElementById('cb-bpm').value = cbBpm;
    const url = new URL(location.href);
    url.searchParams.set('room', msg.code);
    history.replaceState(null, '', url.toString());
    document.getElementById('join-overlay').style.display = 'none';
    edEnterCollabMode(msg.code);
    cbUpdateUsers(msg.users);
    cbRefreshGrid();
    cbBuildInstPicker();
    document.getElementById('ed-note-count').textContent = cbNotes.length;
    cbPrefetchSamples();
    return;
  }
  if (msg.type === 'collab_error') {
    const errEl = document.getElementById('join-error') || document.getElementById('ed-status');
    if (errEl) errEl.textContent = msg.msg;
    const collabBtn = document.getElementById('ed-collab-btn');
    if (collabBtn) collabBtn.textContent = '⇄ collab';
    edCollabPending = false;
    return;
  }
  if (!cbInRoom) return;
  if (msg.type === 'collab_role_confirm') {
    cbMyRole      = msg.your_role;
    cbMyColorIdx  = msg.your_color_idx;
    cbBuildInstPicker();
    cbSampleBuffer = null; cbSampleManifest = {}; cbSampleKey = null;
    cbPrefetchSamples();
    buildCbKeys();
    return;
  }
  if (msg.type === 'collab_user_joined' || msg.type === 'collab_user_left' || msg.type === 'collab_roles_update') {
    if (msg.type === 'collab_user_left') {
      const gone = cbRoomUsers.find(u => !msg.users.find(v => v.color_idx === u.color_idx));
      if (gone) cbSetCursor(gone.color_idx, null, null, null);
    }
    cbUpdateUsers(msg.users);
    return;
  }
  if (msg.type === 'collab_note') {
    cbApplyNote(msg.action, msg.note, msg.step, msg.duration, msg.velocity, msg.user_idx);
    return;
  }
  if (msg.type === 'collab_bpm') {
    cbBpm = msg.bpm;
    document.getElementById('cb-bpm').value = cbBpm;
    document.getElementById('ed-bpm').value = cbBpm;
    return;
  }
  if (msg.type === 'collab_play') {
    if (msg.action === 'stop') cbStopPlayback();
    return;
  }
  if (msg.type === 'collab_audio') {
    await cbReceiveAudio(msg.audio, msg.bpm, msg.steps, msg.step_beats);
    return;
  }
  if (msg.type === 'collab_inst_change') {
    cbRoleInstruments[msg.role] = { bank: msg.bank, program: msg.program };
    cbSf = msg.sf || cbSf;
    if (msg.role === cbMyRole) cbBuildInstPicker();
    return;
  }
  if (msg.type === 'collab_clear') {
    cbNotes = [];
    cbRefreshGrid();
    document.getElementById('ed-note-count').textContent = '0';
    cbStopPlayback();
    return;
  }
  if (msg.type === 'collab_import_pending') {
    const overlay = document.getElementById('cb-import-overlay');
    document.getElementById('cb-import-desc').textContent =
      `${msg.requester} wants to import ${msg.note_count} notes — this will overwrite everything`;
    document.getElementById('cb-import-waiting').textContent = '';
    document.querySelectorAll('#cb-import-overlay button').forEach(b => b.disabled = false);
    overlay.style.display = 'flex';
    return;
  }
  if (msg.type === 'collab_import_apply') {
    document.getElementById('cb-import-overlay').style.display = 'none';
    cbNotes     = msg.notes || [];
    cbBpm       = msg.bpm       || cbBpm;
    cbStepBeats = msg.step_beats || cbStepBeats;
    cbSteps     = msg.steps     || cbSteps;
    document.getElementById('cb-bpm').value = cbBpm;
    document.getElementById('ed-bpm').value = cbBpm;
    edBuilt = 0;
    buildEdGrid(cbSteps);
    edRefreshGrid();
    document.getElementById('ed-note-count').textContent = cbNotes.length;
    cbStopPlayback();
    document.getElementById('ed-status').textContent = `imported ${cbNotes.length} notes`;
    return;
  }
  if (msg.type === 'collab_import_cancelled') {
    document.getElementById('cb-import-overlay').style.display = 'none';
    document.getElementById('ed-status').textContent = `import rejected by ${msg.rejector}`;
    return;
  }
  if (msg.type === 'collab_cursor') {
    const user = cbRoomUsers.find(u => u.color_idx === msg.user_idx);
    if (user) cbSetCursor(msg.user_idx, user.color, msg.midi, msg.step);
    return;
  }
  if (msg.type === 'collab_renamed') {
    cbUpdateUsers(msg.users);
    return;
  }
}

// ── collab-in-editor helpers ──────────────────────────────────────────────────

let edCollabPending = false;

function edStartCollab() {
  if (cbInRoom) return;
  const ov = document.getElementById('create-overlay');
  ov.style.display = 'flex';
  document.getElementById('create-name').focus();
}

let createSelectedRole = 'lead';
function createSelectRole(role) {
  createSelectedRole = role;
  CB_ROLES.forEach(r => document.getElementById(`create-role-btn-${r}`)?.classList.toggle('selected', r === role));
}
function createConfirm() {
  const name = document.getElementById('create-name').value.trim() || 'anon';
  document.getElementById('create-error').textContent = '';
  document.getElementById('create-overlay').style.display = 'none';
  const btn = document.getElementById('ed-collab-btn');
  if (btn) btn.textContent = 'connecting…';
  edCollabPending = true;
  cbSelectedRole = createSelectedRole;
  ensureWS(() => {
    ws.send(JSON.stringify({ type: 'collab_create', name, role: cbSelectedRole }));
  });
}
function createDismiss() {
  document.getElementById('create-overlay').style.display = 'none';
}

function edEnterCollabMode(code) {
  edCollabPending = false;
  document.getElementById('ed-bpm').value = cbBpm;
  document.getElementById('ed-solo-toolbar').style.display = '';
  const tracksWrap = document.getElementById('ed-tracks');
  if (tracksWrap) tracksWrap.style.display = '';
  document.getElementById('ed-collab-toolbar').style.display = 'none';
  const strip = document.getElementById('ed-room-strip');
  if (strip) { strip.style.display = ''; strip.querySelector('#ed-room-code-strip').textContent = code; }
  edBuilt = 0;
  buildCbKeys();
  buildEdGrid(cbSteps);
  buildTrackUI();
  edRefreshGrid();
}

function edExitCollabMode() {
  document.getElementById('ed-collab-toolbar').style.display = 'none';
  document.getElementById('ed-solo-toolbar').style.display = '';
  const strip = document.getElementById('ed-room-strip');
  if (strip) strip.style.display = 'none';
  const tracksWrap = document.getElementById('ed-tracks');
  if (tracksWrap) tracksWrap.style.display = '';
  const btn = document.getElementById('ed-collab-btn');
  if (btn) btn.textContent = '⇄ collab';
  edBuilt = 0;
  buildEdKeys();
  buildEdGrid(edGetSteps());
  buildTrackUI();
  edRefreshGrid();
  edUpdateFooter();
}

function edLeaveCollab() {
  if (!cbInRoom) { edExitCollabMode(); return; }
  if (wsReady) ws.send(JSON.stringify({ type: 'collab_leave' }));
  cbClearAllCursors();
  cbInRoom        = false;
  cbRoomCode      = null;
  cbNotes         = [];
  cbCellMap.clear();
  cbBuilt         = 0;
  cbSampleBuffer  = null;
  cbSampleManifest = {};
  cbSampleKey     = null;
  cbStopPlayback();
  const url = new URL(location.href);
  url.searchParams.delete('room');
  history.replaceState(null, '', url.toString());
  edExitCollabMode();
}

const MIDI_SAVE_BASE = '/toys/save';

function edCopyShareLink(btn) {
  const popup = document.getElementById('share-popup');
  const input = document.getElementById('share-name-input');

  // show/hide overwrite button based on whether we have an existing ID
  const currentId = new URLSearchParams(location.search).get('id');
  document.getElementById('share-overwrite-btn').style.display = currentId ? '' : 'none';
  const newBtn = document.getElementById('share-new-btn');
  newBtn.textContent = currentId ? 'share new' : 'share';

  // position near the button
  if (btn) {
    const r = btn.getBoundingClientRect();
    popup.style.top  = (r.bottom + 8) + 'px';
    popup.style.left = Math.max(8, r.left - 60) + 'px';
    popup.style.transform = '';
  }

  popup.style.display = 'flex';
  input.value = document.getElementById('ed-project-name')?.value.trim() || '';
  input.focus();
  input.select();

  // draggable
  const drag = document.getElementById('share-popup-drag');
  let ox = 0, oy = 0, dragging = false;
  drag.onmousedown = e => {
    dragging = true;
    ox = e.clientX - popup.getBoundingClientRect().left;
    oy = e.clientY - popup.getBoundingClientRect().top;
    drag.style.cursor = 'grabbing';
    e.preventDefault();
  };
  document.onmousemove = e => {
    if (!dragging) return;
    popup.style.left = (e.clientX - ox) + 'px';
    popup.style.top  = (e.clientY - oy) + 'px';
  };
  document.onmouseup = () => { dragging = false; drag.style.cursor = 'grab'; };
}

function shareDismiss() {
  document.getElementById('share-popup').style.display = 'none';
  document.onmousemove = null;
  document.onmouseup  = null;
}

async function shareConfirm(mode) {
  const input  = document.getElementById('share-name-input');
  const name   = input.value.trim() || 'untitled';
  const newBtn = document.getElementById('share-new-btn');
  const owBtn  = document.getElementById('share-overwrite-btn');
  [newBtn, owBtn].forEach(b => { if (b) b.disabled = true; });

  const currentId = new URLSearchParams(location.search).get('id');
  const overwrite = mode === 'overwrite' && currentId;

  try {
    const state = edPackState();
    const res = overwrite
      ? await fetch(MIDI_SAVE_BASE + '/update/' + currentId, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer bArNLiKeADaPiZzA' },
          body: JSON.stringify({ state, name }),
        })
      : await fetch(MIDI_SAVE_BASE + '/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer bArNLiKeADaPiZzA' },
          body: JSON.stringify({ state, name }),
        });
    if (!res.ok) throw new Error('server error');
    const { id } = await res.json();
    edLoadedFromId = true;
    const url = new URL(location.href);
    url.search = '?id=' + id;
    url.hash   = '#editor';
    history.replaceState(null, '', url.toString());
    await navigator.clipboard.writeText(url.toString());
    const nameEl = document.getElementById('ed-project-name');
    if (nameEl) nameEl.value = name;
    edSetStatus((overwrite ? 'updated: ' : 'link copied — ') + name);
    shareDismiss();
  } catch (e) {
    edSetStatus('share failed');
  } finally {
    [newBtn, owBtn].forEach(b => { if (b) b.disabled = false; });
    if (newBtn) newBtn.textContent = currentId ? 'share new' : 'share';
  }
}

function edCopyLink() {
  if (!cbRoomCode) return;
  const url = new URL(location.href);
  url.searchParams.set('room', cbRoomCode);
  navigator.clipboard.writeText(url.toString()).then(() => {
    const btn = document.querySelector('#ed-collab-toolbar button[onclick="edCopyLink()"]');
    if (btn) { btn.textContent = 'copied!'; setTimeout(() => btn.textContent = 'copy link', 1500); }
  });
}

// ── join overlay (URL-based) ──────────────────────────────────────────────────
let joinSelectedRole = null;

function joinSelectRole(role) {
  const btn = document.getElementById(`join-role-btn-${role}`);
  if (btn && btn.disabled) return;
  joinSelectedRole = role;
  CB_ROLES.forEach(r => document.getElementById(`join-role-btn-${r}`)?.classList.toggle('selected', r === role));
}

function joinResetRoleBtns(roleInfo) {
  CB_ROLES.forEach(r => {
    const btn  = document.getElementById(`join-role-btn-${r}`);
    const user = document.getElementById(`join-role-user-${r}`);
    if (!btn) return;
    const taken = !!(roleInfo && roleInfo[r]);
    btn.disabled = taken;
    btn.classList.toggle('selected', joinSelectedRole === r && !taken);
    if (user) user.textContent = taken ? roleInfo[r].name : '';
    if (taken && joinSelectedRole === r) joinSelectedRole = null;
  });
}

function joinConfirm() {
  if (!joinSelectedRole) { document.getElementById('join-error').textContent = 'pick a role'; return; }
  const name = document.getElementById('join-name').value.trim() || 'anon';
  const code = document.getElementById('join-code-display').textContent;
  document.getElementById('join-error').textContent = '';
  ensureWS(() => {
    ws.send(JSON.stringify({ type: 'collab_join', name, code, role: joinSelectedRole }));
  });
}

function joinDismiss() {
  document.getElementById('join-overlay').style.display = 'none';
  const url = new URL(location.href);
  url.searchParams.delete('room');
  history.replaceState(null, '', url.toString());
}

// ── URL state persistence (solo editor) ──────────────────────────────────────
const _SF_KEYS  = ['pokemon','megadrive','msgs'];
const _SPB_KEYS = ['0.25','0.5','1.0'];

function _u8encode(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
}
function _u8decode(str) {
  str = str.replace(/-/g,'+').replace(/_/g,'/');
  while (str.length % 4) str += '=';
  return Uint8Array.from(atob(str), c => c.charCodeAt(0));
}

function edPackState() {
  const bpm  = Math.min(65535, Math.round(parseFloat(document.getElementById('ed-bpm').value) || 120));
  const bars = edBarCount & 0xff;
  const spb  = document.getElementById('ed-stepsize').value;
  const sf   = ED_TRACKS[0]?.sf || 'pokemon';
  const spbI = Math.max(0, _SPB_KEYS.indexOf(spb));
  const sfI  = Math.max(0, _SF_KEYS.indexOf(sf));
  const nTr  = ED_TRACKS.length & 0x0f;

  const bytes = [
    3,
    (bpm >> 8) & 0xff, bpm & 0xff,
    bars,
    (spbI << 6) | (sfI << 4) | nTr,
  ];
  ED_TRACKS.forEach(t => {
    bytes.push((t.bank >> 8) & 0xff, t.bank & 0xff, t.program & 0x7f);
  });
  edNotes.forEach(n => {
    bytes.push(
      n.note & 0x7f,
      Math.min(255, n.step || 0) & 0xff,
      ((Math.min(15, (n.duration || 1) - 1)) << 4) | ((n.track || 0) & 0x0f),
    );
  });
  return _u8encode(new Uint8Array(bytes));
}

function edUnpackState(encoded) {
  const data = _u8decode(encoded);
  let p = 0;
  const r8  = () => data[p++];
  const r16 = () => { const h = r8(), l = r8(); return (h << 8) | l; };

  const ver = r8();

  if (ver === 2) {
    const bpm  = r16();
    const bars = r8();
    const spb  = _SPB_KEYS[r8()] || '0.5';
    const sf   = _SF_KEYS[r8()]  || 'pokemon';
    const nTr  = r8();
    const tracks = [];
    for (let i = 0; i < nTr; i++) {
      const bank = r16(), program = r8();
      tracks.push({ bank, program, sf });
    }
    const nN = r16();
    const notes = [];
    for (let i = 0; i < nN; i++) {
      const note = r8(), step = r16(), velocity = r8(), duration = r8(), track = r8();
      notes.push({ note, step, velocity, duration, track });
    }
    return { bpm, bars, spb, sf, tracks, notes };
  }

  if (ver === 3) {
    const bpm   = r16();
    const bars  = r8();
    const flags = r8();
    const spbI  = (flags >> 6) & 0x03;
    const sfI   = (flags >> 4) & 0x03;
    const nTr   = flags & 0x0f;
    const spb   = _SPB_KEYS[spbI] || '0.5';
    const sf    = _SF_KEYS[sfI]   || 'pokemon';
    const tracks = [];
    for (let i = 0; i < nTr; i++) {
      const bank = r16(), program = r8();
      tracks.push({ bank, program, sf });
    }
    const notes = [];
    while (p + 2 < data.length) {
      const note     = r8();
      const step     = r8();
      const packed   = r8();
      const duration = ((packed >> 4) & 0x0f) + 1;
      const track    = packed & 0x0f;
      notes.push({ note, step, velocity: 90, duration, track });
    }
    return { bpm, bars, spb, sf, tracks, notes };
  }

  return null;
}

let _edSaveTimer   = null;
let edLoadedFromId = false; // suppress URL auto-save when loaded from a share ID

function edSaveToURL() {
  if (edLoadedFromId) return; // keep URL clean — user must explicitly share to get a new ID
  clearTimeout(_edSaveTimer);
  _edSaveTimer = setTimeout(() => {
    const url = new URL(location.href);
    url.searchParams.set('s', edPackState());
    history.replaceState(null, '', url.toString());
  }, 400);
}

function _edApplyState(state) {
  document.getElementById('ed-bpm').value = state.bpm;
  edBarCount = state.bars || 4;
  document.getElementById('ed-bars-display').textContent = edBarCount;
  document.getElementById('ed-stepsize').value = state.spb;
  state.tracks.forEach((t, i) => {
    if (!ED_TRACKS[i]) return;
    ED_TRACKS[i].sf      = t.sf;
    ED_TRACKS[i].bank    = t.bank;
    ED_TRACKS[i].program = t.program;
  });
  const sfGlobal = document.getElementById('ed-sf-global');
  if (sfGlobal) sfGlobal.value = state.sf;
  buildTrackUI();
  edNotes = state.notes;
  edBuilt = 0;
  buildEdGrid(edGetSteps());
  edRefreshGrid();
  edUpdateFooter();
}

function edRestoreFromURL() {
  const encoded = new URLSearchParams(location.search).get('s');
  if (!encoded) return false;
  try {
    const state = edUnpackState(encoded);
    if (!state) return false;
    _edApplyState(state);
    return true;
  } catch (e) {
    console.warn('edRestoreFromURL failed:', e);
    return false;
  }
}

function initFromURL() {
  const params = new URLSearchParams(location.search);
  const code   = params.get('room');
  if (code) {
    const overlay = document.getElementById('join-overlay');
    overlay.style.display = 'flex';
    document.getElementById('join-code-display').textContent = code;
    ensureWS(() => {
      ws.send(JSON.stringify({ type: 'collab_room_info', code }));
    });
  }

  const shareId = params.get('id');
  if (shareId) {
    edLoadedFromId = true;
    fetch(MIDI_SAVE_BASE + '/load/' + shareId)
      .then(r => { if (!r.ok) throw new Error('not found'); return r.json(); })
      .then(({ state, name }) => {
        const parsed = edUnpackState(state);
        if (parsed) {
          // reuse the existing apply logic via a fake URL restore
          _edApplyState(parsed);
          edSetStatus('loaded: ' + name);
        }
      })
      .catch(() => {
        edLoadedFromId = false;
        edSetStatus('share link expired or invalid');
        edRestoreFromURL(); // fall back to ?s= if present
      });
  } else {
    edRestoreFromURL();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// WEBSOCKET
// ─────────────────────────────────────────────────────────────────────────────
function ensureWS(callback) {
  if (wsReady) { if (callback) callback(); return; }
  if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
    connectWS();
  }
  if (callback) {
    const check = setInterval(() => {
      if (wsReady) { clearInterval(check); callback(); }
    }, 100);
    setTimeout(() => {
      clearInterval(check);
      if (!wsReady) {
        edCollabPending = false;
        const btn = document.getElementById('ed-collab-btn');
        if (btn) btn.textContent = '⇄ collab';
      }
    }, 8000);
  }
}

function connectWS() {
  const wsEl = document.getElementById('ftr-ws');
  wsEl.textContent = 'connecting…';
  wsEl.style.color = 'var(--muted)';

  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const url   = `${proto}://${location.hostname}/toys/app/`;

  try { ws = new WebSocket(url); }
  catch(e) { wsEl.textContent = 'ws error'; setTimeout(connectWS, 4000); return; }

  ws.onopen = () => {
    wsReady = true;
    wsEl.textContent = 'live';
    wsEl.style.color = '#3d5a3d';
    ws.send(JSON.stringify({type: 'ping'}));
  };

  ws.onclose = () => {
    wsReady = false;
    wsEl.textContent = 'reconnecting…';
    wsEl.style.color = 'var(--muted)';
    edPendingRender = false;
    document.getElementById('ed-play-btn').disabled = false;
    setTimeout(connectWS, 3000);
  };

  ws.onerror = () => {
    wsEl.textContent = 'ws error';
    wsEl.style.color = '#6a3030';
  };

  ws.onmessage = async e => {
    const msg = JSON.parse(e.data);

    if (msg.type === 'pong') return;

    if (msg.type.startsWith('collab_') || msg.type === 'preview_samples') {
      await cbHandleMessage(msg); return;
    }

    if (msg.type === 'full_state') {
      applyState(msg, false);
      setStatus(msg.status || 'idle');
      if (msg.status === 'playing' && msg.audio && activeTab === 'live') {
        await livePlayAudio(msg.audio, msg.bpm, msg.steps, msg.step_beats);
      }
      return;
    }

    if (msg.type === 'state_update') {
      applyState(msg, true);
      setStatus('composing', msg.label);
      return;
    }

    if (msg.type === 'status') {
      setStatus(msg.status, msg.label);
      if (msg.status === 'idle') liveStopPlayback();
      return;
    }

    if (msg.type === 'audio_ready') {
      if (activeTab === 'live') await livePlayAudio(msg.audio, msg.bpm, msg.steps, msg.step_beats);
      return;
    }

    if (msg.type === 'audio') {
      if (msg.mode === 'preview') {
        const ctx = getCtx();
        try {
          const buf = await ctx.decodeAudioData(b64ToArrayBuffer(msg.data));
          const src = ctx.createBufferSource();
          src.buffer = buf;
          src.connect(gainNode || ctx.destination);
          src.start();
        } catch(e) { console.error(e); }
        return;
      }

      if (msg.mode === 'sequence' && edPendingRender) {
        await edReceiveAudio(msg);
        return;
      }

      if (msg.bpm && msg.steps && msg.step_beats && activeTab === 'live') {
        await livePlayAudio(msg.data, msg.bpm, msg.steps, msg.step_beats);
      }
      return;
    }
  };
}
