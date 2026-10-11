// Simplex noise implementation
// Based on the public domain implementation by Stefan Gustavson

const GRAD3 = [
  [1,1,0],[-1,1,0],[1,-1,0],[-1,-1,0],
  [1,0,1],[-1,0,1],[1,0,-1],[-1,0,-1],
  [0,1,1],[0,-1,1],[0,1,-1],[0,-1,-1]
]

const PERM = new Uint8Array(512)
const PERM_MOD12 = new Uint8Array(512)

let permInitialized = false

function buildPerm(seed) {
  const p = new Uint8Array(256)
  for (let i = 0; i < 256; i++) p[i] = i

  // Seeded shuffle
  let s = seed >>> 0
  for (let i = 255; i > 0; i--) {
    s = (s * 1664525 + 1013904223) >>> 0
    const j = s % (i + 1)
    ;[p[i], p[j]] = [p[j], p[i]]
  }

  for (let i = 0; i < 512; i++) {
    PERM[i] = p[i & 255]
    PERM_MOD12[i] = PERM[i] % 12
  }
  permInitialized = true
}

function dot(g, x, y) {
  return g[0] * x + g[1] * y
}

function dot3(g, x, y, z) {
  return g[0] * x + g[1] * y + g[2] * z
}

export function initNoise(seed = 42) {
  buildPerm(seed)
}

export function noise2D(xin, yin) {
  if (!permInitialized) buildPerm(42)

  const F2 = 0.5 * (Math.sqrt(3) - 1)
  const G2 = (3 - Math.sqrt(3)) / 6

  const s = (xin + yin) * F2
  const i = Math.floor(xin + s)
  const j = Math.floor(yin + s)
  const t = (i + j) * G2
  const X0 = i - t
  const Y0 = j - t
  const x0 = xin - X0
  const y0 = yin - Y0

  let i1, j1
  if (x0 > y0) { i1 = 1; j1 = 0 }
  else { i1 = 0; j1 = 1 }

  const x1 = x0 - i1 + G2
  const y1 = y0 - j1 + G2
  const x2 = x0 - 1 + 2 * G2
  const y2 = y0 - 1 + 2 * G2

  const ii = i & 255
  const jj = j & 255
  const gi0 = PERM_MOD12[ii + PERM[jj]]
  const gi1 = PERM_MOD12[ii + i1 + PERM[jj + j1]]
  const gi2 = PERM_MOD12[ii + 1 + PERM[jj + 1]]

  let t0 = 0.5 - x0 * x0 - y0 * y0
  let n0 = t0 < 0 ? 0 : (t0 *= t0, t0 * t0 * dot(GRAD3[gi0], x0, y0))

  let t1 = 0.5 - x1 * x1 - y1 * y1
  let n1 = t1 < 0 ? 0 : (t1 *= t1, t1 * t1 * dot(GRAD3[gi1], x1, y1))

  let t2 = 0.5 - x2 * x2 - y2 * y2
  let n2 = t2 < 0 ? 0 : (t2 *= t2, t2 * t2 * dot(GRAD3[gi2], x2, y2))

  return 70 * (n0 + n1 + n2)
}

// Fractal Brownian Motion — layered octaves of noise
export function fbm(x, y, octaves = 6, lacunarity = 2.0, gain = 0.5) {
  let value = 0
  let amplitude = 0.5
  let frequency = 1
  for (let i = 0; i < octaves; i++) {
    value += amplitude * noise2D(x * frequency, y * frequency)
    amplitude *= gain
    frequency *= lacunarity
  }
  return value
}

// Island shape mask — normalised distance from centre raised to power 2.5 and inverted.
// Warped with noise so the coastline is irregular rather than a perfect circle.
// Returns 1 at centre, falling smoothly to 0 at the coast.
export function islandMask(nx, ny) {
  // nx, ny in range [-1, 1]
  const wx = noise2D(nx * 1.7 + 4.1, ny * 1.7 + 2.3) * 0.30
  const wy = noise2D(nx * 1.7 + 8.5, ny * 1.7 + 6.7) * 0.30
  const d = Math.sqrt((nx + wx) * (nx + wx) + (ny + wy) * (ny + wy))
  return Math.max(0, 1 - Math.pow(Math.min(1, d * 1.15), 2.5))
}
