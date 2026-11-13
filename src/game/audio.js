// Game audio. Owns the AudioContext and plays through one of two sound styles,
// chosen on the Options screen (settingsStore.soundStyle):
//   'recorded' — real recordings (audio-recorded.js), through a limiter
//   'classic'  — the original synthesised sounds (audio-classic.js), unchanged
// Recorded falls back to classic until its files have loaded, or if they fail.
import { ClassicSounds } from './audio-classic.js'
import { RecordedSounds } from './audio-recorded.js'

export class AudioManager {
  constructor(style = 'recorded') {
    this._style    = style
    this._ctx      = null
    this._ready    = false
    this._classic  = null
    this._recorded = null
    this._current  = null   // the style object that last played continuous sounds
    this._inCombat = false
  }

  // Call after a user gesture (browsers keep audio locked until then)
  init() {
    if (this._ready) {
      // If the context was suspended (iOS autoplay policy), kick it alive again
      this._ctx?.resume()
      return
    }
    try {
      const ctx = this._ctx = new (window.AudioContext || window.webkitAudioContext)()

      // Classic: straight out, exactly as before
      const classicOut = ctx.createGain()
      classicOut.gain.value = 1.0
      classicOut.connect(ctx.destination)

      // Recorded: master gain into a limiter, so explosions on top of engine
      // and wind never clip
      const limiter = ctx.createDynamicsCompressor()
      limiter.threshold.value = -10
      limiter.knee.value      = 6
      limiter.ratio.value     = 12
      limiter.attack.value    = 0.003
      limiter.release.value   = 0.25
      limiter.connect(ctx.destination)
      const recordedOut = ctx.createGain()
      recordedOut.gain.value = 0.9
      recordedOut.connect(limiter)

      this._classic  = new ClassicSounds(ctx, classicOut)
      this._recorded = new RecordedSounds(ctx, recordedOut)
      this._recorded.load(import.meta.env.BASE_URL)
      this._ready = true
    } catch (e) {
      console.warn('[Audio] init failed:', e)
    }
  }

  get style() { return this._style }

  setStyle(style) {
    if (style === this._style) return
    this._style = style
    this._handOver()
  }

  // The style to play right now
  _active() {
    if (this._style === 'recorded' && this._recorded?.ready) return this._recorded
    return this._classic
  }

  // If the playing style changed (option switched, or recordings just loaded),
  // stop the old one's continuous sounds; the new one starts its own on update
  _handOver() {
    const next = this._active()
    if (!next || next === this._current) return
    if (this._current) this._current.stopAll()
    this._current = next
    if (this._inCombat) next.startCombatBuzz()
  }

  // slopeGradient: positive = uphill. vy: vertical speed m/s (paramotor). yaw: heading, radians
  update(dt, travelMode, speed, slopeGradient, vy = 0, yaw = 0) {
    if (!this._ready) return
    this._handOver()
    this._current.update(dt, travelMode, speed, slopeGradient, vy, yaw)
  }

  startCombatBuzz() {
    this._inCombat = true
    if (!this._ready) return
    this._handOver()
    this._current?.startCombatBuzz()
  }

  stopCombatBuzz() {
    this._inCombat = false
    if (!this._ready) return
    this._classic.stopCombatBuzz()
    this._recorded.stopCombatBuzz()
  }

  // One-shots. dist: metres from the player, for the sounds that fade with distance
  playMissileLaunch()    { if (this._ready) this._active().playMissileLaunch() }
  playGunShot()          { if (this._ready) this._active().playGunShot() }
  playRicochet()         { if (this._ready) this._active().playRicochet() }
  playExplosion(dist)    { if (this._ready) this._active().playExplosion(dist) }
  playEnemyFire(dist)    { if (this._ready) this._active().playEnemyFire(dist) }
  playCollision()        { if (this._ready) this._active().playCollision() }

  // Options screen test buttons: play one sound in the chosen style, even
  // while the game's audio is paused. Returns false if it couldn't play.
  async preview(kind, style = this._style) {
    this.init()
    if (!this._ready) return false
    await this._ctx.resume()
    let s = style === 'recorded' ? this._recorded : this._classic
    if (s === this._recorded && !s.ready) {
      if (s.failed) return false
      await new Promise(r => { const t = setInterval(() => { if (s.ready || s.failed) { clearInterval(t); r() } }, 100) })
      if (!s.ready) return false
    }
    if (kind === 'gun')        s.playGunShot()
    if (kind === 'missile')    s.playMissileLaunch()
    if (kind === 'explosion')  s.playExplosion(0)
    if (kind === 'enemy')      s.playEnemyFire(60)
    if (kind === 'crash')      s.playCollision()
    return true
  }

  suspend() { this._ctx?.suspend() }
  resume()  { this._ctx?.resume() }

  dispose() {
    if (!this._ready) return
    this._classic.stopAll()
    this._recorded.stopAll()
    try { this._ctx?.close() } catch {}
    this._ready = false
    this._ctx   = null
  }
}
