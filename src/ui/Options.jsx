import React, { useState } from 'react'
import { useSettings } from '../store/settingsStore.js'

// Options page, opened from the title screen and the Team screen.
// audio: the game's AudioManager, used by the test buttons.
export function Options({ audio, onBack }) {
  const soundStyle    = useSettings(s => s.soundStyle)
  const setSoundStyle = useSettings(s => s.setSoundStyle)
  const [testMsg, setTestMsg] = useState(null)

  async function test(kind) {
    setTestMsg(null)
    const ok = await audio?.preview(kind, soundStyle)
    if (ok === false) setTestMsg(soundStyle === 'recorded'
      ? 'Recorded sounds could not be loaded. The game will use Classic.'
      : 'Sound is not available in this browser.')
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 300,
      background: 'linear-gradient(to bottom, #080f1c, #0d1f3a)',
      fontFamily: 'Courier New, monospace', color: '#a8d8ea',
      overflowY: 'auto', padding: '24px 16px 40px',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
    }}>
      <div style={{ width: 'min(420px, 100%)', textAlign: 'left' }}>
        <div style={{ fontSize: 10, letterSpacing: 6, color: '#446688', textAlign: 'center' }}>FROSTHOLD</div>
        <div style={{ fontSize: 22, letterSpacing: 4, textAlign: 'center', margin: '6px 0 20px', color: '#fff' }}>OPTIONS</div>

        <div style={{
          background: 'rgba(14,30,56,0.85)', border: '1px solid rgba(168,216,234,0.25)',
          borderRadius: 6, padding: '12px 14px', marginBottom: 12,
          fontSize: 12, lineHeight: 1.6, color: '#c8dde8',
        }}>
          <div style={{ fontSize: 10, letterSpacing: 3, color: '#7aaccc', fontWeight: 'bold', marginBottom: 8 }}>SOUND EFFECTS</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Choice selected={soundStyle === 'recorded'} onClick={() => setSoundStyle('recorded')}
              title="RECORDED" text="Real recordings: wind, skis, engines, weapons and explosions." />
            <Choice selected={soundStyle === 'classic'} onClick={() => setSoundStyle('classic')}
              title="CLASSIC" text="The original synthesised sounds." />
          </div>

          <div style={{ fontSize: 10, letterSpacing: 2, color: '#5577aa', margin: '14px 0 6px' }}>TEST</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {[['gun', 'GUN'], ['missile', 'MISSILE'], ['explosion', 'EXPLOSION'], ['enemy', 'ENEMY FIRE'], ['crash', 'CRASH']].map(([k, label]) => (
              <button key={k} onClick={() => test(k)} style={{
                background: 'transparent', border: '1px solid rgba(168,216,234,0.4)',
                borderRadius: 4, color: '#a8d8ea', cursor: 'pointer', padding: '6px 10px',
                fontSize: 10, fontFamily: 'Courier New, monospace', letterSpacing: 2,
              }}>{label}</button>
            ))}
          </div>
          {testMsg && <div style={{ marginTop: 8, fontSize: 11, color: '#ee8080' }}>{testMsg}</div>}
        </div>

        <button onClick={onBack} style={{
          display: 'block', margin: '24px auto 0', width: 220,
          background: 'rgba(14,30,56,0.8)', border: '2px solid rgba(168,216,234,0.5)',
          color: '#a8d8ea', cursor: 'pointer', padding: '12px 0', borderRadius: 4,
          fontSize: 14, fontFamily: 'Courier New, monospace', letterSpacing: 3,
        }}>BACK</button>
      </div>
    </div>
  )
}

function Choice({ selected, onClick, title, text }) {
  return (
    <button onClick={onClick} aria-pressed={selected} style={{
      display: 'flex', alignItems: 'flex-start', gap: 10, textAlign: 'left',
      background: selected ? 'rgba(40,80,120,0.6)' : 'rgba(10,22,40,0.6)',
      border: `1px solid ${selected ? '#a8d8ea' : 'rgba(168,216,234,0.25)'}`,
      borderRadius: 4, padding: '8px 10px', cursor: 'pointer',
      fontFamily: 'Courier New, monospace', color: '#c8dde8',
    }}>
      <span style={{ fontSize: 14, color: selected ? '#80ee80' : '#446688', lineHeight: 1.2 }}>{selected ? '●' : '○'}</span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 12, letterSpacing: 3, fontWeight: 'bold', color: selected ? '#fff' : '#a8d8ea' }}>{title}</span>
        <span style={{ fontSize: 11, lineHeight: 1.5 }}>{text}</span>
      </span>
    </button>
  )
}
