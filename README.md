# Frosthold

## Introduction

Frosthold is a 3D browser-based strategy game inspired by Mike Singleton's 1989 classic *Midwinter*.

You lead the island's resistance: ski, drive and fly across a frozen landscape, recruit allies, sabotage the occupation and hold on to the heat mines for as long as you can.

> **Work in progress.** The game is in early development and isn't fully playable from start to finish yet.

## Story

In a post-collapse world, a powerful warlord invades a small, isolated island to seize its energy-rich heat mines, cutting off the islanders from what they need to survive.

With overwhelming military superiority, he expects a swift and decisive victory. But the islanders refuse to surrender, mounting a determined resistance against seemingly impossible odds.

The invader is unprepared for a prolonged conflict. As his forces suffer mounting losses and the war drags on, unrest grows among his own people and his political authority begins to weaken.

Unable to defeat the invader in conventional battle, the defenders must survive, resist and make the occupation increasingly costly.

Victory does not require defeating the enemy army. It requires outlasting the will to fight.

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
