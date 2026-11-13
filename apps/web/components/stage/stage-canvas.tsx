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
 * The loop pauses when the tab is hidden, and the scene is static for
 * visitors who prefer reduced motion.
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
      const { RoomEnvironment } = await import('three/examples/jsm/environments/RoomEnvironment.js')
      const { RoundedBoxGeometry } = await import('three/examples/jsm/geometries/RoundedBoxGeometry.js')
      if (disposed || !mount) return

      let renderer: THREE_NS.WebGLRenderer
      try {
        renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true })
      } catch {
        return // no WebGL: the page stays plain black
      }
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
      renderer.setSize(mount.clientWidth, mount.clientHeight)
      renderer.toneMapping = THREE.ACESFilmicToneMapping
      renderer.toneMappingExposure = 1.05
      mount.appendChild(renderer.domElement)

      const scene = new THREE.Scene()
      const pmrem = new THREE.PMREMGenerator(renderer)
      const envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
      scene.environment = envTexture
      scene.environmentIntensity = 1

      const camera = new THREE.PerspectiveCamera(32, mount.clientWidth / mount.clientHeight, 0.1, 100)
      camera.position.set(0, 0, 9)

      // --- chrome plates along a sweeping arc -----------------------------
      const COUNT = 9
      const plateGeometry = new RoundedBoxGeometry(1.5, 1.5, 0.12, 5, 0.14)
      const plateMaterial = new THREE.MeshPhysicalMaterial({
        color: 0xc9d0d2,
        metalness: 1,
        roughness: 0.2,
        clearcoat: 1,
        clearcoatRoughness: 0.06,
        envMapIntensity: 1.3,
      })
      const plates: THREE_NS.Mesh[] = []
      const plateGroup = new THREE.Group()
      for (let i = 0; i < COUNT; i++) {
        const m = new THREE.Mesh(plateGeometry, plateMaterial)
        plateGroup.add(m)
        plates.push(m)
      }
      scene.add(plateGroup)

      // --- light: soft white key from the upper left -----------------------
      const key = new THREE.DirectionalLight(0xffffff, 1.6)
      key.position.set(-5, 5, 5)
      scene.add(key)
      scene.add(new THREE.AmbientLight(0xffffff, 0.05))

      // --- state ------------------------------------------------------------
      const cur: Pose = { ...poseRef.current }
      const pointer = { x: 0, y: 0, tx: 0, ty: 0 }
      let scrollY = 0
      const onMove = (e: PointerEvent) => {
        pointer.tx = (e.clientX / window.innerWidth) * 2 - 1
        pointer.ty = (e.clientY / window.innerHeight) * 2 - 1
      }
      const onScroll = () => {
        scrollY = window.scrollY
      }
      const onResize = () => {
        if (!mount) return
        camera.aspect = mount.clientWidth / mount.clientHeight
        camera.updateProjectionMatrix()
        renderer.setSize(mount.clientWidth, mount.clientHeight)
      }
      window.addEventListener('pointermove', onMove, { passive: true })
      window.addEventListener('scroll', onScroll, { passive: true })
      window.addEventListener('resize', onResize)

      const clock = new THREE.Clock()
      let frame = 0
      const lerp = (a: number, b: number, k: number) => a + (b - a) * k

      function render(t: number) {
        const target = poseRef.current
        cur.plates = lerp(cur.plates, target.plates, 0.04)
        cur.lift = lerp(cur.lift, target.lift, 0.04)
        pointer.x = lerp(pointer.x, pointer.tx, 0.05)
        pointer.y = lerp(pointer.y, pointer.ty, 0.05)

        const aspect = camera.aspect
        const narrow = aspect < 1 // phones: pull everything toward centre, scale down
        const shift = narrow ? 0.35 : 1
        const scroll = Math.min(scrollY / 900, 1)

        plateGroup.visible = cur.plates > 0.02
        // Dim by darkening rather than fading: translucent plates would show
        // each other through themselves.
        plateMaterial.color.setScalar(0.79 * cur.plates)
        plateMaterial.envMapIntensity = 1.3 * cur.plates
        plates.forEach((m, i) => {
          const f = i / (COUNT - 1)
          // A sweep that starts edge-on at the top left and opens up, larger
          // and face-on, toward the right; each plate flips a beat after
          // the one before it.
          const x = lerp(-5.6, 4.6, f) * (narrow ? 0.45 : 1)
          const y = 2.0 - Math.sin(f * Math.PI * 0.9) * 0.55 - f * 0.9 + cur.lift + scroll * 2.4
          m.position.set(x, y + Math.sin(t * 0.6 + i * 0.7) * 0.07, Math.sin(f * Math.PI) * 0.9)
          m.rotation.y = lerp(1.25, -0.35, f) + Math.sin(t * 0.5 - i * 0.55) * 0.35 + pointer.x * 0.2
          m.rotation.x = 0.25 + Math.cos(t * 0.35 - i * 0.4) * 0.2 + pointer.y * 0.12
          m.rotation.z = 0.5 + (f - 0.5) * 0.45
          m.scale.setScalar(lerp(0.55, 1.25, f) * (narrow ? 0.6 : 1))
        })

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
        render(reduced ? 0 : clock.getElapsedTime())
      }
      tick()

      cleanup = () => {
        cancelAnimationFrame(frame)
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

    // Start only once the page has loaded and the browser is idle, so the
    // heavy three.js import and first render never compete with hydration
    // (a form clicked before hydration submits natively and reloads).
    let idleHandle = 0
    let timeoutHandle = 0
    function schedule() {
      if ('requestIdleCallback' in window) {
        idleHandle = window.requestIdleCallback(() => start(), { timeout: 2500 })
      } else {
        timeoutHandle = window.setTimeout(start, 800)
      }
    }
    if (document.readyState === 'complete') schedule()
    else window.addEventListener('load', schedule, { once: true })

    return () => {
      disposed = true
      window.removeEventListener('load', schedule)
      if (idleHandle) window.cancelIdleCallback(idleHandle)
      if (timeoutHandle) window.clearTimeout(timeoutHandle)
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
