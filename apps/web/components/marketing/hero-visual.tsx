'use client'

import { useEffect, useRef, useState } from 'react'
import type * as THREE_NS from 'three'
import { ProductPreview } from '@/components/marketing/product-preview'
import { createCardFaceTexture } from '@/components/marketing/card-face-texture'
import {
  createDataNodes,
  createGlassRing,
  createOrbitingCoins,
  createPanelFan,
  createSilverSphere,
} from '@/components/marketing/scene-objects'

/**
 * Mouse-reactive 3D payment card for the hero.
 *
 * Three.js is ~600KB, so it is imported dynamically inside the effect
 * rather than at module scope: the page paints (and LCP settles) on the
 * static fallback below, and the scene swaps in afterwards. Without WebGL
 * the fallback is simply what the visitor keeps — no blank box, no shift.
 *
 * This card animates for everyone, by product decision: it is an ambient
 * looping brand visual, closer to a logo animation than to page motion.
 * The motion that genuinely hurts people with vestibular disorders —
 * scroll-triggered reveals, drifting backdrop orbs, magnetic buttons —
 * still respects prefers-reduced-motion (see motion.tsx). The loop also
 * pauses whenever the hero scrolls out of view or the tab is hidden.
 */
export function HeroVisual() {
  const mountRef = useRef<HTMLDivElement>(null)
  const [sceneReady, setSceneReady] = useState(false)

  useEffect(() => {
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
      renderer.toneMapping = THREE.ACESFilmicToneMapping
      renderer.toneMappingExposure = 1.15
      mount.appendChild(renderer.domElement)

      const scene = new THREE.Scene()
      const camera = new THREE.PerspectiveCamera(35, width / height, 0.1, 100)
      camera.position.set(0, 0, 6)

      const group = new THREE.Group()
      scene.add(group)

      // --- card body -------------------------------------------------
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

      const bodyGeometry = new THREE.ExtrudeGeometry(shape, {
        depth: 0.07,
        bevelEnabled: true,
        bevelSize: 0.02,
        bevelThickness: 0.02,
        bevelSegments: 6,
        curveSegments: 48,
      })
      bodyGeometry.center()

      const bodyMaterial = new THREE.MeshPhysicalMaterial({
        color: 0x0c0e0f,
        metalness: 0.95,
        roughness: 0.28,
        clearcoat: 1,
        clearcoatRoughness: 0.1,
      })
      const body = new THREE.Mesh(bodyGeometry, bodyMaterial)
      group.add(body)

      // --- printed front face ----------------------------------------
      const faceTexture = createCardFaceTexture(THREE)
      const faceGeometry = new THREE.PlaneGeometry(w * 0.99, h * 0.985)
      const faceMaterial = new THREE.MeshPhysicalMaterial({
        map: faceTexture,
        metalness: 0.45,
        roughness: 0.34,
        clearcoat: 0.9,
        clearcoatRoughness: 0.14,
      })
      const face = new THREE.Mesh(faceGeometry, faceMaterial)
      face.position.z = 0.057
      group.add(face)

      // --- magnetic stripe on the reverse ------------------------------
      const stripeGeometry = new THREE.PlaneGeometry(w * 0.99, 0.4)
      const stripeMaterial = new THREE.MeshStandardMaterial({ color: 0x08080a, roughness: 0.6 })
      const stripe = new THREE.Mesh(stripeGeometry, stripeMaterial)
      stripe.position.set(0, 0.5, -0.057)
      stripe.rotation.y = Math.PI
      group.add(stripe)

      // --- lighting ----------------------------------------------------
      scene.add(new THREE.AmbientLight(0xffffff, 0.5))
      const key = new THREE.DirectionalLight(0xffffff, 2.6)
      key.position.set(-3, 4, 5)
      scene.add(key)
      // Two tinted rim lights: the colour only ever lands on the metal
      // edges, which is what sells "premium card" instead of "grey box".
      const rimCool = new THREE.PointLight(0xdbffad, 6, 22)
      rimCool.position.set(4.5, -1.5, 2.5)
      scene.add(rimCool)
      const rimWarm = new THREE.PointLight(0xc9d0d2, 30, 22)
      rimWarm.position.set(-4.5, -3, 2)
      scene.add(rimWarm)
      const topGlow = new THREE.PointLight(0xffffff, 18, 20)
      topGlow.position.set(0, 4, 1.5)
      scene.add(topGlow)

      // --- particle field ----------------------------------------------
      const count = 260
      const positions = new Float32Array(count * 3)
      for (let i = 0; i < count; i++) {
        positions[i * 3] = (Math.random() - 0.5) * 13
        positions[i * 3 + 1] = (Math.random() - 0.5) * 9
        positions[i * 3 + 2] = (Math.random() - 0.5) * 6 - 2
      }
      const particleGeometry = new THREE.BufferGeometry()
      particleGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
      const particleMaterial = new THREE.PointsMaterial({
        color: 0xaab2c0,
        size: 0.032,
        transparent: true,
        opacity: 0.6,
      })
      const particles = new THREE.Points(particleGeometry, particleMaterial)
      scene.add(particles)

      // --- procedural props ----------------------------------------------
      const coins = createOrbitingCoins(THREE, 5)
      scene.add(coins.group)
      const ring = createGlassRing(THREE)
      scene.add(ring.mesh)
      const nodes = createDataNodes(THREE, 6)
      scene.add(nodes.group)
      const sphere = createSilverSphere(THREE)
      scene.add(sphere.group)
      const fan = createPanelFan(THREE)
      scene.add(fan.group)

      // --- interaction ---------------------------------------------------
      const pointer = { x: 0, y: 0 }
      const target = { x: 0, y: 0 }
      function onPointerMove(event: PointerEvent) {
        const rect = mount!.getBoundingClientRect()
        target.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
        target.y = ((event.clientY - rect.top) / rect.height) * 2 - 1
      }

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

        // Idle sway is deliberately larger than the pointer response, so
        // the card is alive even when nobody touches the mouse.
        group.rotation.y = -0.3 + Math.sin(t * 0.45) * 0.35 + pointer.x * 0.45
        group.rotation.x = 0.14 + Math.cos(t * 0.6) * 0.1 + pointer.y * 0.28
        group.rotation.z = Math.sin(t * 0.35) * 0.05
        group.position.y = Math.sin(t * 0.9) * 0.09

        // Scroll-driven depth: the card recedes and yaws as the hero
        // leaves the viewport, so the scene reacts to the page rather
        // than looping in isolation.
        const rect = mount!.getBoundingClientRect()
        const progress = Math.min(Math.max(-rect.top / Math.max(rect.height, 1), 0), 1)
        camera.position.z = 6 + progress * 2.2
        camera.position.y = progress * 0.6
        group.rotation.y += progress * 0.6
        group.scale.setScalar(1 - progress * 0.12)

        coins.update(t)
        ring.update(t)
        nodes.update(t)
        sphere.update(t)
        fan.update(t)
        // Scroll parallax: orb drifts slower than the card, plates faster.
        sphere.group.position.y = progress * 0.9
        fan.group.position.y = progress * 1.6

        particles.rotation.y = t * 0.025
        particles.rotation.x = pointer.y * 0.05

        renderer.render(scene, camera)
      }

      window.addEventListener('pointermove', onPointerMove, { passive: true })
      tick()
      setSceneReady(true)

      cleanup = () => {
        cancelAnimationFrame(frame)
        observer.disconnect()
        resizeObserver.disconnect()
        window.removeEventListener('pointermove', onPointerMove)
        renderer.domElement.remove()
        renderer.dispose()
        bodyGeometry.dispose()
        bodyMaterial.dispose()
        faceGeometry.dispose()
        faceMaterial.dispose()
        faceTexture.dispose()
        stripeGeometry.dispose()
        stripeMaterial.dispose()
        particleGeometry.dispose()
        particleMaterial.dispose()
        coins.dispose()
        ring.dispose()
        nodes.dispose()
        sphere.dispose()
        fan.dispose()
      }
    }

    start()

    return () => {
      disposed = true
      cleanup?.()
    }
  }, [])

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
