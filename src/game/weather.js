import * as THREE from 'three'

const SNOW_CONFIG = { particleCount: 2000, fogDensity: 0.0036, fogColor: 0x6688aa, windSpeed: 1.2 }

export class WeatherSystem {
  constructor(scene, performanceTier = 'high') {
    this.scene = scene
    this.windDirection = new THREE.Vector3(0.3, 0, 1).normalize()
    this.time = 0

    scene.fog = new THREE.FogExp2(SNOW_CONFIG.fogColor, SNOW_CONFIG.fogDensity)

    const multiplier = performanceTier === 'low' ? 0.25 : performanceTier === 'mid' ? 0.6 : 1.0
    const count = Math.floor(SNOW_CONFIG.particleCount * multiplier)

    const geometry = new THREE.BufferGeometry()
    const positions = new Float32Array(count * 3)
    const speeds    = new Float32Array(count)
    const SPREAD = 24, HEIGHT = 10

    for (let i = 0; i < count; i++) {
      positions[i * 3]     = (Math.random() - 0.5) * SPREAD
      positions[i * 3 + 1] = Math.random() * HEIGHT
      positions[i * 3 + 2] = (Math.random() - 0.5) * SPREAD
      speeds[i] = 0.5 + Math.random() * 1.5
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('speed', new THREE.BufferAttribute(speeds, 1))

    this.particles = new THREE.Points(geometry, new THREE.PointsMaterial({
      color: 0xddeeff, size: 3, transparent: true, opacity: 0.75,
      depthWrite: false, sizeAttenuation: false,
    }))
    this.particles.frustumCulled = false
    scene.add(this.particles)
  }

  update(dt, cameraPosition) {
    this.time += dt
    const pos = this.particles.geometry.attributes.position
    const speeds = this.particles.geometry.attributes.speed
    const SPREAD = 24, HEIGHT = 10

    for (let i = 0; i < pos.count; i++) {
      const s = speeds.getX(i)
      pos.setY(i, pos.getY(i) - s * SNOW_CONFIG.windSpeed * dt * 0.55)
      pos.setX(i, pos.getX(i) + this.windDirection.x * SNOW_CONFIG.windSpeed * dt * 0.17)
      pos.setZ(i, pos.getZ(i) + this.windDirection.z * SNOW_CONFIG.windSpeed * dt * 0.17)

      if (pos.getY(i) < -1.0 || Math.abs(pos.getX(i)) > SPREAD || Math.abs(pos.getZ(i)) > SPREAD) {
        pos.setX(i, (Math.random() - 0.5) * SPREAD)
        pos.setY(i, HEIGHT + Math.random() * 1.0)
        pos.setZ(i, (Math.random() - 0.5) * SPREAD)
      }
    }

    this.particles.position.set(cameraPosition.x, cameraPosition.y, cameraPosition.z)
    pos.needsUpdate = true
  }

  dispose() {
    this.scene.remove(this.particles)
    this.particles.geometry.dispose()
    this.particles.material.dispose()
  }
}
