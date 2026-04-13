// ─────────────────────────────────────────────────────────────────────────────
// SHARED AUDIO + WS STATE
// ─────────────────────────────────────────────────────────────────────────────
let audioCtx    = null;
let gainNode    = null;
let volumeLevel = 0.8;
let ws          = null;
let wsReady     = false;

// live tab playback
let livePlaySource  = null;
let livePlayStart   = 0;
let livePlayDur     = 0;
let liveAnimId      = null;
let liveIsPlaying   = false;

// editor tab playback
let edPlaySource  = null;
let edPlayStart   = 0;
let edPlayDur     = 0;
let edAnimId      = null;
let edIsPlaying   = false;
let edPendingRender = false; // waiting for server response
let edLiveUpdateTimer = null; // debounce timer for live note update

let edSelected    = new Set();   // indices into edNotes that are selected
let edSelecting   = false;       // drag-select in progress
let edSelBox      = { r1:0, s1:0, r2:0, s2:0 }; // drag-select box (row/step coords)
let edUndoStack   = [];          // snapshots of edNotes for undo
const ED_UNDO_MAX = 20;
let edCursorStep  = 0;           // step to restart playback from (spacebar)
let edCursorOfs   = 0;           // pending resume offset in seconds for next play
let edMouseDownCell = null;      // { row, step, midi, ctrl } — tracks the cell where mousedown fired
let edDragged     = false;       // true once mouseenter fires on a different cell during drag
let edLoopStart    = 0;          // loop region start in steps
let edLoopEnd      = -1;         // loop region end in steps (-1 = full length)
let edLoopEnabled  = true;       // always looping — region drag sets the window
let edLoopDragging = false;      // measure bar drag in progress

function getCtx() {
  if (!audioCtx) {
    audioCtx = new AudioContext();
    gainNode  = audioCtx.createGain();
    gainNode.gain.value = volumeLevel;
    gainNode.connect(audioCtx.destination);
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

// separate audio context for editor tab (independent mute/volume from live)
let edAudioCtx = null;
let edGainNode = null;
let edVolLevel = 0.8;
let edIsMuted  = false;

function getEdCtx() {
  if (!edAudioCtx) {
    edAudioCtx = new AudioContext();
    edGainNode = edAudioCtx.createGain();
    edGainNode.gain.value = edVolLevel;
    edGainNode.connect(edAudioCtx.destination);
  }
  if (edAudioCtx.state === 'suspended') edAudioCtx.resume();
  return edAudioCtx;
}

function b64ToArrayBuffer(b64) {
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}
