'use client'

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import type * as THREE_NS from 'three'

/**
 * Full-viewport WebGL backdrop shared by every page: a sweeping fan of
 * chrome plates floating on black (the fragment.im look). It is mounted once in the root layout so it persists across route
 * changes; the pathname only retargets how prominent the plates are, so moving
 * from the landing page into the app glides the scene instead of
 * rebuilding it.
 *
 * Three.js is imported dynamically so the page paints as plain black first.
 * The loop pauses when the tab is hidden. The plates drift continuously
 * and scrolling the page drives them further. By product decision the
 * motion runs for every visitor, including those with reduced motion set:
 * it is a slow ambient brand backdrop, like a looping logo animation.
 */

type Pose = { plates: number; lift: number }

function poseFor(path: string): Pose {
  if (path === '/') return { plates: 1, lift: 0 }
  if (path === '/login' || path === '/signup') return { plates: 0.4, lift: 1.0 }
  return { plates: 0.22, lift: 1.4 }
}

export function StageCanvas() {
  const mountRef = useRef<HTMLDivElement>(null)
  const pathname = usePathname()
  const poseRef = useRef<Pose>(poseFor(pathname))

  useEffect(() => {
    poseRef.current = poseFor(pathname)
  }, [pathname])

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return
    let disposed = false
    let cleanup: (() => void) | undefined

    async function start() {
      const THREE = await import('three')
      const { RoundedBoxGeometry } = await import('three/examples/jsm/geometries/RoundedBoxGeometry.js')
      if (disposed || !mount) return

      let renderer: THREE_NS.WebGLRenderer
      try {
        renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true })
      } catch {
        return // no WebGL: the page stays plain black
      }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
      renderer.setSize(mount.clientWidth, mount.clientHeight)
      renderer.toneMapping = THREE.ACESFilmicToneMapping
      renderer.toneMappingExposure = 1.05
      mount.appendChild(renderer.domElement)

      const scene = new THREE.Scene()
      const pmrem = new THREE.PMREMGenerator(renderer)
      // A black studio with a few bright softbox strips. Reflected in
      // polished metal this gives the fragment.im look: mostly black faces
      // crossed by white light sweeps, and hot white bevelled edges.
      const studio = new THREE.Scene()
      studio.background = new THREE.Color(0x000000)
      const boxGeo = new THREE.PlaneGeometry(1, 1)
      const softbox = (w: number, h: number, x: number, y: number, z: number, power: number) => {
        const mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })
        mat.color.setScalar(power)
        const m = new THREE.Mesh(boxGeo, mat)
        m.scale.set(w, h, 1)
        m.position.set(x, y, z)
        m.lookAt(0, 0, 0)
        studio.add(m)
      }
      // Faint grey dome so faces never fall to pure black.
      const dome = new THREE.Mesh(
        new THREE.SphereGeometry(30, 32, 16),
        new THREE.MeshBasicMaterial({ color: 0x3b4144, side: THREE.BackSide }),
      )
      studio.add(dome)
      softbox(30, 12, 0, 10, 5, 5) // wide panel overhead
      softbox(10, 20, -11, 0, 6, 3) // tall panel on the left
      softbox(9, 9, 10, 4, -7, 4.5) // hot kicker behind right
      softbox(18, 4, 0, -9, 8, 0.9) // soft floor bounce
      softbox(6, 6, 9, -2, 9, 1.6) // small front-right fill
      const envTexture = pmrem.fromScene(studio, 0.02).texture
      boxGeo.dispose()
      dome.geometry.dispose()
      ;(dome.material as THREE_NS.Material).dispose()
      scene.environment = envTexture
      scene.environmentIntensity = 1

      const camera = new THREE.PerspectiveCamera(32, mount.clientWidth / mount.clientHeight, 0.1, 100)
      camera.position.set(0, 0, 10)

      // --- a long chain of chrome plates on a ring ----------------------
      // Like fragment.im, the motion is driven by the scroll position of the
      // WHOLE page and nothing else: no idle wobble, no lag. Scrolling walks
      // the chain around the ring and flips every plate from face-on to
      // edge-on and back, so each part of the page shows a different shape.
      const COUNT = 30
      const RADIUS = 7.2
      // Big, chunky, square plates with generous rounded bevels.
      const plateGeometry = new RoundedBoxGeometry(2.3, 2.3, 0.18, 6, 0.09)
      const plateMaterial = new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        metalness: 1,
        roughness: 0.07,
        clearcoat: 1,
        clearcoatRoughness: 0.04,
        envMapIntensity: 1.8,
      })
      const plateGroup = new THREE.Group()
      const plates = new THREE.InstancedMesh(plateGeometry, plateMaterial, COUNT)
      plateGroup.add(plates)
      scene.add(plateGroup)

      // Silver at one end of the chain fading to graphite at the other.
      const bright = new THREE.Color(0xffffff)
      const dark = new THREE.Color(0x9aa2a6)
      const shade = new THREE.Color()
      for (let i = 0; i < COUNT; i++) {
        shade.copy(bright).lerp(dark, Math.pow(i / (COUNT - 1), 0.8))
        plates.setColorAt(i, shade)
      }
      if (plates.instanceColor) plates.instanceColor.needsUpdate = true

      const dummy = new THREE.Object3D()
      const outward = new THREE.Vector3()

      // --- light: soft white key from the upper left, hard rim behind -----
      const key = new THREE.DirectionalLight(0xffffff, 0.6)
      key.position.set(-5, 5, 5)
      scene.add(key)
      const rim = new THREE.DirectionalLight(0xffffff, 2.5)
      rim.position.set(4, 6, -8)
      scene.add(rim)
      scene.add(new THREE.AmbientLight(0xffffff, 0.05))

      // --- state ------------------------------------------------------------
      const cur: Pose = { ...poseRef.current }
      const pointer = { x: 0, y: 0, tx: 0, ty: 0 }
      // 0 at the top of the page, 1 at the bottom.
      let progress = 0
      let shown = 0
      const onMove = (e: PointerEvent) => {
        pointer.tx = (e.clientX / window.innerWidth) * 2 - 1
        pointer.ty = (e.clientY / window.innerHeight) * 2 - 1
      }
      const onScroll = () => {
        const max = document.documentElement.scrollHeight - window.innerHeight
        progress = max > 0 ? Math.min(Math.max(window.scrollY / max, 0), 1) : 0
      }
      onScroll()
      shown = progress
      // Page height changes as fonts and content load.
      const heightWatcher = new ResizeObserver(onScroll)
      heightWatcher.observe(document.body)
      const onResize = () => {
        if (!mount) return
        camera.aspect = mount.clientWidth / mount.clientHeight
        camera.updateProjectionMatrix()
        renderer.setSize(mount.clientWidth, mount.clientHeight)
      }
      window.addEventListener('pointermove', onMove, { passive: true })
      window.addEventListener('scroll', onScroll, { passive: true })
      window.addEventListener('resize', onResize)

      let frame = 0
      // Continuous drift so the backdrop is always alive, even when nobody
      // scrolls. Scrolling adds to it.
      const startedAt = performance.now()
      let lastAt = startedAt
      let drift = 0
      const lerp = (a: number, b: number, k: number) => a + (b - a) * k
      const STEP = (Math.PI * 2) / COUNT

      function render() {
        const target = poseRef.current
        cur.plates = lerp(cur.plates, target.plates, 0.04)
        cur.lift = lerp(cur.lift, target.lift, 0.04)
        pointer.x = lerp(pointer.x, pointer.tx, 0.05)
        pointer.y = lerp(pointer.y, pointer.ty, 0.05)
        // Near-instant follow: just enough to smooth wheel steps, not the
        // floaty lag of a slow ease.
        shown = lerp(shown, progress, 0.2)
        const now = performance.now()
        // Clamp the step so a backgrounded tab does not jump on return.
        drift += Math.min((now - lastAt) / 1000, 0.05)
        lastAt = now

        const narrow = camera.aspect < 1 // phones: centre the ring, scale it down

        plateGroup.visible = cur.plates > 0.02
        // Dim by darkening rather than fading: translucent plates would show
        // each other through themselves.
        plateMaterial.color.setScalar(cur.plates)
        plateMaterial.envMapIntensity = 1.8 * cur.plates

        // The ring hangs over the top of the viewport and tips toward the
        // camera as you scroll, so the visible arc changes from a chain of
        // faces to a fan of edges and back.
        plateGroup.position.set(narrow ? 0 : 1.2, 4.5 + cur.lift, -3.6)
        plateGroup.scale.setScalar(narrow ? 0.62 : 1)
        plateGroup.rotation.set(
          0.58 + Math.sin(shown * Math.PI * 2) * 0.06 + pointer.y * 0.04,
          pointer.x * 0.06,
          -0.18 + shown * 0.3,
        )

        // The chain walks 3/4 of the ring over the page plus a slow constant
        // crawl, and every plate keeps turning over.
        const travel = shown * Math.PI * 2 * 0.75 + drift * 0.2
        const flip = shown * Math.PI * 1.6 + drift * 0.7
        for (let i = 0; i < COUNT; i++) {
          const a = i * STEP + travel
          outward.set(Math.cos(a), 0, Math.sin(a))
          dummy.position.copy(outward).multiplyScalar(RADIUS)
          // Face outward from the ring, then spin about the chain's direction.
          dummy.lookAt(dummy.position.x * 2, 0, dummy.position.z * 2)
          dummy.rotateY(-0.45 + Math.sin(flip - i * 0.12) * 0.95)
          dummy.rotateX(0.18)
          dummy.updateMatrix()
          plates.setMatrixAt(i, dummy.matrix)
        }
        plates.instanceMatrix.needsUpdate = true

        renderer.render(scene, camera)
      }

      let visible = true
      const onVisibility = () => {
        visible = !document.hidden
      }
      document.addEventListener('visibilitychange', onVisibility)

      function tick() {
        frame = requestAnimationFrame(tick)
        if (!visible) return
        render()
      }
      tick()

      cleanup = () => {
        cancelAnimationFrame(frame)
        heightWatcher.disconnect()
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('scroll', onScroll)
        window.removeEventListener('resize', onResize)
        document.removeEventListener('visibilitychange', onVisibility)
        renderer.domElement.remove()
        plateGeometry.dispose()
        plateMaterial.dispose()
        envTexture.dispose()
        pmrem.dispose()
        renderer.dispose()
      }
    }

    // Start only shortly after the page has loaded, so the
    // heavy three.js import and first render never compete with hydration
    // (a form clicked before hydration submits natively and reloads).
    let timeoutHandle = 0
    function schedule() {
      timeoutHandle = window.setTimeout(start, 600)
    }
    if (document.readyState === 'complete') schedule()
    else window.addEventListener('load', schedule, { once: true })

    return () => {
      disposed = true
      window.removeEventListener('load', schedule)
      window.clearTimeout(timeoutHandle)
      cleanup?.()
    }
  }, [])

  return (
    <div
      ref={mountRef}
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 bg-black"
    />
  )
}
