// Procedural audio via Web Audio API — no external assets required.
// All sounds are synthesised from oscillators and filtered noise.

export class AudioManager {
  constructor() {
    this._ctx         = null
    this._ready       = false
    this._masterGain  = null
    this._noiseBuffer = null

    // Ski walk crunch (timer-driven one-shots)
    this._crunchTimer  = 0

    // Ski glide (continuous bandpass rush)
    this._glideNoise   = null
    this._glideFilter  = null
    this._glideGain    = null

    // Snowcat engine (oscillator + noise)
    this._snowcatOsc   = null
    this._snowcatNoise = null
    this._snowcatGain  = null

    // Paramotor (two detuned oscillators + wind rush)
    this._paramotorOsc1  = null
    this._paramotorOsc2  = null
    this._paramotorWind  = null
    this._paramotorGain  = null

    this._travelMode = null

    // Combat buzz (two-tone alternating oscillator)
    this._combatBuzzOsc      = null
    this._combatBuzzGain     = null
    this._combatBuzzInterval = null
  }

  // ---- Initialisation (call after first user gesture) -------------------------

  init() {
    if (this._ready) {
      // If the context was suspended (iOS autoplay policy), kick it alive again
      this._ctx?.resume()
      return
    }
    try {
      this._ctx = new (window.AudioContext || window.webkitAudioContext)()
      this._masterGain = this._ctx.createGain()
      this._masterGain.gain.value = 1.0
      this._masterGain.connect(this._ctx.destination)
      this._noiseBuffer = this._makeNoiseBuffer(8)
      this._ready = true
    } catch (e) {
      console.warn('[Audio] init failed:', e)
    }
  }

  // ---- Noise helpers ----------------------------------------------------------

  _makeNoiseBuffer(seconds) {
    const ctx  = this._ctx
    const sr   = ctx.sampleRate
    const buf  = ctx.createBuffer(1, sr * seconds, sr)
    const data = buf.getChannelData(0)
    // Pink-ish noise via first-order IIR on white noise
    let b0 = 0
    for (let i = 0; i < data.length; i++) {
      const w = Math.random() * 2 - 1
      b0 = 0.99765 * b0 + w * 0.0990460
      data[i] = Math.max(-1, Math.min(1, b0 + w * 0.0555179))
    }
    return buf
  }

  _noiseSource() {
    const src = this._ctx.createBufferSource()
    src.buffer = this._noiseBuffer
    src.loop   = true
    return src
  }

  // ---- Per-frame update -------------------------------------------------------

  // slopeGradient: positive = going uphill, negative = going downhill
  update(dt, travelMode, speed, slopeGradient) {
    if (!this._ready) return

    if (travelMode !== this._travelMode) {
      this._switchTravelMode(travelMode)
      this._travelMode = travelMode
    }

    if (travelMode === 'ski')      this._updateSki(dt, speed)
    else if (travelMode === 'snowcat') this._updateSnowcat(speed, slopeGradient)
  }

  // ---- Travel mode switching --------------------------------------------------

  _switchTravelMode(newMode) {
    const ctx = this._ctx
    const now = ctx.currentTime

    // Fade and stop ski glide
    if (this._glideGain) {
      this._glideGain.gain.linearRampToValueAtTime(0, now + 0.3)
      const g = this._glideGain, n = this._glideNoise
      setTimeout(() => {
        try { n?.stop() } catch {}
        try { g.disconnect() } catch {}
      }, 350)
      this._glideGain = null
      this._glideFilter = null
      this._glideNoise = null
    }
    this._crunchTimer = 0

    // Fade and stop snowcat
    if (this._snowcatGain) {
      this._snowcatGain.gain.linearRampToValueAtTime(0, now + 0.6)
      const g = this._snowcatGain, o = this._snowcatOsc, n = this._snowcatNoise
      setTimeout(() => {
        try { o?.stop() } catch {}
        try { n?.stop() } catch {}
        try { g.disconnect() } catch {}
      }, 700)
      this._snowcatGain = null
      this._snowcatOsc  = null
      this._snowcatNoise = null
    }

    // Fade and stop paramotor
    if (this._paramotorGain) {
      this._paramotorGain.gain.linearRampToValueAtTime(0, now + 0.6)
      const g = this._paramotorGain, o1 = this._paramotorOsc1, o2 = this._paramotorOsc2, w = this._paramotorWind
      setTimeout(() => {
        try { o1?.stop() } catch {}
        try { o2?.stop() } catch {}
        try { w?.stop()  } catch {}
        try { g.disconnect() } catch {}
      }, 700)
      this._paramotorGain = null
      this._paramotorOsc1 = null
      this._paramotorOsc2 = null
      this._paramotorWind = null
    }

    if (newMode === 'snowcat')   this._startSnowcat()
    if (newMode === 'paramotor') this._startParamotor()
    // ski sounds start lazily in _updateSki
  }

  // ---- Skiing sounds ----------------------------------------------------------

  // Two modes: walking (crunch bursts, slow cadence) and gliding (bandpass rush).
  // Crossover at GLIDE_THRESHOLD m/s.
  _updateSki(dt, speed) {
    const GLIDE_THRESHOLD = 1.8
    const ctx = this._ctx
    const now = ctx.currentTime

    if (speed < 0.15) {
      // Stopped — silence glide
      if (this._glideGain) this._glideGain.gain.linearRampToValueAtTime(0, now + 0.25)
      this._crunchTimer = 0
      return
    }

    if (speed < GLIDE_THRESHOLD) {
      // Walking — fade glide out, emit periodic crunch
      if (this._glideGain) this._glideGain.gain.linearRampToValueAtTime(0, now + 0.2)
      this._crunchTimer -= dt
      if (this._crunchTimer <= 0) {
        const interval = Math.max(0.28, 0.75 - speed * 0.18)
        this._crunchTimer = interval
        this._playSkiCrunch(speed)
      }
    } else {
      // Gliding — fade crunch out (it's one-shot anyway), run continuous rush
      this._crunchTimer = 0
      if (!this._glideGain) this._startGlide()
      if (this._glideGain) {
        const t = Math.min(1, (speed - GLIDE_THRESHOLD) / (12.5 - GLIDE_THRESHOLD))
        this._glideFilter.frequency.linearRampToValueAtTime(380 + t * 1800, now + 0.12)
        this._glideGain.gain.linearRampToValueAtTime(0.04 + t * 0.22, now + 0.12)
      }
    }
  }

  _startGlide() {
    const ctx = this._ctx
    this._glideNoise  = this._noiseSource()
    this._glideFilter = ctx.createBiquadFilter()
    this._glideFilter.type            = 'bandpass'
    this._glideFilter.frequency.value = 400
    this._glideFilter.Q.value         = 1.1
    this._glideGain = ctx.createGain()
    this._glideGain.gain.value = 0
    this._glideNoise.connect(this._glideFilter)
    this._glideFilter.connect(this._glideGain)
    this._glideGain.connect(this._masterGain)
    this._glideNoise.start()
  }

  _playSkiCrunch(speed) {
    const ctx = this._ctx
    const now = ctx.currentTime
    const src = this._noiseSource()
    const hpf = ctx.createBiquadFilter()
    hpf.type            = 'highpass'
    hpf.frequency.value = 1100 + Math.random() * 900
    const env = ctx.createGain()
    // Double strike for a crunchy two-phase footstep feel
    env.gain.setValueAtTime(0, now)
    env.gain.linearRampToValueAtTime(0.30 + speed * 0.04, now + 0.007)
    env.gain.exponentialRampToValueAtTime(0.04, now + 0.055)
    env.gain.linearRampToValueAtTime(0.18, now + 0.075)
    env.gain.exponentialRampToValueAtTime(0.001, now + 0.18)
    src.connect(hpf)
    hpf.connect(env)
    env.connect(this._masterGain)
    src.start(now)
    src.stop(now + 0.20)
    src.onended = () => { try { src.disconnect(); hpf.disconnect(); env.disconnect() } catch {} }
  }

  // ---- Snowcat engine ---------------------------------------------------------

  _startSnowcat() {
    const ctx = this._ctx

    this._snowcatOsc = ctx.createOscillator()
    this._snowcatOsc.type            = 'sawtooth'
    this._snowcatOsc.frequency.value = 48

    const distort = ctx.createWaveShaper()
    distort.curve = this._makeDistortionCurve(80)

    const lpf = ctx.createBiquadFilter()
    lpf.type            = 'lowpass'
    lpf.frequency.value = 500

    // Diesel rattle — narrow bandpass noise layer
    this._snowcatNoise = this._noiseSource()
    const rattleBpf = ctx.createBiquadFilter()
    rattleBpf.type            = 'bandpass'
    rattleBpf.frequency.value = 220
    rattleBpf.Q.value         = 3
    const rattleGain = ctx.createGain()
    rattleGain.gain.value = 0.08

    this._snowcatGain = ctx.createGain()
    this._snowcatGain.gain.value = 0

    this._snowcatOsc.connect(distort)
    distort.connect(lpf)
    lpf.connect(this._snowcatGain)

    this._snowcatNoise.connect(rattleBpf)
    rattleBpf.connect(rattleGain)
    rattleGain.connect(this._snowcatGain)

    this._snowcatGain.connect(this._masterGain)

    this._snowcatOsc.start()
    this._snowcatNoise.start()

    // Fade in with a startup rev
    const now = ctx.currentTime
    this._snowcatGain.gain.linearRampToValueAtTime(0.4, now + 1.0)
    // Brief rev up on start
    this._snowcatOsc.frequency.setValueAtTime(80, now)
    this._snowcatOsc.frequency.linearRampToValueAtTime(48, now + 1.2)
  }

  _updateSnowcat(speed, slopeGradient) {
    if (!this._snowcatOsc || !this._snowcatGain) return
    const ctx = this._ctx
    const now = ctx.currentTime

    // Higher RPM going uphill (engine strains), lower when coasting downhill.
    // slopeGradient ≈ (hAhead - hBehind)/2 in world units/m
    const slopeRpm  = slopeGradient * 55
    const speedRpm  = speed * 1.8
    const targetHz  = Math.max(28, Math.min(105, 48 + slopeRpm + speedRpm))
    this._snowcatOsc.frequency.linearRampToValueAtTime(targetHz, now + 0.4)

    // Volume: idle = quiet, driving = louder
    const norm = Math.min(1, speed / 19.44)
    this._snowcatGain.gain.linearRampToValueAtTime(0.14 + norm * 0.36, now + 0.4)
  }

  // ---- Paramotor engine -------------------------------------------------------

  _startParamotor() {
    const ctx = this._ctx

    // Two slightly detuned saws for chorus/beat effect
    this._paramotorOsc1 = ctx.createOscillator()
    this._paramotorOsc1.type            = 'sawtooth'
    this._paramotorOsc1.frequency.value = 82

    this._paramotorOsc2 = ctx.createOscillator()
    this._paramotorOsc2.type            = 'sawtooth'
    this._paramotorOsc2.frequency.value = 85

    const lpf = ctx.createBiquadFilter()
    lpf.type            = 'lowpass'
    lpf.frequency.value = 480

    // Wind rush above the motor tone
    this._paramotorWind = this._noiseSource()
    const windHpf = ctx.createBiquadFilter()
    windHpf.type            = 'highpass'
    windHpf.frequency.value = 700
    const windGain = ctx.createGain()
    windGain.gain.value = 0.09

    this._paramotorGain = ctx.createGain()
    this._paramotorGain.gain.value = 0

    this._paramotorOsc1.connect(lpf)
    this._paramotorOsc2.connect(lpf)
    lpf.connect(this._paramotorGain)

    this._paramotorWind.connect(windHpf)
    windHpf.connect(windGain)
    windGain.connect(this._paramotorGain)

    this._paramotorGain.connect(this._masterGain)

    this._paramotorOsc1.start()
    this._paramotorOsc2.start()
    this._paramotorWind.start()

    this._paramotorGain.gain.linearRampToValueAtTime(0.28, ctx.currentTime + 1.2)
  }

  // ---- Combat buzz ------------------------------------------------------------

  startCombatBuzz() {
    if (!this._ready || this._combatBuzzOsc) return
    const ctx = this._ctx
    this._combatBuzzOsc = ctx.createOscillator()
    this._combatBuzzOsc.type = 'square'
    this._combatBuzzOsc.frequency.value = 440
    this._combatBuzzGain = ctx.createGain()
    this._combatBuzzGain.gain.value = 0.09
    this._combatBuzzOsc.connect(this._combatBuzzGain)
    this._combatBuzzGain.connect(this._masterGain)
    this._combatBuzzOsc.start()
    let high = true
    this._combatBuzzInterval = setInterval(() => {
      if (this._combatBuzzOsc) {
        high = !high
        this._combatBuzzOsc.frequency.value = high ? 440 : 330
      }
    }, 200)
  }

  stopCombatBuzz() {
    if (this._combatBuzzInterval) { clearInterval(this._combatBuzzInterval); this._combatBuzzInterval = null }
    if (this._combatBuzzOsc) {
      try { this._combatBuzzOsc.stop() } catch {}
      try { this._combatBuzzOsc.disconnect() } catch {}
      this._combatBuzzOsc = null
    }
    if (this._combatBuzzGain) {
      try { this._combatBuzzGain.disconnect() } catch {}
      this._combatBuzzGain = null
    }
  }

  // ---- One-shot effects -------------------------------------------------------

  playMissileLaunch() {
    if (!this._ready) return
    const ctx = this._ctx
    const now = ctx.currentTime

    // Oscillator whoosh sweep
    const osc = ctx.createOscillator()
    osc.type = 'sawtooth'
    osc.frequency.setValueAtTime(180, now)
    osc.frequency.exponentialRampToValueAtTime(920, now + 0.38)
    const oscEnv = ctx.createGain()
    oscEnv.gain.setValueAtTime(0, now)
    oscEnv.gain.linearRampToValueAtTime(0.38, now + 0.018)
    oscEnv.gain.exponentialRampToValueAtTime(0.001, now + 0.42)

    // Noise body
    const noise   = this._noiseSource()
    const noiseBpf = ctx.createBiquadFilter()
    noiseBpf.type            = 'bandpass'
    noiseBpf.frequency.value = 600
    noiseBpf.Q.value         = 0.6
    const noiseEnv = ctx.createGain()
    noiseEnv.gain.setValueAtTime(0.28, now)
    noiseEnv.gain.exponentialRampToValueAtTime(0.001, now + 0.40)

    osc.connect(oscEnv);     oscEnv.connect(this._masterGain)
    noise.connect(noiseBpf); noiseBpf.connect(noiseEnv); noiseEnv.connect(this._masterGain)

    osc.start(now);   osc.stop(now + 0.45)
    noise.start(now); noise.stop(now + 0.45)
    osc.onended   = () => { try { osc.disconnect();   oscEnv.disconnect() } catch {} }
    noise.onended = () => { try { noise.disconnect(); noiseBpf.disconnect(); noiseEnv.disconnect() } catch {} }
  }

  playGunShot() {
    if (!this._ready) return
    const ctx = this._ctx
    const now = ctx.currentTime

    // High crack
    const noise = this._noiseSource()
    const hpf   = ctx.createBiquadFilter()
    hpf.type            = 'highpass'
    hpf.frequency.value = 1800
    const crackEnv = ctx.createGain()
    crackEnv.gain.setValueAtTime(0, now)
    crackEnv.gain.linearRampToValueAtTime(0.85, now + 0.003)
    crackEnv.gain.exponentialRampToValueAtTime(0.001, now + 0.09)

    // Low thud
    const thud = ctx.createOscillator()
    thud.type = 'sine'
    thud.frequency.setValueAtTime(130, now)
    thud.frequency.exponentialRampToValueAtTime(45, now + 0.07)
    const thudEnv = ctx.createGain()
    thudEnv.gain.setValueAtTime(0.50, now)
    thudEnv.gain.exponentialRampToValueAtTime(0.001, now + 0.08)

    noise.connect(hpf); hpf.connect(crackEnv); crackEnv.connect(this._masterGain)
    thud.connect(thudEnv); thudEnv.connect(this._masterGain)

    noise.start(now); noise.stop(now + 0.10)
    thud.start(now);  thud.stop(now + 0.10)
    noise.onended = () => { try { noise.disconnect(); hpf.disconnect(); crackEnv.disconnect() } catch {} }
    thud.onended  = () => { try { thud.disconnect();  thudEnv.disconnect() } catch {} }
  }

  playExplosion() {
    if (!this._ready) return
    const ctx = this._ctx
    const now = ctx.currentTime

    // Sub thud
    const sub = ctx.createOscillator()
    sub.type = 'sine'
    sub.frequency.setValueAtTime(62, now)
    sub.frequency.exponentialRampToValueAtTime(28, now + 0.45)
    const subEnv = ctx.createGain()
    subEnv.gain.setValueAtTime(0.55, now)
    subEnv.gain.exponentialRampToValueAtTime(0.001, now + 0.55)

    // Low noise rumble
    const rumble   = this._noiseSource()
    const rumbleLpf = ctx.createBiquadFilter()
    rumbleLpf.type            = 'lowpass'
    rumbleLpf.frequency.value = 250
    const rumbleEnv = ctx.createGain()
    rumbleEnv.gain.setValueAtTime(0, now)
    rumbleEnv.gain.linearRampToValueAtTime(0.80, now + 0.018)
    rumbleEnv.gain.exponentialRampToValueAtTime(0.001, now + 2.1)

    // Mid crack
    const mid    = this._noiseSource()
    const midBpf = ctx.createBiquadFilter()
    midBpf.type            = 'bandpass'
    midBpf.frequency.value = 380
    midBpf.Q.value         = 0.5
    const midEnv = ctx.createGain()
    midEnv.gain.setValueAtTime(0, now)
    midEnv.gain.linearRampToValueAtTime(0.50, now + 0.010)
    midEnv.gain.exponentialRampToValueAtTime(0.001, now + 0.85)

    sub.connect(subEnv);       subEnv.connect(this._masterGain)
    rumble.connect(rumbleLpf); rumbleLpf.connect(rumbleEnv); rumbleEnv.connect(this._masterGain)
    mid.connect(midBpf);       midBpf.connect(midEnv);       midEnv.connect(this._masterGain)

    sub.start(now);    sub.stop(now + 0.60)
    rumble.start(now); rumble.stop(now + 2.2)
    mid.start(now);    mid.stop(now + 0.90)

    sub.onended    = () => { try { sub.disconnect();    subEnv.disconnect() } catch {} }
    rumble.onended = () => { try { rumble.disconnect(); rumbleLpf.disconnect(); rumbleEnv.disconnect() } catch {} }
    mid.onended    = () => { try { mid.disconnect();    midBpf.disconnect(); midEnv.disconnect() } catch {} }
  }

  playEnemyFire() {
    if (!this._ready) return
    const ctx = this._ctx
    const now = ctx.currentTime

    const osc = ctx.createOscillator()
    osc.type = 'sawtooth'
    osc.frequency.setValueAtTime(140, now)
    osc.frequency.exponentialRampToValueAtTime(580, now + 0.28)
    const env = ctx.createGain()
    env.gain.setValueAtTime(0, now)
    env.gain.linearRampToValueAtTime(0.22, now + 0.014)
    env.gain.exponentialRampToValueAtTime(0.001, now + 0.32)

    osc.connect(env); env.connect(this._masterGain)
    osc.start(now); osc.stop(now + 0.35)
    osc.onended = () => { try { osc.disconnect(); env.disconnect() } catch {} }
  }

  playCollision() {
    if (!this._ready) return
    const ctx = this._ctx
    const now = ctx.currentTime

    // Metallic crunch — sawtooth sweep downward
    const osc = ctx.createOscillator()
    osc.type = 'sawtooth'
    osc.frequency.setValueAtTime(220, now)
    osc.frequency.exponentialRampToValueAtTime(35, now + 0.20)
    const oscEnv = ctx.createGain()
    oscEnv.gain.setValueAtTime(0.7, now)
    oscEnv.gain.exponentialRampToValueAtTime(0.001, now + 0.25)
    osc.connect(oscEnv); oscEnv.connect(this._masterGain)
    osc.start(now); osc.stop(now + 0.28)
    osc.onended = () => { try { osc.disconnect(); oscEnv.disconnect() } catch {} }

    // Impact noise burst — wide-band, sharp attack
    const noise = this._noiseSource()
    const lpf = ctx.createBiquadFilter()
    lpf.type = 'lowpass'
    lpf.frequency.value = 1800
    const noiseEnv = ctx.createGain()
    noiseEnv.gain.setValueAtTime(0, now)
    noiseEnv.gain.linearRampToValueAtTime(1.0, now + 0.004)
    noiseEnv.gain.exponentialRampToValueAtTime(0.001, now + 0.5)
    noise.connect(lpf); lpf.connect(noiseEnv); noiseEnv.connect(this._masterGain)
    noise.start(now); noise.stop(now + 0.55)
    noise.onended = () => { try { noise.disconnect(); lpf.disconnect(); noiseEnv.disconnect() } catch {} }
  }

  // ---- Utility ----------------------------------------------------------------

  _makeDistortionCurve(amount) {
    const n     = 256
    const curve = new Float32Array(n)
    const k     = Math.PI + amount
    for (let i = 0; i < n; i++) {
      const x  = (i * 2) / n - 1
      curve[i] = (k * x) / (Math.PI + amount * Math.abs(x))
    }
    return curve
  }

  suspend() { this._ctx?.suspend() }
  resume()  { this._ctx?.resume() }

  dispose() {
    if (!this._ready) return
    this.stopCombatBuzz()
    try {
      this._glideNoise?.stop()
      this._snowcatOsc?.stop(); this._snowcatNoise?.stop()
      this._paramotorOsc1?.stop(); this._paramotorOsc2?.stop(); this._paramotorWind?.stop()
      this._ctx?.close()
    } catch {}
    this._ready = false
    this._ctx   = null
  }
}
