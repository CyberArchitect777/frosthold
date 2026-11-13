// Travel mode display data (HUD label and icon)
import React from 'react'
import { SnowcatIcon } from '../ui/SnowcatIcon.jsx'

export const TRAVEL_MODES = {
  ski: {
    label: 'Skiing',
    icon: '⛷',
  },
  snowcat: {
    label: 'Snowcat',
    icon: React.createElement(SnowcatIcon),
  },
  paramotor: {
    label: 'Paramotor',
    icon: '🪂',
  },
}
