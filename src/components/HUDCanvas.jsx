import { useEffect, useRef } from 'react'

// ── Colour helpers ───────────────────────────────────────────────────────────
const A   = '#f5a623'
const ag  = (a) => `rgba(245,166,35,${a})`
const glow  = (ctx, blur = 14, col = A) => { ctx.shadowBlur = blur; ctx.shadowColor = col }
const noGlow = (ctx) => { ctx.shadowBlur = 0; ctx.shadowColor = 'transparent' }

// ── Background grid + crosshair + corner brackets ───────────────────────────
function drawGrid(ctx, W, H, cx, cy) {
  const sp = 60
  ctx.lineWidth = 0.5
  ctx.strokeStyle = ag(0.045)
  ctx.beginPath()
  const gx0 = cx - Math.floor(cx / sp) * sp
  const gy0 = cy - Math.floor(cy / sp) * sp
  for (let x = gx0; x <= W; x += sp) { ctx.moveTo(x, 0); ctx.lineTo(x, H) }
  for (let y = gy0; y <= H; y += sp) { ctx.moveTo(0, y); ctx.lineTo(W, y) }
  ctx.stroke()

  ctx.lineWidth = 1
  ctx.strokeStyle = ag(0.13)
  ctx.beginPath()
  ctx.moveTo(cx, 0);  ctx.lineTo(cx, H)
  ctx.moveTo(0,  cy); ctx.lineTo(W,  cy)
  ctx.stroke()

  // Corner L-brackets
  const s = 22, p = 36
  ctx.lineWidth = 1.5
  ctx.strokeStyle = ag(0.45)
  ;[
    [[p + s, p],         [p, p],         [p, p + s]],
    [[W - p - s, p],     [W - p, p],     [W - p, p + s]],
    [[p + s, H - p],     [p, H - p],     [p, H - p - s]],
    [[W - p - s, H - p], [W - p, H - p], [W - p, H - p - s]],
  ].forEach(pts => {
    ctx.beginPath()
    pts.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y))
    ctx.stroke()
  })
}

// ── HUD telemetry text in corners ───────────────────────────────────────────
function drawCornerText(ctx, W, H, honesty, convMode) {
  const now = new Date()
  const utc = [now.getUTCHours(), now.getUTCMinutes(), now.getUTCSeconds()]
    .map(v => String(v).padStart(2, '0')).join(':')

  ctx.font = '10px "Courier New", monospace'

  const readouts = [
    { x: 58,     y: 58,     a: 'left',  b: 'top',    lines: [`SYS: ONLINE`, `HNS: ${String(Math.round(honesty)).padStart(3, '0')}%`] },
    { x: W - 58, y: 58,     a: 'right', b: 'top',    lines: [`UTC ${utc}`,   convMode ? 'CONV: ACTIVE' : 'GRV: NOMINAL'] },
    { x: 58,     y: H - 58, a: 'left',  b: 'bottom', lines: [`ENDURANCE MK.IV`, `COOPER STATION`] },
    { x: W - 58, y: H - 58, a: 'right', b: 'bottom', lines: [`SECURE LINK`,     `TARS v1.0`] },
  ]

  readouts.forEach(({ x, y, a, b, lines }) => {
    ctx.textAlign    = a
    ctx.textBaseline = b
    lines.forEach((line, i) => {
      // Highlight CONV: ACTIVE in brighter amber
      ctx.fillStyle = (convMode && line === 'CONV: ACTIVE') ? ag(0.85) : ag(0.38)
      ctx.fillText(line, x, y + (b === 'top' ? i * 16 : -(i * 16)))
    })
  })
}

// ── All concentric rings ─────────────────────────────────────────────────────
function drawRings(ctx, cx, cy, R, t, state) {
  const isActive = state === 'listening' || state === 'speaking'
  const pulse    = isActive
    ? 0.55 + 0.45 * Math.sin(t * (state === 'speaking' ? 5 : 2.5))
    : 0.75

  // Outer radial glow halo
  const halo = ctx.createRadialGradient(cx, cy, R * 0.6, cx, cy, R * 1.35)
  halo.addColorStop(0, ag(0.06 * pulse))
  halo.addColorStop(1, 'transparent')
  ctx.fillStyle = halo
  ctx.beginPath(); ctx.arc(cx, cy, R * 1.35, 0, Math.PI * 2); ctx.fill()

  // ── Rotating tick ring ────────────────────────────────────────────
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(t * 0.09)

  for (let deg = 0; deg < 360; deg += 5) {
    const rad    = (deg * Math.PI) / 180
    const isMaj  = deg % 30 === 0
    const isMid  = deg % 10 === 0
    const inner  = R + (isMaj ? 7 : isMid ? 13 : 17)
    const outer  = R + 26

    ctx.strokeStyle = ag(isMaj ? 0.88 : 0.28)
    ctx.lineWidth   = isMaj ? 1.5 : 0.75
    ctx.beginPath()
    ctx.moveTo(Math.cos(rad) * inner, Math.sin(rad) * inner)
    ctx.lineTo(Math.cos(rad) * outer, Math.sin(rad) * outer)
    ctx.stroke()

    if (isMaj) {
      ctx.fillStyle    = ag(0.6)
      ctx.font         = '8px "Courier New", monospace'
      ctx.textAlign    = 'center'
      ctx.textBaseline = 'middle'
      const lr = R + 40
      ctx.fillText(String(deg).padStart(3, '0'), Math.cos(rad) * lr, Math.sin(rad) * lr)
    }
  }

  glow(ctx, 8)
  ctx.strokeStyle = ag(0.4 * pulse)
  ctx.lineWidth   = 1
  ctx.beginPath(); ctx.arc(0, 0, R + 26, 0, Math.PI * 2); ctx.stroke()
  noGlow(ctx)
  ctx.restore()

  // ── Main ring ─────────────────────────────────────────────────────
  glow(ctx, 22)
  ctx.strokeStyle = ag(0.92 * pulse)
  ctx.lineWidth   = 2
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke()
  noGlow(ctx)

  // ── Middle ring — counter-rotates, dashed, with cardinal diamonds ─
  const r2 = R * 0.70
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(-t * 0.06)
  ctx.strokeStyle = ag(0.28)
  ctx.lineWidth   = 1
  ctx.setLineDash([6, 10])
  ctx.beginPath(); ctx.arc(0, 0, r2, 0, Math.PI * 2); ctx.stroke()
  ctx.setLineDash([])

  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2
    const dx = Math.cos(a) * r2
    const dy = Math.sin(a) * r2
    glow(ctx, 8)
    ctx.fillStyle = A
    ctx.beginPath()
    ctx.moveTo(dx, dy - 5); ctx.lineTo(dx + 4, dy)
    ctx.lineTo(dx, dy + 5); ctx.lineTo(dx - 4, dy)
    ctx.closePath(); ctx.fill()
    noGlow(ctx)
  }
  ctx.restore()

  // ── Inner ring — rotates forward, dashed ─────────────────────────
  const r3 = R * 0.48
  const iPulse = state === 'processing'
    ? 0.35 + 0.65 * Math.abs(Math.sin(t * 7))
    : 0.32

  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(t * 0.18)
  ctx.strokeStyle = ag(iPulse)
  ctx.lineWidth   = 1
  ctx.setLineDash([4, 8])
  ctx.beginPath(); ctx.arc(0, 0, r3, 0, Math.PI * 2); ctx.stroke()
  ctx.setLineDash([])

  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4
    ctx.strokeStyle = ag(0.5)
    ctx.lineWidth   = 1
    ctx.beginPath()
    ctx.moveTo(Math.cos(a) * (r3 - 5), Math.sin(a) * (r3 - 5))
    ctx.lineTo(Math.cos(a) * (r3 + 5), Math.sin(a) * (r3 + 5))
    ctx.stroke()
  }
  ctx.restore()

  // ── Dark interior fill ────────────────────────────────────────────
  const fill = ctx.createRadialGradient(cx, cy, 0, cx, cy, r3 - 1)
  fill.addColorStop(0,   'rgba(5,5,16,0.97)')
  fill.addColorStop(0.7, 'rgba(5,5,16,0.95)')
  fill.addColorStop(1,   'rgba(5,5,16,0.70)')
  ctx.fillStyle = fill
  ctx.beginPath(); ctx.arc(cx, cy, r3 - 1, 0, Math.PI * 2); ctx.fill()
}

// ── Frequency bar waveform at bottom of inner circle ────────────────────────
function drawWaveform(ctx, cx, cy, R, t, state, analyser) {
  const r3       = R * 0.48
  const BAR_N    = 48
  const data     = new Float32Array(BAR_N)

  if (state === 'listening' && analyser) {
    const buf = new Uint8Array(analyser.frequencyBinCount)
    analyser.getByteFrequencyData(buf)
    for (let i = 0; i < BAR_N; i++) {
      data[i] = buf[Math.floor((i / BAR_N) * buf.length * 0.65)] / 255
    }
  } else if (state === 'speaking') {
    for (let i = 0; i < BAR_N; i++) {
      const p = i / BAR_N
      const env = Math.sin(p * Math.PI)
      data[i] = Math.max(0.02,
        (0.25 + 0.45 * Math.abs(Math.sin(t * 3.8 + i * 0.38)))
        * (0.4  + 0.6  * Math.abs(Math.sin(i * 0.27 + t * 1.85)))
        * (0.5  + 0.5  * env)
      )
    }
  } else if (state === 'processing') {
    for (let i = 0; i < BAR_N; i++) {
      data[i] = 0.07 + 0.07 * Math.abs(Math.sin(t * 8 + i * 0.55))
    }
  } else {
    for (let i = 0; i < BAR_N; i++) {
      data[i] = 0.02 + 0.015 * Math.sin(t * 0.65 + i * 0.45)
    }
  }

  const maxH   = r3 * 0.52
  const barW   = (r3 * 2 / BAR_N) * 0.6
  const barY   = cy + r3 - 5          // bars bottom-anchored near circle edge

  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, r3 - 2, 0, Math.PI * 2)
  ctx.clip()

  for (let i = 0; i < BAR_N; i++) {
    const x = cx - r3 + (i + 0.5) * (r3 * 2 / BAR_N)
    const h = Math.max(2, data[i] * maxH)
    const a = 0.2 + 0.8 * data[i]

    if (data[i] > 0.35) { ctx.shadowBlur = 6; ctx.shadowColor = A }
    ctx.fillStyle = ag(a)
    ctx.fillRect(x - barW / 2, barY - h, barW, h)
    ctx.shadowBlur = 0
  }

  ctx.restore()
}

// ── Center target + TARS label ───────────────────────────────────────────────
function drawCenter(ctx, cx, cy, R) {
  const r = R * 0.13

  glow(ctx, 7)
  ctx.strokeStyle = ag(0.55)
  ctx.lineWidth   = 1
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke()
  noGlow(ctx)

  ctx.strokeStyle = ag(0.22)
  ctx.lineWidth   = 0.8
  ctx.beginPath()
  ctx.moveTo(cx - r, cy); ctx.lineTo(cx + r, cy)
  ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy + r)
  ctx.stroke()

  glow(ctx, 18)
  ctx.fillStyle    = A
  ctx.font         = 'bold 20px "Courier New", monospace'
  ctx.textAlign    = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('TARS', cx, cy - 6)
  noGlow(ctx)

  ctx.fillStyle = ag(0.4)
  ctx.font      = '7px "Courier New", monospace'
  ctx.fillText('MK.IV', cx, cy + 9)

  glow(ctx, 6)
  ctx.fillStyle = ag(0.65)
  ctx.beginPath(); ctx.arc(cx, cy - 6, 2.5, 0, Math.PI * 2); ctx.fill()
  noGlow(ctx)
}

// ── Status text below ring ───────────────────────────────────────────────────
function drawStatus(ctx, cx, cy, R, state, convMode) {
  const LABELS = {
    idle:       convMode ? '◌ SESSION OPEN'      : '● STANDBY',
    listening:             '◉ RECEIVING SIGNAL',
    processing:            '◈ PROCESSING',
    speaking:              '◎ TRANSMITTING',
  }

  const text = LABELS[state] || '● STANDBY'
  const y    = cy + R + 52

  ctx.textAlign    = 'center'
  ctx.textBaseline = 'top'
  ctx.font         = '12px "Courier New", monospace'

  if (state !== 'idle') glow(ctx, 10)
  ctx.fillStyle = ag(state === 'idle' ? 0.38 : 0.95)
  ctx.fillText(text, cx, y)
  noGlow(ctx)

  ctx.strokeStyle = ag(0.12)
  ctx.lineWidth   = 1
  ctx.beginPath()
  ctx.moveTo(cx - 70, y + 20); ctx.lineTo(cx + 70, y + 20)
  ctx.stroke()
}

// ── Live interim transcript inside the ring (upper area) ─────────────────────
function drawInterimText(ctx, cx, cy, R, text) {
  if (!text) return
  const r3      = R * 0.48
  const maxChar = 34
  const display = (text.length > maxChar ? '…' + text.slice(-(maxChar - 1)) : text).toUpperCase()

  ctx.save()
  // clip to inner circle so text never bleeds outside the ring
  ctx.beginPath()
  ctx.arc(cx, cy, r3 - 6, 0, Math.PI * 2)
  ctx.clip()

  ctx.textAlign    = 'center'
  ctx.textBaseline = 'middle'
  ctx.font         = '9px "Courier New", monospace'
  glow(ctx, 6)
  ctx.fillStyle = ag(0.65)
  ctx.fillText(display, cx, cy - r3 * 0.44)
  noGlow(ctx)

  ctx.restore()
}

// ── Component ────────────────────────────────────────────────────────────────
export function HUDCanvas({ state, honesty, interimText = '', convMode = false }) {
  const canvasRef   = useRef(null)
  const rafRef      = useRef(null)
  const analyserRef = useRef(null)
  const streamRef   = useRef(null)
  const audioCtxRef = useRef(null)
  const tRef        = useRef(0)

  // Microphone → AnalyserNode when listening
  useEffect(() => {
    if (state === 'listening') {
      navigator.mediaDevices
        .getUserMedia({ audio: true, video: false })
        .then((stream) => {
          streamRef.current = stream
          const ac = new (window.AudioContext || window.webkitAudioContext)()
          audioCtxRef.current = ac
          const src = ac.createMediaStreamSource(stream)
          const analyser = ac.createAnalyser()
          analyser.fftSize = 256
          analyser.smoothingTimeConstant = 0.78
          src.connect(analyser)
          analyserRef.current = analyser
        })
        .catch(() => {})
    } else {
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
      audioCtxRef.current?.close().catch(() => {})
      audioCtxRef.current = null
      analyserRef.current = null
    }
  }, [state])

  // RAF draw loop
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')

    const resize = () => {
      canvas.width  = canvas.offsetWidth
      canvas.height = canvas.offsetHeight
    }
    resize()
    window.addEventListener('resize', resize)

    const loop = () => {
      tRef.current += 0.016
      const t  = tRef.current
      const W  = canvas.width
      const H  = canvas.height
      const cx = W / 2
      const cy = H / 2
      const R  = Math.min(W, H) * 0.33

      ctx.fillStyle = '#050510'
      ctx.fillRect(0, 0, W, H)

      drawGrid(ctx, W, H, cx, cy)
      drawCornerText(ctx, W, H, honesty, convMode)
      drawRings(ctx, cx, cy, R, t, state)
      drawWaveform(ctx, cx, cy, R, t, state, analyserRef.current)
      drawInterimText(ctx, cx, cy, R, interimText)
      drawCenter(ctx, cx, cy, R)
      drawStatus(ctx, cx, cy, R, state, convMode)

      rafRef.current = requestAnimationFrame(loop)
    }

    loop()

    return () => {
      cancelAnimationFrame(rafRef.current)
      window.removeEventListener('resize', resize)
    }
  }, [state, honesty, interimText, convMode])

  return (
    <canvas
      ref={canvasRef}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
    />
  )
}
