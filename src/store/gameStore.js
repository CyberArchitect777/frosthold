import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { generateAllies, generatePlayerCharacter } from '../world/allies.js'
import { initTerrain, findInvasionPoint } from '../game/terrain.js'

const INITIAL_SEED = Math.floor(Math.random() * 100000)
const INITIAL_PLAYER_CHAR = generatePlayerCharacter(INITIAL_SEED)

// When a character's health reaches 0 (G5). Provisional values — see decisions.md.
const DEATH_CHANCE   = 0.25  // otherwise captured or rescued
const CAPTURE_RADIUS = 400   // m — an enemy vehicle this close means capture
const DOWN_HEALTH    = 25    // health after being captured or rescued

const NO_INJURIES = { leftArm: 'fine', rightArm: 'fine', leftLeg: 'fine', rightLeg: 'fine', body: 'fine', head: 'fine' }

// Kit every character starts with (the starting character and each recruit)
const STARTING_KIT = {
  health: 100, stamina: 100, missiles: 1, ammo: 50, dynamite: 0, fuel: 100,
  activeWeapon: 'missile', travelMode: 'ski', vehicle: null,
}

// `player` is the live copy of the active character; `allies` holds every character's
// record (team members included). This returns `allies` with the live copy folded in.
export function withActive(allies, activeAllyId, player) {
  if (!activeAllyId) return allies
  return allies.map(a => a.id === activeAllyId ? { ...a, ...player } : a)
}

// Where a character is now: team members have a position, others sit at their home settlement.
export function charPosition(a) {
  return a.position ?? a.location
}

// The injured body part first aid would treat: an 'out' part first, then a 'hurt' one.
// Each injury can be treated once; null if there's nothing left to treat.
export function firstAidTarget(char) {
  const inj = char.injuries ?? {}
  const done = char.treatedInjuries ?? {}
  const open = k => !done[k]
  return Object.keys(inj).find(k => inj[k] === 'out' && open(k))
      ?? Object.keys(inj).find(k => inj[k] === 'hurt' && open(k))
      ?? null
}

function nearest(items, pos) {
  let best = null, bestD = Infinity
  for (const it of items) {
    const d = Math.hypot(it.x - pos.x, it.z - pos.z)
    if (d < bestD) { best = it; bestD = d }
  }
  return best
}

// Enemy invasion pace (G8). Target: an unopposed enemy wins in about 15 days.
// Provisional values — see decisions.md and plans/g8-enemy-pace.md.
const ENEMY_MOVE        = 200 // m per sync
const ENEMY_START       = 4   // vehicles at the invasion point when the game starts
const ENEMY_GROW_SYNCS  = 24  // the enemy's target force grows by 1 every 24 syncs (2 days)
const ENEMY_CAP         = 10  // most vehicles at once (target force and factory clones)
const SIEGE_SYNCS       = 6   // syncs a vehicle must besiege a settlement to capture it
const SIEGE_SYNCS_MINE  = 12  // ... a settlement with a heat mine
const MINE_LOST_DAYS    = 1   // collapse day pushed back per heat mine lost
const MINE_LOST_MORALE  = 5   // enemy morale gained per heat mine lost
const SIEGE_BROKEN_DAYS = 1   // collapse day pulled forward by destroying a besieging vehicle
const KILL_MORALE       = 2   // enemy morale lost per vehicle destroyed
const STALL_MORALE      = 2   // enemy morale lost per day without taking a heat mine

// Syncs needed to capture a settlement
export function siegeNeed(settlement) {
  return settlement?.buildings.includes('heat_mine') ? SIEGE_SYNCS_MINE : SIEGE_SYNCS
}

// Enemy force the invasion aims to keep in the field after `syncs` syncs
function enemyTargetForce(syncs) {
  return Math.min(ENEMY_CAP, ENEMY_START + Math.floor(syncs / ENEMY_GROW_SYNCS))
}

function spawnEnemy(invasionPoint, i) {
  return {
    id: `ev_${Date.now()}_${i}`,
    x: invasionPoint.x + (Math.random() - 0.5) * 60,
    z: invasionPoint.z + (Math.random() - 0.5) * 60,
    targetSettlementId: null,
    status: 'active',
  }
}

// The engine changes the store several times a frame, so writing the save to localStorage
// on every change is slow (P1). Writes are batched instead: at most one every SAVE_INTERVAL,
// plus one straight away when the page is hidden or closed.
const SAVE_INTERVAL = 2000 // ms
function batchedStorage() {
  let pending = null
  let timer = null
  const flush = () => {
    clearTimeout(timer)
    timer = null
    if (!pending) return
    const [name, value] = pending
    pending = null
    try { localStorage.setItem(name, JSON.stringify(value)) }
    catch (e) { console.warn('Frosthold: could not save', e) }
  }
  window.addEventListener('pagehide', flush)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush()
  })
  return {
    getItem(name) {
      const str = localStorage.getItem(name)
      return str ? JSON.parse(str) : null
    },
    setItem(name, value) {
      pending = [name, value]
      if (!timer) timer = setTimeout(flush, SAVE_INTERVAL)
    },
    removeItem(name) {
      pending = null
      clearTimeout(timer)
      timer = null
      localStorage.removeItem(name)
    },
  }
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
  recruitedAllies: [],    // ids of everyone who has joined the team (starting character included)
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
  contestedSettlements: [],   // [{ id, vehicleId, progress }] — under siege; progress = syncs so far
  minesAtDayStart: 0,         // capturedHeatMines when the current day began (stalled-offensive check)
  inCombat: false,            // true while engine is running real-time combat
  pendingSync: false,         // sync queued while in combat

  // UI
  uiMode: 'hub', // 'hub' | 'action' | 'strategy'
  selectedAlly: null,
  activeAllyId: null,       // id of the character being played; null = none deployed
  downReport: null,         // { name, outcome: 'killed'|'captured'|'rescued' } shown on the Team screen
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
    const startChar = {
      ...playerChar,
      ...STARTING_KIT,
      position: { x: startX, y: 2, z: startZ },
      rotation: { y: 0 },
      reputation: 10,
      inventory: [],
      injuries: { ...NO_INJURIES },
    }
    set({
      allies: [startChar, ...allies],
      settlements,
      invasionPoint,
      gamePhase: 'playing',
      hasSave: true,
      totalHeatMines,
      enemyMorale: 100,
      collapseDay: 40,
      capturedHeatMines: 0,
      reportTime: 840,
      currentDay: 1,
      totalTime: 0,
      activeAllyId: startChar.id,
      downReport: null,
      selectedAlly: null,
      uiMode: 'hub',
      isPaused: false,
      recruitedAllies: [startChar.id],
      sabotagedBuildings: [],
      abandonedVehicles: [],
      enemyVehicles: Array.from({ length: ENEMY_START }, (_, i) => spawnEnemy(invasionPoint, i)),
      capturedSettlements: [],
      contestedSettlements: [],
      minesAtDayStart: 0,
      inCombat: false,
      pendingSync: false,
      player: { ...startChar },
    })
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
      return { player: { ...s.player, stamina, health } }
    })
    const s = get()
    if (s.activeAllyId && s.player.health <= 0) s.characterDown()
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
      return { player: { ...s.player, health } }
    })
    const s = get()
    if (s.activeAllyId && s.player.health <= 0) s.characterDown()
  },

  // The active character's health reached 0 (G5): killed, captured or rescued by locals.
  // Leaves nobody deployed; the Team screen shows what happened and the owner picks who's next.
  characterDown(roll = Math.random()) {
    set(s => {
      const me = s.player
      const pos = me.position
      const abandoned = me.vehicle
        ? [...s.abandonedVehicles, { id: `v_${Date.now()}`, type: me.vehicle, x: pos.x, z: pos.z }]
        : s.abandonedVehicles

      const held = se => s.capturedSettlements.includes(se.id)
      const enemyNear = s.enemyVehicles.some(v => Math.hypot(v.x - pos.x, v.z - pos.z) <= CAPTURE_RADIUS)
      const closest = nearest(s.settlements, pos)
      const prison = nearest(s.settlements.filter(se =>
        held(se) && se.buildings.includes('police_station') &&
        !s.sabotagedBuildings.includes(`${se.id}:police_station`)
      ), pos)
      const refuge = nearest(s.settlements.filter(se => !held(se)), pos)

      let outcome
      if (roll < DEATH_CHANCE) outcome = 'killed'
      else if ((enemyNear || (closest && held(closest))) && prison) outcome = 'captured'
      else if (refuge) outcome = 'rescued'
      else outcome = prison ? 'captured' : 'killed'

      const down = { ...me, vehicle: null, travelMode: 'ski', speed: 0 }
      if (outcome === 'killed') {
        Object.assign(down, { status: 'dead', health: 0 })
      } else if (outcome === 'captured') {
        Object.assign(down, {
          status: 'captured', heldAt: prison.id, health: DOWN_HEALTH, stamina: 0,
          missiles: 0, ammo: 0, dynamite: 0,
          position: { x: prison.x, y: 2, z: prison.z },
        })
      } else {
        // Frozen until the next sync
        Object.assign(down, {
          health: DOWN_HEALTH, stamina: 0,
          personalTime: Math.max(me.personalTime, s.reportTime),
          position: { x: refuge.x, y: 2, z: refuge.z },
        })
      }

      const allies = s.allies.map(a => a.id === s.activeAllyId ? { ...a, ...down } : a)
      const anyoneLeft = allies.some(a => s.recruitedAllies.includes(a.id) && a.status === 'recruited')
      return {
        allies,
        player: down,
        activeAllyId: null,
        abandonedVehicles: abandoned,
        downReport: { name: me.name, outcome },
        uiMode: 'hub',
        gamePhase: anyoneLeft ? s.gamePhase : 'lost',
      }
    })
  },

  clearDownReport() { set({ downReport: null }) },

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
      // A recruit starts on the recruiter's personal time
      allies: s.allies.map(a => a.id === allyId ? {
        ...a, ...STARTING_KIT, status: 'recruited', personalTime: s.player.personalTime,
        position: { x: a.location.x, y: 2, z: a.location.z }, rotation: { y: 0 },
        reputation: 10, inventory: [], injuries: { ...NO_INJURIES },
      } : a),
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
      // A worse injury is a new one, so first aid can treat it again
      const treated = { ...(s.player.treatedInjuries ?? {}), [partId]: false }
      return { player: { ...s.player, injuries: inj, treatedInjuries: treated } }
    })
  },

  // Improve one injury by a step; each injury can only be treated once
  applyFirstAid() {
    set(s => {
      const target = firstAidTarget(s.player)
      if (!target) return {}
      const inj = { ...s.player.injuries }
      inj[target] = inj[target] === 'out' ? 'hurt' : 'fine'
      const treated = { ...(s.player.treatedInjuries ?? {}), [target]: true }
      return { player: { ...s.player, injuries: inj, treatedInjuries: treated } }
    })
  },

  // Building interactions
  // Resting uses up the rest of the period until sync. Recovery scales with the time rested:
  // a full period (REST_FULL_MINS) gives the full amount for the building.
  // Returns false if there's no time left to rest.
  restAtBuilding(rate = 'high') {
    if (get().reportTime - get().player.personalTime <= 0) return false
    const MULT = { high: 1.0, moderate: 0.6, low: 0.35, minimal: 0.1 }
    const REST_FULL_MINS   = 120  // a whole sync period
    const REST_INJURY_MINS = 60   // rest needed to improve an injury
    const m = MULT[rate] ?? 1.0
    set(s => {
      const mins = s.reportTime - s.player.personalTime
      if (mins <= 0) return {}
      const f = Math.min(1, mins / REST_FULL_MINS)
      const inj = { ...s.player.injuries }
      if (m >= 0.6 && mins >= REST_INJURY_MINS) {
        const outPart  = Object.keys(inj).find(k => inj[k] === 'out')
        const hurtPart = Object.keys(inj).find(k => inj[k] === 'hurt')
        const target = outPart ?? hurtPart
        if (target) inj[target] = outPart ? 'hurt' : 'fine'
      }
      return {
        player: {
          ...s.player,
          stamina: Math.min(100, s.player.stamina + Math.round(100 * m * f)),
          health:  Math.min(100, s.player.health  + Math.round(30  * m * f)),
          injuries: inj,
          personalTime: s.reportTime,
        }
      }
    })
    return true
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
      const alreadyTaken = withActive(s.allies, s.activeAllyId, s.player)
        .some(a => a.vehicle === 'snowcat' && a.status !== 'dead')
      if (alreadyTaken) return {}
      return {
        player: { ...s.player, travelMode: 'snowcat', fuel: 100, vehicle: 'snowcat' },
      }
    })
  },

  // Returns false if the team's paramotor is already taken
  ascendCableCar() {
    const s = get()
    const alreadyTaken = withActive(s.allies, s.activeAllyId, s.player)
      .some(a => a.vehicle === 'paramotor' && a.status !== 'dead')
    if (alreadyTaken) return false
    // A snowcat is left behind at the hangar rather than lost
    if (s.player.vehicle === 'snowcat') s.abandonVehicle()
    set(s => ({
      player: { ...s.player, travelMode: 'paramotor', vehicle: 'paramotor' },
    }))
    return true
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

      // Police station in captured settlement: free its own officer and any team members held there
      let alliesUpdate = {}
      if (buildingType === 'police_station') {
        const settlement = s.settlements.find(se => se.id === settlementId)
        const freed = s.allies.filter(a => a.status === 'captured' &&
          (a.id === settlement?.allyId || a.heldAt === settlementId))
        if (freed.length > 0) {
          const ids = freed.map(a => a.id)
          const here = { x: settlement.x, y: 2, z: settlement.z }
          alliesUpdate = {
            allies: s.allies.map(a => {
              if (!ids.includes(a.id)) return a
              // A team member keeps their record; a first-time recruit gets the starting kit
              const fresh = s.recruitedAllies.includes(a.id) ? {} : {
                ...STARTING_KIT, rotation: { y: 0 }, reputation: 10, inventory: [], injuries: { ...NO_INJURIES },
              }
              // Freed characters carry on from the rescuer's personal time (or their own, if later)
              const personalTime = Math.max(a.personalTime ?? 0, s.player.personalTime)
              return { ...a, ...fresh, status: 'recruited', heldAt: null, position: here, personalTime }
            }),
            recruitedAllies: [...s.recruitedAllies, ...ids.filter(id => !s.recruitedAllies.includes(id))],
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

  // Save the active character's live copy into their record and load another character.
  // Returns false if the switch isn't allowed.
  switchCharacter(allyId) {
    const s = get()
    if (s.inCombat) return false
    // Land first. Only in the 3D view: on the Team screen a paramotor is just being carried.
    if (s.uiMode === 'action' && s.player.travelMode === 'paramotor' && s.activeAllyId) return false
    const target = s.allies.find(a => a.id === allyId)
    if (!target || target.status !== 'recruited' || !s.recruitedAllies.includes(allyId)) return false
    if (allyId === s.activeAllyId) return true
    const allies = withActive(s.allies, s.activeAllyId, s.player)
    set({
      allies,
      player: { ...allies.find(a => a.id === allyId) },
      activeAllyId: allyId,
    })
    return true
  },

  abandonVehicle() {
    set(s => {
      const type = s.player.vehicle
      // No vehicle to leave, but never stay in a vehicle mode without one
      if (!type) return s.player.travelMode === 'ski' ? {} : { player: { ...s.player, travelMode: 'ski' } }
      const abandoned = { id: `v_${Date.now()}`, type, x: s.player.position.x, z: s.player.position.z }
      return {
        abandonedVehicles: [...s.abandonedVehicles, abandoned],
        player: { ...s.player, vehicle: null, travelMode: 'ski' },
      }
    })
  },

  collectVehicle(vehicleId) {
    set(s => {
      if (s.player.vehicle) return {}
      const v = s.abandonedVehicles.find(v => v.id === vehicleId)
      if (!v) return {}
      return {
        abandonedVehicles: s.abandonedVehicles.filter(av => av.id !== vehicleId),
        player: { ...s.player, vehicle: v.type, travelMode: v.type, ...(v.type === 'snowcat' ? { fuel: 50 } : {}) },
      }
    })
  },

  destroyEnemyVehicle(vehicleId) {
    set(s => {
      // Destroying a besieging vehicle breaks the siege and brings collapse closer
      const besieging = s.contestedSettlements.some(c => c.vehicleId === vehicleId)
      return {
        enemyVehicles: s.enemyVehicles.filter(v => v.id !== vehicleId),
        contestedSettlements: s.contestedSettlements.filter(c => c.vehicleId !== vehicleId),
        enemyMorale: Math.max(0, s.enemyMorale - KILL_MORALE),
        collapseDay: besieging ? Math.max(s.currentDay + 2, s.collapseDay - SIEGE_BROKEN_DAYS) : s.collapseDay,
        player: { ...s.player, reputation: s.player.reputation + 10 },
      }
    })
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

      // Personal time advances 1 game-minute per real second (1:1 ratio).
      // advanceTime is only called from the engine, which only runs in action mode,
      // so personal time already only ticks during active play.
      // Update once per real second to avoid mapping the allies array every frame.
      const prevSec = Math.floor(s.totalTime)
      const newSec  = Math.floor(total)
      const minsGained = newSec - prevSec // 0 most frames, 1 once per second

      return {
        totalTime: total,
        player: minsGained > 0
          ? { ...s.player, personalTime: s.player.personalTime + minsGained }
          : s.player,
      }
    })
  },

  // Charge one minute of personal time for entering a building.
  chargeEntryTime() {
    set(s => s.activeAllyId
      ? { player: { ...s.player, personalTime: s.player.personalTime + 1 } }
      : {})
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

    // Every watch moves up to the report time; only free team members rest, each where they are
    let newAllies = withActive(s.allies, s.activeAllyId, s.player).map(a => ({
      ...a,
      stamina: a.status === 'recruited' && s.recruitedAllies.includes(a.id)
        ? applyRest(a.personalTime, a.stamina ?? 100, charPosition(a))
        : a.stamina,
      personalTime: Math.max(a.personalTime, rt),
    }))

    // ---- Enemy invasion phase (G8) ----
    const byId = id => s.settlements.find(se => se.id === id)
    const alive = new Set(s.enemyVehicles.filter(v => v.status === 'active').map(v => v.id))
    let capturedSettlements = [...s.capturedSettlements]
    let contestedSettlements = []

    // 1. Sieges advance; a settlement is captured once its siege has lasted long enough.
    //    A siege whose vehicle was destroyed is already gone (destroyEnemyVehicle).
    const besiegersDone = new Set()
    for (const c of s.contestedSettlements) {
      if (!alive.has(c.vehicleId) || capturedSettlements.includes(c.id)) continue
      const progress = (c.progress ?? 0) + 1
      if (progress < siegeNeed(byId(c.id))) {
        contestedSettlements.push({ ...c, progress })
        continue
      }
      capturedSettlements.push(c.id)
      besiegersDone.add(c.vehicleId)
      // If this settlement has a police station, capture the ally inside
      const se = byId(c.id)
      if (se?.buildings.includes('police_station') && se.allyId) {
        newAllies = newAllies.map(a =>
          a.id === se.allyId && a.status === 'free' ? { ...a, status: 'captured' } : a
        )
      }
    }

    // 2. Reinforcements. The enemy keeps a force that grows on a timetable; anything
    //    below it (including destroyed vehicles) is replaced from the invasion point,
    //    one per sync. Captured, unsabotaged factories add clones on top, up to the cap.
    let enemyVehicles = s.enemyVehicles.filter(v => v.status === 'active')
    const syncsSoFar = Math.round((rt - 840) / 120)
    if (s.invasionPoint && enemyVehicles.length < enemyTargetForce(syncsSoFar)) {
      enemyVehicles.push(spawnEnemy(s.invasionPoint, 0))
    }
    for (const id of capturedSettlements.filter(id => !s.capturedSettlements.includes(id))) {
      const se = byId(id)
      if (se?.buildings.includes('synthesis_factory') && !s.sabotagedBuildings.includes(`${id}:synthesis_factory`)
          && enemyVehicles.length < ENEMY_CAP) {
        enemyVehicles.push({ id: `clone_${id}_${Date.now()}`, x: se.x, z: se.z, targetSettlementId: null, status: 'active' })
      }
    }

    // 3. Front line: each free vehicle heads for the nearest resistance settlement that no
    //    other vehicle is besieging or heading for, and starts a siege when it arrives.
    const besieging = new Set(contestedSettlements.map(c => c.vehicleId))
    const claimed = new Set(contestedSettlements.map(c => c.id))
    enemyVehicles = enemyVehicles.map(v => {
      if (besieging.has(v.id)) return v
      let target = null, dist = Infinity
      for (const se of s.settlements) {
        if (capturedSettlements.includes(se.id) || claimed.has(se.id)) continue
        const d = Math.hypot(se.x - v.x, se.z - v.z)
        if (d < dist) { dist = d; target = se }
      }
      if (!target) return v
      claimed.add(target.id)
      if (dist <= ENEMY_MOVE) {
        contestedSettlements.push({ id: target.id, vehicleId: v.id, progress: 0 })
        return { ...v, x: target.x, z: target.z, targetSettlementId: target.id }
      }
      const r = ENEMY_MOVE / dist
      return { ...v, x: v.x + (target.x - v.x) * r, z: v.z + (target.z - v.z) * r, targetSettlementId: target.id }
    })

    // 4. Heat mines lost this sync: each raises enemy morale and delays collapse
    const isHeatMine = id => s.settlements.find(se => se.id === id)?.buildings.includes('heat_mine')
    const capturedHeatMines = capturedSettlements.filter(isHeatMine).length
    const minesLost = Math.max(0, capturedHeatMines - s.capturedHeatMines)
    let enemyMorale = Math.min(100, s.enemyMorale + minesLost * MINE_LOST_MORALE)
    const collapseDay = s.collapseDay + minesLost * MINE_LOST_DAYS

    // 5. Stalled offensive: a whole day without taking a heat mine lowers enemy morale
    //    (counted on the first sync of the new day, before that sync's captures)
    const currentDay = Math.floor(rt / 1440) + 1
    let minesAtDayStart = s.minesAtDayStart ?? 0
    if (currentDay > s.currentDay) {
      if (s.capturedHeatMines <= minesAtDayStart) enemyMorale = Math.max(0, enemyMorale - STALL_MORALE)
      minesAtDayStart = s.capturedHeatMines
    }

    // 6. Win / lose conditions. The day comes from the team clock (minutes since day 1 00:00).
    const won = enemyMorale <= 0 || currentDay >= collapseDay
    const lost = s.totalHeatMines > 0 && capturedHeatMines >= s.totalHeatMines

    set({
      reportTime: rt + 120,
      currentDay,
      capturedHeatMines,
      enemyMorale,
      collapseDay,
      player: s.activeAllyId ? { ...newAllies.find(a => a.id === s.activeAllyId) } : s.player,
      allies: newAllies,
      gamePhase: won ? 'won' : lost ? 'lost' : s.gamePhase,
      enemyVehicles,
      capturedSettlements,
      contestedSettlements,
      minesAtDayStart,
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
      downReport: null,
      enemyMorale: 100,
      collapseDay: 40,
      capturedHeatMines: 0,
      totalHeatMines: 0,
      isPaused: false,
      enemyVehicles: [],
      capturedSettlements: [],
      contestedSettlements: [],
      minesAtDayStart: 0,
      inCombat: false,
      pendingSync: false,
    })
    // initWorld sets gamePhase:'playing' with the correct start position
    useGameStore.getState().initWorld()
  },
    }),
    {
      name: 'frosthold-save',
      storage: batchedStorage(),
      // v2: independent characters (G4). v3: sieges and enemy pace (G8).
      // Older saves aren't converted; they're dropped.
      version: 3,
      migrate: () => ({}),
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
        minesAtDayStart:      s.minesAtDayStart,
        enemyMorale:          s.enemyMorale,
        collapseDay:          s.collapseDay,
        capturedHeatMines:    s.capturedHeatMines,
        totalHeatMines:       s.totalHeatMines,
        currentDay:           s.currentDay,
        totalTime:            s.totalTime,
        activeAllyId:         s.activeAllyId,
        downReport:           s.downReport,
        performanceTier:      s.performanceTier,
        hasSave:              s.hasSave,
      }),
    }
  )
)
