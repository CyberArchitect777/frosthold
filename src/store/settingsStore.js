import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// Player options, kept apart from the game save so they survive NEW GAME
// and loading a save file. Edited on the Options screen (ui/Options.jsx).
export const useSettings = create(
  persist(
    (set) => ({
      soundStyle: 'recorded',          // 'recorded' | 'classic' (see game/audio.js)
      setSoundStyle: soundStyle => set({ soundStyle }),
    }),
    { name: 'frosthold-settings', version: 1 },
  ),
)
