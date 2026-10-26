/**
 * Great-circle helpers for the Field page. Accurate to well under 0.5% at the
 * ranges a handheld cares about. Shared by the server (aircraft range/bearing)
 * and the browser (distance to map markers).
 */

const EARTH_KM = 6371.0088
const rad = (deg: number) => (deg * Math.PI) / 180
const deg = (r: number) => (r * 180) / Math.PI

export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p1 = rad(lat1)
  const p2 = rad(lat2)
  const dp = p2 - p1
  const dl = rad(lon2 - lon1)
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2
  return 2 * EARTH_KM * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/** Initial bearing from point 1 to point 2, degrees clockwise from true north. */
export function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p1 = rad(lat1)
  const p2 = rad(lat2)
  const dl = rad(lon2 - lon1)
  const y = Math.sin(dl) * Math.cos(p2)
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl)
  return (deg(Math.atan2(y, x)) + 360) % 360
}

/** Point reached travelling `distKm` from a start point on an initial bearing. */
export function destination(
  lat: number,
  lon: number,
  bearing: number,
  distKm: number
): [number, number] {
  const d = distKm / EARTH_KM
  const b = rad(bearing)
  const p1 = rad(lat)
  const l1 = rad(lon)
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b))
  const l2 =
    l1 +
    Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2))
  return [deg(p2), ((deg(l2) + 540) % 360) - 180]
}

const CARDINALS = [
  'N',
  'NNE',
  'NE',
  'ENE',
  'E',
  'ESE',
  'SE',
  'SSE',
  'S',
  'SSW',
  'SW',
  'WSW',
  'W',
  'WNW',
  'NW',
  'NNW',
]

export function cardinal(bearing: number): string {
  return CARDINALS[Math.round(bearing / 22.5) % 16]
}
