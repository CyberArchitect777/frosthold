// Travel mode management and fast-travel calculations

export const TRAVEL_MODES = {
  ski: {
    label: 'Skiing',
    icon: '⛷',
    speedBase: 4,    // m/s (fast-travel display only)
    staminaDrain: true,
    terrainSensitive: true,
    requiresFuel: false,
  },
  snowcat: {
    label: 'Snowcat',
    icon: '🚙',
    speedBase: 3,    // m/s (fast-travel display only)
    staminaDrain: false,
    terrainSensitive: false,
    requiresFuel: true,
    fuelPerSecond: 0.5,
  },
  paramotor: {
    label: 'Paramotor',
    icon: '🪂',
    speedBase: 7,    // m/s (fast-travel display only)
    staminaDrain: true,
    terrainSensitive: false,
    requiresFuel: false,
  },
}

/**
 * Calculate fast-travel time and risk for the strategy map.
 * @param {Object} from - { x, z }
 * @param {Object} to   - { x, z }
 * @param {number} enemyDensity - 0..1
 * @returns {{ travelTime: number, riskLevel: number, timeHours: number }}
 */
export function calculateFastTravel(from, to, enemyDensity = 0.3) {
  const dist = Math.hypot(to.x - from.x, to.z - from.z)
  const speedUnitsPerHour = 4 * 3600
  const travelTimeSeconds = (dist / speedUnitsPerHour) * 3600
  const riskLevel = Math.min(1, 0.2 + enemyDensity * 0.5)

  return {
    travelTime: travelTimeSeconds,
    timeHours: travelTimeSeconds / 3600,
    riskLevel,
  }
}

/**
 * Determine if paramotor can be launched from current position.
 * Paramotors self-launch so this always returns true.
 */
export function canLaunchParamotor() {
  return true
}

/**
 * Get speed multiplier for current travel mode and conditions.
 */
export function getEffectiveSpeed(mode, slope = 0) {
  const base = TRAVEL_MODES[mode]?.speedBase ?? 400
  let effective = base

  if (mode === 'ski') {
    // Slope bonus: more slope = faster
    effective += slope * 2
  }

  return effective
}
