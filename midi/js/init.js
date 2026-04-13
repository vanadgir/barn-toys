// ─────────────────────────────────────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────────────────────────────────────
buildKeys();
buildGrid(16);
buildEdKeys();
buildTrackUI();
buildEdGrid(edGetSteps());
edUpdateFooter();
initFromURL();
connectWS();

// ── note hover tooltip ──────────────────────────────────────────────────────
(function() {
  const tip   = document.getElementById('ed-note-tip');
  const inner = document.getElementById('ed-roll-inner');

  function getNoteLabel(midi) {
    const track = ED_TRACKS[edActiveTrack];
    if (track && track.bank === 128) {
      const d = GM_DRUM[midi];
      return d ? `${d[0]} — ${d[1]}` : `drum ${midi}`;
    }
    return noteName(midi);
  }

  inner.addEventListener('mousemove', e => {
    const cell = e.target.closest('[data-midi]');
    if (!cell) { tip.style.display = 'none'; return; }
    const midi = parseInt(cell.dataset.midi, 10);
    tip.textContent = getNoteLabel(midi);
    tip.style.display = 'block';
    tip.style.left = (e.clientX + 14) + 'px';
    tip.style.top  = (e.clientY - 8)  + 'px';
  });

  inner.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
})();

// restore tab from hash, default to radio (auto-switch to editor if ?s= state present)
(function() {
  const hash     = location.hash.replace('#','');
  const valid    = ['radio','editor'];
  const hasState = new URLSearchParams(location.search).has('s');
  if (valid.includes(hash)) {
    switchTab(hash);
  } else if (hasState) {
    switchTab('editor');
  } else {
    switchTab('radio');
  }
})();
