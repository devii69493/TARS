import { useEffect, useRef } from 'react'

const AMBER = 'rgba(245, 166, 35,'
const color = (alpha) => `${AMBER} ${alpha})`

export function Waveform({ state }) {
  const canvasRef = useRef(null)
  const rafRef = useRef(null)
  const analyserRef = useRef(null)
  const streamRef = useRef(null)
  const audioCtxRef = useRef(null)
  const tRef = useRef(0)

  // Manage microphone connection based on state
  useEffect(() => {
    if (state === 'listening') {
      navigator.mediaDevices
        .getUserMedia({ audio: true, video: false })
        .then((stream) => {
          streamRef.current = stream
          const ctx = new (window.AudioContext || window.webkitAudioContext)()
          audioCtxRef.current = ctx
          const source = ctx.createMediaStreamSource(stream)
          const analyser = ctx.createAnalyser()
          analyser.fftSize = 512
          analyser.smoothingTimeConstant = 0.8
          source.connect(analyser)
          analyserRef.current = analyser
        })
        .catch(() => {}) // mic denied — animation falls back to simulated
    } else {
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
      audioCtxRef.current?.close().catch(() => {})
      audioCtxRef.current = null
      analyserRef.current = null
    }
  }, [state])

  // Animation loop
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx2d = canvas.getContext('2d')

    const resize = () => {
      canvas.width = canvas.offsetWidth
      canvas.height = canvas.offsetHeight
    }
    resize()
    window.addEventListener('resize', resize)

    const draw = () => {
      const W = canvas.width
      const H = canvas.height
      const cy = H / 2
      tRef.current += 0.016

      const t = tRef.current

      ctx2d.clearRect(0, 0, W, H)

      if (state === 'listening' && analyserRef.current) {
        const buf = new Uint8Array(analyserRef.current.frequencyBinCount)
        analyserRef.current.getByteTimeDomainData(buf)

        ctx2d.strokeStyle = color(0.95)
        ctx2d.lineWidth = 2
        ctx2d.shadowBlur = 8
        ctx2d.shadowColor = color(0.5)
        ctx2d.beginPath()

        const step = W / buf.length
        buf.forEach((v, i) => {
          const y = cy + ((v / 128) - 1) * (cy - 6)
          i === 0 ? ctx2d.moveTo(0, y) : ctx2d.lineTo(i * step, y)
        })
        ctx2d.stroke()
        ctx2d.shadowBlur = 0

      } else if (state === 'processing') {
        ctx2d.strokeStyle = color(0.7)
        ctx2d.lineWidth = 2
        ctx2d.shadowBlur = 12
        ctx2d.shadowColor = color(0.4)
        ctx2d.beginPath()
        ctx2d.moveTo(0, cy)

        for (let x = 0; x < W; x++) {
          const p = x / W
          const env = Math.sin(p * Math.PI)
          const y = cy + Math.sin(x * 0.12 + t * 5) * 14 * env
                       + Math.sin(x * 0.06 + t * 3) * 8 * env
          ctx2d.lineTo(x, y)
        }
        ctx2d.stroke()
        ctx2d.shadowBlur = 0

      } else if (state === 'speaking') {
        ctx2d.strokeStyle = color(0.9)
        ctx2d.lineWidth = 2.5
        ctx2d.shadowBlur = 14
        ctx2d.shadowColor = color(0.45)
        ctx2d.beginPath()
        ctx2d.moveTo(0, cy)

        for (let x = 0; x < W; x++) {
          const p = x / W
          const env = Math.sin(p * Math.PI)
          const y = cy
            + Math.sin(x * 0.09 + t * 4.5) * 18 * env
            + Math.sin(x * 0.18 + t * 2.8) * 10 * env
            + Math.sin(x * 0.04 + t * 1.2) * 6 * env
          ctx2d.lineTo(x, y)
        }
        ctx2d.stroke()
        ctx2d.shadowBlur = 0

      } else {
        // idle — flat with subtle breath
        ctx2d.strokeStyle = color(0.3)
        ctx2d.lineWidth = 1.5
        ctx2d.beginPath()
        ctx2d.moveTo(0, cy)

        for (let x = 0; x < W; x++) {
          const y = cy
            + Math.sin(x * 0.015 + t * 0.4) * 3
            + Math.sin(x * 0.04 + t * 0.25) * 1.5
          ctx2d.lineTo(x, y)
        }
        ctx2d.stroke()
      }

      rafRef.current = requestAnimationFrame(draw)
    }

    draw()

    return () => {
      cancelAnimationFrame(rafRef.current)
      window.removeEventListener('resize', resize)
    }
  }, [state])

  return (
    <canvas
      ref={canvasRef}
      style={{ width: '100%', height: '100%', display: 'block' }}
    />
  )
}
