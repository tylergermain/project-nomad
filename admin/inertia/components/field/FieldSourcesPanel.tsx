import { useState } from 'react'
import StyledButton from '~/components/StyledButton'
import api from '~/lib/api'
import type { FieldConfig, FieldOrigin } from '../../../types/field'

type GpsKind = 'off' | 'demo' | 'gpsd' | 'device'
type AdsbKind = 'off' | 'demo' | 'sbs'

// NOMAD's admin runs in Docker, so daemons on the host are reached through host.docker.internal.
const DEFAULT_GPSD = 'host.docker.internal:2947'
const DEFAULT_SBS = 'host.docker.internal:30003'
const DEFAULT_DEVICE = '/dev/ttyACM0'

function splitGps(source: string): { kind: GpsKind; detail: string } {
  if (source === 'off' || source === 'demo') return { kind: source, detail: '' }
  if (source.startsWith('gpsd'))
    return { kind: 'gpsd', detail: source.slice('gpsd:'.length) || DEFAULT_GPSD }
  return { kind: 'device', detail: source }
}

function splitAdsb(source: string): { kind: AdsbKind; detail: string } {
  if (source === 'off' || source === 'demo') return { kind: source, detail: '' }
  return { kind: 'sbs', detail: source.slice('sbs:'.length) || DEFAULT_SBS }
}

const inputClass =
  'w-full rounded border border-border-default bg-surface-primary px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-desert-green focus:outline-none'
const labelClass = 'mb-1 block text-sm font-semibold text-text-primary'
const hintClass = 'mt-1 text-xs text-text-secondary'

export default function FieldSourcesPanel({
  config,
  origin,
  onSaved,
}: {
  config: FieldConfig
  origin: FieldOrigin | null
  onSaved: () => void
}) {
  const initialGps = splitGps(config.gpsSource)
  const initialAdsb = splitAdsb(config.adsbSource)
  const [gpsKind, setGpsKind] = useState<GpsKind>(initialGps.kind)
  const [gpsDetail, setGpsDetail] = useState(initialGps.detail)
  const [adsbKind, setAdsbKind] = useState<AdsbKind>(initialAdsb.kind)
  const [adsbDetail, setAdsbDetail] = useState(initialAdsb.detail)
  const [homeLat, setHomeLat] = useState(config.homeLat?.toString() ?? '')
  const [homeLon, setHomeLon] = useState(config.homeLon?.toString() ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    const lat = homeLat.trim() === '' ? null : Number(homeLat)
    const lon = homeLon.trim() === '' ? null : Number(homeLon)
    if (
      (lat === null) !== (lon === null) ||
      (lat !== null && (!Number.isFinite(lat) || !Number.isFinite(lon)))
    ) {
      setError('Enter both home latitude and longitude as decimal degrees, or leave both empty.')
      return
    }
    const gpsSource =
      gpsKind === 'gpsd'
        ? `gpsd:${gpsDetail.trim() || DEFAULT_GPSD}`
        : gpsKind === 'device'
          ? gpsDetail.trim() || DEFAULT_DEVICE
          : gpsKind
    const adsbSource = adsbKind === 'sbs' ? `sbs:${adsbDetail.trim() || DEFAULT_SBS}` : adsbKind

    setSaving(true)
    setError(null)
    const result = await api.updateFieldConfig({
      gpsSource,
      adsbSource,
      homeLat: lat,
      homeLon: lon,
    })
    setSaving(false)
    if (result) onSaved()
    else setError('Could not save. Check the addresses and device path.')
  }

  return (
    <div className="grid gap-6 md:grid-cols-3">
      <div>
        <label className={labelClass} htmlFor="field-gps-kind">
          GPS
        </label>
        <select
          id="field-gps-kind"
          className={inputClass}
          value={gpsKind}
          onChange={(e) => {
            const kind = e.target.value as GpsKind
            setGpsKind(kind)
            setGpsDetail(kind === 'gpsd' ? DEFAULT_GPSD : kind === 'device' ? DEFAULT_DEVICE : '')
          }}
        >
          <option value="off">Off</option>
          <option value="demo">Demo data</option>
          <option value="gpsd">gpsd (recommended)</option>
          <option value="device">Serial device</option>
        </select>
        {gpsKind === 'gpsd' && (
          <>
            <input
              className={`${inputClass} mt-2`}
              value={gpsDetail}
              onChange={(e) => setGpsDetail(e.target.value)}
              placeholder={DEFAULT_GPSD}
            />
            <p className={hintClass}>
              Run gpsd on the NOMAD host with your USB GPS. gpsd must listen on more than localhost
              (start it with -G) for NOMAD's container to reach it.
            </p>
          </>
        )}
        {gpsKind === 'device' && (
          <>
            <input
              className={`${inputClass} mt-2`}
              value={gpsDetail}
              onChange={(e) => setGpsDetail(e.target.value)}
              placeholder={DEFAULT_DEVICE}
            />
            <p className={hintClass}>
              The device must also be passed through to the admin container.
            </p>
          </>
        )}
      </div>

      <div>
        <label className={labelClass} htmlFor="field-adsb-kind">
          Aircraft (ADS-B)
        </label>
        <select
          id="field-adsb-kind"
          className={inputClass}
          value={adsbKind}
          onChange={(e) => {
            const kind = e.target.value as AdsbKind
            setAdsbKind(kind)
            setAdsbDetail(kind === 'sbs' ? DEFAULT_SBS : '')
          }}
        >
          <option value="off">Off</option>
          <option value="demo">Demo data</option>
          <option value="sbs">readsb / dump1090 feed</option>
        </select>
        {adsbKind === 'sbs' && (
          <>
            <input
              className={`${inputClass} mt-2`}
              value={adsbDetail}
              onChange={(e) => setAdsbDetail(e.target.value)}
              placeholder={DEFAULT_SBS}
            />
            <p className={hintClass}>
              Needs an RTL-SDR dongle running readsb or dump1090 on the NOMAD host. Both publish the
              SBS feed on port 30003.
            </p>
          </>
        )}
      </div>

      <div>
        <span className={labelClass}>Home position</span>
        <div className="flex gap-2">
          <input
            className={inputClass}
            value={homeLat}
            onChange={(e) => setHomeLat(e.target.value)}
            placeholder="Latitude"
            inputMode="decimal"
            aria-label="Home latitude"
          />
          <input
            className={inputClass}
            value={homeLon}
            onChange={(e) => setHomeLon(e.target.value)}
            placeholder="Longitude"
            inputMode="decimal"
            aria-label="Home longitude"
          />
        </div>
        {origin?.source === 'gps' && (
          <button
            type="button"
            className="mt-2 text-sm text-desert-green underline"
            onClick={() => {
              setHomeLat(origin.lat.toFixed(5))
              setHomeLon(origin.lon.toFixed(5))
            }}
          >
            Use current GPS position
          </button>
        )}
        <p className={hintClass}>Used for ranges and sun times until the GPS has a fix.</p>
      </div>

      <div className="flex items-center gap-3 md:col-span-3">
        <StyledButton variant="primary" icon="IconCheck" loading={saving} onClick={save}>
          Save sources
        </StyledButton>
        {error && <p className="text-sm text-desert-red">{error}</p>}
      </div>
    </div>
  )
}
