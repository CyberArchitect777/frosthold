import React from 'react'

// "How to play" page, opened from the title screen
export function Guide({ onBack }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 300,
      background: 'linear-gradient(to bottom, #080f1c, #0d1f3a)',
      fontFamily: 'Courier New, monospace', color: '#a8d8ea',
      overflowY: 'auto', padding: '24px 16px 40px',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
    }}>
      <div style={{ width: 'min(560px, 100%)', textAlign: 'left' }}>
        <div style={{ fontSize: 10, letterSpacing: 6, color: '#446688', textAlign: 'center' }}>FROSTHOLD</div>
        <div style={{ fontSize: 22, letterSpacing: 4, textAlign: 'center', margin: '6px 0 20px', color: '#fff' }}>HOW TO PLAY</div>

        <Section title="YOUR OBJECTIVE">
          <p>A powerful warlord has invaded the island to seize its valuable heat mines. His army is far too strong to defeat in conventional combat, so your objective is to lead a resistance campaign, disrupting his operations and gradually weakening his determination to continue the invasion.</p>
          <Rows rows={[
            ['Victory', 'Reduce enemy morale to zero or survive until the enemy\'s collapse day, initially set to day 40.'],
            ['Defeat', 'Lose control of every heat mine or have no team members left free.'],
          ]} />
          <p>Destroying enemy vehicles, sabotaging facilities and rescuing prisoners will weaken enemy morale and bring the collapse day closer. However, every heat mine captured by the enemy will strengthen his position and delay his withdrawal.</p>
        </Section>

        <Section title="HOW TIME WORKS">
          <p>Each character operates independently, with their own watch and available time.</p>
          <p>In the 3D view, time passes at a rate of one game minute per real second. Each character has two game hours (two real minutes) available during each period. Once their time has expired, they cannot act again until the watches are synchronised.</p>
          <p>Select <b>SYNC WATCHES</b> from the Team screen to advance to the next period. This allows the enemy to make their moves, provides some recovery for your team at their current locations and generates a <b>situation report</b> summarising recent developments.</p>
          <p>You can then review the situation and plan your next moves.</p>
        </Section>

        <Section title="GETTING STARTED">
          <ol style={{ margin: 0, paddingLeft: 18 }}>
            <li><b>Select your character.</b> From the Team screen, select your character to open their profile, then choose <b>CONTINUE</b> to enter the 3D world.</li>
            <li><b>Recruit additional team members.</b> Open <b>VIEW MAP</b> and locate the nearest police station. Travel there on skis and recruit the officer, who will always agree to join your resistance. Each additional character provides another watch, allowing more actions during each period.</li>
            <li><b>Monitor enemy movements.</b> Red diamonds on the map indicate enemy vehicles. Settlements under siege display a counter, such as 3/6, showing how far the siege has progressed. Once the counter reaches its limit, the settlement falls.</li>
            <li><b>Defend settlements.</b> Locate and approach enemy vehicles involved in sieges. Destroying a besieging vehicle will break the siege and prevent the settlement from falling.</li>
            <li><b>Gather supplies and sabotage facilities.</b> Visit stores and magazines to replenish your equipment. Magazines also contain dynamite, which can be used to destroy factories before the enemy captures them. Factories that fall into enemy hands can produce additional vehicles for the invasion.</li>
            <li><b>Synchronise your watches.</b> Before all your characters have exhausted their available time, return to the Team screen and select <b>SYNC WATCHES</b>. Review the situation report, assess the enemy's progress and decide where your resistance should concentrate its efforts next.</li>
          </ol>
        </Section>

        <Section title="REMEMBER">
          <p>You are not expected to defeat the enemy army outright. Your strength lies in mobility, disruption and making effective use of a small resistance force.</p>
          <p>Protect the heat mines, deny the enemy valuable resources and attack where he is most vulnerable. Every successful operation brings the island one step closer to liberation.</p>
        </Section>

        <Section title="AT A SETTLEMENT">
          <p>Approach a settlement on skis and press <b>E</b> or <b>ENTER</b> when within a few metres to access its available facilities. Different settlements provide different services and opportunities.</p>
          <Rows rows={[
            ['Houses, churches, police stations and watchtowers', 'Rest until the next synchronisation to recover health, or receive first aid to restore 40 health points. First aid is available once per synchronisation.'],
            ['Stores', 'Replenish your missile, ammunition and fuel supplies. Each character can visit a store once per synchronisation.'],
            ['Magazines', 'Replenish your ammunition and collect a missile and dynamite. Each character can use a magazine once per synchronisation.'],
            ['Garages', 'Collect the snowcat or refuel it for further travel.'],
            ['Hangars', 'Collect the paramotor and take off with a full tank of fuel.'],
            ['Police stations', 'Recruit the local officer to your resistance. If the station has been captured by the enemy, it can be destroyed to release any prisoners held there.'],
            ['Other officers', 'Attempt to recruit officers encountered elsewhere on the island. They may refuse to join, in which case the same character cannot ask them again.'],
            ['Factories', 'Use dynamite to destroy factories before they fall into enemy hands. Captured factories can be used to manufacture additional enemy vehicles.'],
            ['Church towers and watchtowers', 'Use these elevated positions to fire at enemy vehicles within range.'],
          ]} />
        </Section>

        <Section title="COMBAT">
          <p>Combat begins when an enemy vehicle comes within 200 metres of your character.</p>
          <p>Your <b>missile</b> can destroy an enemy vehicle with a single direct hit, although you can only carry one at a time. Alternatively, your <b>gun</b> can destroy a vehicle with five successful hits.</p>
          <p>Enemy vehicles take a few seconds to begin firing, and their turrets rotate relatively slowly. Use this opportunity to attack while remaining mobile and avoiding incoming fire.</p>
          <p>To escape combat, move at least 250 metres away from every enemy vehicle.</p>
          <p>The paramotor provides an effective means of avoiding pursuit, as enemy vehicles cannot follow you into the air. However, they can still fire at you while you are flying.</p>
        </Section>

        <Section title="TRAVELLING AROUND THE ISLAND">
          <p>There are three methods of transport available, each with different advantages and limitations.</p>
          <Rows rows={[
            ['Skis', 'Always available and require no fuel. They are particularly effective when travelling downhill, although climbing slopes is considerably slower.'],
            ['Snowcat', 'A tracked civilian vehicle providing relatively fast movement across flat terrain. A full tank of fuel allows approximately 2 minutes and 45 seconds of driving.'],
            ['Paramotor', 'Provides aerial transport at a speed of 30 km/h while maintaining its flying height. A full tank lasts approximately two minutes, providing a range of around one kilometre. You must land before leaving the 3D view.'],
          ]} />
          <p>Vehicles can be left at any location and subsequently recovered through the relevant character's profile.</p>
          <p>The resistance has access to only one snowcat and one paramotor, so consider carefully where they are left and which characters need them.</p>
        </Section>

        <Section title="HEALTH AND RECOVERY">
          <p>Characters can lose health through enemy attacks, collisions and hard landings.</p>
          <p>If a character's health reaches zero, they may be killed, captured by the enemy or rescued by local inhabitants.</p>
          <p>Health can be recovered by resting at settlements, receiving first aid or through the recovery provided when watches are synchronised.</p>
          <p>Captured team members can be rescued by destroying the enemy-held police station where they are being detained.</p>
          <p>Remember that every character is important to the resistance. Losing team members reduces your ability to operate across the island, while having no free characters remaining will result in defeat.</p>
        </Section>

        <Section title="CONTROLS">
          <p>The following controls are available when travelling and fighting in the 3D view.</p>
          <Rows rows={[
            ['W / ↑', 'Move forward on skis or in the snowcat; climb in the paramotor'],
            ['S / ↓', 'Brake or slow down; descend in the paramotor'],
            ['A / ←', 'Turn left'],
            ['D / →', 'Turn right'],
            ['SPACE', 'Fire the selected weapon'],
            ['G', 'Switch between missile and gun'],
            ['E / ENTER', 'Access a settlement or return to the Team screen'],
            ['TAB', 'Switch between the 3D view and Team screen'],
          ]} />
        </Section>

        <Section title="MOBILE CONTROLS">
          <p>On mobile devices, use the on-screen buttons to control movement and actions, with the option to steer by tilting the device.</p>
          <p>Rotate your phone into portrait orientation to access the Team screen.</p>
        </Section>

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

function Section({ title, children }) {
  return (
    <div style={{
      background: 'rgba(14,30,56,0.85)', border: '1px solid rgba(168,216,234,0.25)',
      borderRadius: 6, padding: '12px 14px', marginBottom: 12,
      fontSize: 12, lineHeight: 1.6, color: '#c8dde8',
    }}>
      <div style={{ fontSize: 10, letterSpacing: 3, color: '#7aaccc', fontWeight: 'bold', marginBottom: 6 }}>{title}</div>
      {children}
    </div>
  )
}

function Rows({ rows }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, margin: '6px 0' }}>
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: 'flex', gap: 10 }}>
          <span style={{ flex: '0 0 38%', color: '#a8d8ea', fontWeight: 'bold' }}>{k}</span>
          <span style={{ flex: 1 }}>{v}</span>
        </div>
      ))}
    </div>
  )
}
