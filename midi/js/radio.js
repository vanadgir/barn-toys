// ─────────────────────────────────────────────────────────────────────────────
// VOLUME (live tab)
// ─────────────────────────────────────────────────────────────────────────────
document.getElementById('vol').addEventListener('input', e => {
  volumeLevel = parseFloat(e.target.value);
  if (!isMuted && gainNode) gainNode.gain.value = volumeLevel;
});

let isMuted = false;
function toggleMute() {
  isMuted = !isMuted;
  const btn = document.getElementById('mute-btn');
  if (gainNode) gainNode.gain.value = isMuted ? 0 : volumeLevel;
  btn.textContent = isMuted ? '🔇' : '🔊';
  btn.style.color = isMuted ? 'var(--accent)' : 'var(--muted)';
  btn.style.borderColor = isMuted ? 'var(--accent)' : 'var(--border)';
}

// ─────────────────────────────────────────────────────────────────────────────
// RADIO TAB
// ─────────────────────────────────────────────────────────────────────────────

const RADIO_BASE      = '../tunes/';
const RADIO_CH_COLORS = ['#c8a84b','#4b8bc8','#5ca87a','#c8604b','#a04bc8','#c8c84b','#4bc8c8','#c84b8b'];
const NOTE_NAMES_FLAT = ['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'];

let radioTracks      = null;
let radioQueue       = [];
let radioQueueIdx    = 0;
let radioAudio       = null;
let radioAnimFrame   = null;
let radioTrack       = null;
let radioInited      = false;
let radioLoopMode    = false;
let radioShuffleMode = true;
let radioDisabled    = new Set();   // set of track indices excluded from queue
let radioUserPaused  = false;       // true if user explicitly hit pause
let radioUseFlats    = false;       // note label accidental style: false=sharps, true=flats
// cached per-track layout (recomputed on resize or track change)
let radioLayout  = null;
let radioSplash  = null;  // splash Image element
let radioCtx     = null;  // cached 2d context — avoid getContext every frame
let radioCanvas  = null;  // cached canvas element
let radioCanvasW = 0;     // desired dimensions tracked by ResizeObserver
let radioCanvasH = 0;

// load splash once
(function() {
  const img = new Image();
  img.src = 'splash.png';
  img.onload = () => { radioSplash = img; };
})();

async function radioInit() {
  if (radioInited) { return; }
  radioInited = true;

  // cache canvas + 2d context, track size via ResizeObserver
  const canvas = document.getElementById('radio-canvas');
  if (canvas) {
    radioCanvas  = canvas;
    radioCtx     = canvas.getContext('2d');
    radioCanvasW = canvas.clientWidth;
    radioCanvasH = canvas.clientHeight;
    // don't assign canvas.width here — radioDraw handles it to avoid blank frames
    new ResizeObserver(entries => {
      for (const e of entries) {
        const w = Math.round(e.contentRect.width);
        const h = Math.round(e.contentRect.height);
        if (w !== radioCanvasW || h !== radioCanvasH) {
          radioCanvasW = w; radioCanvasH = h;
          // only invalidate layout — canvas.width assigned in radioDraw (same frame as redraw)
          radioLayout = null;
        }
      }
    }).observe(canvas);
  }

  try {
    // load tiny metadata only (~3KB) — notes fetch per-track on demand
    const res = await fetch(RADIO_BASE + 'tracks-meta.json');
    const allTracks = await res.json();
    radioTracks = allTracks.filter(t => t.radio);
    // notes start null, loaded lazily
    radioTracks.forEach(t => { t.notes = null; t._notesLoading = false; });
    document.getElementById('radio-loading').style.display = 'none';
    document.getElementById('radio-btn-shuffle').classList.add('active');
    radioRenderSidebar();
    radioShuffle();
    // don't autoplay — show idle state, wait for user to pick a track
    radioSetIdleOverlay(true);
    radioDrawIdle();
  } catch(e) {
    document.getElementById('radio-loading').textContent = 'failed to load tracks :(';
    radioInited = false;
  }
}

async function radioLoadNotes(track) {
  if (track.notes !== null || track._notesLoading) return;
  track._notesLoading = true;
  try {
    const res = await fetch(RADIO_BASE + 'notes/' + track.id + '.json');
    const notes = await res.json();
    // sort by start time so we can binary-search for visible range each frame
    notes.sort((a, b) => a.t - b.t);
    track.notes = notes;
    track._notesLoading = false;
    if (notes.length > 0) {
      const ps = notes.map(n => n.p);
      track._minP = Math.max(0,   Math.min(...ps) - 2);
      track._maxP = Math.min(127, Math.max(...ps) + 2);
      track._maxDur = notes.reduce((mx, n) => Math.max(mx, n.d), 0);
    } else {
      track._minP = 48; track._maxP = 72; track._maxDur = 4;
    }
    // if this is the active track, reset layout so it recomputes with real pitch range
    if (track === radioTrack) radioLayout = null;
    // update note count in header
    if (track === radioTrack) {
      const metaEl = document.getElementById('radio-meta');
      if (metaEl) metaEl.textContent = `${Math.round(track.bpm)} bpm · ${notes.length} notes`;
    }
  } catch(e) {
    track._notesLoading = false;
    track.notes = [];  // empty fallback so we don't retry forever
    track._minP = 48; track._maxP = 72;
  }
}

function radioRenderSidebar() {
  const sidebar = document.getElementById('radio-sidebar');
  sidebar.innerHTML = '';

  // group by channel
  const channels = new Map();
  radioTracks.forEach((t, idx) => {
    const ch = t.channel || 'uncategorized';
    if (!channels.has(ch)) channels.set(ch, []);
    channels.get(ch).push({ track: t, idx });
  });

  channels.forEach((items, chName) => {
    const chEl = document.createElement('div');
    chEl.className = 'radio-channel';
    chEl.innerHTML = `
      <div class="radio-channel-hdr" onclick="this.parentElement.classList.toggle('collapsed')">
        <span>${chName}</span>
        <span class="ch-arrow">▾</span>
      </div>
      <div class="radio-track-list" id="radio-ch-${chName}"></div>`;
    sidebar.appendChild(chEl);

    const list = chEl.querySelector('.radio-track-list');
    items.forEach(({ track, idx }) => {
      const item = document.createElement('div');
      item.className = 'radio-track-item';
      item.id = `radio-track-item-${idx}`;
      const dur = track.duration ? (() => {
        const m = Math.floor(track.duration / 60);
        const s = Math.floor(track.duration % 60).toString().padStart(2,'0');
        return `${m}:${s}`;
      })() : '';
      const disabled = radioDisabled.has(idx);
      item.innerHTML = `<button class="radio-track-toggle" onclick="radioToggleTrack(${idx}, event)">${disabled ? '+' : '−'}</button><span class="radio-track-name">${track.title}</span><span class="radio-track-dur">${dur}</span>`;
      if (disabled) item.classList.add('disabled');
      item.addEventListener('click', () => { if (!radioDisabled.has(idx)) radioPlayByIdx(idx); });
      list.appendChild(item);
    });
  });
}

function radioUpdateSidebarActive() {
  document.querySelectorAll('.radio-track-item').forEach(el => el.classList.remove('active'));
  if (radioTrack) {
    const idx = radioTracks.indexOf(radioTrack);
    const el  = document.getElementById(`radio-track-item-${idx}`);
    if (el) { el.classList.add('active'); el.scrollIntoView({ block: 'nearest' }); }
  }
}

function radioPlayByIdx(trackIdx) {
  // find or insert into queue at front
  radioQueueIdx = 0;
  radioQueue = [trackIdx, ...radioQueue.filter(i => i !== trackIdx)];
  radioPlayTrack();
}

// page visibility pause — stop audio when tab hidden, resume when visible
document.addEventListener('visibilitychange', () => {
  if (!radioAudio) return;
  if (document.hidden) {
    radioAudio.pause();
    // don't kill RAF — let it idle so canvas redraws instantly on return
  } else {
    if (!radioUserPaused && activeTab === 'radio') radioAudio.play().catch(() => {});
    if (activeTab === 'radio' && !radioAnimFrame) radioAnimFrame = requestAnimationFrame(radioDraw);
  }
});

function radioTogglePlay() {
  if (!radioAudio) return;
  const btn = document.getElementById('radio-btn-playpause');
  if (radioAudio.paused) {
    radioUserPaused = false;
    radioAudio.play().catch(() => {});
    if (!radioAnimFrame) radioAnimFrame = requestAnimationFrame(radioDraw);
    if (btn) btn.textContent = '⏸';
  } else {
    radioUserPaused = true;
    radioAudio.pause();
    // keep RAF loop alive so canvas stays visible while paused
    if (!radioAnimFrame) radioAnimFrame = requestAnimationFrame(radioDraw);
    if (btn) btn.textContent = '▶';
  }
}

function radioSetVol(v) {
  const vol = parseFloat(v);
  if (radioAudio) radioAudio.volume = Math.min(1, vol);
}

function radioToggleLoop() {
  radioLoopMode = !radioLoopMode;
  const btn = document.getElementById('radio-btn-loop');
  btn.classList.toggle('active', radioLoopMode);
  if (radioAudio) radioAudio.loop = radioLoopMode;
}

function radioToggleShuffle() {
  radioShuffleMode = !radioShuffleMode;
  const btn = document.getElementById('radio-btn-shuffle');
  btn.classList.toggle('active', radioShuffleMode);
  // rebuild queue from current track position
  const curIdx = radioTrack ? radioTracks.indexOf(radioTrack) : -1;
  radioRebuildQueue(curIdx);
}

function radioToggleFlats() {
  radioUseFlats = !radioUseFlats;
  const btn = document.getElementById('radio-btn-flats');
  if (btn) { btn.textContent = radioUseFlats ? '♭' : '#'; btn.classList.toggle('active', radioUseFlats); }
}

function radioToggleTrack(trackIdx, e) {
  e.stopPropagation();
  if (radioDisabled.has(trackIdx)) {
    radioDisabled.delete(trackIdx);
  } else {
    radioDisabled.add(trackIdx);
  }
  const item = document.getElementById(`radio-track-item-${trackIdx}`);
  const btn  = item && item.querySelector('.radio-track-toggle');
  if (item) item.classList.toggle('disabled', radioDisabled.has(trackIdx));
  if (btn)  btn.textContent = radioDisabled.has(trackIdx) ? '+' : '−';
  // rebuild queue keeping current track
  const curIdx = radioTrack ? radioTracks.indexOf(radioTrack) : -1;
  radioRebuildQueue(curIdx);
}

function radioRebuildQueue(keepAtFront) {
  const enabled = radioTracks.map((_, i) => i).filter(i => !radioDisabled.has(i));
  if (enabled.length === 0) return;
  if (radioShuffleMode) {
    const arr = [...enabled];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    radioQueue = arr;
  } else {
    radioQueue = enabled;
  }
  // put current track at front so playback isn't interrupted
  if (keepAtFront >= 0 && !radioDisabled.has(keepAtFront)) {
    radioQueue = [keepAtFront, ...radioQueue.filter(i => i !== keepAtFront)];
  }
  radioQueueIdx = 0;
}

function radioSeekToFrac(frac) {
  if (!radioAudio || !radioAudio.duration) return;
  frac = Math.max(0, Math.min(1, frac));
  radioAudio.currentTime = frac * radioAudio.duration;
  const fill = document.getElementById('radio-progress-fill');
  fill.style.transition = 'none';
  fill.style.width = (frac * 100).toFixed(1) + '%';
  requestAnimationFrame(() => { fill.style.transition = ''; });
}

// progress bar drag
(function() {
  let dragging = false;
  function fracFromEvent(e, bar) {
    const rect = bar.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    return (clientX - rect.left) / rect.width;
  }
  function getBar() { return document.getElementById('radio-progress-bar'); }
  document.addEventListener('mousedown', e => {
    const bar = getBar();
    if (!bar || !bar.contains(e.target)) return;
    e.preventDefault();
    dragging = true;
    bar.classList.add('dragging');
    radioSeekToFrac(fracFromEvent(e, bar));
  });
  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    const bar = getBar();
    if (!bar) return;
    radioSeekToFrac(fracFromEvent(e, bar));
  });
  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    const bar = getBar();
    if (bar) bar.classList.remove('dragging');
  });
  document.addEventListener('touchstart', e => {
    const bar = getBar();
    if (!bar || !bar.contains(e.target)) return;
    dragging = true;
    bar.classList.add('dragging');
    radioSeekToFrac(fracFromEvent(e, bar));
  }, { passive: true });
  document.addEventListener('touchmove', e => {
    if (!dragging) return;
    const bar = getBar();
    if (!bar) return;
    radioSeekToFrac(fracFromEvent(e, bar));
  }, { passive: true });
  document.addEventListener('touchend', () => {
    dragging = false;
    const bar = getBar();
    if (bar) bar.classList.remove('dragging');
  });
})();

function radioShuffle() {
  radioRebuildQueue(-1);
}

function radioNext() {
  if (radioLoopMode) { if (radioAudio) { radioAudio.currentTime = 0; radioAudio.play().catch(() => {}); } return; }
  radioQueueIdx = (radioQueueIdx + 1) % radioQueue.length;
  if (radioQueueIdx === 0) radioRebuildQueue(-1);
  radioPlayTrack();
}

function radioPlayTrack() {
  if (radioAnimFrame) { cancelAnimationFrame(radioAnimFrame); radioAnimFrame = null; }
  if (radioAudio) { radioAudio.pause(); radioAudio.src = ''; radioAudio = null; }
  radioLayout = null;

  const track = radioTracks[radioQueue[radioQueueIdx]];
  radioTrack = track;

  document.getElementById('radio-title').textContent = track.title;
  const noteCount = track.notes ? track.notes.length : '…';
  document.getElementById('radio-meta').textContent = `${Math.round(track.bpm)} bpm · ${noteCount} notes`;
  document.getElementById('radio-progress-fill').style.width = '0%';
  document.getElementById('radio-time').textContent = '0:00 / 0:00';
  radioUpdateSidebarActive();
  radioSetIdleOverlay(false);
  radioUpdateLegend(track);

  // start audio immediately — no need to wait for notes
  const audio = new Audio(RADIO_BASE + track.ogg.replace(/ /g, '%20'));
  audio.volume = Math.min(1, parseFloat(document.getElementById('radio-vol')?.value ?? 0.8));
  radioAudio = audio;
  audio.loop = radioLoopMode;
  radioUserPaused = false;
  const ppBtn = document.getElementById('radio-btn-playpause');
  if (ppBtn) ppBtn.textContent = '▶';  // default to paused until play() confirms
  if (!document.hidden) {
    audio.play().then(() => {
      if (ppBtn) ppBtn.textContent = '⏸';
    }).catch(() => {
      // autoplay blocked — stay on ▶, but don't set radioUserPaused so tab switching still resumes
    });
  }
  audio.addEventListener('ended', () => { if (!radioLoopMode) radioNext(); });

  if (!document.hidden) radioAnimFrame = requestAnimationFrame(radioDraw);

  // async: load notes for this track, then pre-fetch the next one
  radioLoadNotes(track).then(() => {
    const nextIdx = radioQueue[(radioQueueIdx + 1) % radioQueue.length];
    if (nextIdx !== undefined) radioLoadNotes(radioTracks[nextIdx]);
  });
}

function radioSetIdleOverlay(visible) {
  const el = document.getElementById('radio-idle-overlay');
  if (el) el.classList.toggle('hidden', !visible);
}

function radioUpdateLegend(track) {
  const el = document.getElementById('radio-legend');
  if (!el) return;
  const instrs = track && track.instruments;
  if (!instrs || Object.keys(instrs).length === 0) {
    el.classList.add('hidden');
    return;
  }
  // only show channels that actually have notes in this track
  const usedChs = track.notes
    ? new Set(track.notes.map(n => String(n.ch === 9 ? 9 : n.ch % 8)))
    : new Set(Object.keys(instrs));
  const entries = Object.entries(instrs)
    .filter(([ch]) => usedChs.has(ch) || usedChs.has(String(parseInt(ch) % 8)))
    .sort(([a],[b]) => parseInt(a) - parseInt(b));
  if (entries.length === 0) { el.classList.add('hidden'); return; }
  const items = entries.map(([ch, name]) => {
    const colorIdx = parseInt(ch) === 9 ? 7 : parseInt(ch) % 8;
    const color = RADIO_CH_COLORS[colorIdx];
    return `<div class="radio-legend-item">
      <div class="radio-legend-dot" style="background:${color}"></div>
      <span>${name}</span>
    </div>`;
  }).join('');
  el.innerHTML = `<button class="radio-legend-toggle" onclick="this.closest('.radio-legend').classList.toggle('collapsed')">
    <span class="radio-legend-toggle-arrow">▼</span>
    <span>instruments</span>
  </button>` + items;
  el.classList.remove('hidden');
  el.classList.add('collapsed');
}

function radioStop() {
  if (radioAnimFrame) { cancelAnimationFrame(radioAnimFrame); radioAnimFrame = null; }
  if (radioAudio) { radioAudio.pause(); radioAudio.src = ''; radioAudio = null; }
  radioTrack = null;
  radioLayout = null;
  radioUserPaused = false;
  document.getElementById('radio-title').textContent = '';
  document.getElementById('radio-meta').textContent = '';
  document.getElementById('radio-time').textContent = '0:00 / 0:00';
  document.getElementById('radio-progress-fill').style.width = '0%';
  const ppBtn = document.getElementById('radio-btn-playpause');
  if (ppBtn) ppBtn.textContent = '▶';
  document.querySelectorAll('.radio-track-item').forEach(el => el.classList.remove('active'));
  radioSetIdleOverlay(true);
  radioUpdateLegend(null);
  radioDrawIdle();
}

function radioDrawIdle() {
  const canvas = document.getElementById('radio-canvas');
  if (!canvas) return;
  const W = canvas.clientWidth || canvas.width;
  const H = canvas.clientHeight || canvas.height;
  if (!W || !H) { requestAnimationFrame(radioDrawIdle); return; }
  canvas.width  = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#080c10';
  ctx.fillRect(0, 0, W, H);
  if (radioSplash && radioSplash.complete) {
    const aspect = radioSplash.width / radioSplash.height;
    const dh = H, dw = dh * aspect;
    ctx.globalAlpha = 0.08;
    ctx.drawImage(radioSplash, (W - dw) / 2, 0, dw, dh);
    ctx.globalAlpha = 1;
  }
}

function radioComputeLayout(W, H, track) {
  const pianoW     = 48;
  const gridW      = W - pianoW;
  const minPitch   = track._minP;
  const maxPitch   = track._maxP;
  const pitchRange = maxPitch - minPitch + 1;
  const rowH       = Math.max(3, Math.min(14, (H * 0.95) / pitchRange));
  const totalH     = pitchRange * rowH;
  const offsetY    = Math.max(0, (H - totalH) / 2);
  // visible time window in seconds — roughly 8 beats
  const beatSec    = 60 / track.bpm;
  const visSec     = Math.max(3, 8 * beatSec);
  const playFrac   = 0.25;
  const playheadX  = pianoW + gridW * playFrac;
  return { pianoW, gridW, minPitch, maxPitch, rowH, totalH, offsetY, visSec, beatSec, playFrac, playheadX };
}

function radioDraw() {
  if (!radioTrack) return;

  const W = radioCanvasW;
  const H = radioCanvasH;
  if (!W || !H) { radioAnimFrame = requestAnimationFrame(radioDraw); return; }

  const ctx    = radioCtx;
  const canvas = radioCanvas;
  if (!ctx || !canvas) { radioAnimFrame = requestAnimationFrame(radioDraw); return; }

  // apply any pending resize here — clear + redraw happen in the same frame, no blank flash
  if (canvas.width !== W || canvas.height !== H) {
    canvas.width  = W;
    canvas.height = H;
    radioLayout   = null;
  }

  // notes not loaded yet — draw a simple loading state and keep animating
  if (!radioTrack.notes) {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#080c10';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#555e68';
    ctx.font = '12px IBM Plex Mono, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('loading…', W / 2, H / 2);
    ctx.textAlign = 'left';
    radioAnimFrame = requestAnimationFrame(radioDraw);
    return;
  }

  if (!radioLayout) radioLayout = radioComputeLayout(W, H, radioTrack);
  const audio = radioAudio;
  const track = radioTrack;
  const L     = radioLayout;

  const currentSec = audio ? audio.currentTime : 0;
  const totalSec   = (audio && audio.duration && isFinite(audio.duration))
    ? audio.duration : track.duration;

  // progress UI (throttle DOM writes — only update if value changed meaningfully)
  const pct = totalSec > 0 ? Math.min(100, (currentSec / totalSec) * 100) : 0;
  document.getElementById('radio-progress-fill').style.width = pct.toFixed(1) + '%';
  const fmt = s => `${Math.floor(s/60)}:${Math.floor(s%60).toString().padStart(2,'0')}`;
  document.getElementById('radio-time').textContent = `${fmt(currentSec)} / ${fmt(totalSec)}`;

  const { pianoW, gridW, minPitch, maxPitch, rowH, totalH, offsetY,
          visSec, beatSec, playFrac, playheadX } = L;

  const visStart = currentSec - visSec * playFrac;
  const visEnd   = currentSec + visSec * (1 - playFrac);
  const timeToX  = t => pianoW + ((t - visStart) / visSec) * gridW;
  const pitchToY = p => offsetY + (maxPitch - p) * rowH;

  // ── splash background ──
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#080c10';
  ctx.fillRect(0, 0, W, H);
  if (radioSplash && radioSplash.complete) {
    const aspect = radioSplash.width / radioSplash.height;
    const dh = H, dw = dh * aspect;
    ctx.globalAlpha = 0.08;
    ctx.drawImage(radioSplash, (W - dw) / 2, 0, dw, dh);
    ctx.globalAlpha = 1;
  }

  // ── row backgrounds ──
  for (let p = minPitch; p <= maxPitch; p++) {
    const isBlack = [1,3,6,8,10].includes(p % 12);
    ctx.fillStyle = isBlack ? 'rgba(9,13,18,0.7)' : 'rgba(11,16,23,0.7)';
    ctx.fillRect(pianoW, pitchToY(p), gridW, rowH);
  }

  // ── beat grid lines (time-based, no beat conversion drift) ──
  const firstBeat = Math.floor(visStart / beatSec);
  const lastBeat  = Math.ceil(visEnd / beatSec) + 1;
  ctx.lineWidth = 1;
  for (let b = firstBeat; b <= lastBeat; b++) {
    const x = timeToX(b * beatSec);
    if (x < pianoW - 1 || x > W + 1) continue;
    const isBar = b % 4 === 0;
    ctx.strokeStyle = isBar ? '#1e2a36' : '#141e28';
    ctx.globalAlpha = isBar ? 0.9 : 0.35;
    ctx.beginPath(); ctx.moveTo(x, offsetY); ctx.lineTo(x, offsetY + totalH); ctx.stroke();
    if (isBar && x > pianoW + 4) {
      ctx.globalAlpha = 0.4;
      ctx.fillStyle = '#3d4a55';
      ctx.font = '8px IBM Plex Mono, monospace';
      ctx.fillText(`${Math.floor(b / 4) + 1}`, x + 3, offsetY + 9);
    }
  }
  ctx.globalAlpha = 1;

  // ── binary search helpers for sorted notes ──
  // find first note whose start time >= threshold
  const bsFind = (arr, threshold) => {
    let lo = 0, hi = arr.length;
    while (lo < hi) { const m = (lo + hi) >> 1; arr[m].t < threshold ? lo = m + 1 : hi = m; }
    return lo;
  };
  // visible window: notes that START before visEnd and END after visStart
  // since notes are sorted by .t, start scanning from first note with t >= (visStart - maxNoteDur)
  // use a conservative lookback of visSec to catch long notes that started before visStart
  const scanStart = bsFind(track.notes, visStart - visSec);
  const scanEnd   = bsFind(track.notes, visEnd + 0.001);

  // ── build active pitch set this frame ──
  // look back by maxDur so long notes that started before visStart are still caught
  const maxDur = track._maxDur || visSec;
  const activeScanStart = bsFind(track.notes, currentSec - maxDur);
  const activeScanEnd   = bsFind(track.notes, currentSec + 0.001);
  const activePitchColor = new Map(); // pitch -> color
  const activePitchLabel = new Map(); // pitch -> short label string
  const _noteNames = radioUseFlats ? NOTE_NAMES_FLAT : NOTE_NAMES;
  for (let i = activeScanStart; i < activeScanEnd; i++) {
    const note = track.notes[i];
    if ((note.t + note.d) >= currentSec) {
      const ch = note.ch === 9 ? 7 : (note.ch % 8);
      activePitchColor.set(note.p, RADIO_CH_COLORS[ch]);
      const lbl = note.ch === 9
        ? (GM_DRUM[note.p] ? GM_DRUM[note.p][0] : `D${note.p}`)
        : _noteNames[note.p % 12] + (Math.floor(note.p / 12) - 1);
      activePitchLabel.set(note.p, lbl);
    }
  }

  // ── notes ──
  ctx.shadowBlur = 0;
  for (let i = scanStart; i < scanEnd; i++) {
    const note = track.notes[i];
    const nx  = timeToX(note.t);
    const nw  = Math.max(2, (note.d / visSec) * gridW);
    // skip notes fully outside visible range
    if (nx + nw < pianoW || nx > W) continue;

    const noteEndSec = note.t + note.d;
    const isActive   = note.t <= currentSec && noteEndSec >= currentSec;
    const isPast     = noteEndSec < currentSec;
    const ch         = note.ch === 9 ? 7 : (note.ch % 8);
    const col        = RADIO_CH_COLORS[ch];
    const ny         = pitchToY(note.p);

    // correct clip: clip both left edge AND right edge, adjusting width accordingly
    const drawX = Math.max(pianoW, nx);
    const drawR = Math.min(nx + nw - 1, W);
    const drawW = drawR - drawX;
    if (drawW <= 0) continue;

    ctx.globalAlpha = isPast ? 0.28 : 1.0;

    if (isActive) {
      ctx.shadowColor = col;
      ctx.shadowBlur  = 8;
      ctx.fillStyle   = '#ffffff';
      ctx.fillRect(drawX, ny + 1, drawW, rowH - 2);
      ctx.shadowBlur  = 0;
      ctx.globalAlpha = 0.5;
      ctx.fillStyle   = col;
      ctx.fillRect(drawX, ny + 1, drawW, rowH - 2);
    } else {
      ctx.shadowBlur = 0;
      ctx.fillStyle  = col;
      ctx.fillRect(drawX, ny + 1, drawW, rowH - 2);
    }
  }
  ctx.globalAlpha = 1;
  ctx.shadowBlur  = 0;

  // ── playhead ──
  ctx.strokeStyle = 'rgba(75,139,200,0.9)';
  ctx.lineWidth   = 2;
  ctx.beginPath(); ctx.moveTo(playheadX, 0); ctx.lineTo(playheadX, H); ctx.stroke();
  ctx.strokeStyle = 'rgba(75,139,200,0.18)';
  ctx.lineWidth   = 8;
  ctx.beginPath(); ctx.moveTo(playheadX, 0); ctx.lineTo(playheadX, H); ctx.stroke();

  // ── piano keys ──
  ctx.fillStyle = '#080c10';
  ctx.fillRect(0, 0, pianoW, H);
  ctx.strokeStyle = '#141e28';
  ctx.lineWidth   = 1;
  ctx.beginPath(); ctx.moveTo(pianoW - 0.5, 0); ctx.lineTo(pianoW - 0.5, H); ctx.stroke();

  ctx.font = `${Math.min(8, rowH - 1)}px IBM Plex Mono, monospace`;
  ctx.textAlign = 'right';
  for (let p = minPitch; p <= maxPitch; p++) {
    const isBlack  = [1,3,6,8,10].includes(p % 12);
    const isC      = p % 12 === 0;
    const y        = pitchToY(p);
    if (y + rowH < 0 || y > H) continue;
    const activeCol   = activePitchColor.get(p);
    const activeLabel = activePitchLabel.get(p);
    ctx.fillStyle = activeCol || (isBlack ? '#080e14' : '#121c26');
    ctx.fillRect(2, y + 1, pianoW - 8, rowH - 1);
    if (activeLabel && rowH >= 7) {
      // active key: show note/drum label in white
      ctx.fillStyle = '#fff';
      ctx.fillText(activeLabel, pianoW - 4, y + rowH - 1);
    } else if (isC && rowH >= 6) {
      // inactive: only label C notes as usual
      ctx.fillStyle = '#2a3f55';
      ctx.fillText(`C${Math.floor(p / 12) - 1}`, pianoW - 4, y + rowH - 1);
    }
  }
  ctx.textAlign = 'left';

  radioAnimFrame = requestAnimationFrame(radioDraw);
}
