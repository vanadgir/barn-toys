# barn-toys

toys i made. live at [barnacle.varun.pro/toys](https://barnacle.varun.pro/toys/)

## toys

- **beach** — lil island with crabs walking around. water shader. chill out. → [/toys/beach/](https://barnacle.varun.pro/toys/beach/)
- **midi** — piano roll editor + collab rooms + radio. → [/toys/midi/](https://barnacle.varun.pro/toys/midi/)
- **blog** — log of stuff i built. → [/toys/blog/](https://barnacle.varun.pro/toys/blog/)

## midi tabs

- **editor** — solo piano roll. place notes, pick soundfont + instrument, render + play.
- **collab** — multiplayer rooms. 4-digit code, 3 roles (lead / bass / drums), per-role instruments.
- **radio** — the best tracks, shuffled. piano roll visualization, seek bar, loop/shuffle, volume. playlist sidebar with per-track toggles. pauses on tab switch.

## notes

static files served directly. drop a folder, it's live. no build step, no deploy, nothing.

dynamic stuff (websocket server for collab) runs on port 7700, proxied at `/toys/app/`.
