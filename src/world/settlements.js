import { sampleHeight } from '../game/terrain.js'

const HALF = 2500

export const BUILDING_TYPES = [
  // Enemy sabotage targets
  'synthesis_factory',
  // Resistance / neutral assets
  'heat_mine', 'garage', 'magazine', 'store', 'house', 'church',
  'police_station', 'bunker', 'paramotor_hanger',
]

// Weighted count: 1 building ~55%, 2 ~20%, 3 ~13%, 4 ~7%, 5 ~5%
function numBuildings(r) {
  if (r < 0.55) return 1
  if (r < 0.75) return 2
  if (r < 0.88) return 3
  if (r < 0.95) return 4
  return 5
}

function seededRand(seed) {
  let s = seed >>> 0
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
}

const POLICE_COUNT = 19

export function generateSettlements(worldSeed) {
  const rand = seededRand(worldSeed + 88888)
  const SEARCH = HALF * 0.88   // stay comfortably inside island edge
  const MIN_DIST = 44          // minimum spacing between settlements (44 m)
  const TARGET = 180

  const settlements = []
  let attempts = 0

  while (settlements.length < TARGET && attempts < TARGET * 80) {
    attempts++
    const x = (rand() - 0.5) * 2 * SEARCH
    const z = (rand() - 0.5) * 2 * SEARCH

    if (sampleHeight(x, z) < 1.5) continue  // reject water / coastal fringe

    // Reject steep terrain: sample 8 points on a 16m radius ring
    const baseH = sampleHeight(x, z)
    let steep = false
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2
      const h = sampleHeight(x + Math.cos(a) * 16, z + Math.sin(a) * 16)
      if (Math.abs(h - baseH) > 2.5) { steep = true; break }
    }
    if (steep) continue

    const tooClose = settlements.some(s => Math.hypot(s.x - x, s.z - z) < MIN_DIST)
    if (tooClose) continue

    const n = numBuildings(rand())
    const buildings = []
    const used = new Set()
    for (let b = 0; b < n; b++) {
      let type
      let tries = 0
      do { type = BUILDING_TYPES[Math.floor(rand() * BUILDING_TYPES.length)] }
      while (used.has(type) && ++tries < 20)
      used.add(type)
      buildings.push(type)
    }

    settlements.push({
      id: `settlement_${settlements.length}`,
      x, z,
      buildings,
      allyId: null,   // filled in by generateAllies
    })
  }

  // Post-pass: guarantee exactly POLICE_COUNT settlements have police_station
  const rand2 = seededRand(worldSeed + 55555)
  const withPolice    = settlements.filter(s =>  s.buildings.includes('police_station'))
  const withoutPolice = settlements.filter(s => !s.buildings.includes('police_station'))

  // Remove excess police stations (shuffle first for randomness)
  if (withPolice.length > POLICE_COUNT) {
    for (let i = withPolice.length - 1; i > 0; i--) {
      const j = Math.floor(rand2() * (i + 1));
      [withPolice[i], withPolice[j]] = [withPolice[j], withPolice[i]]
    }
    for (let i = 0; i < withPolice.length - POLICE_COUNT; i++) {
      withPolice[i].buildings = withPolice[i].buildings.filter(b => b !== 'police_station')
    }
  }

  // Add missing police stations
  if (withPolice.length < POLICE_COUNT) {
    const deficit = POLICE_COUNT - withPolice.length
    for (let i = withoutPolice.length - 1; i > 0; i--) {
      const j = Math.floor(rand2() * (i + 1));
      [withoutPolice[i], withoutPolice[j]] = [withoutPolice[j], withoutPolice[i]]
    }
    for (let i = 0; i < deficit && i < withoutPolice.length; i++) {
      withoutPolice[i].buildings.push('police_station')
    }
  }

  return settlements
}
