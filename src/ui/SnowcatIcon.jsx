import React from 'react'

// Snowcat icon: a tracked civilian vehicle (cargo rack, cab, headlight) with a short roof-mounted gun.
// Drawn at 1em so it sizes like the emoji icons it sits beside.
export function SnowcatIcon() {
  return (
    <svg viewBox="0 0 32 24" width="1.25em" height="1em" aria-label="snowcat" role="img"
      style={{ display: 'inline-block', verticalAlign: '-0.15em' }}>
      {/* cargo rack at the back */}
      <rect x="3.5" y="5.6" width="11" height="1" fill="#555" />
      <rect x="4" y="5.6" width="1" height="3.4" fill="#555" />
      <rect x="9" y="5.6" width="1" height="3.4" fill="#555" />
      <rect x="13.5" y="5.6" width="1" height="3.4" fill="#555" />
      {/* cab, windows and the short gun on its roof */}
      <rect x="15.5" y="3" width="11.5" height="6.5" rx="1.2" fill="#d9a441" />
      <rect x="17" y="4.4" width="4.2" height="3.2" rx="0.5" fill="#9fd3ea" />
      <rect x="22.2" y="4.4" width="3.6" height="3.2" rx="0.5" fill="#9fd3ea" />
      <rect x="19.5" y="1.2" width="2.4" height="1.9" fill="#444" />
      <rect x="21" y="1.4" width="6.5" height="1" rx="0.4" fill="#333" />
      {/* body and headlight */}
      <rect x="3" y="8.8" width="26" height="5.6" rx="1.2" fill="#c08a2e" />
      <rect x="27.6" y="9.8" width="1.6" height="1.6" rx="0.4" fill="#fff3b0" />
      {/* track and road wheels */}
      <rect x="1.5" y="14" width="29" height="8.5" rx="4.25" fill="#2a2a2a" />
      {[6.5, 12.5, 19.5, 25.5].map(cx => <circle key={cx} cx={cx} cy="18.25" r="2.5" fill="#8a8a8a" />)}
    </svg>
  )
}
