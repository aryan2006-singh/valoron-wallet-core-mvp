'use client'

import { useEffect, useRef, useState } from 'react'
import type * as THREE_NS from 'three'
import { useReducedMotion } from '@/components/marketing/motion'
import { ProductPreview } from '@/components/marketing/product-preview'

/**
 * Mouse-reactive 3D payment card for the hero.
 *
 * Three.js is ~600KB, so it is imported dynamically inside the effect
 * rather than at module scope: the page paints (and LCP settles) on the
 * static fallback below, and the scene swaps in afterwards. If WebGL is
 * unavailable or the visitor asked for reduced motion, the fallback is
 * simply what they keep — no blank box, no layout shift.
 */
export function HeroVisual() {
  const mountRef = useRef<HTMLDivElement>(null)
  const [sceneReady, setSceneReady] = useState(false)
  const reduced = useReducedMotion()

  useEffect(() => {
    if (reduced) return
    const mount = mountRef.current
    if (!mount) return

    let disposed = false
    let cleanup: (() => void) | undefined

    async function start() {
      const THREE = await import('three')
      if (disposed || !mount) return

      let renderer: THREE_NS.WebGLRenderer
      try {
        renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true })
      } catch {
        return // no WebGL — keep the static fallback
      }

      const width = mount.clientWidth
      const height = mount.clientHeight
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
      renderer.setSize(width, height)
      mount.appendChild(renderer.domElement)

      const scene = new THREE.Scene()
      const camera = new THREE.PerspectiveCamera(35, width / height, 0.1, 100)
      camera.position.set(0, 0, 6)

      // --- the card -------------------------------------------------
      const w = 3.4
      const h = 2.15
      const r = 0.22
      const shape = new THREE.Shape()
      shape.moveTo(-w / 2 + r, -h / 2)
      shape.lineTo(w / 2 - r, -h / 2)
      shape.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r)
      shape.lineTo(w / 2, h / 2 - r)
      shape.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2)
      shape.lineTo(-w / 2 + r, h / 2)
      shape.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r)
      shape.lineTo(-w / 2, -h / 2 + r)
      shape.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2)

      const cardGeometry = new THREE.ExtrudeGeometry(shape, {
        depth: 0.07,
        bevelEnabled: true,
        bevelSize: 0.018,
        bevelThickness: 0.018,
        bevelSegments: 4,
        curveSegments: 32,
      })
      cardGeometry.center()

      const cardMaterial = new THREE.MeshPhysicalMaterial({
        color: 0x0b0b0c,
        metalness: 0.86,
        roughness: 0.24,
        clearcoat: 1,
        clearcoatRoughness: 0.12,
      })
      const card = new THREE.Mesh(cardGeometry, cardMaterial)
      scene.add(card)

      // Emissive stripe, reading as the card's magnetic band.
      const stripeGeometry = new THREE.PlaneGeometry(w * 0.995, 0.34)
      const stripeMaterial = new THREE.MeshBasicMaterial({ color: 0xf4f4f5 })
      const stripe = new THREE.Mesh(stripeGeometry, stripeMaterial)
      stripe.position.set(0, 0.42, 0.055)
      card.add(stripe)

      // --- lighting -------------------------------------------------
      scene.add(new THREE.AmbientLight(0xffffff, 0.55))
      const key = new THREE.DirectionalLight(0xffffff, 2.4)
      key.position.set(-3, 4, 5)
      scene.add(key)
      const rim = new THREE.PointLight(0xffffff, 22, 18)
      rim.position.set(4, -2, 3)
      scene.add(rim)
      const fill = new THREE.PointLight(0x9ca3af, 14, 18)
      fill.position.set(-4, -3, 2)
      scene.add(fill)

      // --- particle field -------------------------------------------
      const count = 220
      const positions = new Float32Array(count * 3)
      for (let i = 0; i < count; i++) {
        positions[i * 3] = (Math.random() - 0.5) * 12
        positions[i * 3 + 1] = (Math.random() - 0.5) * 8
        positions[i * 3 + 2] = (Math.random() - 0.5) * 6 - 2
      }
      const particleGeometry = new THREE.BufferGeometry()
      particleGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
      const particleMaterial = new THREE.PointsMaterial({
        color: 0x9ca3af,
        size: 0.03,
        transparent: true,
        opacity: 0.55,
      })
      const particles = new THREE.Points(particleGeometry, particleMaterial)
      scene.add(particles)

      // --- interaction ----------------------------------------------
      const pointer = { x: 0, y: 0 }
      const target = { x: 0, y: 0 }
      function onPointerMove(event: PointerEvent) {
        const rect = mount!.getBoundingClientRect()
        target.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
        target.y = ((event.clientY - rect.top) / rect.height) * 2 - 1
      }
      window.addEventListener('pointermove', onPointerMove, { passive: true })

      // Only render while actually on screen — a hero animation has no
      // business burning battery once the visitor has scrolled past it.
      let visible = true
      const observer = new IntersectionObserver(([entry]) => {
        visible = entry.isIntersecting
      })
      observer.observe(mount)

      function onResize() {
        if (!mount) return
        const nextWidth = mount.clientWidth
        const nextHeight = mount.clientHeight
        camera.aspect = nextWidth / nextHeight
        camera.updateProjectionMatrix()
        renderer.setSize(nextWidth, nextHeight)
      }
      const resizeObserver = new ResizeObserver(onResize)
      resizeObserver.observe(mount)

      const clock = new THREE.Clock()
      let frame = 0

      function tick() {
        frame = requestAnimationFrame(tick)
        if (!visible || document.hidden) return

        const t = clock.getElapsedTime()
        pointer.x += (target.x - pointer.x) * 0.05
        pointer.y += (target.y - pointer.y) * 0.05

        card.rotation.y = -0.35 + pointer.x * 0.5 + Math.sin(t * 0.4) * 0.06
        card.rotation.x = 0.18 + pointer.y * 0.3 + Math.cos(t * 0.5) * 0.04
        card.position.y = Math.sin(t * 0.8) * 0.07

        particles.rotation.y = t * 0.02
        particles.rotation.x = pointer.y * 0.05

        renderer.render(scene, camera)
      }
      tick()
      setSceneReady(true)

      cleanup = () => {
        cancelAnimationFrame(frame)
        observer.disconnect()
        resizeObserver.disconnect()
        window.removeEventListener('pointermove', onPointerMove)
        renderer.domElement.remove()
        renderer.dispose()
        cardGeometry.dispose()
        cardMaterial.dispose()
        stripeGeometry.dispose()
        stripeMaterial.dispose()
        particleGeometry.dispose()
        particleMaterial.dispose()
      }
    }

    start()

    return () => {
      disposed = true
      cleanup?.()
    }
  }, [reduced])

  return (
    <div className="relative min-h-[22rem] lg:min-h-[30rem]">
      <div ref={mountRef} className="absolute inset-0" aria-hidden />
      {/* Fades out once the scene is live, so there is never an empty gap. */}
      <div
        className={`transition-opacity duration-700 ${sceneReady ? 'pointer-events-none opacity-0' : 'opacity-100'}`}
      >
        <ProductPreview />
      </div>
    </div>
  )
}
