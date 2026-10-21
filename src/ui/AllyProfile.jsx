import React, { useState } from 'react'
import { useGameStore, withActive, charPosition, firstAidTarget } from '../store/gameStore.js'

function fmtTime(mins) {
  const h = Math.floor(mins / 60) % 24
  const m = Math.floor(mins % 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

// Building definitions — recovery rates and tile metadata
const BUILDING_TILE_DEFS = {
  house:           { label: 'HOUSE · REST',       sub: 'Eat, sleep & recover',        icon: '🏠', tileType: 'rest',      danger: false, recoveryRate: 'high'     },
  church:          { label: 'CHURCH · REST',       sub: 'Shelter & sniping platform',  icon: '⛪', tileType: 'rest',      danger: false, recoveryRate: 'moderate' },
  store:           { label: 'STORE · SUPPLIES',    sub: 'Restock missile & ammo',      icon: '🏪', tileType: 'store',     danger: false, recoveryRate: 'high'     },
  police_station:  { label: 'POLICE · REST',        sub: 'Rest — ally already recruited', icon: '🔓', tileType: 'police',   danger: false, recoveryRate: 'high'     },
  garage:          { label: 'GARAGE · VEHICLES',   sub: 'Acquire & refuel snowcat',    icon: '🚙', tileType: 'garage',    danger: false, recoveryRate: 'moderate' },
  paramotor_hanger: { label: 'HANGAR · FLY',      sub: 'Collect & launch paramotor',  icon: '🪂', tileType: 'ascend',    danger: false, recoveryRate: 'moderate' },
  heat_mine:       { label: 'HEAT MINE · DEFEND',  sub: 'Resistance asset — hold',     icon: '♨️', tileType: 'heat_mine', danger: false, recoveryRate: 'minimal'  },
  magazine:        { label: 'MAGAZINE · AMMO',     sub: 'Full ammo resupply',          icon: '🎯', tileType: 'magazine',  danger: false, recoveryRate: 'low'      },
  bunker:          { label: 'WATCHTOWER · REST',   sub: 'Elevated cover — partial rest', icon: '🗼', tileType: 'bunker',  danger: false, recoveryRate: 'low'      },
  synthesis_factory: { label: 'FACTORY · DESTROY', sub: 'Clones enemy vehicles — use dynamite', icon: '🏭', tileType: 'sabotage', danger: true, recoveryRate: 'low' },
}

export function AllyProfile({ allyId, nearSettlement, onBack, onMap, onSki, onSwitch, onSnipe }) {
  const allies            = useGameStore(s => s.allies)
  const player            = useGameStore(s => s.player)
  const reportTime        = useGameStore(s => s.reportTime)
  const activeAllyId      = useGameStore(s => s.activeAllyId)
  const inCombat          = useGameStore(s => s.inCombat)
  const settlements       = useGameStore(s => s.settlements)
  const sabotagedBuildings  = useGameStore(s => s.sabotagedBuildings)
  const capturedSettlements = useGameStore(s => s.capturedSettlements)

  const restAtBuilding   = useGameStore(s => s.restAtBuilding)
  const resupplyStore    = useGameStore(s => s.resupplyStore)
  const resupplyMagazine = useGameStore(s => s.resupplyMagazine)
  const refuelGarage     = useGameStore(s => s.refuelGarage)
  const acquireSnowcat   = useGameStore(s => s.acquireSnowcat)
  const ascendCableCar   = useGameStore(s => s.ascendCableCar)
  const sabotageBuilding = useGameStore(s => s.sabotageBuilding)
  const abandonVehicle   = useGameStore(s => s.abandonVehicle)
  const recruitAlly      = useGameStore(s => s.recruitAlly)
  const applyFirstAid   = useGameStore(s => s.applyFirstAid)
  const collectVehicle   = useGameStore(s => s.collectVehicle)
  const abandonedVehicles = useGameStore(s => s.abandonedVehicles)

  const [feedback, setFeedback] = useState(null)
  function flash(msg) { setFeedback(msg); setTimeout(() => setFeedback(null), 2500) }

  const isActive = allyId === activeAllyId
  // The active character's record is folded together with the live copy
  const char = withActive(allies, activeAllyId, player).find(a => a.id === allyId)

  if (!char) return null
  const isAvailable = char.status === 'recruited'

  const pt          = char.personalTime ?? 720
  const isFrozen    = pt >= reportTime
  const minsLeft    = reportTime - pt
  const approaching = minsLeft <= 15 && minsLeft > 0
  const clockColor  = isFrozen ? '#e05555' : approaching ? '#e6b020' : '#a8d8ea'

  // Find the settlement this character is at.
  // Active character: use engine proximity (nearSettlement).
  // Others: the settlement within 8 m of where they are (same radius the engine uses).
  let charSettlement = null
  const pos = charPosition(char)
  if (isActive && nearSettlement) {
    charSettlement = settlements.find(s => s.id === nearSettlement.settlementId) ?? null
  } else if (!isActive && pos) {
    charSettlement = settlements.find(s => Math.hypot(s.x - pos.x, s.z - pos.z) < 8) ?? null
  }

  // An abandoned vehicle where this character is standing (each character has their own position)
  const nearbyVehicle = isActive && !char.vehicle && pos
    ? abandonedVehicles.find(v => Math.hypot(v.x - pos.x, v.z - pos.z) < 10)
    : null

  // Resting uses up the rest of the period; show how long that is
  const restLabel = isFrozen ? '' : ` (${Math.round(minsLeft)} min)`

  const locationLabel = charSettlement
    ? charSettlement.buildings[0]?.replace(/_/g, ' ') ?? 'settlement'
    : 'field'

  // Build action tiles for this character's location.
  // Only the active character can act; others show their location's buildings as info.
  const buildingTiles = []
  if (charSettlement) {
    const seenTypes = new Set()
    const isCaptured = capturedSettlements.includes(charSettlement.id)
    for (const bType of charSettlement.buildings) {
      const def = BUILDING_TILE_DEFS[bType]
      if (!def || seenTypes.has(def.tileType)) continue
      const key = `${charSettlement.id}:${bType}`
      if (sabotagedBuildings.includes(key) && (def.tileType === 'sabotage' || def.tileType === 'police')) continue
      seenTypes.add(def.tileType)

      let action = null
      let customTile = null
      if (isActive) {
        const rate = def.recoveryRate
        switch (def.tileType) {
          case 'rest':    action = () => flash(restAtBuilding(rate) ? `Rested until sync — ${rate} recovery` : 'No time left to rest before sync'); break
          case 'store':   action = () => { resupplyStore(); flash('Resupplied: missile + 20 rounds') }; break
          case 'magazine':action = () => { resupplyMagazine(); flash('Armoury: full resupply') }; break
          case 'garage': action = () => {
            if (player.travelMode === 'snowcat') { refuelGarage(); flash('Snowcat refuelled') }
            else if (player.travelMode === 'paramotor') { refuelGarage(); flash('Paramotor refuelled') }
            else { acquireSnowcat(); onSki(); }
          }; break
          case 'ascend':  action = () => {
            if (ascendCableCar()) onSki()
            else flash('Paramotor already taken by the team')
          }; break
          case 'police': {
            const stationAlly = allies.find(a => a.id === charSettlement.allyId)
            // The station's own officer and any team members held here
            const prisoners = allies.filter(a => a.status === 'captured' &&
              (a.id === charSettlement.allyId || a.heldAt === charSettlement.id))
            if (isCaptured && prisoners.length > 0) {
              const names = prisoners.map(a => a.name).join(', ')
              customTile = {
                label: 'POLICE · RESCUE',
                sub: `Blow up station — free ${names}`,
                icon: '🧨', tileType: 'rescue', buildingType: 'police_station',
                danger: true, highlight: true,
                action: () => {
                  sabotageBuilding(charSettlement.id, 'police_station')
                  flash(`${names} freed — ${prisoners.length > 1 ? 'join' : 'joins'} the resistance`)
                },
              }
            } else if (!isCaptured && stationAlly?.status === 'free') {
              customTile = {
                label: 'POLICE · RECRUIT',
                sub: `${stationAlly.name} — guaranteed`,
                icon: '🤝', tileType: 'recruit_station', buildingType: 'police_station',
                danger: false, highlight: false,
                action: () => {
                  const res = recruitAlly(stationAlly.id)
                  flash(res.result === 'success' ? `${stationAlly.name} joined the resistance` : 'Already recruited')
                },
              }
            } else {
              action = () => flash(restAtBuilding(rate) ? 'Rested at police station until sync' : 'No time left to rest before sync')
            }
            break
          }
          case 'heat_mine': break
          case 'bunker':  action = () => flash(restAtBuilding(rate) ? 'Watchtower — partial rest until sync' : 'No time left to rest before sync'); break
          case 'sabotage':
            if (player.dynamite > 0) {
              action = () => { sabotageBuilding(charSettlement.id, bType); flash('Factory destroyed') }
            }
            break
        }
      }
      const tile = customTile ?? { ...def, buildingType: bType, action, highlight: def.danger }
      // Rest tiles say how much time resting will take
      if (isActive && !customTile && action && (def.tileType === 'rest' || def.tileType === 'bunker' || def.tileType === 'police')) {
        tile.sub = `Rest until sync${restLabel}`
      }
      buildingTiles.push(tile)
    }

    // Recruit non-police ally present at this settlement
    if (isActive && !isCaptured) {
      const settlementAlly = allies.find(a =>
        a.id === charSettlement.allyId && a.status === 'free' &&
        !charSettlement.buildings.includes('police_station')
      )
      if (settlementAlly) {
        const rel = player.relationships?.find(r => r.allyId === settlementAlly.id)
        const trust = rel?.trust ?? 0
        const oddsLabel = trust > 30 ? '75% chance' : trust < -30 ? '25% chance' : '50% chance'
        buildingTiles.push({
          label: 'RECRUIT ALLY',
          sub: `${settlementAlly.name} — ${oddsLabel}`,
          icon: '🤝', tileType: 'recruit_field',
          danger: false, highlight: false,
          action: () => {
            const res = recruitAlly(settlementAlly.id)
            flash(
              res.result === 'success' ? `${settlementAlly.name} joined the resistance` :
              res.result === 'refused' ? `${settlementAlly.name} refused` :
              'Recruitment failed'
            )
          },
        })
      }
    }

    // First Aid — available when an injury hasn't been treated yet and a rest building is present
    if (isActive) {
      const hasInjury = !!firstAidTarget(char)
      const hasRestBuilding = charSettlement.buildings.some(b =>
        ['house', 'church', 'police_station', 'bunker'].includes(b)
      )
      if (hasInjury && hasRestBuilding) {
        buildingTiles.push({
          label: 'FIRST AID',
          sub: 'Treat one injury here',
          icon: '🩹', tileType: 'first_aid',
          danger: false, highlight: false,
          action: () => { applyFirstAid(); flash('First aid applied — one injury improved') },
        })
      }
    }

    // Snipe action tiles — church (elevated 360°) and bunker (ground-level 360°)
    if (isActive && onSnipe) {
      if (charSettlement.buildings.includes('church')) {
        buildingTiles.push({
          label: 'CHURCH · SNIPE', sub: 'Church tower — elevated 360° platform',
          icon: '🎯', tileType: 'snipe', buildingType: 'church',
          danger: false, highlight: false,
          action: () => onSnipe({ buildingType: 'church', x: charSettlement.x, z: charSettlement.z }),
        })
      }
      if (charSettlement.buildings.includes('bunker')) {
        buildingTiles.push({
          label: 'WATCHTOWER · SNIPE', sub: 'Ground-level 360° covered position',
          icon: '🎯', tileType: 'snipe', buildingType: 'bunker',
          danger: false, highlight: false,
          action: () => onSnipe({ buildingType: 'bunker', x: charSettlement.x, z: charSettlement.z }),
        })
      }
    }
  }


  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'linear-gradient(to bottom, #080f1c, #0d1f3a)',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      fontFamily: 'Courier New, monospace', color: '#a8d8ea',
      zIndex: 200, overflowY: 'auto', padding: '20px 0 32px',
    }}>
      <div style={{ fontSize: 10, letterSpacing: 6, color: '#446688', marginBottom: 12 }}>PROFILE</div>

      {/* Personal watch */}
      <div style={{
        fontSize: 'clamp(36px, 9vw, 52px)', fontWeight: 'bold',
        letterSpacing: 4, color: clockColor,
        fontVariantNumeric: 'tabular-nums', marginBottom: 4,
      }}>{fmtTime(pt)}</div>

      <div style={{ fontSize: 10, letterSpacing: 2, color: clockColor, marginBottom: 20 }}>
        {isFrozen
          ? `FROZEN — ${Math.round(pt - reportTime)}m OVER SYNC`
          : approaching ? `SYNC IN ${Math.round(minsLeft)}m`
          : `SYNC AT ${fmtTime(reportTime)}`}
      </div>

      <div style={{ width: 'min(360px, 94vw)', display: 'flex', flexDirection: 'column', gap: 10 }}>

        {/* Identity + status */}
        <InfoBlock>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 14, letterSpacing: 3, fontWeight: 'bold', marginBottom: 4 }}>{char.name}</div>
              <div style={{ fontSize: 9, color: '#5577aa', letterSpacing: 1 }}>
                {isActive ? 'ACTIVE  ·  ' : ''}{char.status === 'dead' ? 'KILLED' : char.status === 'captured' ? 'CAPTURED' : 'TEAM MEMBER'}
              </div>
              {char.vehicle && (
                <div style={{ fontSize: 9, color: '#a8d8ea', letterSpacing: 1, marginTop: 4 }}>
                  {char.vehicle === 'snowcat' ? '🚙 HAS SNOWCAT' : '🪂 HAS PARAMOTOR'}
                </div>
              )}
            </div>
            <div style={{ fontSize: 9, color: '#446688', letterSpacing: 1, textAlign: 'right' }}>
              SYNC<br />
              <span style={{ color: '#a8d8ea', fontVariantNumeric: 'tabular-nums' }}>{fmtTime(reportTime)}</span>
            </div>
          </div>
        </InfoBlock>

        {/* Muscle Power + Injury diagram */}
        <InfoBlock label="VITALS">
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <div style={{ flex: 1 }}>
              <StatBar label="HEALTH" value={char.health ?? 100} color={
                (char.health ?? 100) > 60 ? '#27ae60' : (char.health ?? 100) > 30 ? '#e67e22' : '#e74c3c'
              } />
              <StatBar label="MUSCLE POWER" value={char.stamina ?? 100} color={
                (char.stamina ?? 100) > 40 ? '#3498db' : '#e67e22'
              } />
            </div>
            {char.injuries && <BodyDiagram injuries={char.injuries} />}
          </div>
        </InfoBlock>

        {/* Supplies — each character carries their own */}
        {isAvailable && (
          <InfoBlock label="SUPPLIES">
            <SupplyRow icon="🚀" label="MISSILE"  value={char.missiles ?? 0}     max={1}   color="#a8d8ea" />
            <SupplyRow icon="🔫" label="AMMO"     value={char.ammo ?? 0}         max={50}  color="#c8d8a0" />
            <SupplyRow icon="🧨" label="DYNAMITE" value={char.dynamite ?? 0}     max={5}   color="#e74c3c" />
            {char.vehicle === 'snowcat' && (
              <SupplyRow icon="⛽" label="FUEL" value={Math.round(char.fuel ?? 0)} max={100} color="#f39c12" />
            )}
          </InfoBlock>
        )}

        {/* Location */}
        <InfoBlock label="LOCATION">
          <div style={{ fontSize: 11, letterSpacing: 1 }}>{locationLabel.toUpperCase()}</div>
          {charSettlement && (
            <div style={{ fontSize: 9, color: '#446688', marginTop: 4, letterSpacing: 1 }}>
              {charSettlement.buildings.map(b => b.replace(/_/g, ' ').toUpperCase()).join('  ·  ')}
            </div>
          )}
        </InfoBlock>

      </div>

      {/* Feedback flash */}
      {feedback && (
        <div style={{
          margin: '12px 0', padding: '6px 16px',
          background: 'rgba(168,216,234,0.1)',
          border: '1px solid rgba(168,216,234,0.3)',
          borderRadius: 4, fontSize: 10, color: '#a8d8ea', letterSpacing: 1,
        }}>{feedback}</div>
      )}

      {/* Action buttons */}
      <div style={{ width: 'min(360px, 94vw)', display: 'flex', flexDirection: 'column', gap: 8, marginTop: 16 }}>

        {/* SKI / DEPLOY */}
        {isActive ? (
          <>
            {char.vehicle ? (
              <>
                <ActionBtn
                  label={`CONTINUE — ${char.vehicle === 'snowcat' ? 'SNOWCAT' : 'PARAMOTOR'}`}
                  sub={`Riding ${char.vehicle === 'snowcat' ? 'snowcat' : 'paramotor'}`}
                  icon={char.vehicle === 'snowcat' ? '🚙' : '🪂'}
                  disabled={isFrozen}
                  onClick={onSki}
                />
                <ActionBtn
                  label="SWITCH TO SKI"
                  sub="Leave vehicle behind as a map item"
                  icon="⛷"
                  disabled={isFrozen}
                  onClick={() => { abandonVehicle(); onSki() }}
                />
              </>
            ) : (
              <ActionBtn
                label="SKI — CONTINUE MISSION"
                sub="Return to action as this character"
                icon="⛷"
                disabled={isFrozen}
                onClick={onSki}
              />
            )}
          </>
        ) : isAvailable ? (
          // Only reached when a switch was refused (in combat); the Team screen switches otherwise
          <ActionBtn
            label="SWITCH TO THIS CHARACTER"
            sub={isFrozen ? 'FROZEN — cannot act until sync'
              : inCombat ? 'IN COMBAT — finish the fight first' : 'Make this the active character'}
            icon="⛷"
            disabled={isFrozen || inCombat}
            onClick={() => onSwitch(allyId)}
          />
        ) : null}

        {nearbyVehicle && (
          <ActionBtn
            label={`COLLECT ${nearbyVehicle.type === 'snowcat' ? 'SNOWCAT' : 'PARAMOTOR'}`}
            sub="Abandoned vehicle here"
            icon={nearbyVehicle.type === 'snowcat' ? '🚙' : '🪂'}
            disabled={isFrozen}
            onClick={() => collectVehicle(nearbyVehicle.id)}
          />
        )}

        {/* MAP */}
        <ActionBtn
          label="VIEW MAP"
          sub="Strategy overview — island & locations"
          icon="🗺"
          disabled={false}
          onClick={onMap}
        />

        {/* Building tiles for this location */}
        {buildingTiles.length > 0 && (
          <>
            <div style={{ fontSize: 9, letterSpacing: 3, color: '#446688', marginTop: 4 }}>
              {isActive ? 'AVAILABLE ACTIONS' : 'LOCATION BUILDINGS'}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {buildingTiles.map(t => (
                <BuildingTile
                  key={t.tileType + (t.buildingType ?? '')}
                  tile={t}
                  active={isActive}
                />
              ))}
            </div>
          </>
        )}


        <button
          onClick={onBack}
          style={{
            marginTop: 8, background: 'transparent',
            border: '1px solid rgba(168,216,234,0.3)', borderRadius: 4,
            color: '#5577aa', cursor: 'pointer', padding: '8px 28px',
            fontSize: 10, fontFamily: 'Courier New, monospace', letterSpacing: 2,
          }}
        >BACK TO TEAM</button>
      </div>
    </div>
  )
}

function InfoBlock({ label, children, style = {} }) {
  return (
    <div style={{
      padding: '12px 16px',
      background: 'rgba(14,30,56,0.9)',
      border: '1px solid rgba(168,216,234,0.25)',
      borderRadius: 6, ...style,
    }}>
      {label && <div style={{ fontSize: 9, letterSpacing: 3, color: '#446688', marginBottom: 8 }}>{label}</div>}
      {children}
    </div>
  )
}

function SupplyRow({ icon, label, value, max, color }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
      <span style={{ fontSize: 14 }}>{icon}</span>
      <span style={{ fontSize: 9, color: '#446688', letterSpacing: 1, minWidth: 62 }}>{label}</span>
      <div style={{ flex: 1, height: 6, background: 'rgba(255,255,255,0.08)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${Math.min(100, (value / max) * 100)}%`, height: '100%', background: color, borderRadius: 3 }} />
      </div>
      <span style={{ fontSize: 9, color, minWidth: 24, textAlign: 'right' }}>{value}</span>
    </div>
  )
}

function StatBar({ label, value, color }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
      <span style={{ fontSize: 9, color: '#446688', letterSpacing: 1, minWidth: 90 }}>{label}</span>
      <div style={{ flex: 1, height: 6, background: 'rgba(255,255,255,0.08)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${value}%`, height: '100%', background: color, borderRadius: 3 }} />
      </div>
      <span style={{ fontSize: 9, color, minWidth: 24, textAlign: 'right' }}>{Math.round(value)}</span>
    </div>
  )
}

function ActionBtn({ label, sub, icon, disabled, onClick }) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      style={{
        background: disabled ? 'rgba(20,20,20,0.7)' : 'rgba(14,50,90,0.9)',
        border: `1px solid ${disabled ? 'rgba(80,80,80,0.3)' : 'rgba(100,180,255,0.5)'}`,
        borderRadius: 6, color: disabled ? '#334455' : '#a8d8ea',
        cursor: disabled ? 'not-allowed' : 'pointer', padding: '12px 14px',
        fontFamily: 'Courier New, monospace', textAlign: 'left',
        display: 'flex', alignItems: 'center', gap: 12,
      }}
    >
      <span style={{ fontSize: 22 }}>{icon}</span>
      <div>
        <div style={{ fontSize: 11, letterSpacing: 2, fontWeight: 'bold' }}>{label}</div>
        <div style={{ fontSize: 8, color: disabled ? '#334455' : '#5577aa', letterSpacing: 1, marginTop: 2 }}>{sub}</div>
      </div>
    </button>
  )
}

function BodyDiagram({ injuries }) {
  const c = p => injuries[p] === 'out' ? '#e74c3c' : injuries[p] === 'hurt' ? '#e67e22' : '#27ae60'
  const label = p => injuries[p] === 'out' ? '✕' : injuries[p] === 'hurt' ? '!' : ''
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
      <div style={{ fontSize: 7, color: '#446688', letterSpacing: 1, marginBottom: 2 }}>BODY</div>
      <svg width="64" height="96" viewBox="0 0 64 96">
        {/* Head */}
        <circle cx="32" cy="9" r="8" fill={c('head')} opacity={0.85} />
        <text x="32" y="13" textAnchor="middle" fontSize="7" fill="#000" fontWeight="bold">{label('head')}</text>
        {/* Body */}
        <rect x="20" y="19" width="24" height="22" rx="3" fill={c('body')} opacity={0.85} />
        <text x="32" y="33" textAnchor="middle" fontSize="7" fill="#000" fontWeight="bold">{label('body')}</text>
        {/* Left arm */}
        <rect x="7" y="20" width="11" height="20" rx="3" fill={c('leftArm')} opacity={0.85} />
        <text x="12" y="32" textAnchor="middle" fontSize="6" fill="#000" fontWeight="bold">{label('leftArm')}</text>
        {/* Right arm */}
        <rect x="46" y="20" width="11" height="20" rx="3" fill={c('rightArm')} opacity={0.85} />
        <text x="51" y="32" textAnchor="middle" fontSize="6" fill="#000" fontWeight="bold">{label('rightArm')}</text>
        {/* Left leg */}
        <rect x="20" y="43" width="10" height="28" rx="3" fill={c('leftLeg')} opacity={0.85} />
        <text x="25" y="59" textAnchor="middle" fontSize="7" fill="#000" fontWeight="bold">{label('leftLeg')}</text>
        {/* Right leg */}
        <rect x="34" y="43" width="10" height="28" rx="3" fill={c('rightLeg')} opacity={0.85} />
        <text x="39" y="59" textAnchor="middle" fontSize="7" fill="#000" fontWeight="bold">{label('rightLeg')}</text>
      </svg>
    </div>
  )
}

function BuildingTile({ tile: t, active }) {
  const bg     = t.highlight ? 'rgba(50,14,14,0.9)' : 'rgba(14,30,56,0.9)'
  const border = t.highlight ? 'rgba(200,70,70,0.5)' : 'rgba(168,216,234,0.25)'
  const color  = t.highlight ? '#ee8080' : active ? '#a8d8ea' : '#556677'

  return (
    <button
      onClick={active && t.action ? t.action : undefined}
      disabled={!active || !t.action}
      style={{
        background: bg, border: `1px solid ${border}`,
        borderRadius: 6, color,
        cursor: active && t.action ? 'pointer' : 'default',
        padding: '14px 10px',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
        fontFamily: 'Courier New, monospace',
        opacity: active ? 1 : 0.55,
      }}
    >
      <span style={{ fontSize: 22 }}>{t.icon}</span>
      <span style={{ fontSize: 10, letterSpacing: 2, fontWeight: 'bold' }}>{t.label}</span>
      <span style={{ fontSize: 7, color: t.highlight ? 'rgba(220,100,100,0.7)' : '#446688', letterSpacing: 1, textAlign: 'center' }}>{t.sub}</span>
    </button>
  )
}
