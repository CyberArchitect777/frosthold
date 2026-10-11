# Frosthold

Frosthold is a 3D browser-based strategy game inspired by Mike Singleton's 1989 classic *Midwinter*.

An enemy army has invaded a frozen island. You lead a resistance of police officers: ski, drive and fly across the island, recruit allies, sabotage the enemy and hold on to the heat mines that keep the island alive.

> **Work in progress.** The game is in early development and isn't fully playable from start to finish yet.

## Running locally
You need Node.js 18 or later.

```bash
npm ci
npm run dev       # http://localhost:5173
npm run build     # production build in dist/
npm run preview   # serve the production build
```

## Built with
React, Three.js, Zustand, Vite and vite-plugin-pwa. Frosthold is a progressive web app with no backend; everything runs in the browser.

## Licence
Frosthold is free software, released under the [GNU General Public License v3.0 only](LICENSE) (SPDX: `GPL-3.0-only`).

*Midwinter* is the work of Mike Singleton and Maelstrom Games. Frosthold is an independent project and isn't affiliated with or endorsed by its rights holders.
