# Emergent Counterpoints

**Emergent Counterpoints** is an interactive web application that explores alignment and counterpoint through animated “movers” on a stage. It is a p5.js reimagining of the original Counterpoint Tool from the [Synchronous Objects](https://synchronousobjects.osu.edu/) project, created after the original Flash-based tool was deprecated.

**Marlon Barrios Solano, 2026** · v1.0

**Live:** [https://marlonbarrios.github.io/emergent_counterpoints/](https://marlonbarrios.github.io/emergent_counterpoints/)

---

## About

The project is inspired by the Counterpoint Tool from the Synchronous Objects project, based on the choreographic work of **William Forsythe** and the dance *One Flat Thing, reproduced*. A procedural algorithm drives the motion of “movers”: each has three arms that rotate at clock-face positions and at different speeds. You shape relationships of unison and difference in **shape**, **speed**, and **motion**, and layer markings (shape match, fan, trails, tip planes) to build visual counterpoint.

---

## How to Run

1. **Load the app**  
   Open `index.html` in a modern web browser (Chrome, Firefox, Safari, Edge). No server or build step is required.

2. **Controls**  
   Use the **Controls** panel (top-right). You can collapse it or click **Hide panel**; use the **Show panel** button to bring it back. The stage uses the full window; movers stay within a 75px margin from the edges.

3. **Sound (optional)**  
   In the **Sound** folder: **Load sound file** to pick an audio file (e.g. MP3). Use **Play**, **Pause**, **Restart**, and **Stop** as needed.

4. **Auto Performance**  
   Turn **Auto performance** on to let the piece run with the music: the app will start playback (if a track is loaded), vary the number of movers (1–10), change markings over time, and modulate zoom, collapse, shape, speed, flocking, and motion in response to the track. Turn it off to stop the music and take full manual control.

---

## Features

### Parameters (panel)

- **Activity** — Less ↔ more activity (including pauses).
- **Flocking** — None ↔ strong; movers cluster and align direction.
- **Shape** — Sameness ↔ difference in arm poses.
- **Speed** — Sameness ↔ difference in arm rotation speed.
- **Motion ↑↓ / ↔** — Vertical and horizontal motion (sameness ↔ difference).
- **Zoom** — Out ↔ In (camera scale).
- **Collapse** — Min ↔ max; at max, movers superimpose at the center; at min, they repel and spread.

### Markings

- **Shape match lines** — Lines between movers with the same shape.
- **Fan (speed align)** — Arcs when a mover’s arms move at the same rate (shown in short bursts during auto performance).
- **Motion trails** — Trails when movers move in similar directions (with decay over time).
- **Tip planes △** — Triangle markers at arm tips.

### Actions

- **Add mover** / **Remove mover** — Up to 10 movers; new movers enter from the edges, removed ones exit toward the edges.
- **Pause / Play** — Pause or resume the animation (independent of sound).
- **Toggle all marks** — Turn all markings on or off.
- **Reset** — Restore default parameters and marking state.
- **Hide panel** — Hide the control panel; **Show panel** (floating button) brings it back.

### Sound & auto performance

- **Load sound file** — Choose an audio file.
- **Play / Pause / Restart / Stop** — Standard playback.
- **Auto performance** — When ON: starts the loaded track and runs the “arc” (mover count, markings, zoom, collapse, shape, speed, flocking, motion) in response to the music and song progress. When OFF: stops playback and leaves control to the sliders.
- **Track sensitivity** — How much the auto performance reacts to the audio (bass, mids, highs, level, beat).

When the track **ends**, all movers exit the stage.

---

## Technical Stack

- **p5.js** (1.7.0) — Drawing and animation.
- **Tweakpane** (3.1.10) — Control panel (top-right, collapsible).
- **HTML5 Audio** — Playback and analysis (no p5.sound).
- **Vanilla JS**, **CSS** — Layout and styling; responsive, no build step.

---

## Credits

- **This adaptation** — Marlon Barrios Solano, 2026 (p5.js reimplementation after Flash deprecation).
- **Original Counterpoint Tool** — Synchronous Objects team (Norah Zuniga Shaw, Maria Palazzi, Benjamin Schroeder, and collaborators at Ohio State University).  
  [synchronousobjects.osu.edu](https://synchronousobjects.osu.edu/)
- **Choreography** — William Forsythe, *One Flat Thing, reproduced*.

---

## File Structure

```
├── index.html   # Entry point, structure, “More Information” text
├── styles.css   # Layout, panel, button and stage styling
├── app.js       # p5.js sketch, movers, arc, sound, Tweakpane setup
└── README.md    # This file
```

Open `index.html` in a browser to run the project.
