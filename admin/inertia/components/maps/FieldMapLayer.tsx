import { Marker } from 'react-map-gl/maplibre'
import { useFieldState } from '~/hooks/useFieldState'
import { formatAltitude } from '~/components/field/RadarScope'
import { EMERGENCY_SQUAWKS } from '../../../util/field_sbs'

/**
 * Live overlay from the Field sensors: your GPS position (with a heading line
 * when moving) and ADS-B aircraft. Only polls while shown.
 */
export default function FieldMapLayer({ enabled }: { enabled: boolean }) {
  const { data: state } = useFieldState(enabled)
  if (!enabled || !state) return null

  const g = state.gps
  const moving = g.hasFix && (g.speedKmh ?? 0) > 1 && g.courseDeg !== null

  return (
    <>
      {state.aircraft.map((a) => {
        if (a.lat === null || a.lon === null) return null
        const emergency = a.squawk !== null && a.squawk in EMERGENCY_SQUAWKS
        return (
          <Marker key={a.hex} longitude={a.lon} latitude={a.lat} anchor="center">
            <div className="pointer-events-none flex items-center gap-1" aria-hidden="true">
              <svg
                width="18"
                height="18"
                viewBox="-9 -9 18 18"
                style={{ transform: `rotate(${a.trackDeg ?? 0}deg)` }}
              >
                <path
                  d="M0 -8 L6 6 L0 3 L-6 6 Z"
                  fill={emergency ? '#c0392b' : '#2a2918'}
                  stroke="#f7eedc"
                  strokeWidth="1.2"
                />
              </svg>
              <span
                className={`whitespace-nowrap rounded px-1 text-[11px] font-semibold leading-tight shadow ${
                  emergency ? 'bg-desert-red text-white' : 'bg-surface-primary/90 text-text-primary'
                }`}
              >
                {a.callsign ?? a.hex} {formatAltitude(a.altFt)}
                {emergency && ` ${EMERGENCY_SQUAWKS[a.squawk!]}`}
              </span>
            </div>
          </Marker>
        )
      })}

      {g.hasFix && g.lat !== null && g.lon !== null && (
        <Marker longitude={g.lon} latitude={g.lat} anchor="center">
          <div
            className="pointer-events-none relative h-5 w-5"
            title="Your GPS position"
            aria-label="Your GPS position"
          >
            {moving && (
              <div
                className="absolute left-1/2 top-1/2 h-8 w-[3px] origin-bottom rounded bg-blue-600"
                style={{ transform: `translate(-50%, -100%) rotate(${g.courseDeg}deg)` }}
              />
            )}
            <div className="absolute inset-0 animate-ping rounded-full bg-blue-500/40" />
            <div className="absolute inset-0.5 rounded-full border-2 border-white bg-blue-600 shadow" />
          </div>
        </Marker>
      )}
    </>
  )
}
