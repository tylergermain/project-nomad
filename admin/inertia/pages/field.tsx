import { useEffect, useMemo, useRef, useState } from 'react'
import { Head, Link } from '@inertiajs/react'
import { useQueryClient } from '@tanstack/react-query'
import { IconAlertTriangle, IconMapPin } from '@tabler/icons-react'
import classNames from 'classnames'
import AppLayout from '~/layouts/AppLayout'
import StyledButton from '~/components/StyledButton'
import RadarScope, { formatAltitude, type ScopeMarker } from '~/components/field/RadarScope'
import FieldSourcesPanel from '~/components/field/FieldSourcesPanel'
import { FIELD_STATE_QUERY_KEY, useFieldState } from '~/hooks/useFieldState'
import { useMapMarkers } from '~/hooks/useMapMarkers'
import api from '~/lib/api'
import { bearingDeg, cardinal, distanceKm } from '../../util/field_geo'
import { EMERGENCY_SQUAWKS } from '../../util/field_sbs'
import type { FieldState } from '../../types/field'

const RANGES_KM = [5, 10, 25, 50, 100, 250]
const RANGE_KEY = 'nomad:field-range'
const TARGET_KEY = 'nomad:field-target'
const WALKING_KMH = 4.5

const pad = (n: number) => String(n).padStart(2, '0')
const clock = (unix: number) => {
  const d = new Date(unix * 1000)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const duration = (secs: number) => {
  const s = Math.max(0, Math.round(secs))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h ? `${h}h ${pad(m)}m` : `${m}m`
}
const km = (d: number | null) =>
  d === null
    ? '—'
    : d < 1
      ? `${Math.round(d * 1000)} m`
      : d < 100
        ? `${d.toFixed(1)} km`
        : `${Math.round(d)} km`
const dms = (v: number, pos: string, neg: string) => {
  const a = Math.abs(v)
  const d = Math.floor(a)
  const mf = (a - d) * 60
  const m = Math.floor(mf)
  return `${d}°${pad(m)}'${((mf - m) * 60).toFixed(1).padStart(4, '0')}"${v >= 0 ? pos : neg}`
}

const readStored = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}
const writeStored = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // ignore persistence failures (private mode, quota)
  }
}

function Card({
  title,
  children,
  className,
}: {
  title: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <section
      className={classNames(
        'rounded-lg border border-border-default bg-surface-primary p-5',
        className
      )}
    >
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-text-secondary">
        {title}
      </h2>
      {children}
    </section>
  )
}

function Rows({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm tabular-nums">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-text-secondary">{k}</dt>
          <dd className="text-right text-text-primary">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

function StatusChip({
  label,
  status,
  source,
  okText,
}: {
  label: string
  status: string
  source: string
  okText?: string
}) {
  const failing = status.startsWith('error') || status === 'disconnected'
  const tone =
    source === 'off'
      ? 'bg-text-muted'
      : status === 'ok'
        ? 'bg-green-600'
        : failing
          ? 'bg-desert-red'
          : 'bg-desert-orange'
  const text = source === 'off' ? 'off' : status === 'ok' ? (okText ?? 'receiving') : status
  return (
    <span className="flex items-center gap-2 rounded-full border border-border-default bg-surface-primary px-3 py-1 text-sm">
      <span className={classNames('h-2.5 w-2.5 rounded-full', tone)} />
      <span className="font-semibold">{label}</span>
      <span className="max-w-[16rem] truncate text-text-secondary">{text}</span>
    </span>
  )
}

function MoonPhase({ phase, southern }: { phase: number; southern: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const ctx = ref.current?.getContext('2d')
    if (!ctx) return
    const r = 40
    const c = 44
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, 88, 88)
    // Seen mirrored from the southern hemisphere.
    if (southern) ctx.setTransform(-1, 0, 0, 1, 88, 0)
    ctx.fillStyle = '#353420'
    ctx.beginPath()
    ctx.arc(c, c, r, 0, Math.PI * 2)
    ctx.fill()
    const k = Math.cos(2 * Math.PI * phase) // 1 at new moon, -1 at full
    ctx.fillStyle = '#eadab9'
    ctx.beginPath()
    ctx.arc(c, c, r, -Math.PI / 2, Math.PI / 2, phase >= 0.5) // lit half
    ctx.fill()
    ctx.fillStyle = k > 0 ? '#353420' : '#eadab9' // terminator
    ctx.beginPath()
    ctx.ellipse(c, c, r * Math.abs(k), r, 0, 0, Math.PI * 2)
    ctx.fill()
  }, [phase, southern])
  return <canvas ref={ref} width={88} height={88} aria-hidden="true" />
}

function Compass({ bearing, heading }: { bearing: number; heading: number }) {
  const ticks = []
  for (let d = 0; d < 360; d += 10) {
    const major = d % 90 === 0
    const a = ((d - 90) * Math.PI) / 180
    const r1 = major ? 72 : 80
    ticks.push(
      <line
        key={d}
        x1={100 + Math.cos(a) * r1}
        y1={100 + Math.sin(a) * r1}
        x2={100 + Math.cos(a) * 88}
        y2={100 + Math.sin(a) * 88}
        className={major ? 'stroke-text-primary' : 'stroke-text-muted'}
        strokeWidth={major ? 2.5 : 1.5}
      />
    )
  }
  return (
    <svg viewBox="0 0 200 200" className="mx-auto block w-48" aria-hidden="true">
      <g transform={`rotate(${-heading} 100 100)`}>
        <circle
          cx="100"
          cy="100"
          r="92"
          fill="none"
          className="stroke-border-default"
          strokeWidth="2"
        />
        {ticks}
        <text
          x="100"
          y="26"
          textAnchor="middle"
          dominantBaseline="middle"
          className="fill-desert-red text-sm font-bold"
        >
          N
        </text>
      </g>
      <path
        d="M100 38 L116 112 L100 101 L84 112 Z"
        transform={`rotate(${bearing - heading} 100 100)`}
        className="fill-desert-orange"
      />
    </svg>
  )
}

export default function Field() {
  const queryClient = useQueryClient()
  const { data: state, isError } = useFieldState()
  const { markers, addMarker } = useMapMarkers()
  const [rangeKm, setRangeKm] = useState<number>(() => readStored(RANGE_KEY, 100))
  const [targetId, setTargetId] = useState<number | null>(() => readStored(TARGET_KEY, null))
  const [selectedHex, setSelectedHex] = useState<string | null>(null)
  const [showSources, setShowSources] = useState(false)
  const [markName, setMarkName] = useState('')
  const [markMessage, setMarkMessage] = useState<string | null>(null)

  const refresh = () => queryClient.invalidateQueries({ queryKey: FIELD_STATE_QUERY_KEY })

  const origin = state?.origin ?? null
  const placedMarkers = useMemo(
    () =>
      origin
        ? markers
            .filter((m) => m.visible !== false)
            .map((m) => ({
              ...m,
              distanceKm: distanceKm(origin.lat, origin.lon, m.latitude, m.longitude),
              bearingDeg: bearingDeg(origin.lat, origin.lon, m.latitude, m.longitude),
            }))
            .sort((a, b) => a.distanceKm - b.distanceKm)
        : [],
    [markers, origin?.lat, origin?.lon]
  )
  const scopeMarkers: ScopeMarker[] = placedMarkers
  const target = placedMarkers.find((m) => m.id === targetId) ?? null

  const chooseTarget = (id: number | null) => {
    setTargetId(id)
    writeStored(TARGET_KEY, id)
  }

  const markHere = async () => {
    if (!state?.gps.hasFix || state.gps.lat === null || state.gps.lon === null) {
      setMarkMessage('No GPS fix yet, so there is no position to mark.')
      return
    }
    const name = markName.trim() || `Waypoint ${markers.length + 1}`
    const marker = await addMarker({
      name,
      latitude: state.gps.lat,
      longitude: state.gps.lon,
      notes: 'Marked from the Field page',
    })
    if (marker) {
      setMarkName('')
      setMarkMessage(`Saved "${marker.name}" to your map markers.`)
    }
  }

  const tryDemo = async () => {
    const config = state?.config
    await api.updateFieldConfig({
      gpsSource: 'demo',
      adsbSource: 'demo',
      homeLat: config?.homeLat ?? null,
      homeLon: config?.homeLon ?? null,
    })
    refresh()
  }

  const nothingConfigured =
    state &&
    state.config.gpsSource === 'off' &&
    state.config.adsbSource === 'off' &&
    state.origin === null
  const usingDemo =
    state && (state.config.gpsSource === 'demo' || state.config.adsbSource === 'demo')

  return (
    <AppLayout compact>
      <Head title="Field" />
      <div className="mx-auto w-full max-w-7xl px-4 pb-12 pt-14 md:px-8">
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <h1 className="mr-2 text-3xl font-bold text-desert-green">Field</h1>
          {state && (
            <>
              <StatusChip
                label="GPS"
                source={state.gps.source}
                status={state.gps.status}
                okText={`${state.gps.sats ?? '?'} satellites`}
              />
              <StatusChip label="ADS-B" source={state.adsb.source} status={state.adsb.status} />
            </>
          )}
          {usingDemo && (
            <span className="rounded border border-desert-orange px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-desert-orange">
              Demo data
            </span>
          )}
          {isError && (
            <span className="rounded border border-desert-red px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-desert-red">
              No link to NOMAD
            </span>
          )}
          <span className="flex-1" />
          <StyledButton
            variant={showSources ? 'secondary' : 'outline'}
            icon="IconSettings"
            onClick={() => setShowSources((v) => !v)}
          >
            Sources
          </StyledButton>
        </div>

        {state && (showSources || nothingConfigured) && (
          <Card title="Sensor sources" className="mb-6">
            {nothingConfigured && !showSources && (
              <div className="mb-6 rounded border border-border-default bg-surface-secondary p-4 text-sm">
                <p className="mb-3 text-text-primary">
                  No sensors are set up yet. Connect a USB GPS and an ADS-B radio to this NOMAD, or
                  try it with simulated data first.
                </p>
                <StyledButton variant="primary" onClick={tryDemo}>
                  Try demo data
                </StyledButton>
              </div>
            )}
            <FieldSourcesPanel
              key={JSON.stringify(state.config)}
              config={state.config}
              origin={state.origin}
              onSaved={() => {
                setShowSources(false)
                refresh()
              }}
            />
          </Card>
        )}

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
          <Card title="Radar">
            <RadarScope
              state={state}
              rangeKm={rangeKm}
              markers={scopeMarkers}
              selectedHex={selectedHex}
              targetMarkerId={targetId}
              onSelect={setSelectedHex}
            />
            {state && !origin && (
              <p className="mt-3 text-center text-sm text-text-secondary">
                No position yet. Waiting for a GPS fix, or set a home position under Sources.
              </p>
            )}
          </Card>

          <div className="flex min-h-0 flex-col gap-6">
            <Card title="Aircraft" className="flex min-h-0 flex-1 flex-col">
              <div
                className="mb-3 grid grid-cols-6 gap-1"
                role="group"
                aria-label="Radar range in km"
              >
                {RANGES_KM.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => {
                      setRangeKm(r)
                      writeStored(RANGE_KEY, r)
                    }}
                    className={classNames(
                      'rounded border py-1.5 text-xs font-semibold',
                      r === rangeKm
                        ? 'border-desert-green bg-desert-green text-white'
                        : 'border-border-default bg-surface-secondary text-text-secondary hover:border-desert-green'
                    )}
                  >
                    {r} km
                  </button>
                ))}
              </div>
              <AircraftTable
                state={state}
                rangeKm={rangeKm}
                selectedHex={selectedHex}
                onSelect={setSelectedHex}
              />
            </Card>
          </div>
        </div>

        <div className="mt-6 grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          <Card title="Position">
            {state && origin ? (
              <>
                <p className="text-2xl font-bold tabular-nums">
                  {origin.lat.toFixed(5)}, {origin.lon.toFixed(5)}
                </p>
                <p className="mb-4 text-sm text-text-secondary">
                  {dms(origin.lat, 'N', 'S')} {dms(origin.lon, 'E', 'W')}
                  {origin.source === 'home' && (
                    <span className="text-desert-orange"> · home position, no GPS fix</span>
                  )}
                </p>
                <Rows
                  rows={[
                    [
                      'Altitude',
                      state.gps.altM === null
                        ? '—'
                        : `${Math.round(state.gps.altM)} m (${Math.round(state.gps.altM * 3.281).toLocaleString()} ft)`,
                    ],
                    [
                      'Speed',
                      state.gps.speedKmh === null ? '—' : `${state.gps.speedKmh.toFixed(1)} km/h`,
                    ],
                    [
                      'Course',
                      state.gps.courseDeg === null || (state.gps.speedKmh ?? 0) <= 1
                        ? '—'
                        : `${Math.round(state.gps.courseDeg)}° ${cardinal(state.gps.courseDeg)}`,
                    ],
                    ['Satellites', state.gps.sats ?? '—'],
                    [
                      'Accuracy (HDOP)',
                      state.gps.hdop === null
                        ? '—'
                        : `${state.gps.hdop.toFixed(1)} ${state.gps.hdop < 2 ? 'good' : state.gps.hdop < 5 ? 'fair' : 'poor'}`,
                    ],
                    [
                      'GPS time',
                      state.gps.utcTime
                        ? `${state.gps.utcDate ?? ''} ${state.gps.utcTime} UTC`
                        : '—',
                    ],
                  ]}
                />
                <Link
                  href={`/maps?lat=${origin.lat.toFixed(6)}&lng=${origin.lon.toFixed(6)}&zoom=14`}
                  className="mt-4 inline-flex items-center gap-1 text-sm text-desert-green underline"
                >
                  <IconMapPin size={16} /> Show on map
                </Link>
              </>
            ) : (
              <p className="text-sm text-text-secondary">No position yet.</p>
            )}
          </Card>

          <Card title="Waypoints">
            {target && origin && (
              <div className="mb-5 border-b border-border-default pb-5">
                <p className="mb-2 text-center text-lg font-bold text-desert-orange">
                  {target.name}
                </p>
                <TargetCompass state={state!} bearing={target.bearingDeg} />
                <Rows
                  rows={[
                    ['Distance', km(target.distanceKm)],
                    [
                      'Bearing',
                      `${Math.round(target.bearingDeg)}° ${cardinal(target.bearingDeg)} (true)`,
                    ],
                    [
                      'On foot',
                      `≈ ${duration((target.distanceKm / WALKING_KMH) * 3600)} at ${WALKING_KMH} km/h`,
                    ],
                  ]}
                />
              </div>
            )}
            <form
              className="mb-2 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                markHere()
              }}
            >
              <input
                value={markName}
                onChange={(e) => setMarkName(e.target.value)}
                maxLength={255}
                placeholder="Name, e.g. Water source"
                aria-label="Waypoint name"
                className="min-w-0 flex-1 rounded border border-border-default bg-surface-primary px-3 py-2 text-sm placeholder:text-text-muted focus:border-desert-green focus:outline-none"
              />
              <StyledButton variant="primary" onClick={markHere} disabled={!state?.gps.hasFix}>
                Mark here
              </StyledButton>
            </form>
            {markMessage && <p className="mb-2 text-sm text-text-secondary">{markMessage}</p>}
            {placedMarkers.length === 0 ? (
              <p className="text-sm text-text-secondary">
                Waypoints are your map markers. Mark one here, or add them on the{' '}
                <Link href="/maps" className="underline">
                  map
                </Link>
                .
              </p>
            ) : (
              <ul className="max-h-72 divide-y divide-border-subtle overflow-y-auto">
                {placedMarkers.map((m) => (
                  <li key={m.id} className="flex items-center gap-3 py-2">
                    <span
                      className="inline-block text-lg text-desert-orange"
                      style={{ transform: `rotate(${m.bearingDeg}deg)` }}
                      aria-hidden="true"
                    >
                      ↑
                    </span>
                    <div className="min-w-0 flex-1">
                      <p
                        className={classNames(
                          'truncate font-semibold',
                          m.id === targetId && 'text-desert-orange'
                        )}
                      >
                        {m.name}
                      </p>
                      <p className="text-xs text-text-secondary tabular-nums">
                        {km(m.distanceKm)} · {Math.round(m.bearingDeg)}° {cardinal(m.bearingDeg)}
                      </p>
                    </div>
                    <StyledButton
                      size="sm"
                      variant={m.id === targetId ? 'secondary' : 'outline'}
                      onClick={() => chooseTarget(m.id === targetId ? null : m.id)}
                    >
                      {m.id === targetId ? 'Stop' : 'Go'}
                    </StyledButton>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Sun and moon">
            {state?.sky ? (
              <SkyPanel state={state} />
            ) : (
              <p className="text-sm text-text-secondary">Needs a position.</p>
            )}
          </Card>
        </div>
      </div>
    </AppLayout>
  )
}

function TargetCompass({ state, bearing }: { state: FieldState; bearing: number }) {
  const g = state.gps
  const moving = g.hasFix && (g.speedKmh ?? 0) > 1.5 && g.courseDeg !== null
  return (
    <>
      <Compass bearing={bearing} heading={moving ? g.courseDeg! : 0} />
      <p className="mb-3 text-center text-xs text-text-secondary">
        {moving
          ? 'Arrow is relative to your direction of travel'
          : "North-up: GPS can't tell which way you face while standing still"}
      </p>
    </>
  )
}

function AircraftTable({
  state,
  rangeKm,
  selectedHex,
  onSelect,
}: {
  state: FieldState | undefined
  rangeKm: number
  selectedHex: string | null
  onSelect: (hex: string | null) => void
}) {
  const list = state?.aircraft ?? []
  const inRange = list.filter((a) => a.distanceKm !== null && a.distanceKm <= rangeKm).length
  return (
    <>
      <p className="mb-2 text-xs text-text-secondary">
        {list.length} tracked · {inRange} within {rangeKm} km
      </p>
      <div className="min-h-0 flex-1 overflow-auto rounded border border-border-default">
        <table className="w-full text-sm tabular-nums">
          <thead className="sticky top-0 bg-surface-secondary text-xs uppercase tracking-wider text-text-secondary">
            <tr>
              <th className="px-2 py-2 text-left">Flight</th>
              <th className="px-2 py-2 text-right">Alt</th>
              <th className="px-2 py-2 text-right">Kt</th>
              <th className="px-2 py-2 text-right">Km</th>
              <th className="px-2 py-2 text-right">Brg</th>
            </tr>
          </thead>
          <tbody>
            {list.length === 0 && (
              <tr>
                <td colSpan={5} className="px-2 py-3 text-text-secondary">
                  {state?.adsb.source === 'off' ? 'ADS-B is off.' : 'No aircraft heard yet.'}
                </td>
              </tr>
            )}
            {list.map((a) => {
              const emergency = a.squawk !== null ? EMERGENCY_SQUAWKS[a.squawk] : undefined
              return (
                <tr
                  key={a.hex}
                  // pointerdown, not click: rows re-sort every second and a click needs the same row on press and release.
                  onPointerDown={() => onSelect(a.hex === selectedHex ? null : a.hex)}
                  className={classNames(
                    'cursor-pointer border-t border-border-subtle',
                    a.hex === selectedHex && 'bg-surface-secondary',
                    emergency && 'font-bold text-desert-red'
                  )}
                >
                  <td className="px-2 py-1.5 text-left">
                    {a.callsign ?? a.hex}
                    {emergency && (
                      <span className="ml-1 inline-flex items-center gap-0.5 text-xs">
                        <IconAlertTriangle size={14} /> {emergency}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-right">{formatAltitude(a.altFt)}</td>
                  <td className="px-2 py-1.5 text-right">
                    {a.speedKt === null ? '—' : Math.round(a.speedKt)}
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    {a.distanceKm === null ? '—' : a.distanceKm.toFixed(a.distanceKm < 10 ? 1 : 0)}
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    {a.bearingDeg === null
                      ? '—'
                      : String(Math.round(a.bearingDeg)).padStart(3, '0')}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}

function SkyPanel({ state }: { state: FieldState }) {
  const sky = state.sky!
  const now = state.now
  const rows: [string, React.ReactNode][] = []
  if (sky.polar) {
    rows.push(['Today', sky.polar === 'day' ? 'Sun never sets' : 'Sun never rises'])
  } else {
    const rise = sky.sunrise!
    const set = sky.sunset!
    rows.push(
      ['Sunrise', clock(rise)],
      ['Solar noon', clock(sky.solarNoon)],
      ['Sunset', clock(set)],
      ['Day length', duration(set - rise)]
    )
    if (now < rise) rows.push(['Until sunrise', duration(rise - now)])
    else if (now < set)
      rows.push([
        'Daylight left',
        <span className={set - now < 3600 ? 'text-desert-orange' : ''}>{duration(set - now)}</span>,
      ])
    else rows.push(['Dark since', clock(set)])
  }

  // Days until the given phase; within a day either side counts as "now".
  const until = (at: number) => {
    const d = ((((at - sky.moonPhase) % 1) + 1) % 1) * 29.53
    return d < 1 || d > 28.53 ? 'now' : `in ${Math.round(d)} days`
  }

  return (
    <>
      <Rows rows={rows} />
      <div className="mt-5 flex items-center gap-5 border-t border-border-default pt-5">
        <MoonPhase phase={sky.moonPhase} southern={(state.origin?.lat ?? 0) < 0} />
        <div className="flex-1">
          <Rows
            rows={[
              ['Moon', sky.moonName],
              ['Lit', `${Math.round(sky.moonIllumination * 100)}%`],
              ['Next full', until(0.5)],
              ['Next new', until(0)],
            ]}
          />
        </div>
      </div>
      <p className="mt-4 text-xs text-text-muted">
        Computed on this NOMAD from your position. Times are in this screen's time zone.
      </p>
    </>
  )
}
