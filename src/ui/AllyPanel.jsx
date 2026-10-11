import React, { useEffect, useRef } from 'react'
import { useGameStore } from '../store/gameStore.js'

export function AllyPanel() {
  const ally            = useGameStore(s => s.selectedAlly)
  const allies          = useGameStore(s => s.allies)
  const player          = useGameStore(s => s.player)
  const settlements     = useGameStore(s => s.settlements)
  const recruitedAllies = useGameStore(s => s.recruitedAllies)
  const capturedSettlements = useGameStore(s => s.capturedSettlements)
  const selectAlly      = useGameStore(s => s.selectAlly)

  const graphRef = useRef(null)

  useEffect(() => {
    if (ally && graphRef.current) {
      drawRelationshipGraph(graphRef.current, ally, allies, player)
    }
  }, [ally, allies, player])

  if (!ally) return null

  const isRecruited = recruitedAllies.includes(ally.id)
  const station = settlements.find(s => s.allyId === ally.id)
  const stationCaptured = station ? capturedSettlements.includes(station.id) : false

  const dist = Math.hypot(
    player.position.x - ally.location.x,
    player.position.z - ally.location.z
  )

  const statusColor = {
    free: '#27ae60', recruited: '#3498db',
    captured: '#e67e22', dead: '#e74c3c',
  }[ally.status] ?? '#aaa'

  return (
    <div style={{
      position: 'fixed', right: 0, top: 0, bottom: 0, width: 280,
      background: 'linear-gradient(to bottom, rgba(10,22,40,0.97), rgba(15,30,55,0.97))',
      borderLeft: '1px solid rgba(168,216,234,0.3)',
      padding: 16,
      overflowY: 'auto',
      fontFamily: 'Courier New, monospace',
      color: '#a8d8ea',
      fontSize: 12,
      zIndex: 200,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <div style={{ fontSize: 16, fontWeight: 'bold', color: '#fff' }}>{ally.name}</div>
        <button
          onClick={() => selectAlly(null)}
          style={{
            background: 'none', border: '1px solid rgba(168,216,234,0.3)',
            color: '#a8d8ea', cursor: 'pointer', padding: '2px 8px', borderRadius: 4,
            fontSize: 11,
          }}
        >✕</button>
      </div>

      <div style={{ marginBottom: 12 }}>
        <span style={{ color: statusColor, fontWeight: 'bold', textTransform: 'uppercase', fontSize: 11 }}>
          ● {ally.status}
        </span>
        <span style={{ marginLeft: 12, color: '#aaa', fontSize: 11 }}>
          {Math.round(dist / 1000)}km away
        </span>
      </div>

      {ally.specialItem && (
        <div style={{ marginBottom: 10, padding: '4px 8px', background: 'rgba(168,216,234,0.1)', borderRadius: 4 }}>
          <span style={{ fontSize: 10, color: '#aaa' }}>CARRIES: </span>
          <span style={{ color: '#f39c12', textTransform: 'uppercase', fontSize: 11 }}>
            {ally.specialItem.replace(/_/g, ' ')}
          </span>
        </div>
      )}

      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 10, color: '#aaa', marginBottom: 4 }}>MORALE</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ flex: 1, height: 8, background: 'rgba(255,255,255,0.1)', borderRadius: 4 }}>
            <div style={{
              width: `${ally.morale}%`, height: '100%', borderRadius: 4,
              background: ally.morale > 60 ? '#27ae60' : ally.morale > 30 ? '#e67e22' : '#e74c3c',
            }} />
          </div>
          <span style={{ fontSize: 11 }}>{ally.morale}</span>
        </div>
      </div>

      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 10, color: '#aaa', marginBottom: 6, textTransform: 'uppercase' }}>Relationships</div>
        <canvas
          ref={graphRef}
          width={248} height={120}
          style={{ border: '1px solid rgba(168,216,234,0.2)', borderRadius: 4 }}
        />
      </div>

      {isRecruited && (
        <div style={{ fontSize: 11, color: '#3498db', textAlign: 'center', marginTop: 4 }}>
          ✓ Recruited
        </div>
      )}

      {!isRecruited && ally.status === 'free' && (
        <div style={{
          padding: '10px 12px', borderRadius: 4,
          background: 'rgba(39,174,96,0.1)',
          border: '1px solid rgba(39,174,96,0.4)',
          color: '#80ee80', fontSize: 10, textAlign: 'center', letterSpacing: 1,
        }}>
          AT POLICE STATION — visit to recruit (100%)
        </div>
      )}

      {ally.status === 'captured' && (
        <div style={{
          padding: '10px 12px', borderRadius: 4,
          background: 'rgba(231,76,60,0.1)',
          border: '1px solid rgba(231,76,60,0.4)',
          color: '#e74c3c', fontSize: 10, textAlign: 'center', letterSpacing: 1,
        }}>
          ENEMY HELD — destroy their station to rescue
        </div>
      )}
    </div>
  )
}

function actionButtonStyle(bg) {
  return {
    background: bg,
    border: 'none', borderRadius: 4,
    color: '#fff', cursor: 'pointer',
    padding: '8px 12px',
    fontSize: 12,
    fontFamily: 'Courier New, monospace',
    textAlign: 'center',
  }
}

function drawRelationshipGraph(canvas, focusAlly, allAllies, player) {
  const ctx = canvas.getContext('2d')
  const w = canvas.width, h = canvas.height
  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = 'rgba(10,22,40,0.5)'
  ctx.fillRect(0, 0, w, h)

  if (!focusAlly.relationships?.length) {
    ctx.fillStyle = '#aaa'
    ctx.font = '11px Courier New'
    ctx.fillText('No known relationships', 10, h / 2)
    return
  }

  const cx = w / 2, cy = h / 2
  const radius = Math.min(w, h) * 0.35
  const rels = focusAlly.relationships.slice(0, 8)

  rels.forEach((rel, i) => {
    const angle = (i / rels.length) * Math.PI * 2
    const nx = cx + Math.cos(angle) * radius
    const ny = cy + Math.sin(angle) * radius

    ctx.beginPath()
    ctx.moveTo(cx, cy)
    ctx.lineTo(nx, ny)
    ctx.strokeStyle = rel.trust > 0
      ? `rgba(39,174,96,${0.3 + rel.trust / 200})`
      : `rgba(231,76,60,${0.3 + Math.abs(rel.trust) / 200})`
    ctx.lineWidth = 1 + Math.abs(rel.trust) / 50
    ctx.stroke()

    ctx.beginPath()
    ctx.arc(nx, ny, 5, 0, Math.PI * 2)
    ctx.fillStyle = rel.trust > 0 ? '#27ae60' : '#e74c3c'
    ctx.fill()

    const person = rel.allyId === 'player'
      ? player
      : allAllies.find(a => a.id === rel.allyId)
    if (person) {
      ctx.fillStyle = '#a8d8ea'
      ctx.font = '8px Courier New'
      const name = person.name
      ctx.fillText(name, nx - name.length * 2.5, ny + 14)
    }
  })

  ctx.beginPath()
  ctx.arc(cx, cy, 8, 0, Math.PI * 2)
  ctx.fillStyle = '#a8d8ea'
  ctx.fill()
}
