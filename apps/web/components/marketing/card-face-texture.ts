import type * as THREE_NS from 'three'

/**
 * Paints the front of the hero card onto a 2D canvas, which the 3D scene
 * then uses as a texture.
 *
 * Doing the detail work in 2D rather than as geometry keeps the mesh
 * cheap (one plane) while still giving a chip, wordmark, card number and
 * embossing — the things that make it read as a real card instead of a
 * black rectangle.
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

  // Faint engraved guilloche arcs, the way real cards use fine line work.
  ctx.save()
  ctx.strokeStyle = 'rgba(255,255,255,0.035)'
  ctx.lineWidth = 1.5
  for (let i = 0; i < 14; i++) {
    ctx.beginPath()
    ctx.arc(W * 0.82, H * 0.5, 90 + i * 28, 0, Math.PI * 2)
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
  ctx.fillText('DEBIT', 64, 140)

  // EMV chip
  const chipX = 64
  const chipY = 214
  const chipW = 116
  const chipH = 92
  const gold = ctx.createLinearGradient(chipX, chipY, chipX + chipW, chipY + chipH)
  gold.addColorStop(0, '#e8d9a8')
  gold.addColorStop(0.5, '#bfa25e')
  gold.addColorStop(1, '#8d7434')
  roundRect(ctx, chipX, chipY, chipW, chipH, 14)
  ctx.fillStyle = gold
  ctx.fill()
  ctx.strokeStyle = 'rgba(0,0,0,0.35)'
  ctx.lineWidth = 2
  // Contact pads
  ctx.beginPath()
  ctx.moveTo(chipX, chipY + chipH * 0.34)
  ctx.lineTo(chipX + chipW, chipY + chipH * 0.34)
  ctx.moveTo(chipX, chipY + chipH * 0.66)
  ctx.lineTo(chipX + chipW, chipY + chipH * 0.66)
  ctx.moveTo(chipX + chipW * 0.38, chipY)
  ctx.lineTo(chipX + chipW * 0.38, chipY + chipH)
  ctx.stroke()

  // Contactless glyph
  ctx.save()
  ctx.translate(chipX + chipW + 54, chipY + chipH / 2)
  ctx.strokeStyle = 'rgba(255,255,255,0.65)'
  ctx.lineWidth = 5
  ctx.lineCap = 'round'
  for (let i = 1; i <= 3; i++) {
    ctx.beginPath()
    ctx.arc(0, 0, i * 13, -Math.PI / 3.4, Math.PI / 3.4)
    ctx.stroke()
  }
  ctx.restore()

  // Card number, embossed look (dark offset under a light face)
  const number = '5282   3456   7890   4242'
  ctx.font = '500 52px ui-monospace, SFMono-Regular, Menlo, monospace'
  ctx.letterSpacing = '2px'
  ctx.fillStyle = 'rgba(0,0,0,0.55)'
  ctx.fillText(number, 66, 432)
  ctx.fillStyle = 'rgba(255,255,255,0.92)'
  ctx.fillText(number, 64, 430)

  // Footer row
  ctx.font = '400 18px system-ui, -apple-system, Segoe UI, sans-serif'
  ctx.letterSpacing = '2px'
  ctx.fillStyle = 'rgba(255,255,255,0.4)'
  ctx.fillText('CARDHOLDER', 64, 518)
  ctx.fillText('VALID THRU', 470, 518)

  ctx.font = '500 30px system-ui, -apple-system, Segoe UI, sans-serif'
  ctx.fillStyle = 'rgba(255,255,255,0.88)'
  ctx.fillText('A. SINGH', 64, 556)
  ctx.fillText('09/29', 470, 556)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
  return texture
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}
