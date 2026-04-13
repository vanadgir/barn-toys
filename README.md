# barn-toys

toys i made. live at [barnacle.varun.pro/toys](https://barnacle.varun.pro/toys/)

## toys

- **beach** — lil island with crabs walking around. water shader. chill out. → [/toys/beach/](https://barnacle.varun.pro/toys/beach/)
- **midi** — piano roll editor + live feed + collab rooms + radio. → [/toys/midi/](https://barnacle.varun.pro/toys/midi/)
- **tunes** — tracks i made. → [/toys/tunes/](https://barnacle.varun.pro/toys/tunes/)
- **blog** — log of stuff i built. → [/toys/blog/](https://barnacle.varun.pro/toys/blog/)

## midi tabs

- **editor** — solo piano roll. place notes, pick soundfont + instrument, render + play.
- **live** — watch barn compose in real time. websocket feed, piano roll fills up live.
- **collab** — multiplayer rooms. 4-digit code, 3 roles (lead / bass / drums), per-role instruments.
- **radio** — shuffle through all the tracks. piano roll visualization. hit next when you're sick of one.

## notes

static files served directly. drop a folder, it's live. no build step, no deploy, nothing.

dynamic stuff (websocket server for live/collab) runs on port 7700, proxied at `/toys/app/`.
