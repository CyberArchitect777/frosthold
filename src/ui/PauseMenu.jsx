import React from 'react'
import { useGameStore } from '../store/gameStore.js'

export function PauseMenu() {
  const isPaused = useGameStore(s => s.isPaused)
  const togglePause = useGameStore(s => s.togglePause)
  const newGame = useGameStore(s => s.newGame)
  const currentDay = useGameStore(s => s.currentDay)
  const player = useGameStore(s => s.player)
  const allies = useGameStore(s => s.allies)
  const recruitedAllies = useGameStore(s => s.recruitedAllies)

  if (!isPaused) return null

  const recruited = recruitedAllies.length
  const total = allies.length

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'rgba(0,0,0,0.85)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 400,
      fontFamily: 'Courier New, monospace',
    }}>
      <div style={{
        background: 'linear-gradient(to bottom, rgba(15,30,55,0.99), rgba(10,22,40,0.99))',
        border: '1px solid rgba(168,216,234,0.3)',
        borderRadius: 8, padding: 32, width: 320,
        textAlign: 'center', color: '#a8d8ea',
      }}>
        <div style={{ fontSize: 24, fontWeight: 'bold', color: '#fff', marginBottom: 4 }}>
          FROSTHOLD
        </div>
        <div style={{ fontSize: 11, color: '#aaa', marginBottom: 24 }}>— PAUSED —</div>

        {/* Stats summary */}
        <div style={{
          background: 'rgba(168,216,234,0.05)',
          border: '1px solid rgba(168,216,234,0.15)',
          borderRadius: 6, padding: 12, marginBottom: 24,
          textAlign: 'left', fontSize: 11,
        }}>
          <StatLine label="Day" value={currentDay} />
          <StatLine label="Health" value={`${Math.round(player.health)}%`} />
          <StatLine label="Stamina" value={`${Math.round(player.stamina)}%`} />
          <StatLine label="Reputation" value={player.reputation} />
          <StatLine label="Allies recruited" value={`${recruited} / ${total}`} />
        </div>

        {/* Menu buttons */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <MenuButton onClick={togglePause} bg="#27ae60">
            ▶ Resume
          </MenuButton>

          <MenuButton onClick={() => {
            if (window.confirm('Start a new game? Current progress will be lost.')) {
              newGame()
              togglePause()
            }
          }} bg="#3498db">
            New Game
          </MenuButton>

          <div style={{ fontSize: 10, color: '#666', marginTop: 8 }}>
            <div>WASD / Arrow Keys — Move</div>
            <div>Mouse — Look around (click to lock)</div>
            <div>Tab — Strategy Map</div>
            <div>E — Interact</div>
            <div>Esc — Pause / Unpause</div>
          </div>
        </div>
      </div>
    </div>
  )
}

function StatLine({ label, value, valueColor = '#a8d8ea' }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
      <span style={{ color: '#888' }}>{label}</span>
      <span style={{ color: valueColor, fontWeight: 'bold' }}>{value}</span>
    </div>
  )
}

function MenuButton({ children, onClick, bg }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: bg, border: 'none', borderRadius: 4,
        color: '#fff', cursor: 'pointer',
        padding: '10px 16px', fontSize: 14,
        fontFamily: 'Courier New, monospace',
        width: '100%',
      }}
    >{children}</button>
  )
}
