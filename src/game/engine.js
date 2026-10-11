import * as THREE from 'three'
import { WeatherSystem } from './weather.js'
import { PlayerController } from './player.js'
import { initTerrain, sampleHeight } from './terrain.js'

const CHUNK_SIZE = 500  // metres per terrain chunk
const CHUNK_SEGS = 256  // segments per chunk — gives ~2 m vertex spacing (~8 vertices per 15 m dune)

// Simple seeded LCG — deterministic tree placement independent of Math.random()
function seededRng(seed) {
  let s = seed >>> 0
  return () => {
    s = Math.imul(s, 1664525) + 1013904223 | 0
    return (s >>> 0) / 4294967296
  }
}

// Detect device performance tier
export function detectPerformanceTier() {
  const cores = navigator.hardwareConcurrency ?? 2
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)

  if (isMobile && cores <= 4) return 'low'
  if (isMobile) return 'mid'
  return 'high'
}

export class GameEngine {
  constructor(canvas, worldSeed, tier = 'high', startPosition = { x: 0, z: 22 }, audioManager = null) {
    this.canvas = canvas
    this.worldSeed = worldSeed
    this.tier = tier
    this.startPosition = startPosition
    this._audio = audioManager

    this.isRunning = false
    this.isPaused = false
    this.lastTime = 0
    this.frameCount = 0
    this.fps = 0
    this.fpsTimer = 0

    this._chunks = new Map()
    this._lastChunkKey = null
    this._collisionCooldown = 0

    // Combat state
    this._enemyVehicleData = []     // synced from store
    this._combatActive = false
    this._combatEnemies = []        // [{ id, x, z, vx, vz, fireTimer, hits, zigPhase }]
    this._combatEnemyMeshes = new Map() // id → { body, turret, bodyGeo, turretGeo, mat }
    this._playerMissiles = []       // { mesh, x, z, y, vx, vy, vz }
    this._enemyMissiles = []        // { mesh, x, z, y, vx, vy, vz }
    this._missileMat = null
    this._travelMode = 'ski'        // tracked for gun accuracy
    this._injuries = null
    this._explosionEffects = []     // active explosion animations

    // World enemy vehicle rendering (visible at all times in 3D)
    this._worldEnemyMeshes = new Map() // vehicleId → { mesh, bodyGeo, mat }

    // Snipe mode state
    this._snipeActive = false
    this._snipeX = 0; this._snipeY = 0; this._snipeZ = 0
    this._snipeRange = 0
    this._snipeEnemyFireTimer = 0
    this._snipeVehicleHits = {}     // vehicleId → hit count for gun
    this._snipeYaw = 0              // camera yaw while sniping
    this._snipePitch = 0            // camera pitch while sniping

    this.onUpdate = null       // callback({ position, rotation, speed, staminaDrain, dt })
    this.onCombatEvent = null  // callback({ type, vehicleId, damage, mode, destroyed })

    this._init()
  }

  _init() {
    const { canvas, tier } = this

    // Seed the procedural terrain
    initTerrain(this.worldSeed)

    // Renderer
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: tier === 'high',
      powerPreference: 'high-performance',
    })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, tier === 'low' ? 1 : 2))
    this.renderer.setSize(canvas.clientWidth || window.innerWidth, canvas.clientHeight || window.innerHeight, false)
    this.renderer.shadowMap.enabled = tier !== 'low'
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.2

    // Scene
    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0x2e5580)

    // Camera
    this.camera = new THREE.PerspectiveCamera(
      85,
      (canvas.clientWidth || window.innerWidth) / (canvas.clientHeight || window.innerHeight),
      0.1, 3000
    )
    this.camera.position.set(this.startPosition.x, 2, this.startPosition.z)

    // Lighting
    this._setupLighting()

    // Weather
    this.weather = new WeatherSystem(this.scene, tier)

    // Player
    this.player = new PlayerController(this.camera)

    // Solid backstop below the ocean floor (−2 m)
    this._buildGroundBackstop()

    // Water plane at sea level — covers all ocean areas
    this._buildWater()

    // Trees across the island
    this._buildTrees()

    // Initial terrain chunks around start position
    this._rebuildTerrain(this.startPosition.x, this.startPosition.z)

    // Resize handler
    this._handleResize = this._onResize.bind(this)
    window.addEventListener('resize', this._handleResize)
  }

  _setupLighting() {
    const ambient = new THREE.AmbientLight(0xaabbcc, 0.6)
    this.scene.add(ambient)

    const sun = new THREE.DirectionalLight(0xfff5e0, 1.2)
    sun.position.set(1000, 800, 500)
    sun.castShadow = this.tier !== 'low'

    if (this.tier !== 'low') {
      sun.shadow.camera.left   = -33
      sun.shadow.camera.right  =  33
      sun.shadow.camera.top    =  33
      sun.shadow.camera.bottom = -33
      sun.shadow.mapSize.width  = this.tier === 'high' ? 2048 : 1024
      sun.shadow.mapSize.height = this.tier === 'high' ? 2048 : 1024
      sun.shadow.bias = -0.001
    }

    this.scene.add(sun)
    this.sun = sun

    const hemi = new THREE.HemisphereLight(0x2e5580, 0xccddee, 0.5)
    this.scene.add(hemi)
  }

  _buildGroundBackstop() {
    // Opaque plane below the ocean floor — catches any gaps in terrain geometry.
    const geo = new THREE.PlaneGeometry(10000, 10000)
    geo.rotateX(-Math.PI / 2)
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.04, 0.10, 0.20) })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.y = -6
    this.scene.add(mesh)
  }

  _buildWater() {
    // Flat opaque plane at sea level covering the full world extent.
    const geo = new THREE.PlaneGeometry(10000, 10000)
    geo.rotateX(-Math.PI / 2)
    const mat = new THREE.MeshLambertMaterial({
      color: new THREE.Color(0.04, 0.10, 0.22),
      emissive: new THREE.Color(0.0, 0.02, 0.06),
    })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.y = 0.05
    this.scene.add(mesh)
  }

  _buildTrees() {
    const rng   = seededRng(this.worldSeed ^ 0xf00dcafe)
    const STEP  = 40    // grid spacing (m)
    const JIT   = 15    // max jitter (m)
    const MIN_H = 0.5   // don't plant in shallow coastal strips
    const DENSITY = this.tier === 'low' ? 0.60 : this.tier === 'mid' ? 0.90 : 1.00

    const trunkGeo = new THREE.CylinderGeometry(0.09, 0.14, 1.1, 5)
    const coneLoGeo = new THREE.ConeGeometry(1.1, 2.2, 6)
    const coneHiGeo = new THREE.ConeGeometry(0.65, 1.6, 6)
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x3b2210 })
    const leafMat  = new THREE.MeshLambertMaterial({ color: 0x1b3d18 })

    const pts = []
    for (let gz = -1950; gz <= 1950; gz += STEP) {
      for (let gx = -1950; gx <= 1950; gx += STEP) {
        const wx = gx + (rng() - 0.5) * JIT * 2
        const wz = gz + (rng() - 0.5) * JIT * 2
        const den = rng()
        const sc  = 0.55 + rng() * 0.95
        const h   = sampleHeight(wx, wz)
        if (h < MIN_H || den > DENSITY) continue
        pts.push({ wx, wz, h, sc })
      }
    }

    this._treePositions = pts.map(p => ({ x: p.wx, z: p.wz }))

    const n = pts.length
    const trunkMesh = new THREE.InstancedMesh(trunkGeo, trunkMat, n)
    const coneLoMesh = new THREE.InstancedMesh(coneLoGeo, leafMat, n)
    const coneHiMesh = new THREE.InstancedMesh(coneHiGeo, leafMat, n)
    trunkMesh.castShadow = coneLoMesh.castShadow = coneHiMesh.castShadow = false

    const dummy = new THREE.Object3D()
    pts.forEach(({ wx, wz, h, sc }, i) => {
      // trunk
      dummy.position.set(wx, h + 0.55 * sc, wz)
      dummy.scale.setScalar(sc)
      dummy.updateMatrix()
      trunkMesh.setMatrixAt(i, dummy.matrix)

      // lower (wide) cone
      dummy.position.set(wx, h + 1.5 * sc, wz)
      dummy.updateMatrix()
      coneLoMesh.setMatrixAt(i, dummy.matrix)

      // upper (narrow) cone
      dummy.position.set(wx, h + 2.6 * sc, wz)
      dummy.scale.setScalar(sc * 0.65)
      dummy.updateMatrix()
      coneHiMesh.setMatrixAt(i, dummy.matrix)
    })

    trunkMesh.instanceMatrix.needsUpdate  = true
    coneLoMesh.instanceMatrix.needsUpdate = true
    coneHiMesh.instanceMatrix.needsUpdate = true

    this.scene.add(trunkMesh, coneLoMesh, coneHiMesh)
    this._treeMeshes = [trunkMesh, coneLoMesh, coneHiMesh]
    this._treeGeos   = [trunkGeo, coneLoGeo, coneHiGeo]
    this._treeMats   = [trunkMat, leafMat]
  }

  _buildChunk(cx, cz) {
    const segs = this.tier === 'low' ? 64 : this.tier === 'mid' ? 128 : CHUNK_SEGS
    const geo = new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE, segs, segs)
    geo.rotateX(-Math.PI / 2)

    const positions = geo.attributes.position
    const originX = cx * CHUNK_SIZE
    const originZ = cz * CHUNK_SIZE

    for (let i = 0; i < positions.count; i++) {
      const wx = positions.getX(i) + originX
      const wz = positions.getZ(i) + originZ
      positions.setY(i, sampleHeight(wx, wz))
    }

    geo.computeVertexNormals()

    const mat = new THREE.MeshLambertMaterial({
      color: new THREE.Color(0.92, 0.96, 1.0),
      emissive: new THREE.Color(0.0, 0.02, 0.05),
      side: THREE.DoubleSide,
    })

    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.set(originX, 0, originZ)
    mesh.receiveShadow = true
    return mesh
  }

  _rebuildTerrain(playerX, playerZ) {
    const cx = Math.round(playerX / CHUNK_SIZE)
    const cz = Math.round(playerZ / CHUNK_SIZE)
    const key = `${cx},${cz}`

    if (key === this._lastChunkKey) return
    this._lastChunkKey = key

    // Remove chunks more than 2 away
    for (const [k, mesh] of this._chunks) {
      const [ox, oz] = k.split(',').map(Number)
      if (Math.abs(ox - cx) > 3 || Math.abs(oz - cz) > 3) {
        this.scene.remove(mesh)
        mesh.geometry.dispose()
        mesh.material.dispose()
        this._chunks.delete(k)
      }
    }

    // Add missing chunks in 5×5 grid around player
    for (let dz = -2; dz <= 2; dz++) {
      for (let dx = -2; dx <= 2; dx++) {
        const nx = cx + dx, nz = cz + dz
        const nk = `${nx},${nz}`
        if (this._chunks.has(nk)) continue
        const mesh = this._buildChunk(nx, nz)
        this.scene.add(mesh)
        this._chunks.set(nk, mesh)
      }
    }
  }

  _onResize() {
    const { canvas, camera, renderer } = this
    const w = canvas.clientWidth || window.innerWidth
    const h = canvas.clientHeight || window.innerHeight
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    renderer.setSize(w, h, false)
  }

  setGyroInput(gamma, beta) { this.player.setGyroInput(gamma, beta) }
  setTravelMode(mode) { this._travelMode = mode; this.player.setTravelMode(mode) }
  setInjuries(injuries) { this._injuries = injuries; this.player.setInjuries(injuries) }
  setTouchForward(active)  { this.player.setTouchForward(active) }
  setTouchBrake(active)    { this.player.setTouchBrake(active) }
  setTouchLeft(active)     { this.player.setTouchLeft(active) }
  setTouchRight(active)    { this.player.setTouchRight(active) }
  setTouchThrottle(active) { this.player.setTouchThrottle(active) }

  pause()  { this.isPaused = true }
  resume() { this.isPaused = false; this.lastTime = performance.now() }

  start() {
    this.isRunning = true
    this.lastTime = performance.now()
    this._loop()
  }

  stop() { this.isRunning = false }

  _loop() {
    if (!this.isRunning) return

    const now = performance.now()
    const dt = Math.min((now - this.lastTime) / 1000, 0.05)
    this.lastTime = now

    this.frameCount++
    this.fpsTimer += dt
    if (this.fpsTimer >= 1) {
      this.fps = this.frameCount
      this.frameCount = 0
      this.fpsTimer -= 1
    }

    if (!this.isPaused) this._update(dt)

    this.renderer.render(this.scene, this.camera)
    requestAnimationFrame(() => this._loop())
  }

  _update(dt) {
    let playerState
    let landed = false

    if (this._snipeActive) {
      // Player is stationary while sniping — freeze physics
      playerState = {
        position: this.player.position.clone(),
        speed: 0,
        rotation: { y: this.player.rotation.y },
        travelMode: this.player.travelMode,
      }
    } else {
      playerState = this.player.update(dt)
      // Detect paramotor landing (player.js sets travelMode internally on touchdown)
      landed = this._travelMode === 'paramotor' && playerState.travelMode === 'ski'
      if (landed) this._travelMode = 'ski'
    }

    // Per-frame audio update (skip in snipe mode — player is stationary)
    if (!this._snipeActive && this._audio) {
      const fwdX = -Math.sin(playerState.rotation.y)
      const fwdZ = -Math.cos(playerState.rotation.y)
      const hAhead  = sampleHeight(playerState.position.x + fwdX, playerState.position.z + fwdZ)
      const hBehind = sampleHeight(playerState.position.x - fwdX, playerState.position.z - fwdZ)
      const slopeGradient = (hAhead - hBehind) / 2  // positive = uphill, negative = downhill
      this._audio.update(dt, this._travelMode, playerState.speed, slopeGradient)
    }

    // Snipe mode: override camera to fixed position + independent rotation
    if (this._snipeActive) {
      this.camera.position.set(this._snipeX, this._snipeY, this._snipeZ)
      const euler = new THREE.Euler(this._snipePitch, this._snipeYaw, 0, 'YXZ')
      this.camera.quaternion.setFromEuler(euler)

      this._snipeEnemyFireTimer -= dt
      if (this._snipeEnemyFireTimer <= 0) {
        this._snipeEnemyFireTimer = 4 + Math.random() * 5
        const inRange = this._enemyVehicleData.some(v =>
          Math.hypot(v.x - this._snipeX, v.z - this._snipeZ) < this._snipeRange
        )
        if (inRange && this.onCombatEvent) this.onCombatEvent({ type: 'snipeEnemyFire' })
      }
    }

    this._rebuildTerrain(playerState.position.x, playerState.position.z)

    // Keep shadow camera centred on player
    if (this.sun) {
      this.sun.position.set(
        playerState.position.x + 11,
        9,
        playerState.position.z + 6
      )
      this.sun.target.position.copy(playerState.position)
      this.sun.target.updateMatrixWorld()
    }

    this.weather.update(dt, this.camera.position)

    // Collision detection — trees and buildings, with 1.5 s cooldown to avoid repeated hits
    this._collisionCooldown = Math.max(0, this._collisionCooldown - dt)
    let collisionDamage = 0
    let buildingCrash = false
    const spd = playerState.speed
    if (this._collisionCooldown === 0 && spd > 0.5) {
      const px = playerState.position.x, pz = playerState.position.z

      if (this._treePositions) {
        for (const t of this._treePositions) {
          if (Math.abs(t.x - px) > 2.0 || Math.abs(t.z - pz) > 2.0) continue
          if (Math.hypot(t.x - px, t.z - pz) < 1.0) {
            collisionDamage = Math.max(5, Math.round(spd * 2.5))
            this._collisionCooldown = 1.5
            this._audio?.playCollision()
            break
          }
        }
      }

      if (collisionDamage === 0 && this._buildingPositions) {
        for (const b of this._buildingPositions) {
          if (Math.abs(b.x - px) > 2.5 || Math.abs(b.z - pz) > 2.5) continue
          if (Math.hypot(b.x - px, b.z - pz) < 1.5) {
            collisionDamage = Math.max(10, Math.round(spd * 5))
            this._collisionCooldown = 1.5
            buildingCrash = true
            this._audio?.playCollision()
            break
          }
        }
      }
    }

    this._updateExplosions(dt)

    // Combat update or proximity check
    if (this._enemyVehicleData.length > 0) {
      const px = playerState.position.x, pz = playerState.position.z
      for (const v of this._enemyVehicleData) {
        if (Math.hypot(v.x - px, v.z - pz) < 200) this._enterCombat(v)
      }
    }
    if (this._combatActive) this._updateCombat(dt)

    if (this.onUpdate) {
      let nearSettlement = null
      if (this._settlementData) {
        for (const s of this._settlementData) {
          const d = Math.hypot(playerState.position.x - s.x, playerState.position.z - s.z)
          if (d < 8) { nearSettlement = s; break }
        }
      }

      const groundH = sampleHeight(playerState.position.x, playerState.position.z)
      this.onUpdate({
        position: playerState.position,
        rotation: playerState.rotation,
        speed: playerState.speed,
        staminaDrain: this.player.getStaminaDrain(dt),
        fuelDrain: this.player.getFuelDrain(dt),
        landingDamage: this.player.consumeLandingDamage(),
        landed,
        collisionDamage,
        buildingCrash,
        nearSettlement,
        combatEnemies: this._combatEnemies.map(e => ({ x: e.x, z: e.z })),
        dt,
        debug: {
          groundHeight: groundH,
          offset: playerState.position.y - groundH,
          playerY: playerState.position.y,
        },
      })
    }
  }

  setAbandonedVehicles(vehicles) {
    this._vehicleData = vehicles ?? []
  }

  // Build meshes for a single building type, positioned at world (wx, groundY, wz).
  // Returns an array of THREE.Mesh to add to the scene.
  _makeBuildingMeshes(type, wx, wz) {
    const groundY = sampleHeight(wx, wz)
    const meshes = []

    const mat = (hex) => new THREE.MeshLambertMaterial({ color: hex })
    const box = (w, h, d) => new THREE.BoxGeometry(w, h, d)
    const cone4 = (r, h) => { const g = new THREE.ConeGeometry(r * Math.SQRT2, h, 4); g.rotateY(Math.PI / 4); return g }
    const cyl = (r, h, seg = 8) => new THREE.CylinderGeometry(r, r, h, seg)

    const place = (geo, mat, x, y, z, ry = 0) => {
      const m = new THREE.Mesh(geo, mat)
      m.position.set(wx + x, groundY + y, wz + z)
      if (ry) m.rotation.y = ry
      m.castShadow = true
      m.receiveShadow = true
      meshes.push(m)
    }

    switch (type) {
      case 'church': {
        // Stone nave + tall steeple
        place(box(3.2, 2.2, 4.5), mat(0xc8b89a), 0, 1.1, 0)         // nave
        place(cone4(1.8, 1.2), mat(0x2a3520), 0, 2.2, 0)              // nave roof
        place(box(1.1, 3.5, 1.1), mat(0xc8b89a), 0, 1.75, -2.4)     // tower
        place(cone4(0.85, 1.8), mat(0x2a3520), 0, 3.5, -2.4)          // spire
        break
      }
      case 'store': {
        // Wide shopfront with flat roof overhang
        place(box(4.5, 1.4, 3.0), mat(0x8a7060), 0, 0.7, 0)          // body
        place(box(5.0, 0.15, 3.5), mat(0x4a3018), 0, 1.5, 0)         // flat roof slab
        place(box(4.4, 0.6, 0.2),  mat(0x6a5040), 0, 0.8, -1.55)    // shopfront board
        break
      }
      case 'police_station': {
        // Solid 2-storey block
        place(box(4.0, 2.4, 3.2), mat(0x8a9090), 0, 1.2, 0)          // body
        place(cone4(2.2, 0.9), mat(0x2a3035), 0, 2.45, 0)             // roof
        place(box(0.6, 2.4, 0.6), mat(0x6a7878), -1.5, 1.2, -1.5)   // corner pillar
        place(box(0.6, 2.4, 0.6), mat(0x6a7878),  1.5, 1.2, -1.5)   // corner pillar
        break
      }
      case 'garage': {
        // Low wide workshop
        place(box(5.5, 1.5, 4.0), mat(0x6a6060), 0, 0.75, 0)         // body
        place(box(5.8, 0.18, 4.3), mat(0x3a3030), 0, 1.59, 0)        // flat roof
        place(box(2.4, 1.2, 0.15), mat(0x3a3030), 0, 0.75, -2.05)   // door panel
        break
      }
      case 'paramotor_hanger': {
        // Hangar — wide curved-ish roof (approximated with a wide box + wedge top)
        place(box(7.0, 1.8, 5.0), mat(0x707880), 0, 0.9, 0)          // walls
        place(box(7.3, 0.3, 5.3), mat(0x505860), 0, 1.95, 0)         // roof cap
        place(box(3.5, 1.8, 0.15), mat(0x3a3a3a), -1.75, 0.9, -2.55) // hangar door L
        place(box(3.5, 1.8, 0.15), mat(0x3a3a3a),  1.75, 0.9, -2.55) // hangar door R
        break
      }
      case 'heat_mine': {
        // Industrial pipe/shaft emerging from ground
        place(cyl(0.9, 3.5), mat(0x3a3a3a), 0, 1.75, 0)              // shaft
        place(cyl(1.3, 0.4), mat(0x5a4030), 0, 3.75, 0)              // flange cap
        place(cyl(0.35, 1.2), mat(0x3a3a3a), 0.9, 3.2, 0)           // small pipe
        place(cyl(0.35, 1.2), mat(0x3a3a3a), -0.9, 3.2, 0)          // small pipe
        break
      }
      case 'magazine': {
        // Low concrete bunker
        place(box(3.5, 0.9, 2.5), mat(0x6a6a5a), 0, 0.45, 0)        // body
        place(box(3.7, 0.25, 2.7), mat(0x4a4a3a), 0, 0.95, 0)       // flat roof slab
        place(box(1.0, 0.9, 0.15), mat(0x3a3a2a), 0, 0.45, -1.33)  // door
        break
      }
      case 'bunker': {
        // Round watchtower
        place(cyl(1.2, 3.5, 8), mat(0x5a6055), 0, 1.75, 0)           // tower
        place(cyl(1.6, 0.35, 8), mat(0x4a5045), 0, 3.68, 0)          // parapet cap
        place(box(0.35, 0.7, 0.35), mat(0x3a3a30), 0, 4.05, -1.5)   // flagpole base
        break
      }
      case 'synthesis_factory': {
        // Large industrial block with chimney
        place(box(5.0, 3.0, 4.0), mat(0x4a5050), 0, 1.5, 0)          // main block
        place(box(5.2, 0.2, 4.2), mat(0x3a4040), 0, 3.1, 0)          // roof
        place(cyl(0.5, 4.5), mat(0x3a3a3a), 1.8, 5.25, 1.0)          // chimney
        place(cyl(0.5, 4.5), mat(0x3a3a3a), -1.8, 5.25, -1.0)        // chimney
        place(box(1.5, 2.0, 1.5), mat(0x3a4848), -1.5, 1.0, -2.4)   // side unit
        break
      }
      default: { // house — and any unknown type
        place(box(2.8, 1.1, 2.2), mat(0x7a6a5a), 0, 0.55, 0)
        place(cone4(1.4, 0.9), mat(0x4a3020), 0, 1.15, 0)
        break
      }
    }
    return meshes
  }

  setSettlements(settlements) {
    // Clear previous
    if (this._settlementGroups) {
      for (const g of this._settlementGroups) {
        this.scene.remove(g)
        g.children.forEach(c => { c.geometry?.dispose(); c.material?.dispose() })
      }
    }

    this._settlementGroups = []
    this._settlementData = []
    this._buildingPositions = []

    const OFFSETS = [
      [[0, 0]],
      [[-2, -0.9], [2, 0.9]],
      [[0, -2.2], [-2.4, 1.3], [2.4, 1.3]],
      [[-2.2, -1.7], [2.2, -1.7], [-2.2, 1.7], [2.2, 1.7]],
      [[0, -2.4], [-2.7, -0.7], [2.7, -0.7], [-1.7, 2.2], [1.7, 2.2]],
    ]

    for (const s of settlements) {
      const group = new THREE.Group()
      const offsets = OFFSETS[s.buildings.length - 1]

      for (let b = 0; b < s.buildings.length; b++) {
        const [ox, oz] = offsets[b]
        const bType = s.buildings[b]
        const bMeshes = this._makeBuildingMeshes(bType, s.x + ox, s.z + oz)
        bMeshes.forEach(m => group.add(m))
        this._buildingPositions.push({ x: s.x + ox, z: s.z + oz })
      }

      group.position.set(0, 0, 0)
      this.scene.add(group)
      this._settlementGroups.push(group)
      this._settlementData.push({ settlementId: s.id, allyId: s.allyId, x: s.x, z: s.z })
    }

  }

  setEnemyVehicles(vehicles) {
    this._enemyVehicleData = vehicles ?? []

    // Sync world enemy vehicle meshes
    const activeIds = new Set(this._enemyVehicleData.map(v => v.id))
    for (const [id, entry] of this._worldEnemyMeshes) {
      if (!activeIds.has(id)) {
        this.scene.remove(entry.mesh)
        entry.bodyGeo.dispose(); entry.mat.dispose()
        this._worldEnemyMeshes.delete(id)
      }
    }
    const combatIds = new Set(this._combatEnemies.map(e => e.id))
    for (const v of this._enemyVehicleData) {
      if (!this._worldEnemyMeshes.has(v.id)) {
        const bodyGeo = new THREE.BoxGeometry(2.4, 0.9, 3.8)
        const mat = new THREE.MeshLambertMaterial({ color: 0x3a4a2a })
        const mesh = new THREE.Mesh(bodyGeo, mat)
        this.scene.add(mesh)
        this._worldEnemyMeshes.set(v.id, { mesh, bodyGeo, mat })
      }
      const entry = this._worldEnemyMeshes.get(v.id)
      const h = sampleHeight(v.x, v.z)
      entry.mesh.position.set(v.x, h + 0.5, v.z)
      entry.mesh.visible = !combatIds.has(v.id)
    }

    // Clean up any combat enemies removed from the store (e.g. via snipe)
    if (this._combatActive) {
      for (const enemy of [...this._combatEnemies]) {
        if (!activeIds.has(enemy.id)) this._destroyCombatEnemy(enemy.id, true)
      }
    }
  }

  _nearestCombatEnemy() {
    if (this._combatEnemies.length === 0) return null
    const pp = this.camera.position
    return this._combatEnemies.reduce((best, e) => {
      const d = Math.hypot(e.x - pp.x, e.z - pp.z)
      const bd = Math.hypot(best.x - pp.x, best.z - pp.z)
      return d < bd ? e : best
    })
  }

  fireMissile() {
    if (!this._combatActive) return
    const enemy = this._nearestCombatEnemy()
    if (!enemy) return
    const mGeo = new THREE.SphereGeometry(0.18, 6, 6)
    const mesh = new THREE.Mesh(mGeo, this._missileMat)
    const pp = this.camera.position

    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion)
    const hLen = Math.hypot(fwd.x, fwd.z) || 1
    const hx = fwd.x / hLen, hz = fwd.z / hLen

    const enemyH = sampleHeight(enemy.x, enemy.z) + 0.8
    const horizDist = Math.hypot(enemy.x - pp.x, enemy.z - pp.z) || 1
    const slope = (enemyH - pp.y) / horizDist
    const totalMag = Math.hypot(1, slope)
    const SPEED = 35

    this.scene.add(mesh)
    this._playerMissiles.push({
      mesh, geo: mGeo,
      x: pp.x, y: pp.y, z: pp.z,
      vx: hx / totalMag * SPEED,
      vy: slope / totalMag * SPEED,
      vz: hz / totalMag * SPEED,
    })
    this._audio?.playMissileLaunch()
  }

  fireGun() {
    if (!this._combatActive) return false
    const enemy = this._nearestCombatEnemy()
    if (!enemy) return false
    const inj = this._injuries
    if (inj && (inj.leftArm === 'out' || inj.rightArm === 'out' || inj.head === 'out')) return false
    const armScore = inj ? (inj.leftArm === 'hurt' ? 1 : 0) + (inj.rightArm === 'hurt' ? 1 : 0) : 0
    const armMult  = [1.0, 0.8, 0.6][armScore]
    const hitChance = (this._travelMode === 'snowcat' ? 0.50 : 0.25) * armMult
    const hit = Math.random() < hitChance
    if (hit) {
      this._showGlint(enemy.id)
      this._audio?.playGunShot()
      enemy.hits = (enemy.hits ?? 0) + 1
      if (enemy.hits >= 5) {
        this._destroyCombatEnemy(enemy.id, true)
        return true
      }
      if (this.onCombatEvent) this.onCombatEvent({ type: 'gunHit', hits: enemy.hits })
    }
    return hit
  }

  _showGlint(enemyId) {
    const meshes = this._combatEnemyMeshes.get(enemyId)
    if (!meshes) return
    meshes.mat.color.setHex(0xffee44)
    setTimeout(() => {
      if (this._combatEnemyMeshes.has(enemyId))
        this._combatEnemyMeshes.get(enemyId).mat.color.setHex(0x3a4a2a)
    }, 200)
  }

  _triggerExplosion(x, y, z) {
    this._audio?.playExplosion()
    // Core fireball
    const ballGeo = new THREE.SphereGeometry(1, 8, 6)
    const ballMat = new THREE.MeshBasicMaterial({ color: 0xff6600, transparent: true, opacity: 1 })
    const ball = new THREE.Mesh(ballGeo, ballMat)
    ball.position.set(x, y + 0.8, z)
    this.scene.add(ball)

    // Secondary smoke puff
    const smokeGeo = new THREE.SphereGeometry(1.2, 8, 6)
    const smokeMat = new THREE.MeshBasicMaterial({ color: 0x331100, transparent: true, opacity: 0.8 })
    const smoke = new THREE.Mesh(smokeGeo, smokeMat)
    smoke.position.set(x, y + 1.2, z)
    this.scene.add(smoke)

    // Bright point light — colours the surrounding landscape orange
    const light = new THREE.PointLight(0xff5500, 180, 100)
    light.position.set(x, y + 2, z)
    this.scene.add(light)

    this._explosionEffects.push({ ball, ballGeo, ballMat, smoke, smokeGeo, smokeMat, light, age: 0 })
  }

  _updateExplosions(dt) {
    const DURATION = 1.8
    for (let i = this._explosionEffects.length - 1; i >= 0; i--) {
      const e = this._explosionEffects[i]
      e.age += dt
      const t = Math.min(1, e.age / DURATION)

      // Fireball: expand quickly then fade
      e.ball.scale.setScalar(1 + t * 7)
      e.ballMat.opacity = t < 0.25 ? 1 : Math.max(0, 1 - (t - 0.25) / 0.75)

      // Smoke: slower rise and fade
      e.smoke.scale.setScalar(1 + t * 5)
      e.smoke.position.y += dt * 0.6
      e.smokeMat.opacity = t < 0.5 ? 0.8 : Math.max(0, 0.8 - (t - 0.5) * 1.6)

      // Light fades out over full duration
      e.light.intensity = 180 * Math.max(0, 1 - t)

      if (e.age >= DURATION) {
        this.scene.remove(e.ball, e.smoke, e.light)
        e.ballGeo.dispose(); e.ballMat.dispose()
        e.smokeGeo.dispose(); e.smokeMat.dispose()
        this._explosionEffects.splice(i, 1)
      }
    }
  }

  // ---- Snipe mode ----

  enterSnipeMode(x, z, height, range) {
    // Capture current camera yaw as starting aim direction
    const euler = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ')
    this._snipeYaw = euler.y
    this._snipePitch = 0
    this._snipeActive = true
    this._snipeX = x
    this._snipeZ = z
    this._snipeY = sampleHeight(x, z) + height
    this._snipeRange = range
    this._snipeVehicleHits = {}
    this._snipeEnemyFireTimer = 3 + Math.random() * 3
  }

  rotateSnipeCam(dYaw, dPitch) {
    if (!this._snipeActive) return
    this._snipeYaw -= dYaw
    this._snipePitch = Math.max(-Math.PI * 0.4, Math.min(Math.PI * 0.4, this._snipePitch - dPitch))
  }

  exitSnipeMode() {
    this._snipeActive = false
    this._snipeVehicleHits = {}
  }

  // Returns { hit: bool, vehicleId?, destroyed?, hits?, blocked? }
  snipeFire(weaponType) {
    if (!this._snipeActive) return { hit: false }
    const inj = this._injuries
    if (inj && (inj.leftArm === 'out' || inj.rightArm === 'out' || inj.head === 'out')) {
      return { hit: false, blocked: true }
    }
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion)
    const fwdH = new THREE.Vector3(fwd.x, 0, fwd.z)
    if (fwdH.lengthSq() < 0.001) return { hit: false }
    fwdH.normalize()

    const aimDeg = weaponType === 'missile' ? 10 : 6
    let bestVehicle = null, bestAngle = Infinity

    for (const v of this._enemyVehicleData) {
      const dx = v.x - this._snipeX, dz = v.z - this._snipeZ
      const dist = Math.hypot(dx, dz)
      if (dist > this._snipeRange) continue
      const toEnemy = new THREE.Vector3(dx, 0, dz).normalize()
      const dot = Math.max(-1, Math.min(1, fwdH.dot(toEnemy)))
      const angleDeg = Math.acos(dot) * (180 / Math.PI)
      if (angleDeg < aimDeg && angleDeg < bestAngle) {
        bestAngle = angleDeg
        bestVehicle = v
      }
    }

    if (!bestVehicle) return { hit: false }

    const ex = bestVehicle.x, ez = bestVehicle.z
    const eh = sampleHeight(ex, ez)

    if (weaponType === 'missile') {
      this._triggerExplosion(ex, eh, ez)  // audio handled inside _triggerExplosion
      return { hit: true, vehicleId: bestVehicle.id, destroyed: true }
    } else {
      const armScore2 = inj ? (inj.leftArm === 'hurt' ? 1 : 0) + (inj.rightArm === 'hurt' ? 1 : 0) : 0
      if (Math.random() < 0.55 * [1.0, 0.8, 0.6][armScore2]) {
        this._audio?.playGunShot()
        this._snipeVehicleHits[bestVehicle.id] = (this._snipeVehicleHits[bestVehicle.id] ?? 0) + 1
        const hits = this._snipeVehicleHits[bestVehicle.id]
        const destroyed = hits >= 5
        if (destroyed) {
          this._triggerExplosion(ex, eh, ez)
          delete this._snipeVehicleHits[bestVehicle.id]
        }
        return { hit: true, vehicleId: bestVehicle.id, destroyed, hits }
      }
      return { hit: false }
    }
  }

  _enterCombat(vehicle) {
    // Skip if already tracking this enemy
    if (this._combatEnemies.find(e => e.id === vehicle.id)) return

    if (!this._missileMat) {
      this._missileMat = new THREE.MeshBasicMaterial({ color: 0xff4400 })
    }

    const bodyGeo = new THREE.BoxGeometry(2.4, 0.9, 3.8)
    const turretGeo = new THREE.BoxGeometry(1.0, 0.7, 1.4)
    const mat = new THREE.MeshLambertMaterial({ color: 0x3a4a2a })
    const body = new THREE.Mesh(bodyGeo, mat)
    const turret = new THREE.Mesh(turretGeo, mat)
    const h = sampleHeight(vehicle.x, vehicle.z)
    body.position.set(vehicle.x, h + 0.55, vehicle.z)
    turret.position.set(vehicle.x, h + 1.15, vehicle.z)
    this.scene.add(body, turret)
    this._combatEnemyMeshes.set(vehicle.id, { body, turret, bodyGeo, turretGeo, mat })

    this._combatEnemies.push({
      id: vehicle.id,
      x: vehicle.x, z: vehicle.z,
      vx: (Math.random() - 0.5) * 4,
      vz: (Math.random() - 0.5) * 4,
      fireTimer: 2.0 + Math.random() * 2.0, // stagger initial shots
      hits: 0,
      zigPhase: Math.random() * Math.PI * 2,
      heading: Math.random() * Math.PI * 2,
    })

    const worldEntry = this._worldEnemyMeshes.get(vehicle.id)
    if (worldEntry) worldEntry.mesh.visible = false

    const wasActive = this._combatActive
    this._combatActive = true
    if (!wasActive && this.onCombatEvent) this.onCombatEvent({ type: 'enter' })
  }

  // Destroy one combat enemy. If it's the last, fully end combat.
  _destroyCombatEnemy(id, destroyed) {
    const enemy = this._combatEnemies.find(e => e.id === id)
    if (!enemy) return

    if (destroyed) {
      this._triggerExplosion(enemy.x, sampleHeight(enemy.x, enemy.z), enemy.z)
    }

    const meshes = this._combatEnemyMeshes.get(id)
    if (meshes) {
      this.scene.remove(meshes.body, meshes.turret)
      meshes.bodyGeo.dispose(); meshes.turretGeo.dispose(); meshes.mat.dispose()
      this._combatEnemyMeshes.delete(id)
    }

    this._combatEnemies = this._combatEnemies.filter(e => e.id !== id)

    if (this._combatEnemies.length > 0) {
      // More enemies remain — report kill but stay in combat
      if (this.onCombatEvent) this.onCombatEvent({ type: 'vehicleDestroyed', vehicleId: id })
    } else {
      // Last enemy gone — end combat
      this._endCombat(destroyed ? 'exit' : 'retreat', id)
    }
  }

  _endCombat(eventType, vehicleId) {
    for (const m of [...this._playerMissiles, ...this._enemyMissiles]) {
      this.scene.remove(m.mesh); m.geo?.dispose()
    }
    this._playerMissiles = []
    this._enemyMissiles = []

    if (eventType === 'retreat') {
      // Restore world meshes — vehicles survive
      for (const e of this._combatEnemies) {
        const we = this._worldEnemyMeshes.get(e.id)
        if (we) we.mesh.visible = true
      }
    }

    for (const [, meshes] of this._combatEnemyMeshes) {
      this.scene.remove(meshes.body, meshes.turret)
      meshes.bodyGeo.dispose(); meshes.turretGeo.dispose(); meshes.mat.dispose()
    }
    this._combatEnemyMeshes.clear()
    this._combatEnemies = []
    this._combatActive = false

    if (this.onCombatEvent) this.onCombatEvent({ type: eventType, vehicleId, destroyed: eventType === 'exit' })
  }

  _updateCombat(dt) {
    if (!this._combatActive) return

    const pp = this.camera.position
    const SEP_DIST  = 12
    const ZIG_FREQ  = 1.2   // radians/s
    const ZIG_AMP   = 6.0   // lateral force magnitude
    const MAX_SPEED = 9

    for (const enemy of this._combatEnemies) {
      const toPX = pp.x - enemy.x, toPZ = pp.z - enemy.z
      const distToPlayer = Math.hypot(toPX, toPZ) || 1
      const chX = toPX / distToPlayer, chZ = toPZ / distToPlayer

      // Chase
      let forceX = chX * 10.0
      let forceZ = chZ * 10.0

      // Zig-zag: perpendicular to chase direction
      enemy.zigPhase += ZIG_FREQ * dt
      const zigAmt = Math.sin(enemy.zigPhase) * ZIG_AMP
      forceX += -chZ * zigAmt
      forceZ +=  chX * zigAmt

      // Missile evasion
      for (const m of this._playerMissiles) {
        const dist = Math.hypot(m.x - enemy.x, m.z - enemy.z)
        if (dist < 30) {
          const mspd = Math.hypot(m.vx, m.vz) || 1
          const weight = (30 - dist) / 30
          forceX += (-m.vz / mspd) * weight * 20.0
          forceZ += ( m.vx / mspd) * weight * 20.0
        }
      }

      // Separation from other enemies
      for (const other of this._combatEnemies) {
        if (other.id === enemy.id) continue
        const dx = enemy.x - other.x, dz = enemy.z - other.z
        const d = Math.hypot(dx, dz) || 0.001
        if (d < SEP_DIST) {
          const push = (SEP_DIST - d) / SEP_DIST * 15.0
          forceX += (dx / d) * push
          forceZ += (dz / d) * push
        }
      }

      enemy.vx += forceX * dt
      enemy.vz += forceZ * dt
      const espd = Math.hypot(enemy.vx, enemy.vz)
      if (espd > MAX_SPEED) { enemy.vx = enemy.vx / espd * MAX_SPEED; enemy.vz = enemy.vz / espd * MAX_SPEED }

      enemy.x += enemy.vx * dt
      enemy.z += enemy.vz * dt
      const eh = sampleHeight(enemy.x, enemy.z)

      // Smooth heading toward velocity direction — max 1.2 rad/s
      if (espd > 0.5) {
        const desiredHeading = Math.atan2(enemy.vx, enemy.vz)
        let diff = desiredHeading - enemy.heading
        if (diff > Math.PI)  diff -= Math.PI * 2
        if (diff < -Math.PI) diff += Math.PI * 2
        enemy.heading += Math.sign(diff) * Math.min(Math.abs(diff), 1.2 * dt)
      }

      const meshes = this._combatEnemyMeshes.get(enemy.id)
      if (meshes) {
        meshes.body.position.set(enemy.x, eh + 0.55, enemy.z)
        meshes.body.rotation.y = enemy.heading
        meshes.turret.position.set(enemy.x, eh + 1.15, enemy.z)
        meshes.turret.lookAt(pp.x, eh + 1.15, pp.z)
      }

      enemy.fireTimer -= dt
      if (enemy.fireTimer <= 0) {
        enemy.fireTimer = 3.0 + Math.random() * 2.0
        this._fireEnemyMissileFrom(enemy)
      }
    }

    // Player missiles — can hit any combat enemy
    for (let i = this._playerMissiles.length - 1; i >= 0; i--) {
      const m = this._playerMissiles[i]
      m.x += m.vx * dt; m.y += m.vy * dt; m.z += m.vz * dt
      m.vy -= 2 * dt
      m.mesh.position.set(m.x, m.y, m.z)

      const gh = sampleHeight(m.x, m.z)
      let hitId = null
      for (const enemy of this._combatEnemies) {
        if (Math.hypot(m.x - enemy.x, m.z - enemy.z) < 2.5) { hitId = enemy.id; break }
      }

      if (hitId !== null) {
        this.scene.remove(m.mesh); m.geo?.dispose()
        this._playerMissiles.splice(i, 1)
        this._destroyCombatEnemy(hitId, true)
        return  // _destroyCombatEnemy may call _endCombat — stop this frame
      }
      if (m.y <= gh || m.y < -10) {
        this.scene.remove(m.mesh); m.geo?.dispose()
        this._playerMissiles.splice(i, 1)
      }
    }

    // Enemy missiles — hit player
    for (let i = this._enemyMissiles.length - 1; i >= 0; i--) {
      const m = this._enemyMissiles[i]
      m.x += m.vx * dt; m.y += m.vy * dt; m.z += m.vz * dt
      m.vy -= 2 * dt
      m.mesh.position.set(m.x, m.y, m.z)

      const gh = sampleHeight(m.x, m.z)
      const dToPlayer = Math.hypot(m.x - pp.x, m.y - pp.y, m.z - pp.z)

      if (dToPlayer < 2.0) {
        this.scene.remove(m.mesh); m.geo?.dispose()
        this._enemyMissiles.splice(i, 1)
        const damage = Math.round(10 + Math.random() * 90)
        if (this.onCombatEvent) this.onCombatEvent({ type: 'playerHit', damage, mode: this._travelMode })
        continue
      }
      if (m.y <= gh || m.y < -10) {
        this.scene.remove(m.mesh); m.geo?.dispose()
        this._enemyMissiles.splice(i, 1)
      }
    }

    // Retreat when ALL enemies are beyond 250 units
    if (this._combatEnemies.length > 0 &&
        this._combatEnemies.every(e => Math.hypot(e.x - pp.x, e.z - pp.z) > 250)) {
      this._endCombat('retreat', null)
    }
  }

  _fireEnemyMissileFrom(enemy) {
    this._audio?.playEnemyFire()
    const mGeo = new THREE.SphereGeometry(0.18, 6, 6)
    const mesh = new THREE.Mesh(mGeo, this._missileMat)
    const pp = this.camera.position
    const eh = sampleHeight(enemy.x, enemy.z) + 1.15
    const dx = pp.x - enemy.x, dy = (pp.y + 0.5) - eh, dz = pp.z - enemy.z
    const dist = Math.hypot(dx, dy, dz) || 1
    mesh.position.set(enemy.x, eh, enemy.z)
    this.scene.add(mesh)
    this._enemyMissiles.push({
      mesh, geo: mGeo,
      x: enemy.x, y: eh, z: enemy.z,
      vx: dx / dist * 28, vy: dy / dist * 28, vz: dz / dist * 28,
    })
  }

  dispose() {
    this.stop()
    window.removeEventListener('resize', this._handleResize)
    this.weather.dispose()
    this.player.dispose()

    for (const mesh of this._chunks.values()) {
      mesh.geometry.dispose()
      mesh.material.dispose()
    }
    this._chunks.clear()

    if (this._settlementGroups) {
      for (const g of this._settlementGroups) {
        this.scene.remove(g)
        g.children.forEach(c => { c.geometry?.dispose(); c.material?.dispose() })
      }
    }

    if (this._treeMeshes) {
      for (const m of this._treeMeshes) { this.scene.remove(m); m.geometry.dispose() }
      for (const g of this._treeGeos)   g.dispose()
      for (const m of this._treeMats)   m.dispose()
    }

    if (this._combatActive) this._endCombat('retreat', null)
    this._missileMat?.dispose()

    for (const e of this._explosionEffects) {
      this.scene.remove(e.ball, e.smoke, e.light)
      e.ballGeo.dispose(); e.ballMat.dispose()
      e.smokeGeo.dispose(); e.smokeMat.dispose()
    }
    this._explosionEffects = []

    for (const [, entry] of this._worldEnemyMeshes) {
      this.scene.remove(entry.mesh)
      entry.bodyGeo.dispose(); entry.mat.dispose()
    }
    this._worldEnemyMeshes.clear()

    this.renderer.dispose()
  }
}
