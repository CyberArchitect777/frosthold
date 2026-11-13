// "Recorded" sound style: public-domain (CC0) recordings from Freesound,
// cut and levelled by Claude-documentation/sound-tools/build_sounds.py and
// served from public/sounds/. Same interface as ClassicSounds (audio-classic.js);
// AudioManager (audio.js) falls back to classic until these have loaded, or for good if loading fails.

// Which file plays each part: the owner's picks from the listening page (2026-11-12).
// Swap a name here to use another cut from the tools. tracks: null = no separate track sound.
export const PICKS = {
  wind:         'wind_a',
  glide:        'ski_glide_a',
  stride:       'ski_stride_a',
  steps:        ['snow_step_1', 'snow_step_2', 'snow_step_3', 'snow_step_4'],
  swoosh:       'ski_swoosh_a',
  gun:          'gun_b',
  missile:      'missile_b',
  explosion:    'explosion_a',
  explosionFar: 'explosion_far',
  enemyFire:    'cannon_a',
  crash:        'crash_a',
  ricochet:     'ricochet',
  alert:        'alert_a',
  heartbeat:    'heartbeat',
  engine:       'snowmobile_alt',
  tracks:       null,
  paramotor:    'paramotor_a',
}

// Loop files hold [last PAD s of loop] + loop + [first PAD s], so the loop plays
// between PAD and PAD+len and MP3 encoder delay can't open a gap. Lengths from
// the tools' manifest.json.
const PAD = 0.15
const LOOP_LEN = {
  wind_a: 20.0, ski_glide_a: 8.0, ski_stride_a: 5.5, heartbeat: 4.0,
  snowcat_engine: 8.0, snowcat_tracks: 8.0, snowmobile_alt: 3.5,
  paramotor_a: 6.0, paramotor_b: 6.0,
}

const SKI_MAX     = 12.5    // m/s, player.js SKI_MAX_SPEED
const SNOWCAT_MAX = 19.44   // m/s, player.js SNOWCAT_MAX_SPEED
const GLIDE_FROM  = 1.8     // m/s: ski hiss starts (classic uses the same crossover)

const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
// 0 below a, 1 above b, smooth between
const ramp = (v, a, b) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t) }
// Distance loudness for shots and blasts, in metres
const falloff = d => clamp(1 / (1 + Math.max(0, d) / 70), 0.12, 1)

export class RecordedSounds {
  constructor(ctx, out) {
    this._ctx = ctx
    this._out = out
    this._buf = {}           // name -> AudioBuffer
    this.ready = false       // true once every file has decoded
    this.failed = false
    this._travelMode = null
    this._loops = {}         // part -> { src, gain }
    this._stepTimer = 0
    this._lastYaw = null
    this._swooshWait = 0     // s until another turn swoosh may play
    this._combat = null      // heartbeat loop while in combat
  }

  // Fetch and decode every picked file. Resolves true when all are ready.
  async load(baseUrl) {
    const names = [...new Set(Object.values(PICKS).flat().filter(Boolean))]
    try {
      await Promise.all(names.map(async n => {
        const res = await fetch(`${baseUrl}sounds/${n}.mp3`)
        if (!res.ok) throw new Error(`${n}: HTTP ${res.status}`)
        const data = await res.arrayBuffer()
        this._buf[n] = await new Promise((ok, bad) => this._ctx.decodeAudioData(data, ok, bad))
      }))
      this.ready = true
    } catch (e) {
      console.warn('[Audio] recorded sounds failed to load, using classic:', e)
      this.failed = true
    }
    return this.ready
  }

  // ---- Helpers ----------------------------------------------------------------

  // Start a looping part at gain 0 (callers ramp it up)
  _startLoop(part, name) {
    if (this._loops[part]) return this._loops[part]
    const buffer = name && this._buf[name]
    if (!buffer) return null
    const ctx = this._ctx
    const src = ctx.createBufferSource()
    src.buffer = buffer
    src.loop = true
    const len = LOOP_LEN[name] ?? (buffer.duration - 2 * PAD)
    src.loopStart = PAD
    src.loopEnd = PAD + len
    const gain = ctx.createGain()
    gain.gain.value = 0
    src.connect(gain)
    gain.connect(this._out)
    // Start somewhere random in the loop so repeats don't line up
    src.start(0, PAD + Math.random() * len)
    return (this._loops[part] = { src, gain })
  }

  _setLoop(part, gain, rate, secs = 0.15) {
    const l = this._loops[part]
    if (!l) return
    const now = this._ctx.currentTime
    l.gain.gain.cancelScheduledValues(now)
    l.gain.gain.setValueAtTime(l.gain.gain.value, now)
    l.gain.gain.linearRampToValueAtTime(gain, now + secs)
    if (rate != null) {
      l.src.playbackRate.cancelScheduledValues(now)
      l.src.playbackRate.setValueAtTime(l.src.playbackRate.value, now)
      l.src.playbackRate.linearRampToValueAtTime(rate, now + secs)
    }
  }

  _stopLoop(part, secs = 0.4) {
    const l = this._loops[part]
    if (!l) return
    delete this._loops[part]
    const now = this._ctx.currentTime
    l.gain.gain.cancelScheduledValues(now)
    l.gain.gain.setValueAtTime(l.gain.gain.value, now)
    l.gain.gain.linearRampToValueAtTime(0, now + secs)
    l.src.stop(now + secs + 0.05)
    l.src.onended = () => { try { l.src.disconnect(); l.gain.disconnect() } catch {} }
  }

  // Play a one-shot. rate: playback speed (also shifts pitch)
  _play(name, gain = 1, rate = 1) {
    const buffer = this._buf[name]
    if (!buffer || gain <= 0) return
    const ctx = this._ctx
    const src = ctx.createBufferSource()
    src.buffer = buffer
    src.playbackRate.value = rate
    const g = ctx.createGain()
    g.gain.value = gain
    src.connect(g)
    g.connect(this._out)
    src.start()
    src.onended = () => { try { src.disconnect(); g.disconnect() } catch {} }
  }

  _vary(amount = 0.05) { return 1 + (Math.random() * 2 - 1) * amount }

  // ---- Per-frame update -------------------------------------------------------

  // slopeGradient: positive = uphill. vy: vertical speed, m/s (paramotor climb/sink)
  // yaw: heading in radians (for the ski turn swoosh)
  update(dt, travelMode, speed, slopeGradient, vy = 0, yaw = 0) {
    if (travelMode !== this._travelMode) {
      this._switchTravelMode(travelMode)
      this._travelMode = travelMode
    }
    // Wind is always there, stronger the faster you go
    this._startLoop('wind', PICKS.wind)
    if (travelMode === 'ski') {
      const t = clamp(speed / SKI_MAX, 0, 1)
      this._setLoop('wind', 0.30 + 0.70 * t, 0.95 + 0.15 * t, 0.4)
      this._updateSki(dt, speed, yaw)
    } else if (travelMode === 'snowcat') {
      const t = clamp(speed / SNOWCAT_MAX, 0, 1)
      this._setLoop('wind', 0.18 + 0.30 * t, 0.95 + 0.15 * t, 0.4)
      this._updateSnowcat(speed, slopeGradient)
    } else if (travelMode === 'paramotor') {
      this._setLoop('wind', 0.75, 1.08, 0.4)
      // Engine works harder climbing, eases off sinking
      this._setLoop('paramotor', 0.55 + clamp(vy, 0, 3) * 0.05, clamp(1 + vy * 0.045, 0.88, 1.15), 0.3)
    }
  }

  _switchTravelMode(mode) {
    for (const part of ['glide', 'stride', 'engine', 'tracks', 'paramotor']) this._stopLoop(part, 0.5)
    this._stepTimer = 0
    this._lastYaw = null
    if (mode === 'snowcat') {
      this._startLoop('engine', PICKS.engine)
      this._startLoop('tracks', PICKS.tracks)
      // Start-up: engine comes up from a low idle
      const e = this._loops.engine
      if (e) { e.src.playbackRate.value = 0.6; this._setLoop('engine', 0.55, 0.8, 1.0) }
    }
    if (mode === 'paramotor') {
      this._startLoop('paramotor', PICKS.paramotor)
      this._setLoop('paramotor', 0.55, 1, 1.2)
    }
  }

  // Slow: footsteps in snow. Walking pace: a cross-country stride.
  // Faster: the skis' hiss, brighter and louder with speed.
  // A sharp turn at speed: one swoosh
  _updateSki(dt, speed, yaw) {
    this._startLoop('stride', PICKS.stride)
    this._startLoop('glide', PICKS.glide)

    const stride = ramp(speed, 0.8, 1.6) * (1 - ramp(speed, 3.0, 5.0))
    this._setLoop('stride', 0.7 * stride, 0.85 + clamp(speed, 0, 4) * 0.08)

    const t = clamp((speed - GLIDE_FROM) / (SKI_MAX - GLIDE_FROM), 0, 1)
    this._setLoop('glide', speed > GLIDE_FROM ? 0.2 + 0.9 * t : 0, 0.85 + 0.35 * t)

    if (speed > 0.15 && speed < 1.2) {
      this._stepTimer -= dt
      if (this._stepTimer <= 0) {
        this._stepTimer = Math.max(0.45, 0.8 - speed * 0.2)
        const steps = PICKS.steps
        this._play(steps[Math.floor(Math.random() * steps.length)], 0.45, this._vary(0.08))
      }
    } else {
      this._stepTimer = 0
    }

    let turn = 0
    if (this._lastYaw != null && dt > 0) {
      let d = yaw - this._lastYaw
      d = Math.atan2(Math.sin(d), Math.cos(d))   // wrap to -pi..pi
      turn = Math.abs(d) / dt                    // rad/s
    }
    this._lastYaw = yaw
    this._swooshWait = Math.max(0, this._swooshWait - dt)
    if (speed > 5 && turn > 1.0 && this._swooshWait === 0) {
      this._swooshWait = 1.5
      this._play(PICKS.swoosh, 0.25 + 0.35 * clamp((speed - 5) / (SKI_MAX - 5), 0, 1), this._vary(0.08))
    }
  }

  // Engine pitch follows speed and strains uphill; tracks (if a track file is picked) clatter with speed
  _updateSnowcat(speed, slopeGradient) {
    const n = clamp(speed / SNOWCAT_MAX, 0, 1)
    this._setLoop('engine', 0.5 + 0.35 * n, clamp(0.8 + 0.45 * n + slopeGradient * 0.6, 0.65, 1.4), 0.4)
    this._setLoop('tracks', 0.75 * ramp(speed, 0.2, 4), 0.7 + 0.6 * n, 0.3)
  }

  // ---- Combat: one alert, then a quiet heartbeat until it's over ---------------

  startCombatBuzz() {
    if (this._combat) return
    this._play(PICKS.alert, 0.45)
    this._combat = this._startLoop('heartbeat', PICKS.heartbeat)
    this._setLoop('heartbeat', 0.55, 1, 1.5)
  }

  stopCombatBuzz() {
    if (!this._combat) return
    this._combat = null
    this._stopLoop('heartbeat', 1.5)
  }

  // ---- One-shots ---------------------------------------------------------------

  playMissileLaunch()   { this._play(PICKS.missile, 0.6, this._vary(0.04)) }
  playGunShot()         { this._play(PICKS.gun, 0.65, this._vary(0.05)) }
  playRicochet()        { this._play(PICKS.ricochet, 0.35, this._vary(0.12)) }
  playCollision()       { this._play(PICKS.crash, 0.75, this._vary(0.05)) }

  // dist: metres from the player (0 = unknown or close)
  playExplosion(dist = 0) {
    if (dist > 150) this._play(PICKS.explosionFar, clamp(1.1 * falloff(dist - 150), 0.2, 0.9), this._vary(0.05))
    else this._play(PICKS.explosion, 0.95 * falloff(dist), this._vary(0.05))
  }

  playEnemyFire(dist = 0) { this._play(PICKS.enemyFire, 0.6 * falloff(dist), this._vary(0.06)) }

  // ---- Lifecycle ---------------------------------------------------------------

  stopAll() {
    for (const part of Object.keys(this._loops)) this._stopLoop(part, 0.3)
    this._combat = null
    this._travelMode = null
    this._stepTimer = 0
  }
}
