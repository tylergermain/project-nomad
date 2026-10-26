/**
 * NMEA 0183 parsing for GPS receivers. Understands GGA (fix, satellites,
 * altitude) and RMC (speed, course, date) from any talker (GP, GN, GL...),
 * which is all a position display needs.
 */

export interface GpsFix {
  hasFix: boolean
  lat: number | null
  lon: number | null
  altM: number | null
  speedKmh: number | null
  courseDeg: number | null
  sats: number | null
  hdop: number | null
  /** Time and date as reported by the satellites, independent of the system clock. */
  utcTime: string | null
  utcDate: string | null
}

export function emptyFix(): GpsFix {
  return {
    hasFix: false,
    lat: null,
    lon: null,
    altM: null,
    speedKmh: null,
    courseDeg: null,
    sats: null,
    hdop: null,
    utcTime: null,
    utcDate: null,
  }
}

function checksumOk(line: string): boolean {
  if (!line.startsWith('$')) return false
  const star = line.indexOf('*')
  if (star < 0) return true
  let calc = 0
  for (let i = 1; i < star; i++) calc ^= line.charCodeAt(i)
  return Number.parseInt(line.slice(star + 1, star + 3), 16) === calc
}

/** NMEA packs coordinates as ddmm.mmmm / dddmm.mmmm plus a hemisphere letter. */
export function parseCoord(value: string, hemi: string): number | null {
  const dot = value.includes('.') ? value.indexOf('.') : value.length
  if (dot < 3) return null
  const degrees = Number(value.slice(0, dot - 2))
  const minutes = Number(value.slice(dot - 2))
  if (!Number.isFinite(degrees) || !Number.isFinite(minutes)) return null
  const v = degrees + minutes / 60
  return hemi === 'S' || hemi === 'W' ? -v : v
}

const num = (s: string | undefined) =>
  s && s.trim() !== '' && Number.isFinite(Number(s)) ? Number(s) : null
const fmtTime = (t: string) =>
  t.length >= 6 ? `${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4, 6)}` : null
const fmtDate = (d: string) =>
  d.length === 6 ? `20${d.slice(4, 6)}-${d.slice(2, 4)}-${d.slice(0, 2)}` : null

/** Folds one sentence into the fix. Returns false for sentences it ignores or rejects. */
export function applyNmea(fix: GpsFix, raw: string): boolean {
  const line = raw.trim()
  if (!checksumOk(line)) return false
  const f = line.slice(1).split('*')[0].split(',')
  if (f[0].length < 5) return false

  switch (f[0].slice(-3)) {
    case 'GGA': {
      if (f.length < 10) return false
      fix.hasFix = (num(f[6]) ?? 0) > 0
      fix.sats = num(f[7])
      fix.hdop = num(f[8])
      fix.utcTime = fmtTime(f[1]) ?? fix.utcTime
      if (fix.hasFix) {
        fix.lat = parseCoord(f[2], f[3]) ?? fix.lat
        fix.lon = parseCoord(f[4], f[5]) ?? fix.lon
        fix.altM = num(f[9])
      }
      return true
    }
    case 'RMC': {
      if (f.length < 10) return false
      fix.utcTime = fmtTime(f[1]) ?? fix.utcTime
      fix.utcDate = fmtDate(f[9]) ?? fix.utcDate
      if (f[2] === 'A') {
        fix.lat = parseCoord(f[3], f[4]) ?? fix.lat
        fix.lon = parseCoord(f[5], f[6]) ?? fix.lon
        const knots = num(f[7])
        fix.speedKmh = knots === null ? null : knots * 1.852
        fix.courseDeg = num(f[8])
      } else {
        fix.hasFix = false
      }
      return true
    }
    default:
      return false
  }
}
