import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { generateAllies, generatePlayerCharacter } from '../world/allies.js'
import { initTerrain, findInvasionPoint } from '../game/terrain.js'

const INITIAL_SEED = Math.floor(Math.random() * 100000)
const INITIAL_PLAYER_CHAR = generatePlayerCharacter(INITIAL_SEED)

// Pick a target settlement for an enemy vehicle.
// Prefers resistance-held settlements (70% weight) and settlements roughly
// away from the invasion point (forward direction).
function pickEnemyTarget(vehicle, allSettlements, resistanceSettlements, invasionPoint) {
  const pool = Math.random() < 0.7 && resistanceSettlements?.length > 0
    ? resistanceSettlements : allSettlements
  if (!pool?.length) return null
  const toInvX = invasionPoint ? invasionPoint.x - vehicle.x : 0
  const toInvZ = invasionPoint ? invasionPoint.z - vehicle.z : 0
  const forward = pool.filter(se =>
    se && (se.x - vehicle.x) * toInvX + (se.z - vehicle.z) * toInvZ <= 0
  )
  const candidates = forward.length > 0 ? forward : pool.filter(Boolean)
  if (!candidates.length) return null
  return candidates[Math.floor(Math.random() * candidates.length)].id
}

export const useGameStore = create(
  persist(
    (set, get) => ({
  // World
  worldSeed: INITIAL_SEED,
  reportTime: 840, // team sync clock: minutes since midnight (14:00); fires every 120 min

  // Player
  player: {
    name: INITIAL_PLAYER_CHAR.name,
    position: { x: 0, y: 1, z: 22 }, // Start south of centre
    rotation: { y: 0 },
    health: 100,
    stamina: 100,
    travelMode: 'ski',
    inventory: [],
    reputation: 10,
    fuel: 100,
    missiles: 1,
    ammo: 50,
    dynamite: 0,
    activeWeapon: 'missile', // 'missile' | 'gun'
    personalTime: 720, // personal watch: minutes since midnight (12:00)
    vehicle: null,
    injuries: { leftArm: 'fine', rightArm: 'fine', leftLeg: 'fine', rightLeg: 'fine', body: 'fine', head: 'fine' },
  },

  // Allies & Settlements
  allies: [],
  settlements: [],
  invasionPoint: null, // { x, z } — coastline point where enemy forces land
  recruitedAllies: [],
  sabotagedBuildings: [], // ["settlementId:buildingType", ...]
  abandonedVehicles: [],      // { id, type, x, z }[]

  // Mission
  enemyMorale: 100,       // 100–0; reaching 0 = occupation collapses = win
  collapseDay: 40,         // day on which occupation collapses; shortened by sabotage
  capturedHeatMines: 0,   // enemy-captured heat mines; all captured = lose
  totalHeatMines: 0,       // set by initWorld
  gamePhase: 'menu', // 'menu' | 'playing' | 'won' | 'lost'
  currentDay: 1,
  totalTime: 0, // seconds elapsed

  // Invasion
  enemyVehicles: [],          // { id, x, z, targetSettlementId, status: 'active' }[]
  capturedSettlements: [],    // settlement IDs fully under enemy control
  contestedSettlements: [],   // [{ id, vehicleId }] — being contested this sync period
  inCombat: false,            // true while engine is running real-time combat
  pendingSync: false,         // sync queued while in combat

  // UI
  uiMode: 'hub', // 'hub' | 'action' | 'strategy'
  selectedAlly: null,
  activeAllyId: null,       // null = original player character
  originalCharacter: null,  // saved on initWorld
  isPaused: false,

  // Performance tier
  performanceTier: 'high', // 'low' | 'mid' | 'high'

  // Save state
  hasSave: false,

  // Actions
  initWorld() {
    const seed = get().worldSeed
    // Seed terrain noise before any height sampling (settlements, invasion point)
    initTerrain(seed)
    const { playerChar, allies, settlements } = generateAllies(seed)
    const invasionPoint = findInvasionPoint(seed)
    const startX = invasionPoint.x * 0.5
    const startZ = invasionPoint.z * 0.5
    const totalHeatMines = settlements.filter(s => s.buildings.includes('heat_mine')).length
    set(s => ({
      allies,
      settlements,
      invasionPoint,
      gamePhase: 'playing',
      hasSave: true,
      originalCharacter: { name: s.player.name, vehicle: null },
      totalHeatMines,
      enemyMorale: 100,
      collapseDay: 40,
      capturedHeatMines: 0,
      reportTime: 840,
      currentDay: 1,
      totalTime: 0,
      activeAllyId: null,
      selectedAlly: null,
      uiMode: 'hub',
      isPaused: false,
      recruitedAllies: [],
      sabotagedBuildings: [],
      abandonedVehicles: [],
      enemyVehicles: [],
      capturedSettlements: [],
      contestedSettlements: [],
      inCombat: false,
      pendingSync: false,
      player: {
        name: s.player.name,
        position: { x: startX, y: 2, z: startZ },
        rotation: { y: 0 },
        relationships: playerChar.relationships,
        personalTime: 720,
        health: 100,
        stamina: 100,
        travelMode: 'ski',
        vehicle: null,
        inventory: [],
        reputation: 10,
        fuel: 100,
        missiles: 1,
        ammo: 50,
        dynamite: 0,
        activeWeapon: 'missile',
        injuries: { leftArm: 'fine', rightArm: 'fine', leftLeg: 'fine', rightLeg: 'fine', body: 'fine', head: 'fine' },
      },
    }))
  },

  continueGame() {
    // Re-seed terrain (lives outside Zustand, not persisted)
    initTerrain(get().worldSeed)
    set({ gamePhase: 'playing', uiMode: 'hub', isPaused: false, inCombat: false, pendingSync: false })
  },

  loadGame(savedState) {
    // Re-seed terrain with the loaded world seed
    initTerrain(savedState.worldSeed)
    set({
      ...savedState,
      gamePhase: 'playing',
      uiMode: 'hub',
      isPaused: false,
      inCombat: false,
      pendingSync: false,
      hasSave: true,
    })
  },

  setGamePhase(phase) { set({ gamePhase: phase }) },

  setUiMode(mode) { set({ uiMode: mode }) },

  togglePause() { set(s => ({ isPaused: !s.isPaused })) },

  updatePlayer(updates) {
    set(s => ({ player: { ...s.player, ...updates } }))
  },

  setTravelMode(mode) {
    set(s => ({ player: { ...s.player, travelMode: mode } }))
  },

  drainStamina(amount) {
    set(s => {
      const stamina = Math.max(0, s.player.stamina - amount)
      const health = stamina === 0 ? Math.max(0, s.player.health - amount * 0.5) : s.player.health
      if (health <= 0) {
        const backup = s.allies.find(a => a.status === 'recruited' && a.id !== s.activeAllyId)
        if (backup) {
          return {
            player: {
              ...s.player, name: backup.name,
              position: { x: backup.location.x, y: 2, z: backup.location.z },
              health: 100, stamina: 100, travelMode: 'ski',
            },
            activeAllyId: backup.id,
          }
        }
        if (s.activeAllyId !== null && s.originalCharacter) {
          return {
            player: { ...s.player, name: s.originalCharacter.name, health: 80, stamina: 100, travelMode: 'ski', vehicle: null },
            activeAllyId: null,
          }
        }
        return { player: { ...s.player, stamina, health }, gamePhase: 'lost' }
      }
      return { player: { ...s.player, stamina, health } }
    })
  },

  recoverStamina(amount) {
    set(s => ({
      player: {
        ...s.player,
        stamina: Math.min(100, s.player.stamina + amount),
      }
    }))
  },

  drainFuel(amount) {
    set(s => ({
      player: { ...s.player, fuel: Math.max(0, s.player.fuel - amount) }
    }))
  },

  takeDamage(amount) {
    set(s => {
      const health = Math.max(0, s.player.health - amount)
      if (health <= 0) {
        // Try another recruited ally first
        const backup = s.allies.find(a => a.status === 'recruited' && a.id !== s.activeAllyId)
        if (backup) {
          return {
            player: {
              ...s.player, name: backup.name,
              position: { x: backup.location.x, y: 2, z: backup.location.z },
              health: 100, stamina: 100, travelMode: 'ski',
            },
            activeAllyId: backup.id,
          }
        }
        // If playing as a recruited ally, fall back to the original character
        if (s.activeAllyId !== null && s.originalCharacter) {
          return {
            player: { ...s.player, name: s.originalCharacter.name, health: 80, stamina: 100, travelMode: 'ski', vehicle: null },
            activeAllyId: null,
          }
        }
        return { player: { ...s.player, health }, gamePhase: 'lost' }
      }
      return { player: { ...s.player, health } }
    })
  },

  recruitAlly(allyId) {
    const s = get()
    const ally = s.allies.find(a => a.id === allyId)
    if (!ally || ally.status !== 'free') return { result: 'invalid' }

    const settlement = s.settlements.find(se => se.allyId === allyId)
    if (!settlement) return { result: 'invalid' }
    if (s.capturedSettlements.includes(settlement.id)) return { result: 'captured' }

    // Police station allies are guaranteed; non-police allies require a persuasion roll
    if (!settlement.buildings.includes('police_station')) {
      const rel = s.player.relationships.find(r => r.allyId === allyId)
      const trust = rel?.trust ?? 0
      const chance = trust > 30 ? 0.75 : trust < -30 ? 0.25 : 0.50
      if (Math.random() >= chance) return { result: 'refused' }
    }

    set(s => ({
      allies: s.allies.map(a => a.id === allyId ? { ...a, status: 'recruited' } : a),
      recruitedAllies: [...s.recruitedAllies, allyId],
      player: { ...s.player, reputation: s.player.reputation + 5 },
    }))
    return { result: 'success' }
  },

  inflictInjury(partId) {
    set(s => {
      const inj = { ...s.player.injuries }
      if (inj[partId] === 'fine') inj[partId] = 'hurt'
      else if (inj[partId] === 'hurt') inj[partId] = 'out'
      return { player: { ...s.player, injuries: inj } }
    })
  },

  applyFirstAid() {
    set(s => {
      const inj = { ...s.player.injuries }
      const outPart  = Object.keys(inj).find(k => inj[k] === 'out')
      const hurtPart = Object.keys(inj).find(k => inj[k] === 'hurt')
      const target = outPart ?? hurtPart
      if (!target) return {}
      inj[target] = outPart ? 'hurt' : 'fine'
      return { player: { ...s.player, injuries: inj } }
    })
  },

  // Building interactions
  restAtBuilding(rate = 'high') {
    const MULT = { high: 1.0, moderate: 0.6, low: 0.35, minimal: 0.1 }
    const m = MULT[rate] ?? 1.0
    set(s => {
      const inj = { ...s.player.injuries }
      if (m >= 0.6) {
        const outPart  = Object.keys(inj).find(k => inj[k] === 'out')
        const hurtPart = Object.keys(inj).find(k => inj[k] === 'hurt')
        const target = outPart ?? hurtPart
        if (target) inj[target] = outPart ? 'hurt' : 'fine'
      }
      return {
        player: {
          ...s.player,
          stamina: Math.min(100, s.player.stamina + Math.round(100 * m)),
          health:  Math.min(100, s.player.health  + Math.round(30  * m)),
          injuries: inj,
        }
      }
    })
  },

  resupplyStore() {
    set(s => ({
      player: { ...s.player, missiles: 1, ammo: Math.min(50, (s.player.ammo ?? 0) + 20) }
    }))
  },

  resupplyMagazine() {
    set(s => ({
      player: { ...s.player, missiles: 1, ammo: 50, dynamite: 1 }
    }))
  },

  consumeMissile() {
    let had = false
    set(s => {
      if (s.player.missiles <= 0) return {}
      had = true
      return { player: { ...s.player, missiles: 0 } }
    })
    return had
  },

  consumeBullet() {
    let had = false
    set(s => {
      if ((s.player.ammo ?? 0) <= 0) return {}
      had = true
      return { player: { ...s.player, ammo: s.player.ammo - 1 } }
    })
    return had
  },

  switchWeapon() {
    set(s => ({
      player: { ...s.player, activeWeapon: s.player.activeWeapon === 'missile' ? 'gun' : 'missile' }
    }))
  },

  refuelGarage() {
    set(s => ({
      player: { ...s.player, fuel: 100 }
    }))
  },

  acquireSnowcat() {
    set(s => {
      const alreadyTaken = s.originalCharacter?.vehicle === 'snowcat' ||
                           s.allies.some(a => a.vehicle === 'snowcat')
      if (alreadyTaken) return {}
      let origChar = s.originalCharacter
      let alliesUpd = s.allies
      if (s.activeAllyId === null) {
        origChar = { ...origChar, vehicle: 'snowcat' }
      } else {
        alliesUpd = s.allies.map(a => a.id === s.activeAllyId ? { ...a, vehicle: 'snowcat' } : a)
      }
      return {
        player: { ...s.player, travelMode: 'snowcat', fuel: 100, vehicle: 'snowcat' },
        originalCharacter: origChar,
        allies: alliesUpd,
      }
    })
  },

  ascendCableCar() {
    set(s => {
      const alreadyTaken = s.originalCharacter?.vehicle === 'paramotor' ||
                           s.allies.some(a => a.vehicle === 'paramotor')
      if (alreadyTaken) return {}
      let origChar = s.originalCharacter
      let alliesUpd = s.allies
      if (s.activeAllyId === null) {
        origChar = { ...origChar, vehicle: 'paramotor' }
      } else {
        alliesUpd = s.allies.map(a => a.id === s.activeAllyId ? { ...a, vehicle: 'paramotor' } : a)
      }
      return {
        player: { ...s.player, travelMode: 'paramotor', vehicle: 'paramotor' },
        originalCharacter: origChar,
        allies: alliesUpd,
      }
    })
  },

  sabotageBuilding(settlementId, buildingType) {
    const key = `${settlementId}:${buildingType}`
    // Political pressure gained and days removed per sabotage type
    const SABOTAGE_FX = {
      synthesis_factory: { morale: 5, days: 3 },
    }
    const fx = SABOTAGE_FX[buildingType] ?? { morale: 3, days: 1 }
    set(s => {
      if (s.sabotagedBuildings.includes(key)) return {}
      const newSabotaged = [...s.sabotagedBuildings, key]
      const newMorale = Math.max(0, s.enemyMorale - fx.morale)
      const newCollapseDay = Math.max(s.currentDay + 2, s.collapseDay - fx.days)

      // Police station in captured settlement: rescue the captured ally
      let alliesUpdate = {}
      if (buildingType === 'police_station') {
        const settlement = s.settlements.find(se => se.id === settlementId)
        const capturedAlly = settlement?.allyId
          ? s.allies.find(a => a.id === settlement.allyId && a.status === 'captured')
          : null
        if (capturedAlly) {
          alliesUpdate = {
            allies: s.allies.map(a =>
              a.id === capturedAlly.id ? { ...a, status: 'recruited' } : a
            ),
            recruitedAllies: [...s.recruitedAllies, capturedAlly.id],
          }
        }
      }

      const won = newMorale <= 0
      const playerUpdate = {
        ...s.player,
        reputation: s.player.reputation + 5,
        dynamite: buildingType === 'synthesis_factory'
          ? Math.max(0, s.player.dynamite - 1)
          : s.player.dynamite,
      }
      return {
        sabotagedBuildings: newSabotaged,
        enemyMorale: newMorale,
        collapseDay: newCollapseDay,
        gamePhase: won ? 'won' : s.gamePhase,
        player: playerUpdate,
        ...alliesUpdate,
      }
    })
  },

  switchCharacter(allyId) {
    set(s => {
      // Save current character's vehicle
      let origChar = s.originalCharacter
      let alliesUpd = s.allies
      if (s.activeAllyId === null) {
        origChar = { ...(origChar ?? {}), vehicle: s.player.vehicle ?? null }
      } else {
        alliesUpd = s.allies.map(a =>
          a.id === s.activeAllyId ? { ...a, vehicle: s.player.vehicle ?? null } : a
        )
      }

      if (allyId === null) {
        const orig = origChar
        if (!orig) return {}
        return {
          player: { ...s.player, name: orig.name, travelMode: orig.vehicle ?? 'ski', vehicle: orig.vehicle ?? null },
          activeAllyId: null,
          originalCharacter: origChar,
          allies: alliesUpd,
        }
      }
      const newChar = alliesUpd.find(a => a.id === allyId)
      if (!newChar || newChar.status !== 'recruited') return {}
      return {
        player: {
          ...s.player,
          name: newChar.name,
          position: { x: newChar.location.x, y: 2, z: newChar.location.z },
          travelMode: newChar.vehicle ?? 'ski',
          vehicle: newChar.vehicle ?? null,
        },
        activeAllyId: allyId,
        originalCharacter: origChar,
        allies: alliesUpd,
      }
    })
  },

  abandonVehicle() {
    set(s => {
      const type = s.player.vehicle
      if (!type) return {}
      const abandoned = { id: `v_${Date.now()}`, type, x: s.player.position.x, z: s.player.position.z }
      let origChar = s.originalCharacter
      let alliesUpd = s.allies
      if (s.activeAllyId === null) {
        origChar = { ...(origChar ?? {}), vehicle: null }
      } else {
        alliesUpd = s.allies.map(a => a.id === s.activeAllyId ? { ...a, vehicle: null } : a)
      }
      return {
        abandonedVehicles: [...s.abandonedVehicles, abandoned],
        player: { ...s.player, vehicle: null, travelMode: 'ski' },
        originalCharacter: origChar,
        allies: alliesUpd,
      }
    })
  },

  collectVehicle(vehicleId) {
    set(s => {
      if (s.player.vehicle) return {}
      const v = s.abandonedVehicles.find(v => v.id === vehicleId)
      if (!v) return {}
      let origChar = s.originalCharacter
      let alliesUpd = s.allies
      if (s.activeAllyId === null) {
        origChar = { ...(origChar ?? {}), vehicle: v.type }
      } else {
        alliesUpd = s.allies.map(a => a.id === s.activeAllyId ? { ...a, vehicle: v.type } : a)
      }
      return {
        abandonedVehicles: s.abandonedVehicles.filter(av => av.id !== vehicleId),
        player: { ...s.player, vehicle: v.type, travelMode: v.type, ...(v.type === 'snowcat' ? { fuel: 50 } : {}) },
        originalCharacter: origChar,
        allies: alliesUpd,
      }
    })
  },

  captureHeatMine() {
    set(s => {
      const captured = s.capturedHeatMines + 1
      const newCollapseDay = s.collapseDay + 3
      const newMorale = Math.min(100, s.enemyMorale + 5)
      const lost = s.totalHeatMines > 0 && captured >= s.totalHeatMines
      return {
        capturedHeatMines: captured,
        collapseDay: newCollapseDay,
        enemyMorale: newMorale,
        gamePhase: lost ? 'lost' : s.gamePhase,
      }
    })
  },

  destroyEnemyVehicle(vehicleId) {
    set(s => ({
      enemyVehicles: s.enemyVehicles.filter(v => v.id !== vehicleId),
      enemyMorale: Math.max(0, s.enemyMorale - 5),
      player: { ...s.player, reputation: s.player.reputation + 10 },
    }))
  },

  enterCombat() {
    set({ inCombat: true })
  },

  exitCombat() {
    const { pendingSync } = get()
    set({ inCombat: false, pendingSync: false })
    if (pendingSync) {
      // Use setTimeout to avoid calling synchroniseWatches inside a set callback
      setTimeout(() => useGameStore.getState().synchroniseWatches(), 0)
    }
  },

  selectAlly(ally) { set({ selectedAlly: ally }) },

  setPerformanceTier(tier) { set({ performanceTier: tier }) },

  advanceTime(dt) {
    set(s => {
      const total = s.totalTime + dt
      const day = Math.floor(total / 86400) + 1
      const won = s.gamePhase === 'playing' && day >= s.collapseDay

      // Personal time advances 1 game-minute per real second (1:1 ratio).
      // advanceTime is only called from the engine, which only runs in action mode,
      // so personal time already only ticks during active play.
      // Update once per real second to avoid mapping the allies array every frame.
      const prevSec = Math.floor(s.totalTime)
      const newSec  = Math.floor(total)
      const minsGained = newSec - prevSec // 0 most frames, 1 once per second

      let playerUpdate = s.player
      let alliesUpdate = s.allies
      if (minsGained > 0) {
        if (s.activeAllyId === null) {
          playerUpdate = { ...s.player, personalTime: s.player.personalTime + minsGained }
        } else {
          alliesUpdate = s.allies.map(a =>
            a.id === s.activeAllyId ? { ...a, personalTime: a.personalTime + minsGained } : a
          )
        }
      }

      return {
        totalTime: total,
        currentDay: day,
        gamePhase: won ? 'won' : s.gamePhase,
        player: playerUpdate,
        allies: alliesUpdate,
      }
    })
  },

  // Charge one minute of personal time for entering a building.
  chargeEntryTime() {
    set(s => {
      if (s.activeAllyId === null) {
        return { player: { ...s.player, personalTime: s.player.personalTime + 1 } }
      }
      return {
        allies: s.allies.map(a =>
          a.id === s.activeAllyId ? { ...a, personalTime: a.personalTime + 1 } : a
        ),
      }
    })
  },

  // Synchronise all watches: fire situation report, auto-rest characters with
  // spare time, snap personal clocks to reportTime, advance team clock +120 min.
  // Also runs the enemy invasion phase.
  synchroniseWatches() {
    const s = get()

    // If combat is active, queue the sync and return; App.jsx fires it on exitCombat
    if (s.inCombat) {
      set({ pendingSync: true })
      return
    }

    const rt = s.reportTime

    // Recovery stamina per 60 minutes of rest, by location tier
    const TIER_RECOVERY = { high: 30, moderate: 18, low: 10, minimal: 4 }
    const BUILDING_TIER = {
      house: 'high', store: 'high', church: 'high', police_station: 'high',
      garage: 'moderate', paramotor_hanger: 'moderate',
      synthesis_factory: 'low', magazine: 'low', bunker: 'low',
    }

    function recoveryTier(pos) {
      if (!pos) return 'minimal'
      const nearest = s.settlements.reduce((best, se) => {
        const d = Math.hypot(se.x - pos.x, se.z - pos.z)
        return d < best.d ? { se, d } : best
      }, { se: null, d: Infinity })
      if (!nearest.se || nearest.d > 60) return 'minimal'
      return nearest.se.buildings
        .map(b => BUILDING_TIER[b])
        .filter(Boolean)
        .reduce((best, t) => {
          const order = ['high', 'moderate', 'low', 'minimal']
          return order.indexOf(t) < order.indexOf(best) ? t : best
        }, 'minimal')
    }

    function applyRest(personalTime, stamina, pos) {
      const restMins = rt - personalTime
      if (restMins <= 0) return stamina
      const tier = recoveryTier(pos)
      const gain = Math.round(TIER_RECOVERY[tier] * (restMins / 60))
      return Math.min(100, stamina + gain)
    }

    const newPlayer = {
      ...s.player,
      stamina: applyRest(s.player.personalTime, s.player.stamina, s.player.position),
      personalTime: Math.max(s.player.personalTime, rt),
    }

    let newAllies = s.allies.map(a => ({
      ...a,
      stamina: applyRest(a.personalTime, a.stamina ?? 100, a.location),
      personalTime: Math.max(a.personalTime, rt),
    }))

    // ---- Enemy invasion phase ----
    const MOVE_DIST = 800       // world units enemy moves per sync
    const SPAWN_CAP = 24        // max simultaneous enemy vehicles

    let capturedSettlements = [...s.capturedSettlements]
    let contestedSettlements = [...s.contestedSettlements]
    let enemyVehicles = [...s.enemyVehicles]

    // 1. Resolve last period's contested settlements → captured
    for (const { id } of contestedSettlements) {
      if (!capturedSettlements.includes(id)) {
        capturedSettlements = [...capturedSettlements, id]
        // If this settlement has a police station, capture the ally inside
        const se = s.settlements.find(se => se.id === id)
        if (se?.buildings.includes('police_station') && se.allyId) {
          newAllies = newAllies.map(a =>
            a.id === se.allyId && a.status === 'free' ? { ...a, status: 'captured' } : a
          )
        }
      }
    }
    contestedSettlements = []

    // 2. Move existing enemy vehicles toward their targets, contest on arrival
    const resistanceIds = s.settlements
      .filter(se => !capturedSettlements.includes(se.id))
      .map(se => se.id)

    // Spawn cloned vehicles for newly captured synthesis factories (if not sabotaged)
    const resistanceSettlements = resistanceIds.map(id => s.settlements.find(se => se.id === id))
    const newlyCaptured = capturedSettlements.filter(id => !s.capturedSettlements.includes(id))
    for (const id of newlyCaptured) {
      const se = s.settlements.find(se => se.id === id)
      const key = `${id}:synthesis_factory`
      if (se?.buildings.includes('synthesis_factory') && !s.sabotagedBuildings.includes(key)) {
        const targetId = pickEnemyTarget({ x: se.x, z: se.z }, s.settlements, resistanceSettlements, s.invasionPoint)
        if (targetId) {
          enemyVehicles = [...enemyVehicles, {
            id: `clone_${id}_${Date.now()}`,
            x: se.x, z: se.z,
            targetSettlementId: targetId,
            status: 'active',
          }]
        }
      }
    }

    enemyVehicles = enemyVehicles
      .filter(v => v.status === 'active')
      .map(v => {
        let { x, z, targetSettlementId } = v

        // Retarget if current target was captured
        if (capturedSettlements.includes(targetSettlementId)) {
          targetSettlementId = pickEnemyTarget(v, s.settlements, resistanceIds.map(id => s.settlements.find(se => se.id === id)), s.invasionPoint) ?? targetSettlementId
        }

        const target = s.settlements.find(se => se.id === targetSettlementId)
        if (!target) return { ...v, targetSettlementId }

        const dx = target.x - x, dz = target.z - z
        const dist = Math.hypot(dx, dz)

        if (dist <= MOVE_DIST) {
          // Arrived — contest this settlement
          if (!capturedSettlements.includes(targetSettlementId)) {
            contestedSettlements = [...contestedSettlements, { id: targetSettlementId, vehicleId: v.id }]
          }
          // Pick next target
          const newTarget = pickEnemyTarget(
            { x: target.x, z: target.z },
            s.settlements,
            resistanceIds.filter(id => id !== targetSettlementId).map(id => s.settlements.find(se => se.id === id)),
            s.invasionPoint
          )
          return { ...v, x: target.x, z: target.z, targetSettlementId: newTarget ?? targetSettlementId }
        }

        const ratio = MOVE_DIST / dist
        // 70% chance move directly toward target, 30% slight perpendicular drift
        const perpX = -dz / dist, perpZ = dx / dist
        const drift = (Math.random() < 0.3 ? (Math.random() - 0.5) * 0.6 : 0)
        return {
          ...v,
          x: x + (dx * ratio + perpX * drift * MOVE_DIST),
          z: z + (dz * ratio + perpZ * drift * MOVE_DIST),
          targetSettlementId,
        }
      })

    // 3. Spawn new enemy vehicles if below cap
    if (s.invasionPoint && enemyVehicles.length < SPAWN_CAP && resistanceIds.length > 0) {
      const spawnCount = Math.min(2, SPAWN_CAP - enemyVehicles.length)
      for (let i = 0; i < spawnCount; i++) {
        const jitter = { x: (Math.random() - 0.5) * 60, z: (Math.random() - 0.5) * 60 }
        const spawnX = s.invasionPoint.x + jitter.x
        const spawnZ = s.invasionPoint.z + jitter.z
        const targetId = pickEnemyTarget(
          { x: spawnX, z: spawnZ },
          s.settlements,
          resistanceIds.map(id => s.settlements.find(se => se.id === id)),
          s.invasionPoint
        )
        if (targetId) {
          enemyVehicles = [...enemyVehicles, {
            id: `ev_${Date.now()}_${i}`,
            x: spawnX, z: spawnZ,
            targetSettlementId: targetId,
            status: 'active',
          }]
        }
      }
    }

    // 4. Win / lose conditions
    const won = s.enemyMorale <= 0 || s.currentDay >= s.collapseDay
    const lost = s.totalHeatMines > 0 && capturedSettlements.length >= s.totalHeatMines

    set({
      reportTime: rt + 120,
      player: newPlayer,
      allies: newAllies,
      gamePhase: won ? 'won' : lost ? 'lost' : s.gamePhase,
      enemyVehicles,
      capturedSettlements,
      contestedSettlements,
      pendingSync: false,
    })
  },

  newGame(seed) {
    const newSeed = seed ?? Math.floor(Math.random() * 100000)
    const pc = generatePlayerCharacter(newSeed)
    set({
      worldSeed: newSeed,
      reportTime: 840,
      player: {
        name: pc.name,
        position: { x: 0, y: 1, z: 22 },
        rotation: { y: 0 },
        health: 100,
        stamina: 100,
        travelMode: 'ski',
        inventory: [],
        reputation: 10,
        fuel: 100,
        missiles: 1,
        dynamite: 0,
        personalTime: 720,
        vehicle: null,
      },
      allies: [],
      settlements: [],
      recruitedAllies: [],
      sabotagedBuildings: [],
      abandonedVehicles: [],
      gamePhase: 'loading',
      currentDay: 1,
      totalTime: 0,
      uiMode: 'hub',
      selectedAlly: null,
      activeAllyId: null,
      originalCharacter: null,
      enemyMorale: 100,
      collapseDay: 40,
      capturedHeatMines: 0,
      totalHeatMines: 0,
      isPaused: false,
      enemyVehicles: [],
      capturedSettlements: [],
      contestedSettlements: [],
      inCombat: false,
      pendingSync: false,
    })
    // initWorld sets gamePhase:'playing' with the correct start position
    useGameStore.getState().initWorld()
  },
    }),
    {
      name: 'frosthold-save',
      partialize: (s) => ({
        worldSeed:            s.worldSeed,
        reportTime:           s.reportTime,
        player:               s.player, // missiles & dynamite live inside player
        allies:               s.allies,
        settlements:          s.settlements,
        invasionPoint:        s.invasionPoint,
        recruitedAllies:      s.recruitedAllies,
        sabotagedBuildings:   s.sabotagedBuildings,
        abandonedVehicles:    s.abandonedVehicles,
        enemyVehicles:        s.enemyVehicles,
        capturedSettlements:  s.capturedSettlements,
        contestedSettlements: s.contestedSettlements,
        enemyMorale:          s.enemyMorale,
        collapseDay:          s.collapseDay,
        capturedHeatMines:    s.capturedHeatMines,
        totalHeatMines:       s.totalHeatMines,
        currentDay:           s.currentDay,
        totalTime:            s.totalTime,
        activeAllyId:         s.activeAllyId,
        originalCharacter:    s.originalCharacter,
        performanceTier:      s.performanceTier,
        hasSave:              s.hasSave,
      }),
    }
  )
)
