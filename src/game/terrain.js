import { noise2D, initNoise } from '../utils/noise.js'

export function initTerrain(seed) {
  initNoise(seed)
}

/**
 * Find the coastline point where the enemy invades.
 * Picks a deterministic angle from the seed, then binary-searches outward
 * along that ray until it finds where the terrain crosses from land to ocean.
 * Returns a world-space {x, z} just inside the waterline.
 */
export function findInvasionPoint(seed) {
  // Derive a stable angle from the seed
  const s = (seed * 1664525 + 1013904223) >>> 0
  const angle = (s / 0xFFFFFFFF) * Math.PI * 2

  const cosA = Math.cos(angle)
  const sinA = Math.sin(angle)

  // Binary search: find where height crosses 0 along this ray
  let lo = 0, hi = 2500
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) * 0.5
    if (sampleHeight(cosA * mid, sinA * mid) > 0) lo = mid
    else hi = mid
  }

  // Place slightly inland (positive height) so it sits on land
  const r = lo
  return { x: Math.round(cosA * r), z: Math.round(sinA * r) }
}

// Radial island mask — 1 at centre, 0 at coast (~1700 m radius), <0 = ocean.
// Low-frequency noise warps the coastline so the island shape is irregular.
// Hard cap at dist >= 1.0 ensures the warp can never push land outside the
// base radius, which would otherwise produce disconnected satellite islands.
function islandMask(worldX, worldZ) {
  const nx = worldX / 1700, nz = worldZ / 1700
  const dist = Math.sqrt(nx * nx + nz * nz)
  if (dist >= 1.0) return 0  // hard ocean boundary — no land beyond 1700 m
  // ±0.18 normalized units of coastline wobble (~300 m); can only carve bays
  // inward now (never extend past the hard boundary to form satellite islands)
  const warp = noise2D(worldX * 0.0025, worldZ * 0.0025) * 0.18
  return Math.max(0, 1 - Math.pow(Math.max(0, dist + warp), 1.8))
}

/**
 * Procedural height in metres.
 * Negative values = below sea level (ocean or occasional lake, covered by water plane).
 *
 * The +2.5 m baseline ensures most land sits comfortably above sea level.
 * Only the deepest noise troughs (rare) dip below 0, forming occasional lakes.
 * Domain warping breaks the regular dune grid so sizes and spacings vary.
 * Amplitude modulation creates flat tundra areas alongside tall dune fields.
 * Island mask fades terrain to 0 near the coast.
 */
export function sampleHeight(worldX, worldZ) {
  const mask = islandMask(worldX, worldZ)
  if (mask <= 0) return -2  // open ocean — well below the water plane

  // Large-scale amplitude envelope (50–100 m scale).
  // Varies 0.35..1.0 — creates patches of tall dunes and flat plains.
  const amp = 0.35 + 0.65 * (noise2D(worldX * 0.012, worldZ * 0.012) * 0.5 + 0.5)

  // Domain warp — offsets the sample point so the dune grid is non-uniform.
  // Produces dunes of varying width, height, and orientation.
  const warpX = noise2D(worldX * 0.015,       worldZ * 0.015)       * 18
  const warpZ = noise2D(worldX * 0.015 + 4.7, worldZ * 0.015 + 2.3) * 18

  // Primary dunes: ~25 m wide, amplitude ±4 m scaled by local envelope
  const primary   = noise2D((worldX + warpX) * 0.04, (worldZ + warpZ) * 0.04) * 4.0 * amp

  // Secondary rolls: ~11 m, ±0.6 m surface variation
  const secondary = noise2D(worldX * 0.09, worldZ * 0.09) * 0.6

  // +4.0 m baseline: only the rarest simultaneous primary+secondary troughs
  // (bottom ~1–2% of noise) dip below 0, producing 1–2 lakes on the whole island.
  const raw = primary + secondary + 4.0

  // Coastal fade: blend from raw inland to -4 m at the waterline so ocean is visible.
  // fade=1 at mask≥0.25 (fully inland), fade=0 at mask=0 (coast) → height = -4 m there.
  const fade = Math.min(1, mask * 4)
  return raw * fade - 4.0 * (1 - fade)
}
