import type { GpsFix } from '../util/field_nmea.js'
import type { Aircraft } from '../util/field_sbs.js'
import type { Sky } from '../util/field_sky.js'

/**
 * Where the Field page reads its sensors from.
 * gpsSource: 'off' | 'demo' | 'gpsd:host:port' | a serial device path such as '/dev/ttyACM0'
 * adsbSource: 'off' | 'demo' | 'sbs:host:port'
 */
export interface FieldConfig {
  gpsSource: string
  adsbSource: string
  /** Fallback position for range and sun times until the GPS has a fix. */
  homeLat: number | null
  homeLon: number | null
}

export interface FieldOrigin {
  lat: number
  lon: number
  source: 'gps' | 'home'
}

export interface FieldAircraft extends Aircraft {
  distanceKm: number | null
  bearingDeg: number | null
}

export interface FieldState {
  now: number
  origin: FieldOrigin | null
  gps: GpsFix & { source: string; status: string; updated: number | null }
  adsb: { source: string; status: string }
  aircraft: FieldAircraft[]
  sky: Sky | null
  config: FieldConfig
}
