import React, { useRef, useEffect, useState } from 'react'
import { useGameStore } from '../store/gameStore.js'
import { TRAVEL_MODES } from '../game/travel.js'
import { sampleHeight } from '../game/terrain.js'

function fmtTime(mins) {
  const h = Math.floor(mins / 60) % 24
  const m = Math.floor(mins % 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export function HUD({ terrainDebug, showDebug, inCombat, enemyBearing }) {
  const player = useGameStore(s => s.player)
  const enemyMorale = useGameStore(s => s.enemyMorale)
  const collapseDay       = useGameStore(s => s.collapseDay)
  const currentDay        = useGameStore(s => s.currentDay)
  const reportTime        = useGameStore(s => s.reportTime)
  const allies = useGameStore(s => s.allies)
  const settlements = useGameStore(s => s.settlements)
  const invasionPoint = useGameStore(s => s.invasionPoint)
  const abandonedVehicles = useGameStore(s => s.abandonedVehicles)

  const personalTime = player.personalTime ?? 720
  const isFrozen     = personalTime >= reportTime
  const minsToSync   = reportTime - personalTime
  const approaching  = minsToSync <= 15 && minsToSync > 0

  const mode = TRAVEL_MODES[player.travelMode]
  const compassAngle = -(player.rotation?.y ?? 0)
  const speedKmh = Math.round((player.speed ?? 0) * 3.6)

  const compassDir = getCompassDir(compassAngle)

  const staminaColor = player.stamina > 40 ? '#3498db' : '#e67e22'

  return (
    <>
    <div
      style={{
        position: 'fixed', bottom: 0, left: 0, right: 0,
        height: '18vh', maxHeight: 130,
        background: 'linear-gradient(to top, rgba(10,22,40,0.95), rgba(10,22,40,0.6))',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 16px',
        borderTop: '1px solid rgba(168,216,234,0.3)',
        fontFamily: 'Courier New, monospace',
        color: '#a8d8ea',
        fontSize: 12,
        userSelect: 'none',
        zIndex: 100,
      }}
    >
      {/* Compass + Speed */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 60 }}>
        <div style={{
          width: 48, height: 48,
          border: '2px solid rgba(168,216,234,0.5)',
          borderRadius: '50%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 14, fontWeight: 'bold', color: '#a8d8ea',
          position: 'relative',
        }}>
          <span style={{
            position: 'absolute', top: 4, fontSize: 10, color: '#e74c3c',
          }}>N</span>
          <span style={{
            transform: `rotate(${compassAngle * (180 / Math.PI)}deg)`,
            display: 'block', fontSize: 16,
          }}>↑</span>
        </div>
        <span style={{ marginTop: 2, fontSize: 11 }}>{compassDir}</span>
        <span style={{ fontSize: 11 }}>{speedKmh} km/h</span>
      </div>

      {/* Status bars */}
      <div style={{ flex: 1, margin: '0 16px', display: 'flex', flexDirection: 'column', gap: 4 }}>
        <StatBar label="ST" value={player.stamina} color={staminaColor} />
        {(player.travelMode === 'snowcat' || player.travelMode === 'paramotor') && (
          <StatBar label="FUEL" value={player.fuel} color="#f39c12" format={v => `${Math.max(0, v).toFixed(1)}%`} />
        )}
      </div>

      {/* Travel mode */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 70 }}>
        <div style={{ fontSize: 28 }}>{mode?.icon ?? '⛷'}</div>
        <div style={{ fontSize: 10, marginTop: 2 }}>{mode?.label ?? 'Ski'}</div>
      </div>

      {/* Clocks + mission status */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', minWidth: 86 }}>
        {/* Personal watch */}
        <div style={{
          fontSize: 15, fontWeight: 'bold', letterSpacing: 2,
          color: isFrozen ? '#e05555' : approaching ? '#e6b020' : '#a8d8ea',
          fontVariantNumeric: 'tabular-nums',
        }}>{fmtTime(personalTime)}</div>
        {/* Frozen / approaching warning */}
        {isFrozen && (
          <div style={{ fontSize: 8, color: '#e05555', letterSpacing: 1, marginBottom: 1 }}>FROZEN</div>
        )}
        {approaching && !isFrozen && (
          <div style={{ fontSize: 8, color: '#e6b020', letterSpacing: 1, marginBottom: 1 }}>SYNC {minsToSync}m</div>
        )}
        {/* Team report time */}
        <div style={{ fontSize: 9, color: '#446688', letterSpacing: 1 }}>SYNC {fmtTime(reportTime)}</div>
        <div style={{ fontSize: 10, color: '#aaa', marginTop: 3 }}>DAY {currentDay}/{collapseDay}</div>
        <div style={{ fontSize: 10, color: '#aaa', marginTop: 2 }}>ENEMY MORALE</div>
        <div style={{
          width: 70, height: 8,
          background: 'rgba(255,255,255,0.1)',
          borderRadius: 4, overflow: 'hidden', marginTop: 2,
        }}>
          <div style={{
            width: `${enemyMorale}%`, height: '100%',
            background: enemyMorale <= 30
              ? 'linear-gradient(to right, #27ae60, #2ecc71)'
              : enemyMorale <= 60
                ? 'linear-gradient(to right, #e6b020, #f39c12)'
                : 'linear-gradient(to right, #c0392b, #e74c3c)',
            transition: 'width 0.5s',
          }} />
        </div>
        <div style={{ fontSize: 10, color: enemyMorale <= 30 ? '#27ae60' : enemyMorale <= 60 ? '#e6b020' : '#e74c3c', marginTop: 1 }}>{enemyMorale}%</div>
      </div>
    </div>

    {/* Terrain debug overlay */}
    {showDebug && terrainDebug && (
      <div style={{
        position: 'fixed', top: 12, left: '50%', transform: 'translateX(-50%)',
        background: 'rgba(0,0,0,0.75)',
        border: '1px solid rgba(168,216,234,0.4)',
        borderRadius: 4, padding: '6px 14px',
        fontFamily: 'Courier New, monospace',
        fontSize: 11, color: '#a8d8ea',
        pointerEvents: 'none', zIndex: 200,
        whiteSpace: 'nowrap',
        lineHeight: 1.8,
      }}>
        <div>height: <b>{terrainDebug.groundHeight?.toFixed(2)} m</b></div>
        <div>offset: <b>{terrainDebug.offset?.toFixed(2)} m</b></div>
        <div>player Y: <b>{terrainDebug.playerY?.toFixed(2)} m</b></div>
      </div>
    )}

    {/* Crosshair */}
    <div style={{
      position: 'fixed', top: '50%', left: '50%',
      transform: 'translate(-50%, -50%)',
      pointerEvents: 'none', zIndex: 110,
    }}>
      <div style={{ position: 'relative', width: 0, height: 0 }}>
        <div style={{ position: 'absolute', width: 14, height: 1, background: 'rgba(255,255,255,0.75)', top: 0, left: -7, boxShadow: '0 0 2px rgba(0,0,0,0.8)' }} />
        <div style={{ position: 'absolute', width: 1, height: 14, background: 'rgba(255,255,255,0.75)', top: -7, left: 0, boxShadow: '0 0 2px rgba(0,0,0,0.8)' }} />
      </div>
    </div>

    {/* Combat bearing indicators */}
    {inCombat && (
      <CombatBearingLights bearing={enemyBearing} />
    )}

    {/* Minimap */}
    <Minimap player={player} allies={allies} settlements={settlements} invasionPoint={invasionPoint} abandonedVehicles={abandonedVehicles} />
    </>
  )
}

function CombatBearingLights({ bearing }) {
  const [flash, setFlash] = useState(true)
  useEffect(() => {
    const id = setInterval(() => setFlash(f => !f), 250)
    return () => clearInterval(id)
  }, [])

  const lit = flash
  const leftOn  = lit && (bearing === 'left'  || bearing === 'both')
  const rightOn = lit && (bearing === 'right' || bearing === 'both')

  const dot = (on) => ({
    width: 14, height: 14,
    borderRadius: '50%',
    background: on ? '#e6b020' : 'rgba(230,176,32,0.15)',
    boxShadow: on ? '0 0 8px 3px rgba(230,176,32,0.7)' : 'none',
    border: '1px solid rgba(230,176,32,0.4)',
    transition: 'background 0.05s, box-shadow 0.05s',
  })

  return (
    <div style={{
      position: 'fixed',
      bottom: 'calc(18vh + 6px)',
      left: '50%',
      transform: 'translateX(-50%)',
      display: 'flex', gap: 120,
      pointerEvents: 'none', zIndex: 101,
    }}>
      <div style={dot(leftOn)} title="Enemy left" />
      <div style={dot(rightOn)} title="Enemy right" />
    </div>
  )
}

function StatBar({ label, value, color, format }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ width: 24, fontSize: 10, color: '#aaa' }}>{label}</span>
      <div style={{
        flex: 1, height: 8,
        background: 'rgba(255,255,255,0.1)',
        borderRadius: 4, overflow: 'hidden',
      }}>
        <div style={{
          width: `${value}%`, height: '100%',
          background: color,
          transition: 'width 0.3s',
          borderRadius: 4,
        }} />
      </div>
      <span style={{ minWidth: 44, fontSize: 10, textAlign: 'right', color }}>
        {format ? format(value) : Math.round(value)}
      </span>
    </div>
  )
}


function getCompassDir(radians) {
  const deg = ((radians * 180 / Math.PI) % 360 + 360) % 360
  if (deg < 22.5  || deg >= 337.5) return 'N'
  if (deg < 67.5)  return 'NE'
  if (deg < 112.5) return 'E'
  if (deg < 157.5) return 'SE'
  if (deg < 202.5) return 'S'
  if (deg < 247.5) return 'SW'
  if (deg < 292.5) return 'W'
  return 'NW'
}

const MAP_SIZE = 110 // canvas px
const MINIMAP_VIEW_RADIUS = 225 // world units (metres) visible from player centre

function Minimap({ player, allies, settlements, invasionPoint, abandonedVehicles }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const w = MAP_SIZE, h = MAP_SIZE

    ctx.clearRect(0, 0, w, h)

    // Draw land (green) / water (blue) background at half resolution for performance
    const px = player.position.x, pz = player.position.z
    const imgData = ctx.createImageData(w, h)
    const d = imgData.data
    const step = 2  // sample every 2 px, fill 2×2 blocks
    for (let py = 0; py < h; py += step) {
      for (let mapX = 0; mapX < w; mapX += step) {
        // Skip pixels outside the circular minimap
        const dx = mapX - w / 2, dy = py - h / 2
        if (dx * dx + dy * dy > (w / 2) * (w / 2)) continue

        const wx = px + (mapX - w / 2) / (w / 2) * MINIMAP_VIEW_RADIUS
        const wz = pz + (py  - h / 2) / (h / 2) * MINIMAP_VIEW_RADIUS
        const hv = sampleHeight(wx, wz)

        let r, g, b
        if (hv <= 0) {
          // Water — black
          r = 0; g = 0; b = 0
        } else {
          // Land — black
          r = 0; g = 0; b = 0
        }

        for (let oy = 0; oy < step; oy++) {
          for (let ox = 0; ox < step; ox++) {
            const i = ((py + oy) * w + (mapX + ox)) * 4
            d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255
          }
        }
      }
    }
    ctx.putImageData(imgData, 0, 0)

    // Re-apply circular clip over the image
    ctx.save()
    ctx.beginPath()
    ctx.arc(w / 2, h / 2, w / 2, 0, Math.PI * 2)
    ctx.clip()

    // Subtle overlay so dots remain readable
    ctx.fillStyle = 'rgba(0,0,0,0.25)'
    ctx.fillRect(0, 0, w, h)

    // Player-centred world→minimap coordinate transform
    function worldToMap(wx, wz) {
      return {
        mx: w / 2 + (wx - px) / MINIMAP_VIEW_RADIUS * (w / 2),
        my: h / 2 + (wz - pz) / MINIMAP_VIEW_RADIUS * (h / 2),
      }
    }

    // Settlements — small white squares
    for (const s of (settlements ?? [])) {
      const { mx, my } = worldToMap(s.x, s.z)
      if (mx < 0 || mx > w || my < 0 || my > h) continue
      ctx.fillStyle = 'rgba(255,255,255,0.7)'
      ctx.fillRect(mx - 2, my - 2, 4, 4)
    }

    // All living allies (colour-coded by status)
    for (const ally of allies) {
      if (ally.status === 'dead') continue
      const { mx, my } = worldToMap(ally.location.x, ally.location.z)
      ctx.beginPath()
      ctx.arc(mx, my, 2, 0, Math.PI * 2)
      ctx.fillStyle = ally.status === 'recruited' ? '#3498db'
                    : ally.status === 'captured'  ? '#e67e22' : '#27ae60'
      ctx.fill()
    }

    // Invasion point — red downward triangle at the coastline
    if (invasionPoint) {
      const { mx, my } = worldToMap(invasionPoint.x, invasionPoint.z)
      const s = 4
      ctx.beginPath()
      ctx.moveTo(mx, my + s)
      ctx.lineTo(mx - s, my - s)
      ctx.lineTo(mx + s, my - s)
      ctx.closePath()
      ctx.fillStyle = '#e74c3c'
      ctx.fill()
    }

    // Abandoned vehicles
    for (const v of (abandonedVehicles ?? [])) {
      const { mx, my } = worldToMap(v.x, v.z)
      if (mx < 0 || mx > w || my < 0 || my > h) continue
      ctx.beginPath()
      ctx.arc(mx, my, 3, 0, Math.PI * 2)
      ctx.fillStyle = v.type === 'snowcat' ? '#f39c12' : '#7ec8e3'
      ctx.fill()
      ctx.strokeStyle = 'rgba(255,255,255,0.6)'
      ctx.lineWidth = 1
      ctx.stroke()
    }

    // Player dot + bearing arrow (always at centre)
    const rot = player.rotation?.y ?? 0
    const arrowLen = 7
    const ax = w / 2 - Math.sin(rot) * arrowLen
    const ay = h / 2 - Math.cos(rot) * arrowLen

    ctx.beginPath()
    ctx.arc(w / 2, h / 2, 3.5, 0, Math.PI * 2)
    ctx.fillStyle = '#f39c12'
    ctx.fill()

    ctx.beginPath()
    ctx.moveTo(w / 2, h / 2)
    ctx.lineTo(ax, ay)
    ctx.strokeStyle = '#f39c12'
    ctx.lineWidth = 1.5
    ctx.stroke()

    ctx.restore()

    // Border
    ctx.beginPath()
    ctx.arc(w / 2, h / 2, w / 2 - 1, 0, Math.PI * 2)
    ctx.strokeStyle = 'rgba(168,216,234,0.35)'
    ctx.lineWidth = 1.5
    ctx.stroke()

    // N label
    ctx.fillStyle = 'rgba(168,216,234,0.7)'
    ctx.font = 'bold 8px Courier New'
    ctx.textAlign = 'center'
    ctx.fillText('N', w / 2, 10)

  }, [player.position, player.rotation, allies, settlements, invasionPoint, abandonedVehicles])

  return (
    <canvas
      ref={canvasRef}
      width={MAP_SIZE}
      height={MAP_SIZE}
      style={{
        position: 'fixed',
        top: 12, left: 12,
        borderRadius: '50%',
        pointerEvents: 'none',
        zIndex: 110,
        opacity: 0.9,
      }}
    />
  )
}
