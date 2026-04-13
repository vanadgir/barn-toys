// ─────────────────────────────────────────────────────────────────────────────
// MIDI IMPORT (pure JS)
// ─────────────────────────────────────────────────────────────────────────────
function readVarLen(data, pos) {
  let val = 0;
  let bytesRead = 0;
  let b;
  do {
    b = data[pos++];
    val = (val << 7) | (b & 0x7f);
    bytesRead++;
  } while (b & 0x80 && bytesRead < 4);
  return { val, pos };
}

function parseMidi(buffer) {
  const data = new Uint8Array(buffer);
  let pos = 0;

  function read(n) {
    const slice = data.slice(pos, pos + n);
    pos += n;
    return slice;
  }
  function readU32() {
    const b = read(4);
    return (b[0]<<24)|(b[1]<<16)|(b[2]<<8)|b[3];
  }
  function readU16() {
    const b = read(2);
    return (b[0]<<8)|b[1];
  }

  const magic = readU32();
  if (magic !== 0x4d546864) throw new Error('not a MIDI file');
  const hlen = readU32(); pos += hlen - 6;
  const format    = readU16();
  const numTracks = readU16();
  const tpb       = readU16(); // ticks per beat

  const allNoteOns  = []; // {tick, ch, ti, note, vel}
  const allNoteOffs = []; // {tick, ch, ti, note}
  const progByTi    = new Map(); // ti → program (for format 1 track-based mapping)
  const progByCh    = new Map(); // ch → program (for format 0 channel-based mapping)
  let   tempo       = 500000;   // microseconds per beat

  for (let ti = 0; ti < numTracks; ti++) {
    const tmagic = readU32();
    if (tmagic !== 0x4d54726b) break;
    const tlen     = readU32();
    const trackEnd = pos + tlen;
    let   tick     = 0;
    let   running  = 0;

    while (pos < trackEnd) {
      const { val: delta, pos: p2 } = readVarLen(data, pos);
      pos = p2;
      tick += delta;

      let status = data[pos];
      if (status & 0x80) { running = status; pos++; }
      else { status = running; }

      const type = status & 0xf0;
      const ch   = status & 0x0f;

      if (status === 0xff) {
        // meta
        const mt   = data[pos++];
        const { val: mlen, pos: p3 } = readVarLen(data, pos);
        pos = p3;
        if (mt === 0x51 && mlen === 3) {
          tempo = (data[pos]<<16)|(data[pos+1]<<8)|data[pos+2];
        }
        pos += mlen;
      } else if (status === 0xf0 || status === 0xf7) {
        const { val: slen, pos: p3 } = readVarLen(data, pos);
        pos = p3 + slen;
      } else if (type === 0x90) {
        const note = data[pos++];
        const vel  = data[pos++];
        if (vel > 0) allNoteOns.push({tick, ch, ti, note, vel});
        else         allNoteOffs.push({tick, ch, ti, note});
      } else if (type === 0x80) {
        const note = data[pos++]; pos++; // skip vel
        allNoteOffs.push({tick, ch, ti, note});
      } else if (type === 0xc0) {
        const prog = data[pos++];
        if (!progByTi.has(ti)) progByTi.set(ti, prog);
        progByCh.set(ch, prog);
      } else if (type === 0xa0 || type === 0xb0 || type === 0xe0) {
        pos += 2;
      } else if (type === 0xd0) {
        pos += 1;
      } else {
        pos++; // unknown, skip 1
      }
    }
    pos = trackEnd;
  }

  const bpm       = Math.round(60000000 / tempo);
  const stepBeats = 0.5; // default to 1/8
  const stepTicks = tpb * stepBeats;

  // for format 1: ti=0 is tempo track (no notes), ti=1 is editor track 0, etc.
  // for format 0: single MIDI track, use channel to distinguish editor tracks
  function noteTrack(on) {
    if (format === 1) return Math.min(Math.max(0, on.ti - 1), 2);
    return on.ch % 3;
  }

  // build programs map: editor track index → program number
  const programs = new Map();
  if (format === 1) {
    progByTi.forEach((prog, ti) => {
      const edTrack = ti - 1;
      if (edTrack >= 0) programs.set(edTrack, prog);
    });
  } else {
    progByCh.forEach((prog, ch) => programs.set(ch % 3, prog));
  }

  // match note ons to offs
  const notes = [];
  allNoteOns.forEach(on => {
    const off = allNoteOffs.find(o => o.ch === on.ch && o.ti === on.ti && o.note === on.note && o.tick >= on.tick);
    const endTick = off ? off.tick : on.tick + stepTicks;
    if (off) allNoteOffs.splice(allNoteOffs.indexOf(off), 1);

    const step     = Math.round(on.tick / stepTicks);
    const duration = Math.max(1, Math.round((endTick - on.tick) / stepTicks));
    notes.push({ note: on.note, step, velocity: on.vel, duration, track: noteTrack(on) });
  });

  return { bpm, stepBeats, notes, programs };
}

function edImportMidi(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const { bpm, stepBeats, notes, programs } = parseMidi(e.target.result);

      // find max step to determine grid size
      const maxStep = notes.reduce((m, n) => Math.max(m, n.step + n.duration), 0);
      let gridSteps = 16;
      if (maxStep > 16) gridSteps = 32;
      if (maxStep > 32) gridSteps = 64;

      // filter to notes in range
      const filtered = notes.filter(n =>
        n.note >= NOTE_BOT && n.note <= NOTE_TOP && n.step < gridSteps
      );

      // update controls
      document.getElementById('ed-bpm').value = Math.min(220, Math.max(60, bpm));
      const closestStepB = [0.25, 0.5, 1.0].reduce((a,b) => Math.abs(b-stepBeats) < Math.abs(a-stepBeats) ? b : a);
      document.getElementById('ed-stepsize').value = closestStepB;

      // restore track programs if we got them from the file
      if (programs && programs.size) {
        programs.forEach((prog, edTrack) => {
          if (ED_TRACKS[edTrack]) ED_TRACKS[edTrack].program = prog;
        });
        buildTrackUI();
      }

      // compute bar count from imported steps
      const spb = edGetStepsPerBar(closestStepB);
      edBarCount = Math.max(1, Math.ceil(gridSteps / spb));
      document.getElementById('ed-bars-display').textContent = edBarCount;
      const best = edBarCount * spb;

      // set project name from filename
      const nameEl = document.getElementById('ed-project-name');
      if (nameEl) nameEl.value = file.name.replace(/\.midi?$/i, '');

      edNotes  = filtered;
      edBuilt  = 0;
      buildEdGrid(best);
      edUpdateFooter();
      edSetStatus(`imported ${filtered.length} notes`);
      edSaveToURL();
    } catch(err) {
      console.error('MIDI import error', err);
      edSetStatus('import failed');
    }
  };
  reader.readAsArrayBuffer(file);
  input.value = '';
}
