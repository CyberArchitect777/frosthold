// 32 peace officers for Frosthold (1 player + 31 allies)
// 18 allies are stationed one-per-police-station.
// 13 allies are placed at random non-police settlements.

const ALLY_TEMPLATES = [
  { name: 'Lars Holt'      },
  { name: 'Sara Kell'      },
  { name: 'Dirk Farrow'    },
  { name: 'Mia Voss'       },
  { name: 'Otto Brenn'     },
  { name: 'Lena Frost'     },
  { name: 'Pavel Grunn'    },
  { name: 'Yuki Tanaka'    },
  { name: 'Hank Mueller'   },
  { name: 'Nora Quinn'     },
  { name: 'Rex Dalton'     },
  { name: 'Ana Petrov'     },
  { name: 'Cole Ashby'     },
  { name: 'Inge Lars'      },
  { name: 'Marco Vidal'    },
  { name: 'Faye Hollis'    },
  { name: 'Boris Crane'    },
  { name: 'Tia Mercer'     },
  { name: 'Ash Renn'       },
  { name: 'Rolf Stern'     },
  { name: 'Ivy Drake'      },
  { name: 'Sven Halden'    },
  { name: 'Petra Wolff'    },
  { name: 'Karl Nansen'    },
  { name: 'Dawn Ryker'     },
  { name: 'Finn Odell'     },
  { name: 'Vera Strand'    },
  { name: 'Cal Morrow'     },
  { name: 'Elsa Brandt'    },
  { name: 'Wade Kern'      },
  { name: 'Nina Sable'     },
  { name: 'Jorn Havel'     },
]

const SPECIAL_ITEMS = [
  'thermal_suit', 'signal_jammer', 'medkit', 'explosives', 'fuel_canister',
  'night_vision', 'snowcat_key', 'radio', 'maps', 'rations',
  null, null, null, null, null,
]

import { generateSettlements } from './settlements.js'
import { findInvasionPoint } from '../game/terrain.js'

function seededRand(seed) {
  let s = seed >>> 0
  return function() {
    s = (s * 1664525 + 1013904223) >>> 0
    return (s >>> 0) / 4294967296
  }
}

export function generatePlayerCharacter(seed) {
  const idx = seed % ALLY_TEMPLATES.length
  return ALLY_TEMPLATES[idx]
}

// Build all 32 peace officers. 18 are stationed one-per-police-station (the
// station nearest the player's start is left empty). 13 are placed at random
// non-police settlements. The player character is not assigned to any station.
// Returns { playerChar, allies, settlements }
export function generateAllies(worldSeed) {
  const rand = seededRand(worldSeed + 1000)
  const playerIdx = worldSeed % ALLY_TEMPLATES.length  // 0..31

  const settlements = generateSettlements(worldSeed)

  // Collect police station settlements (guaranteed 19 by settlements.js)
  const policeEntries = settlements
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s.buildings.includes('police_station'))

  // Player starts at invasionPoint * 0.5 — find nearest station to leave empty
  const ip = findInvasionPoint(worldSeed)
  const psx = ip.x * 0.5, psz = ip.z * 0.5
  policeEntries.sort((a, b) =>
    Math.hypot(a.s.x - psx, a.s.z - psz) - Math.hypot(b.s.x - psx, b.s.z - psz)
  )
  const allyStations = policeEntries.slice(1)  // 18 stations (nearest left empty)

  // Non-police settlements for the remaining 13 allies
  const nonPoliceEntries = settlements
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => !s.buildings.includes('police_station'))

  // Shuffle both pools independently
  for (let i = allyStations.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [allyStations[i], allyStations[j]] = [allyStations[j], allyStations[i]]
  }
  for (let i = nonPoliceEntries.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [nonPoliceEntries[i], nonPoliceEntries[j]] = [nonPoliceEntries[j], nonPoliceEntries[i]]
  }

  let allyCount = 0

  const all = ALLY_TEMPLATES.map((tmpl, i) => {
    const isPlayer = i === playerIdx
    let location = { x: 0, z: 0 }

    if (!isPlayer) {
      if (allyCount < 18) {
        // Police station ally
        const { s, i: idx } = allyStations[allyCount]
        location = { x: s.x, z: s.z }
        settlements[idx].allyId = `ally_${i}`
      } else {
        // Non-police settlement ally
        const npIdx = allyCount - 18
        if (npIdx < nonPoliceEntries.length) {
          const { s, i: idx } = nonPoliceEntries[npIdx]
          location = { x: s.x, z: s.z }
          settlements[idx].allyId = `ally_${i}`
        }
      }
      allyCount++
    }

    const specialItemIdx = Math.floor(rand() * SPECIAL_ITEMS.length)
    const morale = 40 + Math.floor(rand() * 40)

    return {
      id: isPlayer ? 'player' : `ally_${i}`,
      name: tmpl.name,
      location,
      relationships: [],
      status: isPlayer ? 'recruited' : 'free',
      morale,
      health: 100,
      stamina: 100,
      personalTime: 720,
      specialItem: SPECIAL_ITEMS[specialItemIdx],
      vehicle: null,
      injuries: { leftArm: 'fine', rightArm: 'fine', leftLeg: 'fine', rightLeg: 'fine', body: 'fine', head: 'fine' },
    }
  })

  // Relationship graph across all 32
  for (let i = 0; i < all.length; i++) {
    const numRel = 2 + Math.floor(rand() * 3)
    const existing = new Set(all[i].relationships.map(r => r.allyId))

    for (let r = 0; r < numRel; r++) {
      const j = Math.floor(rand() * all.length)
      if (j === i || existing.has(all[j].id)) continue

      const trust = Math.max(-100, Math.min(100, Math.floor((rand() - 0.3) * 160)))

      all[i].relationships.push({ allyId: all[j].id, trust })
      if (!all[j].relationships.find(r => r.allyId === all[i].id)) {
        all[j].relationships.push({ allyId: all[i].id, trust })
      }
      existing.add(all[j].id)
    }
  }

  const playerChar = all[playerIdx]
  const allies = all.filter((_, i) => i !== playerIdx)

  return { playerChar, allies, settlements }
}
