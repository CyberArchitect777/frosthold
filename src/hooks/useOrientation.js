import { useState, useEffect } from 'react'

export function useOrientation() {
  const [orientation, setOrientation] = useState(() => {
    if (typeof window === 'undefined') return 'landscape'
    return window.innerWidth > window.innerHeight ? 'landscape' : 'portrait'
  })

  useEffect(() => {
    function update() {
      const next = window.innerWidth > window.innerHeight ? 'landscape' : 'portrait'
      setOrientation(next)
    }

    // Use resize instead of orientationchange for reliability
    window.addEventListener('resize', update)
    if (screen.orientation) {
      screen.orientation.addEventListener('change', update)
    } else {
      window.addEventListener('orientationchange', update)
    }

    return () => {
      window.removeEventListener('resize', update)
      if (screen.orientation) {
        screen.orientation.removeEventListener('change', update)
      } else {
        window.removeEventListener('orientationchange', update)
      }
    }
  }, [])

  return orientation
}
