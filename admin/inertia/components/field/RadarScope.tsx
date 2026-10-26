import { useEffect, useRef } from 'react'
import { EMERGENCY_SQUAWKS } from '../../../util/field_sbs'
import type { FieldState } from '../../../types/field'

export interface ScopeMarker {
  id: number
  name: string
  distanceKm: number
  bearingDeg: number
}

interface RadarScopeProps {
  state: FieldState | undefined
  rangeKm: number
  markers: ScopeMarker[]
  selectedHex: string | null
  targetMarkerId: number | null
  onSelect: (hex: string | null) => void
}

// The scope is an instrument display, so it keeps one dark palette in both themes.
const SCOPE = {
  face: '#23241a',
  ring: '#45482c',
  label: '#a5ab7d',
  sweep: '#d9c9a3',
  blip: '#eadab9',
  marker: '#e69556',
  alert: '#e05a4f',
  self: '#ffffff',
}

const SWEEP_DEG_PER_S = 90

/** Altitude as a flight level above the US transition altitude, else feet. */
export const formatAltitude = (ft: number | null) =>
  ft === null ? '—' : ft >= 18000 ? `FL${Math.round(ft / 100)}` : ft.toLocaleString()

/**
 * North-up radar display of aircraft and saved map markers around the observer,
 * with a rotating sweep and short trails. Click a blip to select it.
 */
export default function RadarScope({
  state,
  rangeKm,
  markers,
  selectedHex,
  targetMarkerId,
  onSelect,
}: RadarScopeProps) {
  const boxRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sizeRef = useRef(0)
  const blipsRef = useRef<{ x: number; y: number; hex: string }[]>([])
  const trailsRef = useRef(new Map<string, [number, number][]>())
  // The draw loop runs outside React, so it reads the latest props from a ref.
  const propsRef = useRef({ state, rangeKm, markers, selectedHex, targetMarkerId })
  propsRef.current = { state, rangeKm, markers, selectedHex, targetMarkerId }

  // Remember recent positions per aircraft for trails.
  useEffect(() => {
    if (!state) return
    const trails = trailsRef.current
    const live = new Set<string>()
    for (const a of state.aircraft) {
      if (a.lat === null || a.lon === null) continue
      live.add(a.hex)
      const t = trails.get(a.hex) ?? []
      const last = t[t.length - 1]
      if (!last || last[0] !== a.lat || last[1] !== a.lon) t.push([a.lat, a.lon])
      if (t.length > 40) t.shift()
      trails.set(a.hex, t)
    }
    for (const hex of trails.keys()) if (!live.has(hex)) trails.delete(hex)
  }, [state])

  useEffect(() => {
    const box = boxRef.current
    const canvas = canvasRef.current
    if (!box || !canvas) return

    const resize = () => {
      const size = Math.floor(Math.min(box.clientWidth, box.clientHeight || box.clientWidth))
      if (size <= 0) return
      const dpr = window.devicePixelRatio || 1
      canvas.style.width = canvas.style.height = `${size}px`
      canvas.width = canvas.height = Math.round(size * dpr)
      sizeRef.current = size
    }
    const observer = new ResizeObserver(resize)
    observer.observe(box)
    resize()

    let frame = 0
    const draw = (ts: number) => {
      frame = requestAnimationFrame(draw)
      const ctx = canvas.getContext('2d')
      const s = sizeRef.current
      if (!ctx || !s) return
      const {
        state: st,
        rangeKm: range,
        markers: marks,
        selectedHex: sel,
        targetMarkerId: target,
      } = propsRef.current
      const c = s / 2
      const R = c - 20
      const dpr = canvas.width / s
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, s, s)
      ctx.font = `11px ${getComputedStyle(canvas).fontFamily}`
      ctx.textBaseline = 'middle'

      // Face, range rings and crosshair.
      ctx.fillStyle = SCOPE.face
      ctx.beginPath()
      ctx.arc(c, c, R, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = SCOPE.ring
      ctx.lineWidth = 1
      for (let k = 1; k <= 4; k++) {
        ctx.beginPath()
        ctx.arc(c, c, (R * k) / 4, 0, Math.PI * 2)
        ctx.stroke()
      }
      ctx.beginPath()
      ctx.moveTo(c - R, c)
      ctx.lineTo(c + R, c)
      ctx.moveTo(c, c - R)
      ctx.lineTo(c, c + R)
      ctx.stroke()
      ctx.fillStyle = SCOPE.label
      ctx.textAlign = 'left'
      for (let k = 1; k <= 4; k++) ctx.fillText(`${(range * k) / 4}`, c + 4, c - (R * k) / 4 + 8)
      ctx.textAlign = 'center'
      for (const [label, x, y] of [
        ['N', 0, -1],
        ['E', 1, 0],
        ['S', 0, 1],
        ['W', -1, 0],
      ] as const) {
        ctx.fillStyle = label === 'N' ? SCOPE.alert : SCOPE.label
        ctx.fillText(label, c + x * (R + 11), c + y * (R + 11))
      }

      // Sweep with a fading tail.
      const sweep = ((ts / 1000) * SWEEP_DEG_PER_S) % 360
      const toCanvas = (bearing: number) => ((bearing - 90) * Math.PI) / 180
      ctx.fillStyle = SCOPE.sweep
      for (let i = 0; i < 24; i++) {
        ctx.globalAlpha = 0.16 * (1 - i / 24)
        ctx.beginPath()
        ctx.moveTo(c, c)
        ctx.arc(c, c, R, toCanvas(sweep - (i + 1) * 2.5), toCanvas(sweep - i * 2.5))
        ctx.closePath()
        ctx.fill()
      }
      ctx.globalAlpha = 0.8
      ctx.strokeStyle = SCOPE.sweep
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(c, c)
      ctx.lineTo(c + Math.cos(toCanvas(sweep)) * R, c + Math.sin(toCanvas(sweep)) * R)
      ctx.stroke()
      ctx.globalAlpha = 1

      if (!st?.origin) return
      const origin = st.origin
      const toXY = (dist: number, bearing: number) => {
        const b = (bearing * Math.PI) / 180
        return [c + (Math.sin(b) * dist * R) / range, c - (Math.cos(b) * dist * R) / range]
      }

      // Saved map markers.
      ctx.textAlign = 'left'
      for (const m of marks) {
        if (m.distanceKm > range) continue
        const [x, y] = toXY(m.distanceKm, m.bearingDeg)
        ctx.fillStyle = SCOPE.marker
        ctx.globalAlpha = m.id === target ? 1 : 0.75
        ctx.beginPath()
        ctx.moveTo(x, y - 6)
        ctx.lineTo(x + 6, y)
        ctx.lineTo(x, y + 6)
        ctx.lineTo(x - 6, y)
        ctx.closePath()
        ctx.fill()
        ctx.fillText(m.name, x + 9, y)
      }
      ctx.globalAlpha = 1

      // Aircraft, brightest just after the sweep passes them.
      const blips: { x: number; y: number; hex: string }[] = []
      const kmEast = 111.32 * Math.cos((origin.lat * Math.PI) / 180)
      for (const a of st.aircraft) {
        if (a.distanceKm === null || a.bearingDeg === null || a.distanceKm > range) continue
        const [x, y] = toXY(a.distanceKm, a.bearingDeg)
        const since = (((sweep - a.bearingDeg) % 360) + 360) % 360
        const glow = 0.4 + 0.6 * (1 - since / 360)
        const emergency = a.squawk !== null && a.squawk in EMERGENCY_SQUAWKS
        const color = emergency ? SCOPE.alert : SCOPE.blip
        blips.push({ x, y, hex: a.hex })

        const trail = trailsRef.current.get(a.hex)
        if (trail && trail.length > 1) {
          ctx.globalAlpha = 0.3 * glow
          ctx.strokeStyle = color
          ctx.lineWidth = 1
          ctx.beginPath()
          trail.forEach(([lat, lon], i) => {
            const px = c + (((lon - origin.lon) * kmEast) / range) * R
            const py = c - (((lat - origin.lat) * 110.574) / range) * R
            i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)
          })
          ctx.stroke()
        }

        ctx.globalAlpha = glow
        ctx.fillStyle = color
        ctx.save()
        ctx.translate(x, y)
        ctx.rotate(((a.trackDeg ?? 0) * Math.PI) / 180)
        ctx.beginPath()
        ctx.moveTo(0, -7)
        ctx.lineTo(5, 5)
        ctx.lineTo(0, 2)
        ctx.lineTo(-5, 5)
        ctx.closePath()
        ctx.fill()
        ctx.restore()
        ctx.fillText(a.callsign ?? a.hex, x + 9, y - 6)
        ctx.fillStyle = SCOPE.label
        ctx.fillText(formatAltitude(a.altFt), x + 9, y + 7)
        if (emergency) {
          ctx.strokeStyle = SCOPE.alert
          ctx.lineWidth = 2
          ctx.globalAlpha = 0.5 + 0.5 * Math.sin(ts / 180)
          ctx.beginPath()
          ctx.arc(x, y, 13, 0, Math.PI * 2)
          ctx.stroke()
        }
        if (a.hex === sel) {
          ctx.globalAlpha = 1
          ctx.strokeStyle = SCOPE.self
          ctx.lineWidth = 1
          ctx.strokeRect(x - 11, y - 11, 22, 22)
        }
        ctx.globalAlpha = 1
      }
      blipsRef.current = blips

      // Observer, with a heading line when moving.
      const g = st.gps
      ctx.fillStyle = origin.source === 'gps' ? SCOPE.self : SCOPE.marker
      ctx.beginPath()
      ctx.arc(c, c, 4, 0, Math.PI * 2)
      ctx.fill()
      if (g.hasFix && (g.speedKmh ?? 0) > 1 && g.courseDeg !== null) {
        ctx.strokeStyle = SCOPE.self
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.moveTo(c, c)
        ctx.lineTo(
          c + Math.cos(toCanvas(g.courseDeg)) * 22,
          c + Math.sin(toCanvas(g.courseDeg)) * 22
        )
        ctx.stroke()
      }
    }
    frame = requestAnimationFrame(draw)

    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [])

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    let best: string | null = null
    let bestDist = 24
    for (const b of blipsRef.current) {
      const d = Math.hypot(b.x - x, b.y - y)
      if (d < bestDist) {
        bestDist = d
        best = b.hex
      }
    }
    onSelect(best === selectedHex ? null : best)
  }

  return (
    <div ref={boxRef} className="flex aspect-square w-full items-center justify-center">
      <canvas
        ref={canvasRef}
        onClick={handleClick}
        aria-label="Radar scope"
        className="font-mono"
      />
    </div>
  )
}
