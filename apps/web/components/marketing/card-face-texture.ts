import type * as THREE_NS from 'three'

/**
 * Paints the face of the hero object onto a 2D canvas, which the 3D scene
 * then uses as a texture.
 *
 * This is deliberately NOT a debit card. Valoron is a wallet: it issues no
 * physical card, has no PAN, no EMV chip and no expiry, so showing those
 * would advertise a product that does not exist. What it shows instead is
 * what the product actually is — a USD wallet balance backed by a ledger.
 */
export function createCardFaceTexture(THREE: typeof THREE_NS): THREE_NS.CanvasTexture {
  const W = 1024
  const H = 648
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!

  // Base: deep charcoal with a soft diagonal sheen so the surface reads
  // as brushed metal rather than flat paint.
  const base = ctx.createLinearGradient(0, 0, W, H)
  base.addColorStop(0, '#1c1c20')
  base.addColorStop(0.45, '#0d0d10')
  base.addColorStop(1, '#232329')
  ctx.fillStyle = base
  ctx.fillRect(0, 0, W, H)

  const sheen = ctx.createLinearGradient(-W * 0.2, H, W * 0.8, 0)
  sheen.addColorStop(0, 'rgba(255,255,255,0)')
  sheen.addColorStop(0.5, 'rgba(255,255,255,0.07)')
  sheen.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = sheen
  ctx.fillRect(0, 0, W, H)

  // Faint engraved arcs — fine line work for depth, no card iconography.
  ctx.save()
  ctx.strokeStyle = 'rgba(255,255,255,0.035)'
  ctx.lineWidth = 1.5
  for (let i = 0; i < 14; i++) {
    ctx.beginPath()
    ctx.arc(W * 0.84, H * 0.52, 90 + i * 28, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.restore()

  // Wordmark
  ctx.fillStyle = '#ffffff'
  ctx.font = '600 44px system-ui, -apple-system, Segoe UI, sans-serif'
  ctx.letterSpacing = '6px'
  ctx.fillText('VALORON', 64, 104)

  ctx.fillStyle = 'rgba(255,255,255,0.45)'
  ctx.font = '400 20px system-ui, -apple-system, Segoe UI, sans-serif'
  ctx.letterSpacing = '3px'
  ctx.fillText('USD WALLET', 64, 140)

  // The balance is the hero of the face — this is a wallet, so the
  // headline figure is what you hold, not an account number.
  ctx.letterSpacing = '0px'
  ctx.fillStyle = 'rgba(255,255,255,0.5)'
  ctx.font = '400 22px system-ui, -apple-system, Segoe UI, sans-serif'
  ctx.fillText('Available balance', 64, 300)

  ctx.font = '600 96px system-ui, -apple-system, Segoe UI, sans-serif'
  ctx.fillStyle = 'rgba(0,0,0,0.5)'
  ctx.fillText('$2,480.00', 66, 392)
  ctx.fillStyle = '#ffffff'
  ctx.fillText('$2,480.00', 64, 390)

  // Ledger provenance line — the actual differentiator.
  ctx.save()
  ctx.strokeStyle = 'rgba(255,255,255,0.16)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(64, 440)
  ctx.lineTo(W - 64, 440)
  ctx.stroke()
  ctx.restore()

  // Small tick glyph + provenance caption
  ctx.save()
  ctx.strokeStyle = '#7ee2a8'
  ctx.lineWidth = 5
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  ctx.moveTo(66, 496)
  ctx.lineTo(80, 510)
  ctx.lineTo(106, 482)
  ctx.stroke()
  ctx.restore()

  ctx.font = '400 22px system-ui, -apple-system, Segoe UI, sans-serif'
  ctx.fillStyle = 'rgba(255,255,255,0.72)'
  ctx.fillText('Reconstructed from 1,204 ledger entries', 126, 504)

  // Footer row
  ctx.font = '400 18px system-ui, -apple-system, Segoe UI, sans-serif'
  ctx.letterSpacing = '2px'
  ctx.fillStyle = 'rgba(255,255,255,0.4)'
  ctx.fillText('ACCOUNT HOLDER', 64, 566)
  ctx.fillText('MEMBER SINCE', 560, 566)

  ctx.letterSpacing = '0px'
  ctx.font = '500 28px system-ui, -apple-system, Segoe UI, sans-serif'
  ctx.fillStyle = 'rgba(255,255,255,0.88)'
  ctx.fillText('A. SINGH', 64, 604)
  ctx.fillText('2026', 560, 604)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
  return texture
}
