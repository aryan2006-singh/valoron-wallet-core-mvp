'use client'

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import type * as THREE_NS from 'three'

/**
 * Full-viewport WebGL backdrop shared by every page: a grainy silver orb
 * (digital of things) and a fan of chrome plates (fragment), floating on
 * black. It is mounted once in the root layout so it persists across route
 * changes; the pathname only retargets where the objects sit, so moving
 * from the landing page into the app glides the scene instead of
 * rebuilding it.
 *
 * Three.js is imported dynamically so the page paints as plain black first.
 * The loop pauses when the tab is hidden, and the scene is static for
 * visitors who prefer reduced motion.
 */

type Pose = { orbX: number; orbY: number; orbS: number; plates: number; dim: number }

function poseFor(path: string): Pose {
  if (path === '/') return { orbX: 0, orbY: -0.1, orbS: 1, plates: 1, dim: 1 }
  if (path === '/login' || path === '/signup') return { orbX: 1.4, orbY: -0.2, orbS: 0.75, plates: 0.6, dim: 0.85 }
  return { orbX: 2.2, orbY: -0.9, orbS: 0.55, plates: 0.25, dim: 0.45 }
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
      scene.environmentIntensity = 0.3

      const camera = new THREE.PerspectiveCamera(32, mount.clientWidth / mount.clientHeight, 0.1, 100)
      camera.position.set(0, 0, 9)

      // --- orb: matte silver with film grain --------------------------
      const S = 512
      const canvas = document.createElement('canvas')
      canvas.width = S
      canvas.height = S
      const ctx = canvas.getContext('2d')!
      const img = ctx.createImageData(S, S)
      for (let i = 0; i < img.data.length; i += 4) {
        const v = 110 + Math.random() * 90
        img.data[i] = v
        img.data[i + 1] = v
        img.data[i + 2] = v
        img.data[i + 3] = 255
      }
      ctx.putImageData(img, 0, 0)
      const grain = new THREE.CanvasTexture(canvas)
      grain.wrapS = grain.wrapT = THREE.RepeatWrapping
      grain.repeat.set(4, 2)
      grain.colorSpace = THREE.SRGBColorSpace

      const orbGeometry = new THREE.SphereGeometry(2.2, 128, 128)
      const orbMaterial = new THREE.MeshStandardMaterial({
        map: grain,
        color: 0xb4bbbd,
        roughness: 1,
        metalness: 0,
        transparent: true,
      })
      const orb = new THREE.Mesh(orbGeometry, orbMaterial)
      scene.add(orb)

      // --- chrome plates along a sweeping arc -----------------------------
      const COUNT = 11
      const plateGeometry = new THREE.BoxGeometry(0.9, 0.9, 0.05)
      const plateMaterial = new THREE.MeshPhysicalMaterial({
        color: 0xd7dde0,
        metalness: 1,
        roughness: 0.14,
        clearcoat: 1,
        clearcoatRoughness: 0.06,
        envMapIntensity: 1.6,
        transparent: true,
      })
      const plates: THREE_NS.Mesh[] = []
      const plateGroup = new THREE.Group()
      for (let i = 0; i < COUNT; i++) {
        const m = new THREE.Mesh(plateGeometry, plateMaterial)
        plateGroup.add(m)
        plates.push(m)
      }
      scene.add(plateGroup)

      // --- light: bright upper-left, falling into black lower-right -------
      const key = new THREE.DirectionalLight(0xffffff, 1.7)
      key.position.set(-6, 5, 3)
      scene.add(key)
      scene.add(new THREE.AmbientLight(0xffffff, 0.04))
      const accent = new THREE.PointLight(0xdbffad, 14, 20)
      accent.position.set(5, -3, 3)
      scene.add(accent)

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
        cur.orbX = lerp(cur.orbX, target.orbX, 0.04)
        cur.orbY = lerp(cur.orbY, target.orbY, 0.04)
        cur.orbS = lerp(cur.orbS, target.orbS, 0.04)
        cur.plates = lerp(cur.plates, target.plates, 0.04)
        cur.dim = lerp(cur.dim, target.dim, 0.04)
        pointer.x = lerp(pointer.x, pointer.tx, 0.05)
        pointer.y = lerp(pointer.y, pointer.ty, 0.05)

        const aspect = camera.aspect
        const narrow = aspect < 1 // phones: pull everything toward centre, scale down
        const shift = narrow ? 0.35 : 1
        const scroll = Math.min(scrollY / 900, 1)

        orb.position.set(
          cur.orbX * shift - pointer.x * 0.25,
          cur.orbY + scroll * 1.4 + pointer.y * -0.15,
          -1
        )
        const orbScale = cur.orbS * (narrow ? 0.62 : 1) * (1 + Math.sin(t * 0.5) * 0.015)
        orb.scale.setScalar(orbScale)
        orb.rotation.y = t * 0.04
        orbMaterial.opacity = cur.dim

        plateGroup.visible = cur.plates > 0.02
        plateMaterial.opacity = Math.min(1, cur.plates * 1.2)
        plates.forEach((m, i) => {
          const f = i / (COUNT - 1)
          // A diagonal sweep: low on the right, rising across the top-left,
          // each plate flipping a little later than the last.
          const x = lerp(5.2, -5.2, f) * (narrow ? 0.45 : 1)
          const y = 1.55 + Math.sin(f * Math.PI) * 0.8 - f * 0.3 + scroll * 2
          m.position.set(x, y + Math.sin(t * 0.6 + i * 0.7) * 0.08, 0.4 + Math.sin(f * Math.PI) * 0.8)
          m.rotation.y = Math.sin(t * 0.45 - i * 0.5) * 0.9 + (0.5 - f) * 1.1 + pointer.x * 0.25
          m.rotation.x = 0.3 + Math.cos(t * 0.35 - i * 0.4) * 0.35 + pointer.y * 0.15
          m.rotation.z = 0.55 + (f - 0.5) * 0.7
          m.scale.setScalar(narrow ? 0.6 : 1)
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
        orbGeometry.dispose()
        orbMaterial.dispose()
        grain.dispose()
        plateGeometry.dispose()
        plateMaterial.dispose()
        envTexture.dispose()
        pmrem.dispose()
        renderer.dispose()
      }
    }

    start()
    return () => {
      disposed = true
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
