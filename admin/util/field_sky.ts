/**
 * Sunrise, sunset and moon phase computed locally: no network, no ephemeris
 * files. Sun times use the sunrise equation (good to a minute or two); moon
 * phase uses the mean synodic month, close enough to plan around dark nights.
 */

const J2000 = 2451545.0
const SYNODIC_DAYS = 29.530588853
/** A known new moon: 2000-01-06 18:14 UTC. */
const NEW_MOON_UNIX = 947_182_440

const MOON_NAMES = [
  'New moon',
  'Waxing crescent',
  'First quarter',
  'Waxing gibbous',
  'Full moon',
  'Waning gibbous',
  'Last quarter',
  'Waning crescent',
]

export interface Sky {
  /** Unix seconds; null during polar day or night. */
  sunrise: number | null
  sunset: number | null
  solarNoon: number
  /** Set when the sun never sets ('day') or never rises ('night') today. */
  polar: 'day' | 'night' | null
  /** 0 = new, 0.5 = full. */
  moonPhase: number
  moonIllumination: number
  moonName: string
}

const toRad = (d: number) => (d * Math.PI) / 180
const toJd = (unix: number) => unix / 86400 + 2440587.5
const fromJd = (jd: number) => Math.round((jd - 2440587.5) * 86400)
const mod = (a: number, n: number) => ((a % n) + n) % n

export function computeSky(lat: number, lon: number, now: number): Sky {
  // Pick the solar day whose noon is nearest to now at this longitude.
  const n = Math.round(toJd(now) - J2000 + lon / 360)
  const jStar = n - lon / 360
  const m = toRad(mod(357.5291 + 0.98560028 * jStar, 360))
  const c = 1.9148 * Math.sin(m) + 0.02 * Math.sin(2 * m) + 0.0003 * Math.sin(3 * m)
  const lambda = toRad(mod((m * 180) / Math.PI + c + 180 + 102.9372, 360))
  const transit = J2000 + jStar + 0.0053 * Math.sin(m) - 0.0069 * Math.sin(2 * lambda)
  const sinD = Math.sin(lambda) * Math.sin(toRad(23.4397))
  const cosD = Math.sqrt(1 - sinD * sinD)
  const phi = toRad(lat)
  const cosW = (Math.sin(toRad(-0.833)) - Math.sin(phi) * sinD) / (Math.cos(phi) * cosD)

  let sunrise: number | null = null
  let sunset: number | null = null
  let polar: Sky['polar'] = null
  if (cosW < -1) polar = 'day'
  else if (cosW > 1) polar = 'night'
  else {
    const w = (Math.acos(cosW) * 180) / Math.PI / 360
    sunrise = fromJd(transit - w)
    sunset = fromJd(transit + w)
  }

  const moonPhase = mod((now - NEW_MOON_UNIX) / 86400 / SYNODIC_DAYS, 1)
  return {
    sunrise,
    sunset,
    solarNoon: fromJd(transit),
    polar,
    moonPhase,
    moonIllumination: (1 - Math.cos(2 * Math.PI * moonPhase)) / 2,
    moonName: MOON_NAMES[Math.floor(moonPhase * 8 + 0.5) % 8],
  }
}
