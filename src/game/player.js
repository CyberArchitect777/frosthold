import * as THREE from 'three'
import { sampleHeight } from './terrain.js'

// Physics constants (1 unit = 1 metre)
const SKI_GRAVITY      = 6
const SKI_FRICTION     = 0.0265625
const SKI_MIN_SPEED    = 0.556
const SKI_MAX_SPEED    = 12.5
const SKI_TURN_SPEED   = 2.0
const SNOWCAT_MIN_SPEED  = 6.944  // 25 km/h
const SNOWCAT_MAX_SPEED  = 19.44  // 70 km/h
const SNOWCAT_GRAVITY    = 7.0
const SNOWCAT_FRICTION   = 0.018
const SNOWCAT_TURN_SPEED = 1.4
const PARAMOTOR_MAX_SPEED  = 8.333  // 30 km/h — always flown at this speed
const PARAMOTOR_THRUST     = 8.0    // m/s² — how fast it gets up to speed
const PARAMOTOR_CLIMB      = 3.0    // m/s up while climbing (and during take-off)
const PARAMOTOR_SINK       = 3.0    // m/s down while descending
const PARAMOTOR_FLARE      = 1.2    // m/s — most sink rate in the last few metres, for a soft landing
const PARAMOTOR_TAKEOFF    = 2.0    // s of automatic climb after take-off
const COLLISION_RADIUS    = 0.5
const STAMINA_DRAIN_SKI = 1.2
const STAMINA_RECOVER   = 4

export class PlayerController {
  constructor(camera) {
    this.camera = camera

    // State — seed position from camera (set by engine from the store's start position)
    this.position = camera.position.clone()
    this.velocity = new THREE.Vector3()
    this.rotation = new THREE.Euler(0, 0, 0, 'YXZ')
    this.travelMode = 'ski'

    // Mouse look
    this.mouseDeltaX = 0
    this.mouseDeltaY = 0
    this.isPointerLocked = false

    // Keyboard state
    this.keys = {}

    // Gyroscope input (-1..1)
    this.gyroTilt = { gamma: 0, beta: 0 }

    // On-screen button state (mobile forward/brake/turn/throttle)
    this.touchForward  = false
    this.touchBrake    = false
    this.touchLeft     = false
    this.touchRight    = false

    // Injury state (set by engine from store)
    this._injuries = null

    // Mouse joystick for desktop steering (non-touch only)
    this.mouseX         = window.innerWidth / 2
    this._mouseMovedAt  = 0   // timestamp of last mousemove — 0 = never moved

    // Skiing latch — true once forward has been pressed; cleared when braked to a stop
    this._skiingActive = false
    this._braking = false
    this._landingDamage = 0
    this._takeoffTime = 0  // paramotor: seconds of take-off climb left

    this._bindInputs()
  }

  _bindInputs() {
    // Kept so dispose() can remove them (P5)
    this._onKeyDown = e => { this.keys[e.code] = true }
    this._onKeyUp   = e => { this.keys[e.code] = false }
    // Pointer lock for desktop mouse look
    this._onPointerLockChange = () => {
      this.isPointerLocked = document.pointerLockElement !== null
    }
    this._onMouseMove = e => {
      this.mouseX        = e.clientX
      this._mouseMovedAt = performance.now()
      if (this.isPointerLocked) {
        this.mouseDeltaX += e.movementX
        this.mouseDeltaY += e.movementY
      }
    }
    window.addEventListener('keydown', this._onKeyDown)
    window.addEventListener('keyup',   this._onKeyUp)
    document.addEventListener('pointerlockchange', this._onPointerLockChange)
    document.addEventListener('mousemove', this._onMouseMove)
  }

  setGyroInput(gamma, beta) {
    this.gyroTilt.gamma = gamma
    this.gyroTilt.beta  = beta
  }

  setTouchForward(active)  { this.touchForward  = active }
  setTouchBrake(active)    { this.touchBrake    = active }
  setTouchLeft(active)     { this.touchLeft     = active }
  setTouchRight(active)   { this.touchRight = active }

  setTravelMode(mode) {
    this.travelMode = mode
    if (mode === 'paramotor') {
      // Running start — forward impulse + upward push so the motor can bite immediately
      const fwdX = -Math.sin(this.rotation.y)
      const fwdZ = -Math.cos(this.rotation.y)
      this.velocity.set(fwdX * 4, 2.0, fwdZ * 4)
      this.rotation.x = -0.2  // slight nose-up on launch
      this._takeoffTime = PARAMOTOR_TAKEOFF
    } else {
      this.velocity.set(0, 0, 0)
    }
    this._skiingActive = false
    this._braking = false
  }

  setInjuries(injuries) { this._injuries = injuries }

  _injuryMults() {
    const inj = this._injuries
    if (!inj) return { speedMult: 1, staminaMult: 1, canSki: true }
    if (inj.head === 'out') return { speedMult: 0, staminaMult: 5, canSki: false }

    const legScore = (inj.leftLeg  === 'out' ? 2 : inj.leftLeg  === 'hurt' ? 1 : 0)
                   + (inj.rightLeg === 'out' ? 2 : inj.rightLeg === 'hurt' ? 1 : 0)
    const bodyBonus = inj.body === 'out' ? 0.5 : inj.body === 'hurt' ? 0.2 : 0

    const speedMults  = [1.0, 0.8, 0.65, 0.45, 0.0]
    const drainMults  = [1.0, 1.3, 1.6,  2.0,  4.0]

    return {
      speedMult:  Math.max(0, speedMults[legScore] - bodyBonus),
      staminaMult: drainMults[legScore] + bodyBonus,
      canSki: legScore < 4,
    }
  }

  consumeLandingDamage() {
    const d = this._landingDamage
    this._landingDamage = 0
    return d
  }

  update(dt) {
    switch (this.travelMode) {
      case 'ski':        this._updateSkiing(dt); break
      case 'snowcat':    this._updateSnowcat(dt); break
      case 'paramotor': this._updateParamotor(dt); break
    }

    this._applyGround()
    this._updateCamera()

    // Consume mouse delta
    this.mouseDeltaX = 0
    this.mouseDeltaY = 0

    return {
      position: this.position.clone(),
      velocity: this.velocity.clone(),
      speed: this.velocity.length(),
      rotation: { y: this.rotation.y },
      travelMode: this.travelMode,
    }
  }

  // Returns a -1..1 steer value from mouse position — desktop only, and only
  // while the mouse has moved recently (avoids pulling when mouse is idle/off-screen).
  _mouseJoystick() {
    if ('ontouchstart' in window) return 0              // never on touch devices
    if (performance.now() - this._mouseMovedAt > 800) return 0  // idle = no pull
    const cx = window.innerWidth / 2
    return Math.max(-1, Math.min(1, (this.mouseX - cx) / cx))
  }

  _updateSkiing(dt) {
    // Yaw: pointer lock delta > gyro > mouse-position joystick (desktop fallback)
    if (this.isPointerLocked) {
      this.rotation.y -= this.mouseDeltaX * 0.002
      this.rotation.x -= this.mouseDeltaY * 0.001
    } else {
      const gamma = this.gyroTilt.gamma
      if (Math.abs(gamma) > 0.01) {
        this.rotation.y -= gamma * SKI_TURN_SPEED * dt
      } else {
        const mx = this._mouseJoystick()
        if (Math.abs(mx) > 0.05) this.rotation.y -= mx * SKI_TURN_SPEED * dt
      }
    }
    this.rotation.x = Math.max(-0.6, Math.min(0.4, this.rotation.x))

    if (this.keys['ArrowLeft']  || this.keys['KeyA'] || this.touchLeft)  this.rotation.y += SKI_TURN_SPEED * dt
    if (this.keys['ArrowRight'] || this.keys['KeyD'] || this.touchRight) this.rotation.y -= SKI_TURN_SPEED * dt

    const forwardDir = new THREE.Vector3(
      -Math.sin(this.rotation.y), 0, -Math.cos(this.rotation.y)
    )

    const forwardPush = this.keys['ArrowUp'] || this.keys['KeyW'] || this.touchForward
    const brakeTap    = this.keys['ArrowDown'] || this.keys['KeyS'] || this.touchBrake

    // Forward tap starts skiing; brake tap starts braking (forward cancels brake)
    if (forwardPush) { this._skiingActive = true; this._braking = false }
    if (brakeTap && this._skiingActive && !this._braking) this._braking = true

    const { speedMult, canSki } = this._injuryMults()
    if (!this._skiingActive || !canSki) {
      this.velocity.set(0, 0, 0)
      if (!canSki) this._skiingActive = false
    } else {
      // Friction
      this.velocity.multiplyScalar(1 - SKI_FRICTION * dt)

      // Lateral damping — skis resist sideways movement
      const rightDir = new THREE.Vector3(forwardDir.z, 0, -forwardDir.x)
      const lateralVel = this.velocity.dot(rightDir)
      this.velocity.addScaledVector(rightDir, -lateralVel * Math.min(1, 10 * dt))

      // Slope gravity — sample terrain 1 m ahead and behind to get gradient
      const sd = 1.0
      const hAhead  = sampleHeight(this.position.x + forwardDir.x * sd, this.position.z + forwardDir.z * sd)
      const hBehind = sampleHeight(this.position.x - forwardDir.x * sd, this.position.z - forwardDir.z * sd)
      const slope = (hBehind - hAhead) / (2 * sd)  // positive when going downhill
      this.velocity.addScaledVector(forwardDir, slope * SKI_GRAVITY * dt)

      if (this._braking) {
        // Bleed all speed as fast as physics allows
        const fwdSpeedNow = this.velocity.dot(forwardDir)
        if (fwdSpeedNow > 0) {
          this.velocity.addScaledVector(forwardDir, -Math.min(fwdSpeedNow, 2 * dt))
        }
        if (this.velocity.length() < 0.1) {
          this.velocity.set(0, 0, 0)
          this._skiingActive = false
          this._braking = false
        }
      } else {
        // Minimum forward speed — floor on flat/uphill terrain
        const fwdSpeed = this.velocity.dot(forwardDir)
        if (fwdSpeed < SKI_MIN_SPEED) {
          this.velocity.addScaledVector(forwardDir, SKI_MIN_SPEED - fwdSpeed)
        }
      }

      // Speed cap scaled by leg injury
      const speed = this.velocity.length()
      const effectiveMax = SKI_MAX_SPEED * speedMult
      if (speed > effectiveMax) {
        this.velocity.multiplyScalar(effectiveMax / speed)
      }
    }

    this.position.addScaledVector(this.velocity, dt)
  }

  _updateSnowcat(dt) {
    // Yaw: pointer lock delta > gyro > mouse-position joystick
    if (this.isPointerLocked) {
      this.rotation.y -= this.mouseDeltaX * 0.002
    } else {
      const gamma = this.gyroTilt.gamma
      if (Math.abs(gamma) > 0.01) {
        this.rotation.y -= gamma * SNOWCAT_TURN_SPEED * dt
      } else {
        const mx = this._mouseJoystick()
        if (Math.abs(mx) > 0.05) this.rotation.y -= mx * SNOWCAT_TURN_SPEED * dt
      }
    }
    if (this.keys['ArrowLeft']  || this.keys['KeyA'] || this.touchLeft)  this.rotation.y += SNOWCAT_TURN_SPEED * dt
    if (this.keys['ArrowRight'] || this.keys['KeyD'] || this.touchRight) this.rotation.y -= SNOWCAT_TURN_SPEED * dt

    const forwardDir = new THREE.Vector3(-Math.sin(this.rotation.y), 0, -Math.cos(this.rotation.y))
    const forwardPush = this.keys['ArrowUp'] || this.keys['KeyW'] || this.touchForward
    const brakeTap    = this.keys['ArrowDown'] || this.keys['KeyS'] || this.touchBrake

    if (forwardPush) { this._skiingActive = true; this._braking = false }
    if (brakeTap && this._skiingActive && !this._braking) this._braking = true

    if (!this._skiingActive) {
      this.velocity.set(0, 0, 0)
    } else {
      // Friction
      this.velocity.multiplyScalar(1 - SNOWCAT_FRICTION * dt)

      // Lateral damping — tracks resist sideways slip
      const rightDir = new THREE.Vector3(forwardDir.z, 0, -forwardDir.x)
      const lateralVel = this.velocity.dot(rightDir)
      this.velocity.addScaledVector(rightDir, -lateralVel * Math.min(1, 8 * dt))

      // Slope gravity
      const sd = 1.0
      const hAhead  = sampleHeight(this.position.x + forwardDir.x * sd, this.position.z + forwardDir.z * sd)
      const hBehind = sampleHeight(this.position.x - forwardDir.x * sd, this.position.z - forwardDir.z * sd)
      const slope = (hBehind - hAhead) / (2 * sd)
      this.velocity.addScaledVector(forwardDir, slope * SNOWCAT_GRAVITY * dt)

      if (this._braking) {
        const fwdSpeed = this.velocity.dot(forwardDir)
        if (fwdSpeed > 0) this.velocity.addScaledVector(forwardDir, -Math.min(fwdSpeed, 3 * dt))
        if (this.velocity.length() < 0.1) {
          this.velocity.set(0, 0, 0); this._skiingActive = false; this._braking = false
        }
      } else {
        // Engine floor — never drop below 25 km/h
        const fwdSpeed = this.velocity.dot(forwardDir)
        if (fwdSpeed < SNOWCAT_MIN_SPEED) {
          this.velocity.addScaledVector(forwardDir, SNOWCAT_MIN_SPEED - fwdSpeed)
        }
      }

      const speed = this.velocity.length()
      if (speed > SNOWCAT_MAX_SPEED) this.velocity.multiplyScalar(SNOWCAT_MAX_SPEED / speed)
    }

    this.position.addScaledVector(this.velocity, dt)
  }

  _updateParamotor(dt) {
    // Yaw (left/right) — gyro left/right only; pointer lock or mouse joystick on desktop
    if (this.isPointerLocked) {
      this.rotation.y -= this.mouseDeltaX * 0.002
      // No mouse pitch — vertical axis controlled by climb/descend buttons only
    } else {
      const gamma = this.gyroTilt.gamma
      if (Math.abs(gamma) > 0.01) {
        this.rotation.y -= gamma * 1.2 * dt
      } else {
        const mx = this._mouseJoystick()
        if (Math.abs(mx) > 0.05) this.rotation.y -= mx * 1.2 * dt
      }
    }
    if (this.keys['ArrowLeft']  || this.keys['KeyA'] || this.touchLeft)  this.rotation.y += 0.8 * dt
    if (this.keys['ArrowRight'] || this.keys['KeyD'] || this.touchRight) this.rotation.y -= 0.8 * dt

    // Controls (always flies at top speed, holds altitude unless told otherwise):
    //   Climb    — ArrowUp or W / ▲ touch button
    //   Descend  — ArrowDown or S / ▼ touch button
    this._takeoffTime = Math.max(0, this._takeoffTime - dt)
    const climbing   = this.keys['ArrowUp']   || this.keys['KeyW'] || this.touchForward || this._takeoffTime > 0
    const descending = this.keys['ArrowDown'] || this.keys['KeyS'] || this.touchBrake

    const fwdH = new THREE.Vector3(-Math.sin(this.rotation.y), 0, -Math.cos(this.rotation.y))

    // Horizontal: build up to top speed in the facing direction
    const toward = (v, target, step) => v + Math.max(-step, Math.min(step, target - v))
    const step = PARAMOTOR_THRUST * dt
    this.velocity.x = toward(this.velocity.x, fwdH.x * PARAMOTOR_MAX_SPEED, step)
    this.velocity.z = toward(this.velocity.z, fwdH.z * PARAMOTOR_MAX_SPEED, step)

    // Vertical: climb, descend or hold altitude; sink gently in the last few metres
    const height = this.position.y - Math.max(0, sampleHeight(this.position.x, this.position.z))
    let targetVY = climbing ? PARAMOTOR_CLIMB : descending ? -PARAMOTOR_SINK : 0
    if (targetVY < 0 && height < 4) targetVY = -PARAMOTOR_FLARE
    this.velocity.y = toward(this.velocity.y, targetVY, 6 * dt)

    this.position.addScaledVector(this.velocity, dt)

    // Visual pitch — camera tilts to reflect vertical velocity (cosmetic only)
    const targetPitch = -this.velocity.y * 0.045
    this.rotation.x += (targetPitch - this.rotation.x) * Math.min(1, 4 * dt)
    this.rotation.x = Math.max(-0.55, Math.min(0.55, this.rotation.x))

    // Ground collision
    const rawH = sampleHeight(this.position.x, this.position.z)
    const groundH = Math.max(0, rawH)
    if (this.position.y <= groundH + 0.3) {
      const climbInput = this.keys['ArrowUp'] || this.keys['KeyW'] || this.touchForward || this._takeoffTime > 0
      if (climbInput) {
        // Up pressed — take off instead of landing
        this.position.y = groundH + 0.3
        if (this.velocity.y < 3.0) this.velocity.y = 3.0
      } else {
        const impactVY = Math.abs(Math.min(0, this.velocity.y))
        if (impactVY > 1.5) {
          this._landingDamage += Math.round(Math.min(90, (impactVY - 1.5) * 18))
        }
        this.position.y = groundH + 0.3
        this.velocity.set(0, 0, 0)
        this.travelMode = 'ski'
        this.rotation.x = 0
      }
    }
  }

  _applyGround() {
    if (this.travelMode === 'paramotor') return

    const x = this.position.x, z = this.position.z
    const centreH = sampleHeight(x, z)
    const inWater = centreH < 0

    if (inWater) {
      // Kill momentum — water is not skiable
      this.velocity.multiplyScalar(0.05)
      this._skiingActive = false
      this._braking = false
    }

    // Sample a cross pattern so the player stays above the highest
    // nearby terrain point — prevents clipping through the mesh on drops
    // where linear interpolation between vertices sits above sampleHeight.
    const r = 0.8
    const rawH = Math.max(
      centreH,
      sampleHeight(x + r, z),
      sampleHeight(x - r, z),
      sampleHeight(x, z + r),
      sampleHeight(x, z - r),
    )

    const groundH = inWater ? 0 : rawH
    const targetY = groundH + 0.5

    if (this.position.y < targetY) {
      this.position.y = targetY
    } else {
      this.position.y += (targetY - this.position.y) * 0.3
    }
  }

  _updateCamera() {
    // First-person for all modes — eye height 0.3 m above player origin
    this.camera.position.copy(this.position)
    this.camera.position.y += 0.3

    const cx = this.camera.position.x, cz = this.camera.position.z
    const groundY = Math.max(
      sampleHeight(cx, cz),
      sampleHeight(cx + 0.5, cz),
      sampleHeight(cx - 0.5, cz),
      sampleHeight(cx, cz + 0.5),
      sampleHeight(cx, cz - 0.5),
    )
    if (this.camera.position.y < groundY + 0.4) {
      this.camera.position.y = groundY + 0.4
    }

    this.camera.rotation.copy(this.rotation)
  }

  getStaminaDrain(dt, weatherMult = 1.0) {
    if (this.travelMode === 'snowcat') return 0

    const isPushing = this.keys['ArrowUp'] || this.keys['KeyW'] || this.touchForward
    const { staminaMult } = this._injuryMults()

    if (this.travelMode === 'ski') {
      return isPushing
        ? STAMINA_DRAIN_SKI * dt * weatherMult * staminaMult
        : -STAMINA_RECOVER * dt
    }

    if (this.travelMode === 'paramotor') return 0.5 * dt * staminaMult

    return -STAMINA_RECOVER * dt
  }

  getFuelDrain(dt) {
    if (this.travelMode === 'snowcat')   return 0.3 * dt   // 100 fuel ≈ 5.5 min
    if (this.travelMode === 'paramotor') return 0.25 * dt  // 100 fuel ≈ 6.7 min
    return 0
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown)
    window.removeEventListener('keyup',   this._onKeyUp)
    document.removeEventListener('pointerlockchange', this._onPointerLockChange)
    document.removeEventListener('mousemove', this._onMouseMove)
  }
}
