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
  if (path === '/') return { plates: 0.55, lift: 0 }
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
      const { EffectComposer } = await import('three/examples/jsm/postprocessing/EffectComposer.js')
      const { RenderPass } = await import('three/examples/jsm/postprocessing/RenderPass.js')
      const { UnrealBloomPass } = await import('three/examples/jsm/postprocessing/UnrealBloomPass.js')
      const { OutputPass } = await import('three/examples/jsm/postprocessing/OutputPass.js')
      if (disposed || !mount) return

      let renderer: THREE_NS.WebGLRenderer
      try {
        renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
      } catch {
        return // no WebGL: the page stays plain black
      }
      const dpr = Math.min(window.devicePixelRatio, 2)
      renderer.setPixelRatio(dpr)
      renderer.setSize(mount.clientWidth, mount.clientHeight)
      renderer.setClearColor(0x000000, 1)
      // The reference look is untone-mapped: the gradient colours are the
      // final colours.
      renderer.toneMapping = THREE.NoToneMapping
      renderer.shadowMap.enabled = true
      renderer.shadowMap.type = THREE.PCFShadowMap
      mount.appendChild(renderer.domElement)

      const scene = new THREE.Scene()
      const camera = new THREE.PerspectiveCamera(33.8, mount.clientWidth / mount.clientHeight, 0.1, 100)
      camera.position.set(0, 0, 10)

      // --- the slab ------------------------------------------------------
      // A rounded square slab: corner radius 12% of the side, thickness 6%,
      // with a small rounded bevel so the edges catch a thin line of light.
      const SIDE = 0.6
      const half = SIDE / 2
      const corner = SIDE * 0.12
      const outline = new THREE.Shape()
      outline.moveTo(-half + corner, -half)
      outline.lineTo(half - corner, -half)
      outline.quadraticCurveTo(half, -half, half, -half + corner)
      outline.lineTo(half, half - corner)
      outline.quadraticCurveTo(half, half, half - corner, half)
      outline.lineTo(-half + corner, half)
      outline.quadraticCurveTo(-half, half, -half, half - corner)
      outline.lineTo(-half, -half + corner)
      outline.quadraticCurveTo(-half, -half, -half + corner, -half)
      const plateGeometry = new THREE.ExtrudeGeometry(outline, {
        depth: SIDE * 0.06 - SIDE * 0.02,
        bevelEnabled: true,
        bevelSize: SIDE * 0.01,
        bevelThickness: SIDE * 0.01,
        bevelSegments: 4,
        curveSegments: 24,
      })
      plateGeometry.center()

      // --- the material --------------------------------------------------
      // Not chrome. The face colour comes from how far each point is from
      // the camera (near: almost white, middle: blue-grey, far: near
      // black), so a tilted slab carries a soft gradient across its face
      // and a stack fades from pale to dark with depth. On top of that sit
      // a broad, soft specular and a faint "reflection" matcap, which is
      // what draws the thin bright line along every bevelled edge.
      const matcapCanvas = document.createElement('canvas')
      matcapCanvas.width = matcapCanvas.height = 256
      const mc = matcapCanvas.getContext('2d')!
      mc.fillStyle = '#000'
      mc.fillRect(0, 0, 256, 256)
      // broad soft highlight, upper left
      let g = mc.createRadialGradient(84, 70, 0, 84, 70, 110)
      g.addColorStop(0, 'rgba(255,255,255,0.16)')
      g.addColorStop(1, 'rgba(255,255,255,0)')
      mc.fillStyle = g
      mc.fillRect(0, 0, 256, 256)
      // bright thin ring at the rim: normals pointing sideways (the bevels)
      g = mc.createRadialGradient(128, 128, 108, 128, 128, 128)
      g.addColorStop(0, 'rgba(255,255,255,0)')
      g.addColorStop(0.75, 'rgba(255,255,255,0.9)')
      g.addColorStop(1, 'rgba(255,255,255,1)')
      mc.fillStyle = g
      mc.fillRect(0, 0, 256, 256)
      const matcap = new THREE.CanvasTexture(matcapCanvas)
      matcap.colorSpace = THREE.SRGBColorSpace

      const uniforms = {
        uNear: { value: 7 },
        uFar: { value: 16 },
        uDim: { value: 1 },
        uSide: { value: SIDE },
        uMatcap: { value: matcap },
        uC0: { value: new THREE.Color().setRGB(0.929, 0.929, 0.929, THREE.SRGBColorSpace) },
        uC1: { value: new THREE.Color().setRGB(0.525, 0.574, 0.604, THREE.SRGBColorSpace) },
        uC2: { value: new THREE.Color().setRGB(0.11, 0.148, 0.152, THREE.SRGBColorSpace) },
      }
      const plateMaterial = new THREE.MeshPhongMaterial({
        color: 0xffffff,
        specular: new THREE.Color().setRGB(0.178, 0.208, 0.217, THREE.SRGBColorSpace),
        shininess: 5,
      })
      plateMaterial.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, uniforms)
        // Per-slab glow (hover / tap) brightens the rim line and the face.
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nattribute float aGlow;\nvarying float vGlow;\nvarying float vCenterDepth;')
          .replace(
            '#include <begin_vertex>',
            '#include <begin_vertex>\nvGlow = aGlow;\nvCenterDepth = -(modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).z;',
          )
        shader.fragmentShader = shader.fragmentShader
          .replace(
            '#include <common>',
            `#include <common>
            varying float vGlow; varying float vCenterDepth;
            uniform float uNear; uniform float uFar; uniform float uDim; uniform float uSide;
            uniform sampler2D uMatcap; uniform vec3 uC0; uniform vec3 uC1; uniform vec3 uC2;
            // Gradient across each slab's own depth (like the reference),
            // nudged by where the slab sits along the chain.
            vec3 depthGradient(float d) {
              float local = (d - vCenterDepth) / uSide;
              float chain = (vCenterDepth - uNear) / (uFar - uNear) - 0.5;
              float t = clamp(1.0 + local * 2.6 + chain * 1.0, 0.0, 1.0);
              const float mid = 0.448;
              return t < mid ? mix(uC0, uC1, t / mid) : mix(uC1, uC2, (t - mid) / (1.0 - mid));
            }`,
          )
          .replace(
            '#include <color_fragment>',
            `#include <color_fragment>
            vec3 grad = depthGradient(vViewPosition.z) * uDim;
            // Diffuse stays white: Phong's diffuse result is used below
            // only as a light/shadow factor over the gradient.
            diffuseColor.rgb = vec3(1.0);`,
          )
          .replace(
            '#include <opaque_fragment>',
            `// Layer stack, bottom to top: depth gradient, soft reflection
            // matcap (screen), then lighting at 60% shading the result,
            // plus the broad specular.
            vec2 mcUv = normal.xy * 0.495 + 0.5;
            vec3 mcCol = texture2D(uMatcap, mcUv).rgb * (0.33 + vGlow * 0.45) * uDim;
            vec3 base = 1.0 - (1.0 - grad * (1.0 + vGlow * 0.25)) * (1.0 - mcCol);
            vec3 shade = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;
            outgoingLight = base * mix(vec3(1.0), shade, 0.6) + reflectedLight.directSpecular * 0.6 * uDim;
            #include <opaque_fragment>`,
          )
      }

      // --- a long chain of slabs on a ring -------------------------------
      // Spread over the whole viewport along a 3:2:1 Lissajous loop.
      const COUNT = 40
      const DEPTH = 3.2
      const plateGroup = new THREE.Group()
      const plates = new THREE.InstancedMesh(plateGeometry, plateMaterial, COUNT)
      plates.castShadow = true
      plates.receiveShadow = true
      plateGroup.add(plates)

      // --- card text on each slab's front face ----------------------------
      // One shared texture for every slab, drawn in the site's fonts.
      const cssVar = (n: string) =>
        getComputedStyle(document.body).getPropertyValue(n).trim() ||
        getComputedStyle(document.documentElement).getPropertyValue(n).trim()
      const sans = `${cssVar('--font-inter-tight') || 'ui-sans-serif'}, system-ui, sans-serif`
      const mono = `${cssVar('--font-geist-mono') || 'ui-monospace'}, monospace`
      await document.fonts.ready
      if (disposed) return
      const labelCanvas = document.createElement('canvas')
      labelCanvas.width = labelCanvas.height = 1024
      const lc = labelCanvas.getContext('2d')!
      lc.scale(2, 2)
      const text = (t: string, x: number, y: number, font: string, alpha: number, spacing = 0) => {
        lc.globalAlpha = alpha
        lc.font = font
        lc.letterSpacing = `${spacing}px`
        lc.fillText(t, x, y)
      }
      lc.fillStyle = '#eef0f2'
      text('VALORON', 40, 78, `500 24px ${mono}`, 0.9, 4)
      text('Available balance', 40, 190, `400 22px ${sans}`, 0.6)
      text('$2,480.00', 36, 262, `300 72px ${sans}`, 0.95, -2)
      lc.globalAlpha = 0.25
      lc.fillRect(40, 300, 432, 1)
      lc.globalAlpha = 0.8
      lc.strokeStyle = '#eef0f2'
      lc.lineWidth = 2
      lc.beginPath()
      lc.moveTo(42, 336)
      lc.lineTo(49, 343)
      lc.lineTo(62, 328)
      lc.stroke()
      text('Reconstructed from 1,204 ledger entries', 74, 343, `400 18px ${sans}`, 0.7)
      text('ACCOUNT HOLDER', 40, 418, `500 13px ${mono}`, 0.45, 2)
      text('A. SINGH', 40, 448, `500 22px ${sans}`, 0.9)
      text('MEMBER SINCE', 290, 418, `500 13px ${mono}`, 0.45, 2)
      text('2026', 290, 448, `500 22px ${sans}`, 0.9)
      const labelTexture = new THREE.CanvasTexture(labelCanvas)
      labelTexture.colorSpace = THREE.SRGBColorSpace
      labelTexture.anisotropy = renderer.capabilities.getMaxAnisotropy()
      const labelGeometry = new THREE.PlaneGeometry(SIDE * 0.9, SIDE * 0.9)
      labelGeometry.translate(0, 0, SIDE * 0.03 + 0.002)
      const labelMaterial = new THREE.MeshBasicMaterial({
        map: labelTexture,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      })
      const labels = new THREE.InstancedMesh(labelGeometry, labelMaterial, COUNT)
      plateGroup.add(labels)
      scene.add(plateGroup)

      const dummy = new THREE.Object3D()
      const groupWorld = new THREE.Vector3()

      // --- light ----------------------------------------------------------
      // A grey sky fill and one white key from close to the camera, which
      // casts soft shadows from each slab onto the ones behind it.
      scene.add(new THREE.HemisphereLight(0xd3d3d3, 0x2a2e31, 1.3))
      const key = new THREE.DirectionalLight(0xffffff, 2.2)
      key.position.set(3.5, 4.5, 12)
      key.castShadow = true
      key.shadow.mapSize.set(1024, 1024)
      key.shadow.radius = 6
      key.shadow.bias = -0.0004
      key.shadow.normalBias = 0.02
      const sc = key.shadow.camera
      sc.left = sc.bottom = -10
      sc.right = sc.top = 10
      sc.near = 1
      sc.far = 30
      scene.add(key)
      scene.add(key.target)

      // --- post: soft glow on the bright parts -----------------------------
      const target = new THREE.WebGLRenderTarget(mount.clientWidth * dpr, mount.clientHeight * dpr, {
        samples: 4,
        type: THREE.HalfFloatType,
      })
      const composer = new EffectComposer(renderer, target)
      composer.setPixelRatio(dpr)
      composer.setSize(mount.clientWidth, mount.clientHeight)
      composer.addPass(new RenderPass(scene, camera))
      const bloom = new UnrealBloomPass(new THREE.Vector2(mount.clientWidth, mount.clientHeight), 0.28, 0.35, 0.86)
      composer.addPass(bloom)
      composer.addPass(new OutputPass())

      // --- state ------------------------------------------------------------
      const cur: Pose = { ...poseRef.current }
      const pointer = { x: 0, y: 0, tx: 0, ty: 0 }
      // 0 at the top of the page, 1 at the bottom.
      let progress = 0
      let shown = 0
      // --- per-slab interaction state ----------------------------------
      // The canvas sits behind the page with pointer-events: none, so we
      // listen on window and work in screen pixels ourselves.
      const HOVER_RADIUS = 150 // px: how close the cursor must come
      const TAP_RADIUS = 170 // px: how close a tap must land
      const TAP_MS = 900
      const pointerPx = { x: -9999, y: -9999, active: false }
      const hover = new Float32Array(COUNT)
      const glow = new Float32Array(COUNT)
      const tapAt = new Float64Array(COUNT)
      const screenX = new Float32Array(COUNT)
      const screenY = new Float32Array(COUNT)
      const glowAttr = new THREE.InstancedBufferAttribute(glow, 1)
      plateGeometry.setAttribute('aGlow', glowAttr)
      const screen = new THREE.Vector3()
      const worldPos = new THREE.Vector3()
      const liftDir = new THREE.Vector3()

      const toLocal = (e: PointerEvent) => {
        const rect = mount!.getBoundingClientRect()
        pointerPx.x = e.clientX - rect.left
        pointerPx.y = e.clientY - rect.top
      }
      const onMove = (e: PointerEvent) => {
        pointer.tx = (e.clientX / window.innerWidth) * 2 - 1
        pointer.ty = (e.clientY / window.innerHeight) * 2 - 1
        toLocal(e)
        pointerPx.active = true
      }
      const onLeave = () => {
        pointerPx.active = false
      }
      const onDown = (e: PointerEvent) => {
        toLocal(e)
        if (e.pointerType !== 'mouse') pointerPx.active = true
        // Never react to clicks on page controls.
        const el = e.target as Element | null
        if (el?.closest('a, button, input, textarea, select, label, summary, [role="button"], [contenteditable]')) return
        let best = -1
        let bestD = TAP_RADIUS
        for (let i = 0; i < COUNT; i++) {
          const d = Math.hypot(pointerPx.x - screenX[i], pointerPx.y - screenY[i])
          if (d < bestD) {
            bestD = d
            best = i
          }
        }
        if (best >= 0 && tapAt[best] === 0) tapAt[best] = performance.now()
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
        composer.setSize(mount.clientWidth, mount.clientHeight)
      }
      window.addEventListener('pointermove', onMove, { passive: true })
      window.addEventListener('pointerdown', onDown, { passive: true })
      document.documentElement.addEventListener('pointerleave', onLeave)
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
        uniforms.uDim.value = cur.plates
        labelMaterial.color.setScalar(cur.plates * 0.75)

        // The ring hangs over the top of the viewport and tips toward the
        // camera as you scroll, so the visible arc changes from a chain of
        // faces to a fan of edges and back.
        const scale = narrow ? 0.7 : 1
        plateGroup.position.set(0, 0, -1.5)
        plateGroup.scale.setScalar(scale)
        plateGroup.rotation.set(
          Math.sin(shown * Math.PI * 2) * 0.08 + pointer.y * 0.06,
          pointer.x * 0.1,
          shown * 0.25,
        )
        // Half the visible frustum at the group's depth, in group units.
        const halfH = (Math.tan((camera.fov * Math.PI) / 360) * 11.5) / scale
        const AX = halfH * camera.aspect * 0.95
        const AY = halfH * 0.9

        // The chain walks 3/4 of the ring over the page plus a slow constant
        // crawl, and every plate keeps turning over.
        const travel = shown * Math.PI * 2 * 0.75 + drift * 0.06
        const flip = shown * Math.PI * 1.6 + drift * 0.22
        plateGroup.updateMatrixWorld()
        const w = mount!.clientWidth
        const h = mount!.clientHeight
        for (let i = 0; i < COUNT; i++) {
          const a = i * STEP + travel
          dummy.position.set(
            AX * Math.sin(3 * a + 0.4) + Math.sin(drift * 0.23 + i * 1.7) * 0.6,
            AY * Math.sin(2 * a) + Math.cos(drift * 0.19 + i * 2.3) * 0.5,
            DEPTH * Math.cos(a) + Math.sin(drift * 0.15 + i * 0.9) * 0.8,
          )
          dummy.rotation.set(0.3 * Math.cos(flip * 0.7 + i), 0, i * 0.4)
          dummy.rotateY(Math.sin(flip - i * 0.5) * 0.95)

          // --- per-slab interaction ------------------------------------
          // Where this slab sits on screen, and how close the cursor is.
          screen.copy(dummy.position).applyMatrix4(plateGroup.matrixWorld)
          worldPos.copy(screen)
          screen.project(camera)
          const sx = (screen.x * 0.5 + 0.5) * w
          const sy = (-screen.y * 0.5 + 0.5) * h
          screenX[i] = sx
          screenY[i] = sy
          const dx = pointerPx.x - sx
          const dy = pointerPx.y - sy
          const near = pointerPx.active ? Math.max(0, 1 - Math.hypot(dx, dy) / HOVER_RADIUS) : 0
          hover[i] = lerp(hover[i], near * near * (3 - 2 * near), 0.08)
          const hv = hover[i]

          // Tap: one quick turn with a soft rim pulse, then settle.
          let spin = 0
          let pulse = 0
          if (tapAt[i] > 0) {
            const p = (now - tapAt[i]) / TAP_MS
            if (p >= 1) tapAt[i] = 0
            else {
              spin = (1 - Math.pow(1 - p, 3)) * Math.PI * 2
              pulse = Math.sin(p * Math.PI)
            }
          }

          if (hv > 0.001 || spin > 0) {
            // Lift toward the camera...
            liftDir.copy(camera.position).sub(worldPos).normalize().multiplyScalar(hv * 0.45)
            worldPos.add(liftDir)
            plateGroup.worldToLocal(worldPos)
            dummy.position.copy(worldPos)
            // ...and lean toward the cursor.
            const len = Math.hypot(dx, dy) || 1
            dummy.rotateY((dx / len) * hv * 0.55)
            dummy.rotateX((dy / len) * hv * 0.55)
            if (spin > 0) dummy.rotateY(spin)
          }
          glow[i] = hv * 0.9 + pulse * 1.6

          dummy.updateMatrix()
          plates.setMatrixAt(i, dummy.matrix)
          labels.setMatrixAt(i, dummy.matrix)
        }
        plates.instanceMatrix.needsUpdate = true
        labels.instanceMatrix.needsUpdate = true
        glowAttr.needsUpdate = true

        // Depth gradient spans the ring: nearest slab pale, farthest dark.
        plateGroup.getWorldPosition(groupWorld)
        const centre = camera.position.distanceTo(groupWorld)
        const r = DEPTH * plateGroup.scale.x
        uniforms.uNear.value = centre - r
        uniforms.uFar.value = centre + r
        key.target.position.copy(groupWorld)

        composer.render()
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
        window.removeEventListener('pointerdown', onDown)
        document.documentElement.removeEventListener('pointerleave', onLeave)
        window.removeEventListener('scroll', onScroll)
        window.removeEventListener('resize', onResize)
        document.removeEventListener('visibilitychange', onVisibility)
        renderer.domElement.remove()
        plateGeometry.dispose()
        plateMaterial.dispose()
        labelGeometry.dispose()
        labelMaterial.dispose()
        labelTexture.dispose()
        matcap.dispose()
        bloom.dispose()
        composer.dispose()
        target.dispose()
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
