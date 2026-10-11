import { useState, useEffect, useRef } from 'react'

/**
 * Returns normalized tilt values for ski steering.
 * gamma: left/right tilt (-1 to 1, negative = left)
 * beta:  forward/back tilt (-1 to 1)
 */
export function useGyroscope() {
  const [tilt, setTilt] = useState({ gamma: 0, beta: 0, supported: false, permitted: false })
  const baseRef = useRef(null)

  useEffect(() => {
    if (typeof DeviceOrientationEvent === 'undefined') return

    async function requestPermission() {
      // iOS 13+ requires explicit permission
      if (typeof DeviceOrientationEvent.requestPermission === 'function') {
        try {
          const permission = await DeviceOrientationEvent.requestPermission()
          if (permission !== 'granted') return
        } catch {
          return
        }
      }

      function handleOrientation(e) {
        if (e.gamma === null) return

        // Set baseline on first reading
        if (baseRef.current === null) {
          baseRef.current = { gamma: e.gamma, beta: e.beta }
        }

        const gamma = e.gamma - baseRef.current.gamma  // left/right: -90 to 90
        const beta  = e.beta  - baseRef.current.beta   // forward/back

        setTilt({
          gamma: Math.max(-1, Math.min(1, gamma / 45)),   // normalize to -1..1
          beta:  Math.max(-1, Math.min(1, beta  / 45)),
          supported: true,
          permitted: true,
        })
      }

      window.addEventListener('deviceorientation', handleOrientation)
      setTilt(t => ({ ...t, supported: true, permitted: true }))

      return () => window.removeEventListener('deviceorientation', handleOrientation)
    }

    const cleanup = requestPermission()
    return () => { cleanup?.then(fn => fn?.()) }
  }, [])

  function recalibrate() {
    baseRef.current = null
  }

  return { ...tilt, recalibrate }
}
