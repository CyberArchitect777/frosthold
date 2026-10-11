import React, { useEffect, useRef, useState, useCallback } from 'react'
import { useGameStore } from './store/gameStore.js'
import { useOrientation } from './hooks/useOrientation.js'
import { useGyroscope } from './hooks/useGyroscope.js'
import { GameEngine, detectPerformanceTier } from './game/engine.js'
import { AudioManager } from './game/audio.js'
import { HUD } from './ui/HUD.jsx'
import { StrategyMap } from './ui/StrategyMap.jsx'
import { AllyPanel } from './ui/AllyPanel.jsx'
import { AllyProfile } from './ui/AllyProfile.jsx'
import { PauseMenu } from './ui/PauseMenu.jsx'

export default function App() {
  const canvasRef = useRef(null)
  const engineRef = useRef(null)
  const audioRef  = useRef(null)
  const orientation = useOrientation()
  const gyro = useGyroscope()

  const gamePhase = useGameStore(s => s.gamePhase)
  const uiMode = useGameStore(s => s.uiMode)
  const isPaused = useGameStore(s => s.isPaused)
  const worldSeed = useGameStore(s => s.worldSeed)
  const selectedAlly = useGameStore(s => s.selectedAlly)

  const initWorld     = useGameStore(s => s.initWorld)
  const continueGame  = useGameStore(s => s.continueGame)
  const hasSave       = useGameStore(s => s.hasSave)
  const setUiMode = useGameStore(s => s.setUiMode)
  const setPerformanceTier = useGameStore(s => s.setPerformanceTier)
  const togglePause = useGameStore(s => s.togglePause)
  const setGamePhase = useGameStore(s => s.setGamePhase)
  const updatePlayer = useGameStore(s => s.updatePlayer)
  const allies = useGameStore(s => s.allies)
  const settlements = useGameStore(s => s.settlements)
  const selectAlly = useGameStore(s => s.selectAlly)
  const drainStamina = useGameStore(s => s.drainStamina)
  const drainFuel = useGameStore(s => s.drainFuel)
  const recoverStamina = useGameStore(s => s.recoverStamina)
  const advanceTime           = useGameStore(s => s.advanceTime)
  const chargeEntryTime       = useGameStore(s => s.chargeEntryTime)
  const synchroniseWatches    = useGameStore(s => s.synchroniseWatches)
  const switchCharacter       = useGameStore(s => s.switchCharacter)
  const takeDamage            = useGameStore(s => s.takeDamage)
  const inflictInjury         = useGameStore(s => s.inflictInjury)
  const abandonVehicle        = useGameStore(s => s.abandonVehicle)
  const collectVehicle        = useGameStore(s => s.collectVehicle)
  const abandonedVehicles     = useGameStore(s => s.abandonedVehicles)
  const enemyVehicles         = useGameStore(s => s.enemyVehicles)
  const inCombat              = useGameStore(s => s.inCombat)
  const enterCombat           = useGameStore(s => s.enterCombat)
  const exitCombat            = useGameStore(s => s.exitCombat)
  const destroyEnemyVehicle   = useGameStore(s => s.destroyEnemyVehicle)
  const loadGame              = useGameStore(s => s.loadGame)
  const consumeMissile        = useGameStore(s => s.consumeMissile)
  const consumeBullet         = useGameStore(s => s.consumeBullet)
  const switchWeapon          = useGameStore(s => s.switchWeapon)
  const activeWeapon          = useGameStore(s => s.player.activeWeapon)

  const [showOrientationHint, setShowOrientationHint] = useState(false)
  const [transitionOverlay, setTransitionOverlay] = useState(false)
  const [retreatFlash, setRetreatFlash] = useState(false)
  const [nearSettlement, setNearSettlement] = useState(null)
  const [gyroEnabled, setGyroEnabled] = useState(true)
  const [terrainDebug, setTerrainDebug] = useState(null)
  const [showDebug, setShowDebug] = useState(false)
  const [enemyBearing, setEnemyBearing] = useState(null)
  const enemyBearingRef = useRef(null)
  // Ally roster / profile navigation (null = roster, allyId string or 'player-char' = profile)
  const [profileAllyId, setProfileAllyId] = useState(undefined)
  // Snipe mode: { buildingType, coverHp } | null
  const [snipeState, setSnipeState] = useState(null)
  const snipeStateRef = useRef(null)
  const [snipeFlash, setSnipeFlash] = useState(null)
  // Ref to GunSight's fireWithEffect so keyboard Space key triggers visual
  const gunSightFireRef = useRef(null)


  // Keep snipeStateRef in sync for keyboard handler (avoids stale closure)
  useEffect(() => { snipeStateRef.current = snipeState }, [snipeState])

  // Detect performance tier on mount
  useEffect(() => {
    const tier = detectPerformanceTier()
    setPerformanceTier(tier)
  }, [setPerformanceTier])

  // Rotating to portrait while skiing → return to hub
  useEffect(() => {
    if (gamePhase === 'playing' && orientation === 'portrait' && uiMode === 'action') {
      setUiMode('hub')
    }
  }, [orientation]) // eslint-disable-line

  // When coming in from action: charge entry time and jump straight to current character's profile.
  // Exception: if the active character has overrun the sync period, go to the strategy hub
  // instead so no further actions can be taken until the team syncs.
  const prevUiMode = useRef(null)
  useEffect(() => {
    if (prevUiMode.current === 'action' && uiMode === 'hub') {
      if (nearSettlement) chargeEntryTime()
      const { activeAllyId, player, allies, reportTime } = useGameStore.getState()
      const activePersonalTime = activeAllyId
        ? (allies.find(a => a.id === activeAllyId)?.personalTime ?? 720)
        : (player.personalTime ?? 720)
      const overrun = activePersonalTime >= reportTime
      setProfileAllyId(overrun ? undefined : activeAllyId)
    }
    prevUiMode.current = uiMode
  }, [uiMode]) // eslint-disable-line

  // Initialize Three.js engine when canvas is ready and game starts
  useEffect(() => {
    if (gamePhase !== 'playing' || !canvasRef.current) return

    const canvas = canvasRef.current
    const tier = detectPerformanceTier()

    // Lazy-create AudioManager once per App mount; re-init on each game start
    if (!audioRef.current) audioRef.current = new AudioManager()
    audioRef.current.init()

    const { player } = useGameStore.getState()
    const engine = new GameEngine(canvas, worldSeed, tier, { x: player.position.x, z: player.position.z }, audioRef.current)
    engineRef.current = engine

    // Combat event handler
    engine.onCombatEvent = ({ type, vehicleId, damage, mode, destroyed }) => {
      if (type === 'enter') {
        enterCombat()
      } else if (type === 'vehicleDestroyed') {
        destroyEnemyVehicle(vehicleId)
      } else if (type === 'exit') {
        exitCombat()
        if (destroyed) destroyEnemyVehicle(vehicleId)
      } else if (type === 'retreat') {
        exitCombat()
        setRetreatFlash(true)
        setTimeout(() => setRetreatFlash(false), 2500)
      } else if (type === 'playerHit') {
        takeDamage(damage)
        if (mode === 'snowcat') updatePlayer({ vehicle: null, travelMode: 'ski' })
        // Combat hits → random body/arm/head injury
        const combatParts = ['body', 'body', 'body', 'leftArm', 'rightArm', 'head']
        inflictInjury(combatParts[Math.floor(Math.random() * combatParts.length)])
      } else if (type === 'snipeEnemyFire') {
        // Enemy fires back at sniper — reduce cover HP
        const current = snipeStateRef.current
        if (!current) return
        const hp = current.coverHp - 1
        if (hp <= 0) {
          engine.exitSnipeMode()
          setSnipeState(null)
          setSnipeFlash(null)
          takeDamage(25)
          setUiMode('hub')
        } else {
          setSnipeState({ ...current, coverHp: hp })
        }
      }
    }

    // Bridge engine updates → Zustand store
    engine.onUpdate = ({ position, rotation, speed, staminaDrain, fuelDrain, landingDamage, landed, collisionDamage, buildingCrash, nearSettlement, combatEnemies, dt, debug }) => {
      updatePlayer({ position, rotation, speed })

      // Compute enemy bearing for HUD directional lights
      if (combatEnemies && combatEnemies.length > 0) {
        const nearest = combatEnemies.reduce((best, e) => {
          const d = Math.hypot(e.x - position.x, e.z - position.z)
          return d < Math.hypot(best.x - position.x, best.z - position.z) ? e : best
        })
        const fwdX = -Math.sin(rotation.y), fwdZ = -Math.cos(rotation.y)
        const dx = nearest.x - position.x, dz = nearest.z - position.z
        const ang = Math.atan2(fwdX * dz - fwdZ * dx, fwdX * dx + fwdZ * dz)
        const newBearing = (Math.abs(ang) < Math.PI / 4 || Math.abs(ang) > 3 * Math.PI / 4)
          ? 'both' : ang < 0 ? 'left' : 'right'
        if (newBearing !== enemyBearingRef.current) {
          enemyBearingRef.current = newBearing
          setEnemyBearing(newBearing)
        }
      } else if (enemyBearingRef.current !== null) {
        enemyBearingRef.current = null
        setEnemyBearing(null)
      }
      if (staminaDrain > 0) drainStamina(staminaDrain)
      else recoverStamina(-staminaDrain)
      if (fuelDrain > 0) {
        drainFuel(fuelDrain)
        const { player: p } = useGameStore.getState()
        if (p.fuel <= 0 && (p.travelMode === 'snowcat' || p.travelMode === 'paramotor')) {
          abandonVehicle()
        }
      }
      if (landingDamage > 0) {
        takeDamage(landingDamage)
        // Hard landings damage legs
        if (landingDamage > 20) inflictInjury(['leftLeg', 'rightLeg'][Math.floor(Math.random() * 2)])
        if (landingDamage > 50) inflictInjury(['leftLeg', 'rightLeg'][Math.floor(Math.random() * 2)])
      }
      if (landed) abandonVehicle()
      if (collisionDamage > 0) {
        takeDamage(collisionDamage)
        // Collisions damage legs or body
        const crashParts = ['leftLeg', 'rightLeg', 'body', 'leftArm']
        inflictInjury(crashParts[Math.floor(Math.random() * crashParts.length)])
      }
      if (buildingCrash) {
        if (useGameStore.getState().player.vehicle) abandonVehicle()
        setUiMode('hub')
      }
      advanceTime(dt)
      setNearSettlement(nearSettlement ?? null)
      setTerrainDebug(debug ?? null)
    }

    engine.start()
    // Sync initial state — these effects won't re-fire because the values
    // haven't changed since the engine didn't exist yet.
    const { isPaused: paused, uiMode: mode, player: currentPlayer } = useGameStore.getState()
    engine.setTravelMode(currentPlayer.travelMode)
    if (paused || mode !== 'action') engine.pause()

    // Place settlement buildings at ally locations
    const { settlements: currentSettlements } = useGameStore.getState()
    if (currentSettlements.length > 0) engine.setSettlements(currentSettlements)

    return () => {
      engine.dispose()
      engineRef.current = null
    }
  }, [gamePhase, worldSeed]) // eslint-disable-line

  // Pause engine whenever not in action mode
  useEffect(() => {
    if (!engineRef.current) return
    if (isPaused || uiMode !== 'action') {
      engineRef.current.pause()
      audioRef.current?.suspend()
    } else {
      engineRef.current.resume()
      audioRef.current?.resume()
    }
  }, [isPaused, uiMode])

  // Start/stop combat buzz
  useEffect(() => {
    if (inCombat) audioRef.current?.startCombatBuzz()
    else audioRef.current?.stopCombatBuzz()
  }, [inCombat])

  // Sync abandoned vehicles to engine
  useEffect(() => {
    engineRef.current?.setAbandonedVehicles(abandonedVehicles)
  }, [abandonedVehicles])

  // Sync enemy vehicles to engine
  useEffect(() => {
    engineRef.current?.setEnemyVehicles(enemyVehicles)
  }, [enemyVehicles])

  // Sync travel mode to engine when changed from store (garage/cable car)
  const storeTravelMode = useGameStore(s => s.player.travelMode)
  useEffect(() => {
    engineRef.current?.setTravelMode(storeTravelMode)
  }, [storeTravelMode])

  // Sync injuries to engine whenever they change
  const playerInjuries = useGameStore(s => s.player.injuries)
  useEffect(() => {
    engineRef.current?.setInjuries(playerInjuries)
  }, [playerInjuries])

  // Head knocked out → force exit from action (unconscious)
  useEffect(() => {
    if (playerInjuries?.head === 'out' && uiMode === 'action') {
      setUiMode('hub')
    }
  }, [playerInjuries, uiMode])

  // Pipe gyroscope to engine (only when enabled, never in snipe mode)
  useEffect(() => {
    if (!gyro.permitted || !gyroEnabled || snipeState) {
      engineRef.current?.setGyroInput(0, 0)
      return
    }
    engineRef.current?.setGyroInput(gyro.gamma, gyro.beta)
  }, [gyro.gamma, gyro.beta, gyro.permitted, gyroEnabled, snipeState])

  function handleSnipe({ buildingType, x, z }) {
    const height = 8
    const range  = buildingType === 'church' ? 600 : 300
    engineRef.current?.enterSnipeMode(x, z, height, range)
    setSnipeState({ buildingType, coverHp: 5 })
    setSnipeFlash(null)
    setProfileAllyId(undefined)
    setUiMode('action')
  }

  function handleExitSnipe() {
    engineRef.current?.exitSnipeMode()
    setSnipeState(null)
    setSnipeFlash(null)
    setUiMode('hub')
  }

  function handleSnipeFire() {
    const weapon = useGameStore.getState().player.activeWeapon ?? 'missile'
    let canFire = false
    if (weapon === 'gun') canFire = consumeBullet()
    else canFire = consumeMissile()

    if (!canFire) {
      setSnipeFlash(weapon === 'gun' ? 'NO AMMO' : 'NO MISSILE')
      setTimeout(() => setSnipeFlash(null), 1500)
      return
    }
    // Play fire sound immediately (before result so it always fires)
    if (weapon === 'gun') audioRef.current?.playGunShot()
    else audioRef.current?.playMissileLaunch()

    const result = engineRef.current?.snipeFire(weapon)
    if (!result || !result.hit) {
      setSnipeFlash('MISSED')
      setTimeout(() => setSnipeFlash(null), 1000)
      return
    }
    if (result.destroyed) {
      destroyEnemyVehicle(result.vehicleId)
      setSnipeFlash('ENEMY DESTROYED!')
      setTimeout(() => setSnipeFlash(null), 2500)
    } else {
      setSnipeFlash(`HIT — ${result.hits}/5`)
      setTimeout(() => setSnipeFlash(null), 1200)
    }
  }

  // Keyboard: Tab = strategy hub, Esc = strategy hub, Space = fire in combat / snipe
  useEffect(() => {
    function handleKey(e) {
      if (e.code === 'Tab') {
        e.preventDefault()
        setUiMode(uiMode === 'action' ? 'hub' : 'action')
      }
      if (e.code === 'Escape' && uiMode === 'action') {
        if (snipeStateRef.current) handleExitSnipe()
        else setUiMode('hub')
      }
      if (e.code === 'KeyE') {
        if (snipeStateRef.current) handleExitSnipe()
        else setUiMode('hub')
      }
      if (e.code === 'Space' && uiMode === 'action') {
        e.preventDefault()
        if (snipeStateRef.current) {
          if (gunSightFireRef.current) gunSightFireRef.current()
          else handleSnipeFire()
        } else {
          const weapon = useGameStore.getState().player.activeWeapon ?? 'missile'
          if (weapon === 'gun') {
            if (consumeBullet()) engineRef.current?.fireGun()
          } else {
            if (consumeMissile()) engineRef.current?.fireMissile()
          }
        }
      }
      if (e.code === 'KeyG' && uiMode === 'action') {
        e.preventDefault()
        switchWeapon()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [uiMode, setUiMode])

  // Click canvas to lock pointer (desktop)
  function handleCanvasClick() {
    if (uiMode === 'action' && canvasRef.current) {
      canvasRef.current.requestPointerLock?.()
    }
  }

  function handleSaveGame() {
    const s = useGameStore.getState()
    const data = {
      worldSeed: s.worldSeed, reportTime: s.reportTime,
      player: s.player, allies: s.allies, settlements: s.settlements,
      invasionPoint: s.invasionPoint, recruitedAllies: s.recruitedAllies,
      sabotagedBuildings: s.sabotagedBuildings, abandonedVehicles: s.abandonedVehicles,
      recruitmentAttempted: s.recruitmentAttempted, enemyVehicles: s.enemyVehicles,
      capturedSettlements: s.capturedSettlements, contestedSettlements: s.contestedSettlements,
      mastersStrength: s.mastersStrength, enemyMorale: s.enemyMorale,
      collapseDay: s.collapseDay, capturedHeatMines: s.capturedHeatMines,
      totalHeatMines: s.totalHeatMines, currentDay: s.currentDay, totalTime: s.totalTime,
      activeAllyId: s.activeAllyId, originalCharacter: s.originalCharacter,
      performanceTier: s.performanceTier, hasSave: true,
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `frosthold-day${s.currentDay}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (gamePhase === 'menu') {
    return <TitleScreen onStart={initWorld} onContinue={continueGame} hasSave={hasSave} onLoad={loadGame} />
  }

  if (gamePhase === 'won') {
    return <EndScreen won={true} onRestart={() => useGameStore.getState().newGame()} />
  }

  if (gamePhase === 'lost') {
    return <EndScreen won={false} onRestart={() => useGameStore.getState().newGame()} />
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#0a1628' }}>
      {/* Three.js canvas — always mounted when playing */}
      <canvas
        ref={canvasRef}
        onClick={handleCanvasClick}
        style={{
          position: 'absolute', inset: 0,
          width: '100%', height: '100%',
          display: uiMode === 'action' ? 'block' : 'none',
          cursor: 'crosshair',
        }}
      />

      {/* Strategy hub — team screen */}
      {uiMode === 'hub' && profileAllyId === undefined && (
        <StrategyHub
          onSync={() => synchroniseWatches()}
          onProfile={(id) => setProfileAllyId(id)}
          onMap={() => setUiMode('strategy')}
          onSave={handleSaveGame}
          nearSettlement={nearSettlement}
          allies={allies}
          abandonedVehicles={abandonedVehicles}
          onCollectVehicle={(id) => collectVehicle(id)}
        />
      )}

      {/* Ally profile — opened from team screen */}
      {uiMode === 'hub' && profileAllyId !== undefined && (
        <AllyProfile
          allyId={profileAllyId}
          nearSettlement={nearSettlement}
          onBack={() => setProfileAllyId(undefined)}
          onMap={() => setUiMode('strategy')}
          onSki={() => { setUiMode('action'); setProfileAllyId(undefined) }}
          onSwitch={(id) => { switchCharacter(id); setUiMode('action'); setProfileAllyId(undefined) }}
          onSnipe={handleSnipe}
        />
      )}

      {/* Strategy map overlay */}
      {uiMode === 'strategy' && <StrategyMap onBack={() => setUiMode('hub')} />}

      {/* HUD — only in action mode and not sniping */}
      {uiMode === 'action' && !snipeState && <HUD terrainDebug={terrainDebug} showDebug={showDebug} inCombat={inCombat} enemyBearing={enemyBearing} />}

      {/* Mobile speed controls — hidden in snipe mode (GunSight has its own buttons) */}
      {uiMode === 'action' && !snipeState && (
        <MobileSpeedControls engineRef={engineRef} inCombat={inCombat} activeWeapon={activeWeapon} travelMode={storeTravelMode} />
      )}

      {/* Gun sight overlay — snipe mode */}
      {uiMode === 'action' && snipeState && (
        <GunSight
          snipeState={snipeState}
          snipeFlash={snipeFlash}
          activeWeapon={activeWeapon}
          onFire={handleSnipeFire}
          onExit={handleExitSnipe}
          onSwitch={switchWeapon}
          engineRef={engineRef}
          fireRef={gunSightFireRef}
        />
      )}

      {/* Retreat flash */}
      {uiMode === 'action' && !snipeState && retreatFlash && (
        <div style={{
          position: 'fixed', top: 56, left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(10,60,20,0.9)',
          border: '1px solid rgba(80,220,80,0.7)',
          color: '#80ee80', fontFamily: 'Courier New, monospace',
          fontSize: 11, letterSpacing: 3, padding: '4px 14px',
          borderRadius: 4, zIndex: 150,
        }}>
          RETREATED SUCCESSFULLY
        </div>
      )}

      {/* Combat indicator */}
      {uiMode === 'action' && !snipeState && inCombat && (
        <div style={{
          position: 'fixed', top: 56, left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(120,10,10,0.9)',
          border: '1px solid rgba(255,80,80,0.7)',
          color: '#ff8080', fontFamily: 'Courier New, monospace',
          fontSize: 11, letterSpacing: 3, padding: '4px 14px',
          borderRadius: 4, zIndex: 150,
        }}>
          {activeWeapon === 'gun' ? '🔫 GUN' : '🚀 MISSILE'} — SPACE  [G] SWITCH
        </div>
      )}

      {/* Debug toggle */}
      {uiMode === 'action' && (
        <button
          onClick={() => setShowDebug(v => !v)}
          style={{
            position: 'fixed', top: 130, left: 12,
            background: showDebug ? 'rgba(20,50,20,0.9)' : 'rgba(10,22,40,0.8)',
            border: `1px solid ${showDebug ? 'rgba(100,220,100,0.5)' : 'rgba(168,216,234,0.4)'}`,
            color: showDebug ? '#80ee80' : '#a8d8ea',
            cursor: 'pointer',
            padding: '4px 8px', borderRadius: 4, fontSize: 10,
            fontFamily: 'Courier New, monospace', zIndex: 150,
            letterSpacing: 1,
          }}
        >DEBUG {showDebug ? 'ON' : 'OFF'}</button>
      )}

      {/* Gyro toggle — hidden in snipe mode */}
      {uiMode === 'action' && !snipeState && gyro.permitted && (
        <button
          onClick={() => {
            const next = !gyroEnabled
            setGyroEnabled(next)
            if (next) gyro.recalibrate()
          }}
          style={{
            position: 'fixed', top: 52, right: 12,
            background: gyroEnabled ? 'rgba(20,50,20,0.9)' : 'rgba(10,22,40,0.8)',
            border: `1px solid ${gyroEnabled ? 'rgba(100,220,100,0.5)' : 'rgba(168,216,234,0.4)'}`,
            color: gyroEnabled ? '#80ee80' : '#a8d8ea',
            cursor: 'pointer',
            padding: '6px 10px', borderRadius: 4, fontSize: 11,
            fontFamily: 'Courier New, monospace', zIndex: 150,
            letterSpacing: 1,
          }}
        >GYRO {gyroEnabled ? 'ON' : 'OFF'}</button>
      )}

      {/* Gyro calibrate — hidden in snipe mode */}
      {uiMode === 'action' && !snipeState && gyro.permitted && gyroEnabled && (
        <button
          onClick={() => gyro.recalibrate()}
          style={{
            position: 'fixed', top: 52, right: 100,
            background: 'rgba(10,22,40,0.8)',
            border: '1px solid rgba(168,216,234,0.4)',
            color: '#a8d8ea',
            cursor: 'pointer',
            padding: '6px 10px', borderRadius: 4, fontSize: 11,
            fontFamily: 'Courier New, monospace', zIndex: 150,
            letterSpacing: 1,
          }}
        >CAL</button>
      )}

      {/* Strategy / Enter button */}
      {uiMode === 'action' && (
        <button
          onClick={() => setUiMode('hub')}
          style={{
            position: 'fixed', top: 12, right: 12,
            background: nearSettlement ? 'rgba(40,80,40,0.9)' : 'rgba(10,22,40,0.8)',
            border: `1px solid ${nearSettlement ? 'rgba(100,220,100,0.6)' : 'rgba(168,216,234,0.4)'}`,
            color: nearSettlement ? '#80ee80' : '#a8d8ea',
            cursor: 'pointer',
            padding: '6px 12px', borderRadius: 4, fontSize: 11,
            fontFamily: 'Courier New, monospace', zIndex: 150,
            letterSpacing: 1,
            transition: 'all 0.2s',
          }}
        >{nearSettlement ? 'ENTER [E]' : 'STRATEGY'}</button>
      )}

      {/* Ally panel — shown over hub or strategy map */}
      {selectedAlly && (uiMode === 'hub' || uiMode === 'strategy') && <AllyPanel />}

      {/* Pause overlay */}
      <PauseMenu />

      {/* Orientation transition overlay */}
      {transitionOverlay && (
        <div style={{
          position: 'fixed', inset: 0,
          background: 'rgba(10,22,40,0.95)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 500, transition: 'opacity 0.3s',
          fontFamily: 'Courier New, monospace',
          color: '#a8d8ea', fontSize: 14,
        }}>
          Switching mode...
        </div>
      )}
    </div>
  )
}


function fmtTime(mins) {
  const h = Math.floor(mins / 60) % 24
  const m = Math.floor(mins % 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

// ---- Strategy Hub — team overview screen ----
function StrategyHub({ onSync, onProfile, onMap, onSave, nearSettlement, allies, abandonedVehicles, onCollectVehicle }) {
  const player            = useGameStore(s => s.player)
  const originalCharacter = useGameStore(s => s.originalCharacter)
  const activeAllyId      = useGameStore(s => s.activeAllyId)
  const reportTime        = useGameStore(s => s.reportTime)
  const enemyMorale = useGameStore(s => s.enemyMorale)
  const collapseDay       = useGameStore(s => s.collapseDay)
  const currentDay        = useGameStore(s => s.currentDay)

  const recruited = (allies ?? []).filter(a => a.status === 'recruited')
  const roster = [
    {
      id: null,
      name: originalCharacter?.name ?? player.name,
      personalTime: player.personalTime ?? 720,
      health: player.health,
      stamina: player.stamina,
    },
    ...recruited,
  ]

  const anyFrozen   = roster.some(c => (c.personalTime ?? 720) >= reportTime)
  const anyApproach = roster.some(c => { const m = reportTime - (c.personalTime ?? 720); return m <= 15 && m > 0 })
  const syncUrgent  = anyFrozen || anyApproach

  const nearbyVehicle = (abandonedVehicles ?? []).find(v =>
    Math.hypot(v.x - player.position.x, v.z - player.position.z) < 10
  )

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'linear-gradient(to bottom, #080f1c, #0d1f3a)',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      fontFamily: 'Courier New, monospace', color: '#a8d8ea',
      zIndex: 200, overflowY: 'auto', padding: '20px 0 32px',
    }}>
      <div style={{ fontSize: 10, letterSpacing: 6, color: '#446688', marginBottom: 4 }}>COMMAND</div>
      <div style={{ fontSize: 'clamp(18px, 4vw, 26px)', letterSpacing: 4, marginBottom: 6 }}>FROSTHOLD</div>
      <div style={{ fontSize: 10, color: '#5577aa', letterSpacing: 2, marginBottom: 2 }}>
        DAY {currentDay} / {collapseDay}
      </div>
      <div style={{ fontSize: 10, color: '#446688', letterSpacing: 1, marginBottom: 16 }}>
        ENEMY MORALE <span style={{ color: enemyMorale <= 30 ? '#27ae60' : enemyMorale <= 60 ? '#e6b020' : '#e74c3c', fontWeight: 'bold' }}>{enemyMorale}%</span>
      </div>

      {/* SYNC button */}
      <button
        onClick={onSync}
        style={{
          width: 'min(380px, 94vw)', padding: '12px 16px', marginBottom: 20,
          background: syncUrgent ? 'rgba(60,20,20,0.95)' : 'rgba(14,30,56,0.9)',
          border: `1px solid ${syncUrgent ? 'rgba(220,80,80,0.7)' : 'rgba(168,216,234,0.35)'}`,
          borderRadius: 6, cursor: 'pointer', fontFamily: 'Courier New, monospace',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
          <span style={{ fontSize: 12, letterSpacing: 3, fontWeight: 'bold', color: syncUrgent ? '#ee8080' : '#a8d8ea' }}>
            SYNC WATCHES
          </span>
          <span style={{ fontSize: 9, color: syncUrgent ? 'rgba(220,100,100,0.8)' : '#5577aa', letterSpacing: 1 }}>
            {anyFrozen ? 'ONE OR MORE CHARACTERS FROZEN' : anyApproach ? 'SYNC DUE SOON' : 'SITUATION REPORT & REST'}
          </span>
        </div>
        <span style={{
          fontSize: 15, letterSpacing: 2, fontWeight: 'bold',
          color: syncUrgent ? '#e05555' : '#a8d8ea',
          fontVariantNumeric: 'tabular-nums',
        }}>{fmtTime(reportTime)}</span>
      </button>

      {nearbyVehicle && !player.vehicle && (
        <button
          onClick={() => onCollectVehicle(nearbyVehicle.id)}
          style={{
            width: 'min(380px, 94vw)', padding: '10px 16px', marginBottom: 12,
            background: 'rgba(14,40,14,0.9)',
            border: '1px solid rgba(100,220,100,0.5)',
            borderRadius: 6, cursor: 'pointer', fontFamily: 'Courier New, monospace',
            display: 'flex', alignItems: 'center', gap: 12,
            color: '#80ee80',
          }}
        >
          <span style={{ fontSize: 20 }}>{nearbyVehicle.type === 'snowcat' ? '🚙' : '🪂'}</span>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
            <span style={{ fontSize: 12, letterSpacing: 3, fontWeight: 'bold' }}>
              COLLECT {nearbyVehicle.type === 'snowcat' ? 'SNOWCAT' : 'PARAMOTOR'}
            </span>
            <span style={{ fontSize: 9, color: '#446688', letterSpacing: 1 }}>Abandoned vehicle nearby</span>
          </div>
        </button>
      )}

      {/* MAP button */}
      <button
        onClick={onMap}
        style={{
          width: 'min(380px, 94vw)', padding: '10px 16px', marginBottom: 8,
          background: 'rgba(14,30,56,0.9)',
          border: '1px solid rgba(168,216,234,0.35)',
          borderRadius: 6, cursor: 'pointer', fontFamily: 'Courier New, monospace',
          display: 'flex', alignItems: 'center', gap: 12,
          color: '#a8d8ea',
        }}
      >
        <span style={{ fontSize: 20 }}>🗺</span>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
          <span style={{ fontSize: 12, letterSpacing: 3, fontWeight: 'bold' }}>VIEW MAP</span>
          <span style={{ fontSize: 9, color: '#5577aa', letterSpacing: 1 }}>Strategy overview — island & locations</span>
        </div>
      </button>

      {/* SAVE button */}
      <button
        onClick={onSave}
        style={{
          width: 'min(380px, 94vw)', padding: '10px 16px', marginBottom: 20,
          background: 'rgba(14,30,56,0.9)',
          border: '1px solid rgba(168,216,234,0.35)',
          borderRadius: 6, cursor: 'pointer', fontFamily: 'Courier New, monospace',
          display: 'flex', alignItems: 'center', gap: 12,
          color: '#a8d8ea',
        }}
      >
        <span style={{ fontSize: 20 }}>💾</span>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
          <span style={{ fontSize: 12, letterSpacing: 3, fontWeight: 'bold' }}>SAVE GAME</span>
          <span style={{ fontSize: 9, color: '#5577aa', letterSpacing: 1 }}>Download save file to device</span>
        </div>
      </button>

      <div style={{ fontSize: 9, letterSpacing: 4, color: '#446688', marginBottom: 10, alignSelf: 'flex-start', marginLeft: 'max(3vw, calc(50% - 190px))' }}>
        TEAM — {roster.length} MEMBER{roster.length !== 1 ? 'S' : ''}
      </div>

      <div style={{ width: 'min(380px, 94vw)', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {roster.map(char => {
          const pt       = char.personalTime ?? 720
          const frozen   = pt >= reportTime
          const mLeft    = reportTime - pt
          const approach = mLeft <= 15 && mLeft > 0
          const isActive = char.id === activeAllyId

          return (
            <button
              key={char.id ?? 'player'}
              onClick={frozen ? undefined : () => onProfile(char.id)}
              disabled={frozen}
              style={{
                background: frozen ? 'rgba(30,10,10,0.9)' : 'rgba(14,30,56,0.9)',
                border: `1px solid ${frozen ? 'rgba(200,80,80,0.35)' : approach ? 'rgba(220,180,60,0.5)' : 'rgba(168,216,234,0.3)'}`,
                borderRadius: 6, cursor: frozen ? 'not-allowed' : 'pointer', padding: '10px 14px',
                fontFamily: 'Courier New, monospace', textAlign: 'left',
                color: frozen ? '#774444' : '#a8d8ea',
                opacity: frozen ? 0.7 : 1,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontSize: 11, letterSpacing: 2, fontWeight: 'bold' }}>{char.name}</span>
                  {isActive && <span style={{ fontSize: 8, color: '#a8d8ea', letterSpacing: 1, border: '1px solid rgba(168,216,234,0.4)', borderRadius: 3, padding: '1px 4px' }}>ACTIVE</span>}
                  {frozen && <span style={{ fontSize: 8, color: '#e05555', letterSpacing: 1 }}>FROZEN</span>}
                  {approach && !frozen && <span style={{ fontSize: 8, color: '#e6b020', letterSpacing: 1 }}>SYNC {Math.round(mLeft)}m</span>}
                </div>
                <span style={{
                  fontSize: 13, letterSpacing: 2, fontWeight: 'bold',
                  fontVariantNumeric: 'tabular-nums',
                  color: frozen ? '#e05555' : approach ? '#e6b020' : '#a8d8ea',
                }}>{fmtTime(pt)}</span>
              </div>
              <div style={{ display: 'flex', gap: 6, flexDirection: 'column' }}>
                <MiniBar value={char.health ?? 100} color={
                  (char.health ?? 100) > 60 ? '#27ae60' : (char.health ?? 100) > 30 ? '#e67e22' : '#e74c3c'
                } label="HP" />
                <MiniBar value={char.stamina ?? 100} color={
                  (char.stamina ?? 100) > 40 ? '#3498db' : '#e67e22'
                } label="MP" />
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function MiniBar({ value, color, label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ fontSize: 8, color: '#446688', letterSpacing: 1, minWidth: 16 }}>{label}</span>
      <div style={{ flex: 1, height: 4, background: 'rgba(255,255,255,0.08)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: `${value}%`, height: '100%', background: color, borderRadius: 2 }} />
      </div>
      <span style={{ fontSize: 8, color, minWidth: 22, textAlign: 'right' }}>{Math.round(value)}</span>
    </div>
  )
}


// ---- Mobile Speed Controls ----
function MobileSpeedControls({ engineRef, inCombat, activeWeapon, travelMode }) {
  const consumeMissile = useGameStore(s => s.consumeMissile)
  const consumeBullet  = useGameStore(s => s.consumeBullet)
  const switchWeapon   = useGameStore(s => s.switchWeapon)

  // Only render on touch devices
  if (!('ontouchstart' in window)) return null

  function makeHandlers(setter) {
    return {
      onTouchStart: (e) => { e.preventDefault(); setter(true) },
      onTouchEnd:   (e) => { e.preventDefault(); setter(false) },
      onTouchCancel:(e) => { e.preventDefault(); setter(false) },
    }
  }

  const btnBase = {
    position: 'fixed',
    width: 64, height: 64,
    borderRadius: '50%',
    border: '2px solid rgba(168,216,234,0.5)',
    background: 'rgba(10,22,40,0.7)',
    color: '#a8d8ea',
    fontSize: 24,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    userSelect: 'none',
    WebkitUserSelect: 'none',
    touchAction: 'none',
    zIndex: 120,
  }

  function handleFire(e) {
    e.preventDefault()
    const weapon = useGameStore.getState().player.activeWeapon ?? 'missile'
    if (weapon === 'gun') {
      if (consumeBullet()) engineRef.current?.fireGun()
    } else {
      if (consumeMissile()) engineRef.current?.fireMissile()
    }
  }

  const isParamotor = travelMode === 'paramotor'

  return (
    <>
      {isParamotor ? (
        // ---- Paramotor layout ----
        // Left side: ▲ climb / ▼ descend
        // Right side: ◀ turn left / ▶ turn right
        // Centre: ▶▶ speed boost (motor always running)
        <>
          <div style={{ ...btnBase, left: 20, bottom: 160 }}
            {...makeHandlers((v) => engineRef.current?.setTouchForward(v))}>▲</div>
          <div style={{ ...btnBase, left: 20, bottom: 88 }}
            {...makeHandlers((v) => engineRef.current?.setTouchBrake(v))}>▼</div>

          <div style={{ ...btnBase, right: 20, bottom: 160 }}
            {...makeHandlers((v) => engineRef.current?.setTouchLeft(v))}>◀</div>
          <div style={{ ...btnBase, right: 20, bottom: 88 }}
            {...makeHandlers((v) => engineRef.current?.setTouchRight(v))}>▶</div>

          {/* Boost — centre */}
          <div style={{
            ...btnBase,
            bottom: 120, left: '50%', marginLeft: -36,
            width: 72, height: 72,
            border: '2px solid rgba(168,216,234,0.7)',
            background: 'rgba(10,40,70,0.85)',
            fontSize: 20,
          }}
            {...makeHandlers((v) => engineRef.current?.setTouchThrottle(v))}
          >▶▶</div>
        </>
      ) : (
        // ---- Ski / snowcat layout ----
        // Left side: ▲ forward / ▼ brake
        // Right side: ◀ left / ▶ right
        <>
          <div style={{ ...btnBase, left: 20, bottom: 160 }}
            {...makeHandlers((v) => engineRef.current?.setTouchForward(v))}>▲</div>
          <div style={{ ...btnBase, left: 20, bottom: 88 }}
            {...makeHandlers((v) => engineRef.current?.setTouchBrake(v))}>▼</div>

          <div style={{ ...btnBase, right: 20, bottom: 160 }}
            {...makeHandlers((v) => engineRef.current?.setTouchLeft(v))}>◀</div>
          <div style={{ ...btnBase, right: 20, bottom: 88 }}
            {...makeHandlers((v) => engineRef.current?.setTouchRight(v))}>▶</div>
        </>
      )}

      {/* Fire + weapon switch — only in combat */}
      {inCombat && (
        <>
          <div
            style={{
              ...btnBase,
              bottom: 88, left: '50%', marginLeft: -36,
              border: '2px solid rgba(255,80,80,0.7)',
              background: 'rgba(120,10,10,0.8)',
              color: '#ff8080',
              fontSize: 20,
              width: 72, height: 72,
            }}
            onTouchStart={handleFire}
            onTouchEnd={(e) => e.preventDefault()}
          >{activeWeapon === 'gun' ? '🔫' : '🚀'}</div>
          <div
            style={{
              ...btnBase,
              bottom: 88, left: '50%', marginLeft: 44,
              width: 48, height: 48,
              fontSize: 14,
              border: '2px solid rgba(255,200,80,0.6)',
              background: 'rgba(60,40,10,0.8)',
              color: '#ffc850',
              letterSpacing: 0,
              fontFamily: 'Courier New, monospace',
            }}
            onTouchStart={(e) => { e.preventDefault(); switchWeapon() }}
            onTouchEnd={(e) => e.preventDefault()}
          >SW</div>
        </>
      )}
    </>
  )
}

// ---- Gun Sight Overlay (snipe mode) ----
function GunSight({ snipeState, snipeFlash, activeWeapon, onFire, onExit, onSwitch, engineRef, fireRef }) {
  const [vw, setVw] = useState(window.innerWidth)
  const [vh, setVh] = useState(window.innerHeight)
  const [aimLocked, setAimLocked] = useState(false)
  const [shotFx, setShotFx] = useState(null)   // { type: 'gun'|'missile', key }
  const aimTouchRef = useRef(null)
  const mouseAimRef = useRef(null)

  // Inject CSS keyframes for shot effects once
  useEffect(() => {
    const id = 'snipe-fx-style'
    if (document.getElementById(id)) return
    const s = document.createElement('style')
    s.id = id
    s.textContent = `
      @keyframes snipe-gun-fx    { 0%{opacity:.85;transform:scale(1)}  100%{opacity:0;transform:scale(3.5)} }
      @keyframes snipe-missile-fx{ 0%{opacity:1;transform:scale(1)}    100%{opacity:0;transform:scale(9)}   }
    `
    document.head.appendChild(s)
    return () => document.getElementById(id)?.remove()
  }, [])

  useEffect(() => {
    function onResize() { setVw(window.innerWidth); setVh(window.innerHeight) }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const cx = vw / 2, cy = vh / 2
  const r  = Math.min(vw, vh) * 0.42
  const gap = 12
  const isTouch = 'ontouchstart' in window

  function fireWithEffect() {
    const key = Date.now()
    setShotFx({ type: activeWeapon ?? 'missile', key })
    setTimeout(() => setShotFx(s => s?.key === key ? null : s), 350)
    onFire()
  }

  // Expose fireWithEffect to parent for keyboard Space key
  useEffect(() => { if (fireRef) fireRef.current = fireWithEffect }, [activeWeapon])

  // Touch aiming
  function handleTouchStart(e) {
    if (!aimLocked) return
    const t = e.touches[0]
    aimTouchRef.current = { x: t.clientX, y: t.clientY }
  }
  function handleTouchMove(e) {
    if (!aimLocked || !aimTouchRef.current) return
    e.preventDefault()
    const t = e.touches[0]
    const dx = t.clientX - aimTouchRef.current.x
    const dy = t.clientY - aimTouchRef.current.y
    aimTouchRef.current = { x: t.clientX, y: t.clientY }
    engineRef.current?.rotateSnipeCam(dx * 0.004, dy * 0.004)
  }
  function handleTouchEnd() { aimTouchRef.current = null }

  // Mouse aiming (desktop — drag anywhere)
  function handleMouseDown(e) {
    if (e.target.tagName === 'BUTTON') return
    mouseAimRef.current = { x: e.clientX, y: e.clientY }
  }
  function handleMouseMove(e) {
    if (!mouseAimRef.current) return
    const dx = e.clientX - mouseAimRef.current.x
    const dy = e.clientY - mouseAimRef.current.y
    mouseAimRef.current = { x: e.clientX, y: e.clientY }
    engineRef.current?.rotateSnipeCam(dx * 0.004, dy * 0.004)
  }
  function handleMouseUp() { mouseAimRef.current = null }

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 130, userSelect: 'none', WebkitUserSelect: 'none', cursor: 'crosshair' }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >

      {/* Scope mask + crosshair SVG */}
      <svg width={vw} height={vh} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        <defs>
          <mask id="scope-mask">
            <rect width={vw} height={vh} fill="white" />
            <circle cx={cx} cy={cy} r={r} fill="black" />
          </mask>
        </defs>
        <rect width={vw} height={vh} fill="black" mask="url(#scope-mask)" />
        <circle cx={cx} cy={cy} r={r}     fill="none" stroke="rgba(12,24,12,0.98)" strokeWidth="12" />
        <circle cx={cx} cy={cy} r={r - 4} fill="none" stroke="rgba(60,90,50,0.45)" strokeWidth="1.5" />
        <line x1={cx - r*0.45} y1={cy} x2={cx - gap} y2={cy} stroke="rgba(170,200,150,0.65)" strokeWidth="1" />
        <line x1={cx + gap}    y1={cy} x2={cx + r*0.45} y2={cy} stroke="rgba(170,200,150,0.65)" strokeWidth="1" />
        <line x1={cx} y1={cy - r*0.45} x2={cx} y2={cy - gap} stroke="rgba(170,200,150,0.65)" strokeWidth="1" />
        <line x1={cx} y1={cy + gap}    x2={cx} y2={cy + r*0.45} stroke="rgba(170,200,150,0.65)" strokeWidth="1" />
        <circle cx={cx} cy={cy} r="2.5" fill="rgba(210,235,185,0.9)" />
      </svg>

      {/* Shot visual effects — rendered over the scope glass */}
      {shotFx && (
        <div
          key={shotFx.key}
          style={{
            position: 'absolute',
            left: cx - (shotFx.type === 'missile' ? 14 : 18),
            top:  cy - (shotFx.type === 'missile' ? 14 : 18),
            width:  shotFx.type === 'missile' ? 28 : 36,
            height: shotFx.type === 'missile' ? 28 : 36,
            borderRadius: '50%',
            background: shotFx.type === 'missile'
              ? 'radial-gradient(circle, rgba(255,200,60,1) 0%, rgba(255,100,20,0.7) 55%, transparent 100%)'
              : 'radial-gradient(circle, rgba(10,10,10,0.95) 0%, rgba(40,40,40,0.55) 55%, transparent 100%)',
            animation: shotFx.type === 'missile'
              ? 'snipe-missile-fx 0.32s ease-out forwards'
              : 'snipe-gun-fx 0.18s ease-out forwards',
            pointerEvents: 'none',
            zIndex: 2,
          }}
        />
      )}

      {/* Building label — top center */}
      <div style={{
        position: 'absolute', top: 14, left: 0, right: 0, textAlign: 'center',
        fontFamily: 'Courier New, monospace', color: '#a8d8ea',
        fontSize: 10, letterSpacing: 4, pointerEvents: 'none',
      }}>
        {snipeState.buildingType === 'church' ? '⛪ CHURCH TOWER' : '🗼 WATCHTOWER'}
      </div>

      {/* Cover HP — top right */}
      <div style={{
        position: 'absolute', top: 14, right: 16,
        fontFamily: 'Courier New, monospace',
        fontSize: 10, letterSpacing: 1,
        color: snipeState.coverHp > 2 ? '#a8d8ea' : '#e74c3c',
        pointerEvents: 'none',
      }}>
        COVER {'█'.repeat(snipeState.coverHp)}{'░'.repeat(5 - snipeState.coverHp)}
      </div>

      {/* Exit button — moved to second row */}
      <button
        onClick={onExit}
        style={{
          position: 'absolute', top: 46, left: 14,
          background: 'rgba(10,22,40,0.85)',
          border: '1px solid rgba(168,216,234,0.4)',
          color: '#a8d8ea', cursor: 'pointer',
          padding: '5px 10px', borderRadius: 4,
          fontSize: 10, fontFamily: 'Courier New, monospace', letterSpacing: 2,
        }}
      >EXIT [E]</button>

      {/* Aim lock — second row, mobile only */}
      {isTouch && (
        <button
          style={{
            position: 'absolute', top: 46, left: 100,
            background: aimLocked ? 'rgba(20,60,20,0.9)' : 'rgba(10,22,40,0.85)',
            border: `1px solid ${aimLocked ? 'rgba(100,220,100,0.6)' : 'rgba(168,216,234,0.4)'}`,
            color: aimLocked ? '#80ee80' : '#a8d8ea', cursor: 'pointer',
            padding: '5px 10px', borderRadius: 4,
            fontSize: 10, fontFamily: 'Courier New, monospace', letterSpacing: 2,
          }}
          onTouchStart={(e) => { e.stopPropagation(); e.preventDefault(); setAimLocked(v => !v) }}
          onTouchEnd={(e) => e.preventDefault()}
        >{aimLocked ? 'AIM ON' : 'AIM OFF'}</button>
      )}

      {/* Hit / miss flash */}
      {snipeFlash && (
        <div style={{
          position: 'absolute', left: 0, right: 0,
          top: cy + r + 12,
          textAlign: 'center',
          fontFamily: 'Courier New, monospace', color: '#e8ee80',
          fontSize: 12, letterSpacing: 3, pointerEvents: 'none',
        }}>{snipeFlash}</div>
      )}

      {/* Weapon + hint — bottom left */}
      <div style={{
        position: 'absolute', bottom: 20, left: 18,
        fontFamily: 'Courier New, monospace', color: '#a8d8ea',
        fontSize: 9, letterSpacing: 2, lineHeight: 1.8, pointerEvents: 'none',
      }}>
        {activeWeapon === 'gun' ? '━━┤ GUN' : '🚀 MISSILE'}<br />
        {isTouch
          ? <span style={{ color: '#446688' }}>DRAG TO AIM · TAP FIRE</span>
          : <span style={{ color: '#446688' }}>DRAG TO AIM · SPACE FIRE · G SWITCH · E EXIT</span>
        }
      </div>

      {/* Mobile fire + switch buttons */}
      {isTouch && (
        <>
          <div
            style={{
              position: 'absolute',
              bottom: Math.max(40, cy - r - 80),
              right: 28,
              width: 70, height: 70, borderRadius: '50%',
              border: '2px solid rgba(255,80,80,0.7)',
              background: 'rgba(120,10,10,0.85)',
              color: '#ff8080',
              fontSize: activeWeapon === 'gun' ? 13 : 22,
              fontFamily: 'Courier New, monospace',
              fontWeight: 'bold',
              letterSpacing: activeWeapon === 'gun' ? 1 : 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              touchAction: 'none',
            }}
            onTouchStart={(e) => { e.stopPropagation(); e.preventDefault(); fireWithEffect() }}
            onTouchEnd={(e) => e.preventDefault()}
          >{activeWeapon === 'gun' ? 'FIRE' : '🚀'}</div>
          <div
            style={{
              position: 'absolute',
              bottom: Math.max(122, cy - r + 4),
              right: 34,
              width: 50, height: 50, borderRadius: '50%',
              border: '2px solid rgba(255,200,80,0.6)',
              background: 'rgba(60,40,10,0.85)',
              color: '#ffc850', fontSize: 12,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: 'Courier New, monospace',
              touchAction: 'none',
            }}
            onTouchStart={(e) => { e.stopPropagation(); e.preventDefault(); onSwitch() }}
            onTouchEnd={(e) => e.preventDefault()}
          >SW</div>
        </>
      )}
    </div>
  )
}

// ---- Title Screen ----
function TitleScreen({ onStart, onContinue, hasSave, onLoad }) {
  const fileInputRef = useRef(null)
  const [loadError, setLoadError] = useState(null)

  function handleFileChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result)
        if (!data.worldSeed || !data.player || !data.settlements) {
          setLoadError('Invalid save file.')
          return
        }
        setLoadError(null)
        onLoad(data)
      } catch {
        setLoadError('Could not read file.')
      }
    }
    reader.readAsText(file)
    // Reset so the same file can be re-selected if needed
    e.target.value = ''
  }

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'linear-gradient(to bottom, #0a1628, #1e3a5f)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      fontFamily: 'Courier New, monospace',
      color: '#a8d8ea',
      textAlign: 'center',
      padding: 24,
    }}>
      <div style={{ fontSize: 12, color: '#5577aa', letterSpacing: 6, marginBottom: 24 }}>
        INSPIRED BY MIKE SINGLETON'S MIDWINTER
      </div>
      <div style={{
        fontSize: 'clamp(32px, 8vw, 56px)',
        fontWeight: 'bold', color: '#fff',
        letterSpacing: 4, marginBottom: 16,
        textShadow: '0 0 40px rgba(168,216,234,0.6)',
      }}>
        FROSTHOLD
      </div>
      <div style={{ fontSize: 'clamp(14px, 3vw, 18px)', color: '#7aaccc', letterSpacing: 8, marginBottom: 64 }}>
        SAVE THE ISLAND
      </div>

      <div style={{
        maxWidth: 400, fontSize: 12, color: '#aaa',
        lineHeight: 1.7, marginBottom: 48,
      }}>
        The enemy general has started the invasion. Recruit allies, sabotage his installations,
        and prevent the takeover before the last fires go cold.
      </div>

      {hasSave && (
        <button
          onClick={onContinue}
          style={{
            width: 260,
            background: 'linear-gradient(to right, #1a3a1a, #2a5a2a)',
            border: '2px solid #80ee80',
            color: '#80ee80', cursor: 'pointer',
            padding: '14px 0', borderRadius: 4,
            fontSize: 16, fontFamily: 'Courier New, monospace',
            letterSpacing: 3, marginBottom: 12,
            boxShadow: '0 0 20px rgba(128,238,128,0.3)',
          }}
        >
          CONTINUE
        </button>
      )}
      <button
        onClick={onStart}
        style={{
          width: 260,
          background: hasSave ? 'rgba(14,30,56,0.8)' : 'linear-gradient(to right, #1e3a5f, #2e5a8f)',
          border: `2px solid ${hasSave ? 'rgba(168,216,234,0.4)' : '#a8d8ea'}`,
          color: '#a8d8ea', cursor: 'pointer',
          padding: '14px 0', borderRadius: 4,
          fontSize: 16, fontFamily: 'Courier New, monospace',
          letterSpacing: 3, marginBottom: 12,
          boxShadow: hasSave ? 'none' : '0 0 20px rgba(168,216,234,0.3)',
        }}
      >
        NEW GAME
      </button>

      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        onChange={handleFileChange}
        style={{ display: 'none' }}
      />
      <button
        onClick={() => { setLoadError(null); fileInputRef.current?.click() }}
        style={{
          width: 260,
          background: 'rgba(14,30,56,0.8)',
          border: '2px solid rgba(168,216,234,0.4)',
          color: 'rgba(168,216,234,0.7)', cursor: 'pointer',
          padding: '14px 0', borderRadius: 4,
          fontSize: 16, fontFamily: 'Courier New, monospace',
          letterSpacing: 3,
        }}
      >
        LOAD FILE
      </button>
      {loadError && (
        <div style={{ marginTop: 8, fontSize: 11, color: '#e74c3c', fontFamily: 'Courier New, monospace' }}>
          {loadError}
        </div>
      )}

      <div style={{ marginTop: 32, fontSize: 10, color: '#446688', lineHeight: 1.8 }}>
        <div>WASD / Arrows — Move | Mouse — Look | Tab — Map | Esc — Pause</div>
        <div>Mobile: Tilt to steer | Rotate device for strategy map</div>
      </div>

      <SnowCanvas />
    </div>
  )
}

function SnowCanvas() {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')

    const particles = Array.from({ length: 80 }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      s: 1 + Math.random() * 2,
      v: 0.3 + Math.random() * 0.8,
    }))

    let animId
    function animate() {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.fillStyle = 'rgba(168,216,234,0.6)'
      for (const p of particles) {
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.s, 0, Math.PI * 2)
        ctx.fill()
        p.y += p.v
        p.x += (Math.random() - 0.5) * 0.5
        if (p.y > canvas.height) { p.y = 0; p.x = Math.random() * canvas.width }
      }
      animId = requestAnimationFrame(animate)
    }
    animate()
    return () => cancelAnimationFrame(animId)
  }, [])

  return (
    <canvas
      ref={canvasRef}
      width={window.innerWidth}
      height={window.innerHeight}
      style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: -1 }}
    />
  )
}

// ---- End Screen ----
function EndScreen({ won, onRestart }) {
  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: won
        ? 'linear-gradient(to bottom, #0a2818, #1e5f3a)'
        : 'linear-gradient(to bottom, #1a0808, #3a1010)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      fontFamily: 'Courier New, monospace',
      color: won ? '#a8d8ea' : '#d8a8a8',
      textAlign: 'center',
      padding: 24,
    }}>
      <div style={{ fontSize: 64, marginBottom: 16 }}>
        {won ? '🏆' : '💀'}
      </div>
      <div style={{ fontSize: 32, fontWeight: 'bold', color: '#fff', marginBottom: 8 }}>
        {won ? 'VICTORY!' : 'DEFEAT'}
      </div>
      <div style={{ fontSize: 14, marginBottom: 32, maxWidth: 360, lineHeight: 1.7 }}>
        {won
          ? "The enemy general's forces have been routed. The island is free once more."
          : "Your resistance has been crushed. The enemy general consolidates his iron grip on the frozen island."}
      </div>
      <button
        onClick={onRestart}
        style={{
          background: won ? '#27ae60' : '#c0392b',
          border: 'none', borderRadius: 4,
          color: '#fff', cursor: 'pointer',
          padding: '12px 32px', fontSize: 14,
          fontFamily: 'Courier New, monospace',
          letterSpacing: 2,
        }}
      >
        PLAY AGAIN
      </button>
    </div>
  )
}
