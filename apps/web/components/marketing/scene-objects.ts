import type * as THREE_NS from 'three'

/**
 * Procedural props for the hero scene. Everything here is generated in
 * code rather than loaded from a model file, which keeps the page free of
 * multi-megabyte asset downloads and means the objects inherit the site's
 * palette instead of whatever a third-party model was authored in.
 */

/** Minted coin face: embossed "V" monogram inside a beaded rim. */
function createCoinTexture(THREE: typeof THREE_NS): THREE_NS.CanvasTexture {
  const S = 512
  const canvas = document.createElement('canvas')
  canvas.width = S
  canvas.height = S
  const ctx = canvas.getContext('2d')!

  const g = ctx.createRadialGradient(S * 0.35, S * 0.3, S * 0.05, S * 0.5, S * 0.5, S * 0.6)
  g.addColorStop(0, '#f3f4f6')
  g.addColorStop(0.55, '#b8bcc4')
  g.addColorStop(1, '#71757d')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, S, S)

  // Beaded rim
  ctx.strokeStyle = 'rgba(255,255,255,0.55)'
  ctx.lineWidth = 10
  ctx.beginPath()
  ctx.arc(S / 2, S / 2, S * 0.42, 0, Math.PI * 2)
  ctx.stroke()
  ctx.strokeStyle = 'rgba(0,0,0,0.25)'
  ctx.lineWidth = 4
  ctx.beginPath()
  ctx.arc(S / 2, S / 2, S * 0.36, 0, Math.PI * 2)
  ctx.stroke()

  // Monogram, drawn twice for a struck/embossed edge
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = '700 250px system-ui, -apple-system, Segoe UI, sans-serif'
  ctx.fillStyle = 'rgba(0,0,0,0.30)'
  ctx.fillText('V', S / 2 + 5, S / 2 + 8)
  ctx.fillStyle = '#fbfbfd'
  ctx.fillText('V', S / 2, S / 2)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
  return texture
}

export type OrbitingCoins = {
  group: THREE_NS.Group
  /** Advance the orbit. `t` is elapsed seconds. */
  update: (t: number) => void
  dispose: () => void
}

/**
 * A small set of coins on tilted elliptical orbits around the origin.
 * Geometry and materials are shared across every coin, so adding coins
 * costs draw calls but not memory.
 */
export function createOrbitingCoins(THREE: typeof THREE_NS, count = 5): OrbitingCoins {
  const group = new THREE.Group()

  const faceTexture = createCoinTexture(THREE)
  const geometry = new THREE.CylinderGeometry(0.26, 0.26, 0.045, 56)
  const edgeMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x9aa0a8,
    metalness: 1,
    roughness: 0.32,
  })
  const faceMaterial = new THREE.MeshPhysicalMaterial({
    map: faceTexture,
    metalness: 0.95,
    roughness: 0.26,
    clearcoat: 0.6,
  })
  // CylinderGeometry groups are ordered [side, top, bottom].
  const materials = [edgeMaterial, faceMaterial, faceMaterial]

  const coins: { mesh: THREE_NS.Mesh; radius: number; speed: number; phase: number; tilt: number; y: number }[] = []

  for (let i = 0; i < count; i++) {
    const mesh = new THREE.Mesh(geometry, materials)
    // Lie the coin "face out" by default; the orbit tilts it from there.
    mesh.rotation.x = Math.PI / 2
    group.add(mesh)
    coins.push({
      mesh,
      radius: 2.3 + (i % 3) * 0.55,
      speed: 0.22 + i * 0.045,
      phase: (i / count) * Math.PI * 2,
      tilt: 0.25 + (i % 2) * 0.35,
      y: (i - count / 2) * 0.34,
    })
  }

  function update(t: number) {
    for (const c of coins) {
      const a = t * c.speed + c.phase
      c.mesh.position.set(Math.cos(a) * c.radius, c.y + Math.sin(a * 1.3) * 0.35, Math.sin(a) * c.radius * 0.62)
      // Spin about the coin's own axis while it travels.
      c.mesh.rotation.y = a * 1.6
      c.mesh.rotation.z = Math.sin(a) * c.tilt
    }
  }

  function dispose() {
    geometry.dispose()
    edgeMaterial.dispose()
    faceMaterial.dispose()
    faceTexture.dispose()
  }

  return { group, update, dispose }
}

export type GlassRing = {
  mesh: THREE_NS.Mesh
  update: (t: number) => void
  dispose: () => void
}

/** Slim translucent torus that sweeps around the card. */
export function createGlassRing(THREE: typeof THREE_NS): GlassRing {
  const geometry = new THREE.TorusGeometry(2.55, 0.018, 16, 160)
  const material = new THREE.MeshPhysicalMaterial({
    color: 0xdfe3ea,
    metalness: 0.6,
    roughness: 0.15,
    transmission: 0.55,
    transparent: true,
    opacity: 0.75,
    thickness: 0.4,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.rotation.x = Math.PI / 2.4

  function update(t: number) {
    mesh.rotation.z = t * 0.12
    mesh.rotation.x = Math.PI / 2.4 + Math.sin(t * 0.3) * 0.12
  }

  function dispose() {
    geometry.dispose()
    material.dispose()
  }

  return { mesh, update, dispose }
}

export type DataNodes = {
  group: THREE_NS.Group
  update: (t: number) => void
  dispose: () => void
}

/**
 * Wireframe icosahedra drifting in the background — reads as "ledger
 * nodes" and gives the scene parallax depth behind the card.
 */
export function createDataNodes(THREE: typeof THREE_NS, count = 6): DataNodes {
  const group = new THREE.Group()
  const geometry = new THREE.IcosahedronGeometry(0.34, 0)
  const material = new THREE.MeshBasicMaterial({
    color: 0x8b93a1,
    wireframe: true,
    transparent: true,
    opacity: 0.32,
  })

  const nodes: { mesh: THREE_NS.Mesh; drift: number; base: THREE_NS.Vector3 }[] = []
  for (let i = 0; i < count; i++) {
    const mesh = new THREE.Mesh(geometry, material)
    const base = new THREE.Vector3(
      (Math.random() - 0.5) * 9,
      (Math.random() - 0.5) * 5.5,
      -2.5 - Math.random() * 3
    )
    mesh.position.copy(base)
    group.add(mesh)
    nodes.push({ mesh, drift: 0.2 + Math.random() * 0.4, base })
  }

  function update(t: number) {
    for (const n of nodes) {
      n.mesh.rotation.x = t * n.drift * 0.6
      n.mesh.rotation.y = t * n.drift
      n.mesh.position.y = n.base.y + Math.sin(t * n.drift + n.base.x) * 0.3
    }
  }

  function dispose() {
    geometry.dispose()
    material.dispose()
  }

  return { group, update, dispose }
}

export type SceneProp = {
  group: THREE_NS.Group
  update: (t: number) => void
  dispose: () => void
}

/**
 * Large matte silver sphere that slowly breathes behind the card — the
 * moon-like orb from the digital-of-things reference. A canvas noise
 * texture gives it the grainy, film-like surface.
 */
export function createSilverSphere(THREE: typeof THREE_NS): SceneProp {
  const group = new THREE.Group()

  const S = 256
  const canvas = document.createElement('canvas')
  canvas.width = S
  canvas.height = S
  const ctx = canvas.getContext('2d')!
  const img = ctx.createImageData(S, S)
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 150 + Math.random() * 70
    img.data[i] = v
    img.data[i + 1] = v
    img.data[i + 2] = v
    img.data[i + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(3, 2)
  texture.colorSpace = THREE.SRGBColorSpace

  const geometry = new THREE.SphereGeometry(1.3, 96, 96)
  const material = new THREE.MeshStandardMaterial({
    map: texture,
    color: 0xc9d0d2,
    metalness: 0.15,
    roughness: 0.9,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.set(1.5, 0.35, -2.4)
  group.add(mesh)

  function update(t: number) {
    mesh.rotation.y = t * 0.05
    mesh.scale.setScalar(1 + Math.sin(t * 0.6) * 0.025)
  }
  function dispose() {
    geometry.dispose()
    material.dispose()
    texture.dispose()
  }
  return { group, update, dispose }
}

/**
 * A fan of thin chrome plates (the fragment.im reference) that flip and
 * ripple in sequence along an arc across the top of the scene.
 */
export function createPanelFan(THREE: typeof THREE_NS, count = 9): SceneProp {
  const group = new THREE.Group()
  const geometry = new THREE.BoxGeometry(0.46, 0.46, 0.03)
  const material = new THREE.MeshPhysicalMaterial({
    color: 0xc9d0d2,
    metalness: 1,
    roughness: 0.16,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
  })
  const plates: THREE_NS.Mesh[] = []
  for (let i = 0; i < count; i++) {
    const mesh = new THREE.Mesh(geometry, material)
    group.add(mesh)
    plates.push(mesh)
  }

  function update(t: number) {
    plates.forEach((m, i) => {
      const f = i / (count - 1)
      const a = f * Math.PI * 0.95 + Math.PI * 0.03
      m.position.set(-2.6 + f * 5.2, 1.05 + Math.sin(a) * 0.25 + Math.sin(t * 0.7 + i) * 0.06, -1 - Math.cos(a * 2) * 0.4)
      m.rotation.y = 0.9 * Math.sin(t * 0.5 - i * 0.45) + (f - 0.5) * 1.2
      m.rotation.x = 0.35 + Math.cos(t * 0.4 - i * 0.3) * 0.25
      m.rotation.z = 0.5 + (f - 0.5) * 0.6
    })
  }
  function dispose() {
    geometry.dispose()
    material.dispose()
  }
  return { group, update, dispose }
}
