/**
 * ADS-B aircraft from the SBS (BaseStation) text feed that readsb and
 * dump1090 publish on port 30003. Lines look like
 * `MSG,3,1,1,A1B2C3,1,date,time,date,time,CALLSIGN,ALT,GS,TRK,LAT,LON,VR,SQUAWK,...`
 * and each message type fills in only some fields, so they are merged per aircraft.
 */

export interface Aircraft {
  hex: string
  callsign: string | null
  altFt: number | null
  speedKt: number | null
  trackDeg: number | null
  lat: number | null
  lon: number | null
  vrateFpm: number | null
  squawk: string | null
  onGround: boolean
  /** Unix seconds when last heard. */
  seen: number
}

/** Transponder codes that mean an aircraft is declaring an emergency. */
export const EMERGENCY_SQUAWKS: Record<string, string> = {
  '7500': 'Hijack',
  '7600': 'Radio failure',
  '7700': 'Emergency',
}

export function applySbs(map: Map<string, Aircraft>, line: string, now: number): boolean {
  const f = line
    .trim()
    .split(',')
    .map((s) => s.trim())
  if (f.length < 11 || f[0] !== 'MSG' || !f[4]) return false

  const get = (i: number) => (f[i] ? f[i] : null)
  const num = (i: number) => {
    const v = get(i)
    return v !== null && Number.isFinite(Number(v)) ? Number(v) : null
  }

  const hex = f[4].toUpperCase()
  let ac = map.get(hex)
  if (!ac) {
    ac = {
      hex,
      callsign: null,
      altFt: null,
      speedKt: null,
      trackDeg: null,
      lat: null,
      lon: null,
      vrateFpm: null,
      squawk: null,
      onGround: false,
      seen: now,
    }
    map.set(hex, ac)
  }
  ac.seen = now
  ac.callsign = get(10) ?? ac.callsign
  const alt = num(11)
  if (alt !== null) ac.altFt = Math.round(alt)
  ac.speedKt = num(12) ?? ac.speedKt
  ac.trackDeg = num(13) ?? ac.trackDeg
  const lat = num(14)
  const lon = num(15)
  if (lat !== null && lon !== null) {
    ac.lat = lat
    ac.lon = lon
  }
  const vrate = num(16)
  if (vrate !== null) ac.vrateFpm = Math.round(vrate)
  ac.squawk = get(17) ?? ac.squawk
  const ground = get(21)
  if (ground !== null) ac.onGround = ground === '-1' || ground === '1'
  return true
}
