import React, { useRef, useEffect, useCallback, useState } from 'react'
import { useGameStore } from '../store/gameStore.js'
import { sampleHeight } from '../game/terrain.js'
const ISLAND_HALF = 2500


// Module-level island cache — survives component unmount/remount so the
// expensive sampleHeight loop only runs once per world seed, not on every map open.
let _islandCache = null
let _islandCacheSeed = null
let _islandCacheW = 0
let _islandCacheH = 0

export function StrategyMap({ onBack }) {
  const canvasRef = useRef(null)
  const player = useGameStore(s => s.player)
  const allies = useGameStore(s => s.allies)
  const settlements = useGameStore(s => s.settlements)
  const mastersStrength   = useGameStore(s => s.mastersStrength)
  const enemyMorale = useGameStore(s => s.enemyMorale)
  const collapseDay       = useGameStore(s => s.collapseDay)
  const capturedHeatMines = useGameStore(s => s.capturedHeatMines)
  const totalHeatMines    = useGameStore(s => s.totalHeatMines)
  const currentDay        = useGameStore(s => s.currentDay)
  const invasionPoint = useGameStore(s => s.invasionPoint)
  const abandonedVehicles = useGameStore(s => s.abandonedVehicles)
  const enemyVehicles = useGameStore(s => s.enemyVehicles)
  const capturedSettlements = useGameStore(s => s.capturedSettlements)
  const contestedSettlements = useGameStore(s => s.contestedSettlements)
  const worldSeed    = useGameStore(s => s.worldSeed)
  const activeAllyId = useGameStore(s => s.activeAllyId)
  const selectAlly = useGameStore(s => s.selectAlly)
  const selectedAlly = useGameStore(s => s.selectedAlly)
  const setUiMode = useGameStore(s => s.setUiMode)

  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [selectedSelf, setSelectedSelf] = useState(false)
  const [selectedSettlement, setSelectedSettlement] = useState(null)
  const tapCycleRef = useRef({ candidates: [], index: -1, wx: null, wz: null })
  const dragRef = useRef(null)
  const pinchRef = useRef(null)
  // island cache lives at module level — see _islandCache above
  const zoomRef = useRef(zoom)
  const panRef = useRef(pan)
  zoomRef.current = zoom
  panRef.current = pan

  // Transform: world → canvas. Zoom is centred on canvas centre.
  const worldToCanvas = useCallback((wx, wz, canvas) => {
    const w = canvas.width
    const h = canvas.height
    const cx0 = ((wx + ISLAND_HALF) / (ISLAND_HALF * 2)) * w
    const cy0 = ((wz + ISLAND_HALF) / (ISLAND_HALF * 2)) * h
    const cx = (cx0 - w / 2) * zoomRef.current + w / 2 + panRef.current.x
    const cy = (cy0 - h / 2) * zoomRef.current + h / 2 + panRef.current.y
    return { cx, cy }
  }, [])

  // Wheel zoom must be registered as native listener (passive:false) to call preventDefault
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const onWheel = e => {
      e.preventDefault()
      const factor = e.deltaY < 0 ? 1.2 : 1 / 1.2
      setZoom(z => Math.max(1, Math.min(8, z * factor)))
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')

    function draw() {
      const w = canvas.width
      const h = canvas.height
      ctx.clearRect(0, 0, w, h)

      // Island background — build once per seed/size; reuse on every subsequent draw and remount.
      if (!_islandCache || _islandCacheSeed !== worldSeed || _islandCacheW !== w || _islandCacheH !== h) {
        const island = document.createElement('canvas')
        island.width = w
        island.height = h
        const ic = island.getContext('2d')
        ic.fillStyle = '#081420'      // ocean
        ic.fillRect(0, 0, w, h)
        const STEP = 5               // px per sample — ~5 world-km resolution
        ic.fillStyle = '#1a2e1a'     // land
        for (let py = 0; py < h; py += STEP) {
          for (let px = 0; px < w; px += STEP) {
            const wx = (px / w) * (ISLAND_HALF * 2) - ISLAND_HALF
            const wz = (py / h) * (ISLAND_HALF * 2) - ISLAND_HALF
            if (sampleHeight(wx, wz) > 0) ic.fillRect(px, py, STEP + 1, STEP + 1)
          }
        }
        _islandCache = island
        _islandCacheSeed = worldSeed
        _islandCacheW = w
        _islandCacheH = h
      }

      // Draw island with zoom/pan applied (scales the cached bitmap)
      ctx.save()
      ctx.setTransform(zoom, 0, 0, zoom, pan.x + w / 2 * (1 - zoom), pan.y + h / 2 * (1 - zoom))
      ctx.drawImage(_islandCache, 0, 0)
      ctx.restore()

      // Grid lines (in screen space, faint)
      ctx.strokeStyle = 'rgba(168,216,234,0.05)'
      ctx.lineWidth = 1
      for (let i = 0; i <= 10; i++) {
        ctx.beginPath(); ctx.moveTo(w * i / 10, 0); ctx.lineTo(w * i / 10, h); ctx.stroke()
        ctx.beginPath(); ctx.moveTo(0, h * i / 10); ctx.lineTo(w, h * i / 10); ctx.stroke()
      }

      // Draw settlements (circles; colour shows ally status)
      for (const s of settlements) {
        const { cx, cy } = worldToCanvas(s.x, s.z, canvas)
        const isSelected = selectedSettlement?.id === s.id
        const hasHeatMine = s.buildings.includes('heat_mine')
        const r = (hasHeatMine ? 4 : 2) + (s.buildings.length - 1) * 0.5

        // Determine colour: invasion state overrides ally status
        const isCaptured = capturedSettlements.includes(s.id)
        const isContested = contestedSettlements.some(cs => cs.id === s.id)
        const residentAlly = s.allyId ? allies.find(a => a.id === s.allyId) : null
        let fill
        if (isCaptured) {
          fill = 'rgba(231,76,60,0.9)'
        } else if (isContested) {
          fill = 'rgba(230,126,34,0.9)'
        } else if (hasHeatMine) {
          fill = 'rgba(255,160,60,0.7)'
        } else if (residentAlly) {
          if (residentAlly.status === 'recruited') fill = 'rgba(52,152,219,0.85)'
          else if (residentAlly.status === 'captured') fill = 'rgba(230,126,34,0.85)'
          else fill = 'rgba(39,174,96,0.85)'
        } else {
          fill = 'rgba(200,200,200,0.45)'
        }

        if (isSelected) {
          ctx.beginPath()
          ctx.arc(cx, cy, r + 3, 0, Math.PI * 2)
          ctx.strokeStyle = '#f39c12'
          ctx.lineWidth = 1.5
          ctx.stroke()
        }

        ctx.beginPath()
        ctx.arc(cx, cy, r, 0, Math.PI * 2)
        ctx.fillStyle = fill
        ctx.fill()
      }

      // Invasion point — red triangle with label
      if (invasionPoint) {
        const { cx: ix, cy: iy } = worldToCanvas(invasionPoint.x, invasionPoint.z, canvas)
        const s = 7
        ctx.beginPath()
        ctx.moveTo(ix, iy + s)
        ctx.lineTo(ix - s, iy - s)
        ctx.lineTo(ix + s, iy - s)
        ctx.closePath()
        ctx.fillStyle = '#e74c3c'
        ctx.fill()
        ctx.fillStyle = '#e74c3c'
        ctx.font = 'bold 9px Courier New'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'bottom'
        ctx.fillText('INVASION', ix, iy - s - 2)
      }

      // Abandoned vehicles
      for (const v of (abandonedVehicles ?? [])) {
        const { cx: vx, cy: vy } = worldToCanvas(v.x, v.z, canvas)
        ctx.beginPath()
        ctx.arc(vx, vy, 5, 0, Math.PI * 2)
        ctx.fillStyle = '#ff8fab'
        ctx.fill()
        ctx.strokeStyle = '#fff'
        ctx.lineWidth = 1.5
        ctx.stroke()
        ctx.fillStyle = '#fff'
        ctx.font = 'bold 7px Courier New'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(v.type === 'snowcat' ? 'SC' : 'PM', vx, vy)
      }

      // Enemy vehicles — red diamond icons
      for (const v of (enemyVehicles ?? [])) {
        const { cx: ex, cy: ey } = worldToCanvas(v.x, v.z, canvas)
        const s2 = 6
        ctx.beginPath()
        ctx.moveTo(ex, ey - s2)
        ctx.lineTo(ex + s2, ey)
        ctx.lineTo(ex, ey + s2)
        ctx.lineTo(ex - s2, ey)
        ctx.closePath()
        ctx.fillStyle = 'rgba(231,76,60,0.85)'
        ctx.fill()
        ctx.strokeStyle = '#fff'
        ctx.lineWidth = 1
        ctx.stroke()
        ctx.fillStyle = '#fff'
        ctx.font = 'bold 6px Courier New'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText('E', ex, ey)
      }

      // All allies — coloured by status, except the active one (shown as player marker)
      const ALLY_COLOURS = {
        free:      'rgba(39,174,96,0.85)',
        recruited: 'rgba(52,152,219,0.85)',
        captured:  'rgba(230,126,34,0.85)',
      }
      for (const a of (allies ?? [])) {
        if (a.id === activeAllyId) continue   // active character shown as player marker
        if (!a.location) continue
        const { cx: ax, cy: ay } = worldToCanvas(a.location.x, a.location.z, canvas)
        ctx.beginPath()
        ctx.arc(ax, ay, 6, 0, Math.PI * 2)
        ctx.fillStyle = ALLY_COLOURS[a.status] ?? 'rgba(39,174,96,0.85)'
        ctx.fill()
        ctx.strokeStyle = '#fff'
        ctx.lineWidth = 1.5
        ctx.stroke()
        ctx.fillStyle = '#fff'
        ctx.font = 'bold 7px Courier New'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(a.name.charAt(0).toUpperCase(), ax, ay)
      }

      // Draw player position (active character)
      const { cx: plx, cy: ply } = worldToCanvas(player.position.x, player.position.z, canvas)
      ctx.beginPath()
      ctx.arc(plx, ply, 8, 0, Math.PI * 2)
      ctx.fillStyle = '#f39c12'
      ctx.fill()
      ctx.strokeStyle = '#fff'
      ctx.lineWidth = 2
      ctx.stroke()

      const rot = player.rotation?.y ?? 0
      ctx.beginPath()
      ctx.moveTo(plx, ply)
      ctx.lineTo(plx - Math.sin(rot) * 14, ply - Math.cos(rot) * 14)
      ctx.strokeStyle = '#f39c12'
      ctx.lineWidth = 2
      ctx.stroke()

      // North indicator (always in screen corner)
      ctx.fillStyle = '#e74c3c'
      ctx.font = 'bold 12px Courier New'
      ctx.textAlign = 'left'
      ctx.textBaseline = 'top'
      ctx.fillText('N', 8, 8)
      ctx.beginPath()
      ctx.moveTo(20, 25); ctx.lineTo(20, 8)
      ctx.strokeStyle = '#e74c3c'
      ctx.lineWidth = 2
      ctx.stroke()
    }

    draw()
  }, [player, allies, activeAllyId, settlements, worldSeed, invasionPoint, abandonedVehicles, enemyVehicles, capturedSettlements, contestedSettlements, selectedAlly, selectedSettlement, worldToCanvas, zoom, pan])

  function handleTap(e) {
    const canvas = canvasRef.current
    if (!canvas) return

    const rect = canvas.getBoundingClientRect()
    const tapX = (e.clientX ?? e.touches?.[0]?.clientX) - rect.left
    const tapY = (e.clientY ?? e.touches?.[0]?.clientY) - rect.top

    const w = canvas.width, h = canvas.height

    // Reverse the zoom/pan transform to get base canvas coords
    const cx0 = (tapX - pan.x - w / 2) / zoom + w / 2
    const cy0 = (tapY - pan.y - h / 2) / zoom + h / 2

    // Convert base canvas coords to world coords
    const wx = (cx0 / w) * (ISLAND_HALF * 2) - ISLAND_HALF
    const wz = (cy0 / h) * (ISLAND_HALF * 2) - ISLAND_HALF

    const TAP_RADIUS = (ISLAND_HALF * 2 / w) * 28 / zoom // 28 canvas px in world units

    // Collect all candidates within tap radius, sorted by distance
    const candidates = []

    const playerDist = Math.hypot(player.position.x - wx, player.position.z - wz)
    if (playerDist < TAP_RADIUS) candidates.push({ type: 'self', dist: playerDist })

    for (const s of settlements) {
      const d = Math.hypot(s.x - wx, s.z - wz)
      if (d < TAP_RADIUS) candidates.push({ type: 'settlement', item: s, dist: d })
    }

    candidates.sort((a, b) => a.dist - b.dist)

    if (candidates.length === 0) {
      // Deselect
      tapCycleRef.current = { candidates: [], index: -1, wx: null, wz: null }
      setSelectedSelf(false)
      selectAlly(null)
      setSelectedSettlement(null)
      return
    }

    const prev = tapCycleRef.current
    const SAME_SPOT = TAP_RADIUS * 1.5
    const isSameSpot = prev.wx !== null &&
      Math.hypot(prev.wx - wx, prev.wz - wz) < SAME_SPOT &&
      prev.candidates.length === candidates.length

    const nextIndex = isSameSpot ? (prev.index + 1) % candidates.length : 0
    tapCycleRef.current = { candidates, index: nextIndex, wx, wz }

    const chosen = candidates[nextIndex]
    setSelectedSelf(false)
    selectAlly(null)
    setSelectedSettlement(null)

    if (chosen.type === 'self') {
      setSelectedSelf(true)
    } else if (chosen.type === 'settlement') {
      setSelectedSettlement(chosen.item)
    }
  }

  function handleMouseDown(e) {
    dragRef.current = { startX: e.clientX, startY: e.clientY, startPan: { ...panRef.current } }
  }

  function handleMouseMove(e) {
    if (!dragRef.current) return
    setPan({
      x: dragRef.current.startPan.x + e.clientX - dragRef.current.startX,
      y: dragRef.current.startPan.y + e.clientY - dragRef.current.startY,
    })
  }

  function handleMouseUp() { dragRef.current = null }

  function handleTouchStartMap(e) {
    if (e.touches.length === 2) {
      const d = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY,
      )
      pinchRef.current = { dist: d, zoom: zoomRef.current }
    } else if (e.touches.length === 1) {
      dragRef.current = {
        startX: e.touches[0].clientX,
        startY: e.touches[0].clientY,
        startPan: { ...panRef.current },
      }
    }
  }

  function handleTouchMoveMap(e) {
    e.preventDefault()
    if (e.touches.length === 2 && pinchRef.current) {
      const canvas = canvasRef.current
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      const d = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY,
      )
      const oldZoom = zoomRef.current
      const newZoom = Math.max(1, Math.min(8, pinchRef.current.zoom * (d / pinchRef.current.dist)))

      // Pinch midpoint in canvas-local coords
      const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left
      const my = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top
      const w = canvas.width, h = canvas.height

      // Keep the pinch midpoint fixed: adjust pan so same world point stays under fingers
      const oldPan = panRef.current
      const txOld = oldPan.x + w / 2 * (1 - oldZoom)
      const tyOld = oldPan.y + h / 2 * (1 - oldZoom)
      const txNew = mx - (mx - txOld) * (newZoom / oldZoom)
      const tyNew = my - (my - tyOld) * (newZoom / oldZoom)
      const newPan = {
        x: txNew - w / 2 * (1 - newZoom),
        y: tyNew - h / 2 * (1 - newZoom),
      }

      setZoom(newZoom)
      setPan(newPan)
    } else if (e.touches.length === 1 && dragRef.current) {
      setPan({
        x: dragRef.current.startPan.x + e.touches[0].clientX - dragRef.current.startX,
        y: dragRef.current.startPan.y + e.touches[0].clientY - dragRef.current.startY,
      })
    }
  }

  function handleTouchEndMap() {
    pinchRef.current = null
    dragRef.current = null
  }

  function resetView() { setZoom(1); setPan({ x: 0, y: 0 }) }

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: '#0a1628',
      display: 'flex', flexDirection: 'column',
      fontFamily: 'Courier New, monospace',
      zIndex: 50,
    }}>
      {/* Top bar */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '8px 16px',
        borderBottom: '1px solid rgba(168,216,234,0.3)',
        color: '#a8d8ea', fontSize: 12,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <span><span style={{ color: '#aaa' }}>DAY </span>{currentDay}</span>
          <span>
            <span style={{ color: '#aaa' }}>COLLAPSE </span>
            <span style={{ color: currentDay >= collapseDay - 5 ? '#e74c3c' : '#f39c12' }}>DAY {collapseDay}</span>
          </span>
          <span>
            <span style={{ color: '#aaa' }}>ENEMY MORALE </span>
            <span style={{ color: enemyMorale <= 30 ? '#27ae60' : enemyMorale <= 60 ? '#f39c12' : '#e74c3c' }}>
              {enemyMorale}%
            </span>
          </span>
          {totalHeatMines > 0 && (
            <span>
              <span style={{ color: '#aaa' }}>MINES </span>
              <span style={{ color: capturedHeatMines > 0 ? '#e74c3c' : '#a8d8ea' }}>
                {totalHeatMines - capturedHeatMines}/{totalHeatMines}
              </span>
            </span>
          )}
        </div>
        <button
          onClick={onBack ?? (() => setUiMode('hub'))}
          style={{
            background: 'rgba(168,216,234,0.1)',
            border: '1px solid rgba(168,216,234,0.3)',
            color: '#a8d8ea', cursor: 'pointer',
            padding: '4px 12px', borderRadius: 4, fontSize: 11,
          }}
        >◀ BACK</button>
      </div>

      {/* Map canvas */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <canvas
          ref={canvasRef}
          width={window.innerWidth}
          height={window.innerHeight - 120}
          onClick={handleTap}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onTouchStart={e => { handleTouchStartMap(e); if (e.touches.length > 1) e.preventDefault() }}
          onTouchMove={handleTouchMoveMap}
          onTouchEnd={handleTouchEndMap}
          style={{ display: 'block', cursor: 'crosshair', touchAction: 'none' }}
        />

        {/* Zoom controls */}
        <div style={{
          position: 'absolute', top: 8, right: 8,
          display: 'flex', flexDirection: 'column', gap: 4,
        }}>
          {[
            { label: '+', action: () => setZoom(z => Math.min(8, z * 1.4)) },
            { label: '−', action: () => setZoom(z => Math.max(1, z / 1.4)) },
            { label: '⌂', action: resetView },
          ].map(({ label, action }) => (
            <button key={label} onClick={action} style={zoomBtnStyle}>{label}</button>
          ))}
          <div style={{ fontSize: 9, color: 'rgba(168,216,234,0.5)', textAlign: 'center', marginTop: 2 }}>
            {zoom.toFixed(1)}x
          </div>
        </div>

        {/* Legend */}
        <div style={{
          position: 'absolute', bottom: 8, left: 8,
          background: 'rgba(10,22,40,0.8)',
          border: '1px solid rgba(168,216,234,0.2)',
          borderRadius: 4, padding: '4px 8px',
          fontSize: 9, color: '#a8d8ea',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span>🟡 You</span>
            {[
              ['rgba(200,200,200,0.6)',  'Settlement'],
              ['rgba(255,160,60,0.8)',   'Heat mine'],
              ['rgba(39,174,96,0.85)',   'Ally'],
              ['rgba(52,152,219,0.85)',  'Recruited ally'],
              ['rgba(231,76,60,0.9)',    'Captured settlement'],
              ['rgba(255,143,171,0.9)', 'Abandoned vehicle'],
            ].map(([fill, label]) => (
              <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                <svg width="10" height="10"><circle cx="5" cy="5" r="4" fill={fill}/></svg>
                {label}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Player info */}
      {selectedSelf && !selectedAlly && (
        <div style={{
          padding: '8px 16px',
          background: 'rgba(15,30,55,0.97)',
          borderTop: '1px solid rgba(168,216,234,0.3)',
          color: '#a8d8ea', fontSize: 11,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <div>
            <div style={{ fontWeight: 'bold', color: '#f39c12' }}>
              {player.name} <span style={{ color: '#aaa', fontWeight: 'normal' }}>[YOU]</span>
            </div>
            <div style={{ color: '#aaa', marginTop: 4, fontSize: 10 }}>
              Stamina: {Math.round(player.stamina)}
            </div>
            {player.relationships?.length > 0 && (
              <div style={{ marginTop: 6, fontSize: 10 }}>
                <span style={{ color: '#aaa' }}>Known: </span>
                {player.relationships.slice(0, 6).map(rel => {
                  const person = allies.find(a => a.id === rel.allyId)
                  if (!person) return null
                  return (
                    <span key={rel.allyId} style={{ marginRight: 8, color: rel.trust > 0 ? '#27ae60' : '#e74c3c' }}>
                      {person.name} ({rel.trust > 0 ? '+' : ''}{rel.trust})
                    </span>
                  )
                })}
              </div>
            )}
          </div>
          <button onClick={() => setSelectedSelf(false)} style={{ background: 'none', border: '1px solid rgba(168,216,234,0.3)', color: '#a8d8ea', cursor: 'pointer', padding: '2px 8px', borderRadius: 4, fontSize: 11 }}>✕</button>
        </div>
      )}

      {/* Selected ally info */}
      {selectedAlly && (
        <div style={{
          padding: '8px 16px',
          background: 'rgba(15,30,55,0.97)',
          borderTop: '1px solid rgba(168,216,234,0.3)',
          color: '#a8d8ea', fontSize: 11,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <div>
            <div style={{ fontWeight: 'bold', color: '#a8d8ea' }}>{selectedAlly.name}</div>
            <div style={{ color: '#aaa', marginTop: 4, fontSize: 10 }}>
              Status: {selectedAlly.status} | Morale: {selectedAlly.morale}
              {selectedAlly.specialItem && <span> | Item: {selectedAlly.specialItem.replace('_', ' ')}</span>}
            </div>
          </div>
          {selectedAlly.status === 'free' && (
            <div style={{ fontSize: 9, color: '#80ee80', textAlign: 'right', letterSpacing: 1 }}>
              VISIT POLICE STATION
            </div>
          )}
          {selectedAlly.status === 'captured' && (
            <div style={{ fontSize: 9, color: '#e05555', textAlign: 'right', letterSpacing: 1 }}>
              DESTROY STATION TO RESCUE
            </div>
          )}
        </div>
      )}

      {/* Selected settlement info */}
      {selectedSettlement && !selectedAlly && (
        <div style={{
          padding: '8px 16px',
          background: 'rgba(15,30,55,0.97)',
          borderTop: '1px solid rgba(168,216,234,0.3)',
          color: '#a8d8ea', fontSize: 11,
          display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
        }}>
          <div>
            <div style={{ fontWeight: 'bold', color: '#a8d8ea', marginBottom: 4 }}>
              SETTLEMENT
            </div>
            <div style={{ color: '#ccc', marginBottom: 4 }}>
              <span style={{ color: '#888' }}>Buildings: </span>
              {selectedSettlement.buildings.map(b => b.replace(/_/g, ' ')).join('  ·  ')}
            </div>
            {(() => {
              const here = allies.filter(a => a.location && Math.hypot(a.location.x - selectedSettlement.x, a.location.z - selectedSettlement.z) < 55 && a.status !== 'dead')
              return here.length > 0 ? (
                <div>
                  <span style={{ color: '#888' }}>People: </span>
                  {here.map(a => (
                    <span key={a.id} style={{ marginRight: 10, color: a.status === 'recruited' ? '#3498db' : '#27ae60' }}>
                      {a.name}
                    </span>
                  ))}
                </div>
              ) : <div style={{ color: '#555' }}>No known contacts here</div>
            })()}
          </div>
          <button onClick={() => setSelectedSettlement(null)} style={{ background: 'none', border: '1px solid rgba(168,216,234,0.3)', color: '#a8d8ea', cursor: 'pointer', padding: '2px 8px', borderRadius: 4, fontSize: 11 }}>✕</button>
        </div>
      )}

    </div>
  )
}

function actionBtnStyle(bg) {
  return {
    background: bg, border: 'none', borderRadius: 4,
    color: '#fff', cursor: 'pointer',
    padding: '6px 12px', fontSize: 11,
    fontFamily: 'Courier New, monospace',
  }
}

const zoomBtnStyle = {
  width: 28, height: 28,
  background: 'rgba(10,22,40,0.85)',
  border: '1px solid rgba(168,216,234,0.3)',
  borderRadius: 4, color: '#a8d8ea',
  cursor: 'pointer', fontSize: 16, lineHeight: '1',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  fontFamily: 'Courier New, monospace',
}
