import React from 'react'
import { useGameStore } from '../store/gameStore.js'

function fmtTime(mins) {
  const h = Math.floor(mins / 60) % 24
  const m = Math.floor(mins % 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export function AllyRoster({ onBack, onProfile }) {
  const allies           = useGameStore(s => s.allies)
  const player           = useGameStore(s => s.player)
  const originalCharacter = useGameStore(s => s.originalCharacter)
  const reportTime       = useGameStore(s => s.reportTime)
  const activeAllyId     = useGameStore(s => s.activeAllyId)

  const recruited = allies.filter(a => a.status === 'recruited')

  // Roster: original player char first, then all recruited allies
  const roster = [
    {
      id: null,
      name: originalCharacter?.name ?? player.name,
      personalTime: player.personalTime ?? 720,
      stamina: player.stamina,
    },
    ...recruited,
  ]

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'linear-gradient(to bottom, #080f1c, #0d1f3a)',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      fontFamily: 'Courier New, monospace', color: '#a8d8ea',
      zIndex: 200, overflowY: 'auto', padding: '20px 0 32px',
    }}>
      <div style={{ fontSize: 10, letterSpacing: 6, color: '#446688', marginBottom: 4 }}>COMMAND</div>
      <div style={{ fontSize: 'clamp(18px, 4vw, 26px)', letterSpacing: 4, marginBottom: 6 }}>TEAM</div>

      {/* Team sync time */}
      <div style={{
        fontSize: 11, letterSpacing: 2, color: '#5577aa', marginBottom: 4,
      }}>NEXT SYNC  <span style={{ color: '#a8d8ea', fontWeight: 'bold' }}>{fmtTime(reportTime)}</span></div>
      <div style={{ fontSize: 9, color: '#446688', letterSpacing: 1, marginBottom: 24 }}>
        {roster.length} ACTIVE MEMBER{roster.length !== 1 ? 'S' : ''}
      </div>

      <div style={{ width: 'min(380px, 94vw)', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {roster.map(char => {
          const pt        = char.personalTime ?? 720
          const isFrozen  = pt >= reportTime
          const minsLeft  = reportTime - pt
          const approaching = minsLeft <= 15 && minsLeft > 0
          const isActive  = char.id === activeAllyId

          const borderColor = isFrozen   ? 'rgba(200,80,80,0.6)'
                            : approaching ? 'rgba(220,180,60,0.6)'
                            : 'rgba(168,216,234,0.3)'
          const bg = isFrozen ? 'rgba(50,20,20,0.9)' : 'rgba(14,30,56,0.9)'

          return (
            <button
              key={char.id ?? 'player'}
              onClick={() => onProfile(char.id)}
              style={{
                background: bg,
                border: `1px solid ${borderColor}`,
                borderRadius: 6,
                color: isFrozen ? '#dd8888' : '#a8d8ea',
                cursor: 'pointer', padding: '12px 16px',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                fontFamily: 'Courier New, monospace', textAlign: 'left',
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={{ fontSize: 12, letterSpacing: 2, fontWeight: 'bold' }}>{char.name}</span>
                <span style={{
                  fontSize: 9, letterSpacing: 1,
                  color: isFrozen ? 'rgba(220,100,100,0.8)' : approaching ? '#e6b020' : '#5577aa',
                }}>
                  {isActive ? 'ACTIVE · ' : ''}
                  {isFrozen ? 'FROZEN' : approaching ? `SYNC IN ${Math.round(minsLeft)}m` : 'READY'}
                </span>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{
                  fontSize: 15, letterSpacing: 2, fontWeight: 'bold',
                  fontVariantNumeric: 'tabular-nums',
                  color: isFrozen ? '#e05555' : approaching ? '#e6b020' : '#a8d8ea',
                }}>
                  {fmtTime(pt)}
                </div>
                <div style={{ fontSize: 9, color: '#446688', letterSpacing: 1, marginTop: 2 }}>
                  {isFrozen
                    ? `+${Math.round(pt - reportTime)}m OVER`
                    : `${Math.round(minsLeft)}m LEFT`}
                </div>
              </div>
            </button>
          )
        })}
      </div>

      <button
        onClick={onBack}
        style={{
          marginTop: 28, background: 'transparent',
          border: '1px solid rgba(168,216,234,0.3)', borderRadius: 4,
          color: '#5577aa', cursor: 'pointer', padding: '8px 28px',
          fontSize: 10, fontFamily: 'Courier New, monospace', letterSpacing: 2,
        }}
      >BACK</button>
    </div>
  )
}
