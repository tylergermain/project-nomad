import { createReadStream } from 'node:fs'
import net from 'node:net'
import readline from 'node:readline'
import type { Readable } from 'node:stream'
import KVStore from '#models/kv_store'
import { bearingDeg, destination, distanceKm } from '../../util/field_geo.js'
import { applyNmea, emptyFix, type GpsFix } from '../../util/field_nmea.js'
import { applySbs, type Aircraft } from '../../util/field_sbs.js'
import { computeSky } from '../../util/field_sky.js'
import type { FieldConfig, FieldOrigin, FieldState } from '../../types/field.js'

/** Drop aircraft we haven't heard from in this long. */
const AIRCRAFT_MAX_AGE_S = 60
const RECONNECT_MS = 5000
/** Demo data circles this point when no home position is set. */
const DEMO_HOME = { lat: 39.7392, lon: -104.9903 }

type Channel = 'gps' | 'adsb'

const nowSecs = () => Math.floor(Date.now() / 1000)

/** "host:port" with an optional port, as used by `gpsd:` and `sbs:` sources. */
function hostPort(spec: string, defaultPort: number): { host: string; port: number } {
  const [host, port] = spec.split(':')
  return { host: host || '127.0.0.1', port: port ? Number(port) : defaultPort }
}

/** Short status text for the UI; "error:" marks it as a failure. */
function describeError(err: NodeJS.ErrnoException): string {
  switch (err.code) {
    case 'ECONNREFUSED':
      return 'error: nothing listening at that address'
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return 'error: unknown host'
    case 'ETIMEDOUT':
    case 'EHOSTUNREACH':
      return 'error: host unreachable'
    case 'ENOENT':
      return 'error: device not found'
    case 'EACCES':
      return 'error: no permission to read device'
    default:
      return `error: ${err.message}`
  }
}

/**
 * Reads live sensors for the Field page: GPS position through gpsd or a serial
 * receiver, and nearby aircraft from an ADS-B decoder (readsb/dump1090) via its
 * SBS feed. Both connections retry forever, so plugging hardware in later just
 * works. Sources live in the KV store and can be changed at runtime.
 *
 * One long-lived instance per process, since it owns sockets and timers.
 */
export class FieldSensorService {
  static readonly instance = new FieldSensorService()

  private config: FieldConfig = {
    gpsSource: 'off',
    adsbSource: 'off',
    homeLat: null,
    homeLon: null,
  }
  private fix: GpsFix = emptyFix()
  private gpsStatus = 'off'
  private gpsUpdated: number | null = null
  private aircraft = new Map<string, Aircraft>()
  private adsbStatus = 'off'
  /** Bumped on every restart so callbacks from old connections are ignored. */
  private generation = 0
  private closers = new Map<Channel, () => void>()
  private pruneTimer: NodeJS.Timeout | null = null

  async start() {
    this.config = await FieldSensorService.loadConfig()
    this.pruneTimer ??= setInterval(() => this.pruneAircraft(), 5000).unref()
    this.restart()
  }

  getConfig(): FieldConfig {
    return { ...this.config }
  }

  async updateConfig(next: FieldConfig) {
    await Promise.all([
      KVStore.setValue('field.gpsSource', next.gpsSource),
      KVStore.setValue('field.adsbSource', next.adsbSource),
      next.homeLat === null
        ? KVStore.clearValue('field.homeLat')
        : KVStore.setValue('field.homeLat', String(next.homeLat)),
      next.homeLon === null
        ? KVStore.clearValue('field.homeLon')
        : KVStore.setValue('field.homeLon', String(next.homeLon)),
    ])
    this.config = { ...next }
    this.restart()
  }

  snapshot(): FieldState {
    const now = nowSecs()
    const origin = this.origin()
    const aircraft = [...this.aircraft.values()]
      .map((a) => {
        const placed = origin && a.lat !== null && a.lon !== null
        return {
          ...a,
          distanceKm: placed ? distanceKm(origin.lat, origin.lon, a.lat!, a.lon!) : null,
          bearingDeg: placed ? bearingDeg(origin.lat, origin.lon, a.lat!, a.lon!) : null,
        }
      })
      .sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity))

    return {
      now,
      origin,
      gps: {
        ...this.fix,
        source: this.config.gpsSource,
        status: this.gpsStatus,
        updated: this.gpsUpdated,
      },
      adsb: { source: this.config.adsbSource, status: this.adsbStatus },
      aircraft,
      sky: origin ? computeSky(origin.lat, origin.lon, now) : null,
      config: this.getConfig(),
    }
  }

  private static async loadConfig(): Promise<FieldConfig> {
    const [gpsSource, adsbSource, homeLat, homeLon] = await Promise.all([
      KVStore.getValue('field.gpsSource'),
      KVStore.getValue('field.adsbSource'),
      KVStore.getValue('field.homeLat'),
      KVStore.getValue('field.homeLon'),
    ])
    const coord = (v: string | null) =>
      v !== null && Number.isFinite(Number(v)) ? Number(v) : null
    return {
      gpsSource: gpsSource || 'off',
      adsbSource: adsbSource || 'off',
      homeLat: coord(homeLat),
      homeLon: coord(homeLon),
    }
  }

  /** Where distances are measured from: the GPS fix, else the configured home. */
  private origin(): FieldOrigin | null {
    if (this.fix.hasFix && this.fix.lat !== null && this.fix.lon !== null) {
      return { lat: this.fix.lat, lon: this.fix.lon, source: 'gps' }
    }
    if (this.config.homeLat !== null && this.config.homeLon !== null) {
      return { lat: this.config.homeLat, lon: this.config.homeLon, source: 'home' }
    }
    return null
  }

  private home() {
    const { homeLat, homeLon } = this.config
    return homeLat !== null && homeLon !== null ? { lat: homeLat, lon: homeLon } : DEMO_HOME
  }

  private restart() {
    for (const close of this.closers.values()) close()
    this.closers.clear()
    this.generation++
    this.fix = emptyFix()
    this.gpsUpdated = null
    this.aircraft.clear()
    this.startGps()
    this.startAdsb()
  }

  private startGps() {
    const src = this.config.gpsSource
    if (src === 'off') {
      this.gpsStatus = 'off'
    } else if (src === 'demo') {
      this.gpsStatus = 'ok'
      this.every('gps', 1000, () => this.demoGps())
    } else {
      const onLine = (line: string) => {
        if (!applyNmea(this.fix, line)) return
        this.gpsUpdated = nowSecs()
        this.gpsStatus = this.fix.hasFix ? 'ok' : 'searching for satellites'
      }
      if (src.startsWith('gpsd')) {
        const { host, port } = hostPort(src.slice('gpsd:'.length), 2947)
        // Ask gpsd to relay raw NMEA; its JSON status lines are ignored by the parser.
        this.streamLines(
          'gps',
          () => net.connect(port, host),
          onLine,
          (s) => {
            ;(s as net.Socket).write('?WATCH={"enable":true,"nmea":true};\n')
          }
        )
      } else {
        this.streamLines('gps', () => createReadStream(src), onLine)
      }
    }
  }

  private startAdsb() {
    const src = this.config.adsbSource
    if (src === 'off') {
      this.adsbStatus = 'off'
    } else if (src === 'demo') {
      this.adsbStatus = 'ok'
      this.every('adsb', 1000, () => this.demoAircraft())
    } else {
      const { host, port } = hostPort(src.slice('sbs:'.length), 30003)
      this.streamLines(
        'adsb',
        () => net.connect(port, host),
        (line) => {
          applySbs(this.aircraft, line, nowSecs())
        }
      )
    }
  }

  private setStatus(channel: Channel, status: string) {
    if (channel === 'gps') {
      this.gpsStatus = status
      if (status !== 'ok') this.fix.hasFix = false
    } else {
      this.adsbStatus = status
    }
  }

  private every(channel: Channel, ms: number, tick: () => void) {
    tick()
    const timer = setInterval(tick, ms)
    this.closers.set(channel, () => clearInterval(timer))
  }

  /** Reads lines from a socket or device, reconnecting until the source changes. */
  private streamLines(
    channel: Channel,
    open: () => Readable,
    onLine: (line: string) => void,
    onConnect?: (stream: Readable) => void
  ) {
    const gen = this.generation
    let retryTimer: NodeJS.Timeout | null = null

    const attempt = () => {
      if (gen !== this.generation) return
      this.setStatus(channel, 'connecting')
      const stream = open()
      const lines = readline.createInterface({ input: stream, crlfDelay: Infinity })
      let failed = false

      const fail = (why: string) => {
        if (failed) return
        failed = true
        lines.close()
        stream.destroy()
        if (gen !== this.generation) return
        this.setStatus(channel, why)
        retryTimer = setTimeout(attempt, RECONNECT_MS)
      }

      const ready = () => {
        if (channel === 'adsb') this.setStatus(channel, 'ok')
        else this.setStatus(channel, 'searching for satellites')
        onConnect?.(stream)
      }
      if (stream instanceof net.Socket) stream.once('connect', ready)
      else stream.once('open', ready)

      lines.on('line', (line) => {
        if (gen === this.generation) onLine(line)
      })
      // readline re-emits the stream's errors, and an unhandled one would crash the server.
      lines.on('error', (err) => fail(describeError(err)))
      stream.on('error', (err) => fail(describeError(err)))
      stream.on('close', () => fail('disconnected'))

      this.closers.set(channel, () => {
        failed = true
        if (retryTimer) clearTimeout(retryTimer)
        lines.close()
        stream.destroy()
      })
    }

    attempt()
  }

  private pruneAircraft() {
    const cutoff = nowSecs() - AIRCRAFT_MAX_AGE_S
    for (const [hex, a] of this.aircraft) if (a.seen < cutoff) this.aircraft.delete(hex)
  }

  /** Simulated walk in a 300 m circle around home, so the page is usable without hardware. */
  private demoGps() {
    const radiusKm = 0.3
    const periodS = 1200
    const now = nowSecs()
    const angle = ((now % periodS) / periodS) * 360
    const home = this.home()
    const [lat, lon] = destination(home.lat, home.lon, angle, radiusKm)
    const iso = new Date(now * 1000).toISOString()
    Object.assign(this.fix, {
      hasFix: true,
      lat,
      lon,
      altM: 1609,
      speedKmh: ((2 * Math.PI * radiusKm) / periodS) * 3600,
      courseDeg: (angle + 90) % 360,
      sats: 9,
      hdop: 0.9,
      utcDate: iso.slice(0, 10),
      utcTime: iso.slice(11, 19),
    })
    this.gpsUpdated = now
  }

  /** Simulated traffic crossing the area around home on straight tracks. */
  private demoAircraft() {
    const spanKm = 320
    const now = nowSecs()
    const home = this.home()
    for (const p of DEMO_PLANES) {
      const heading = (p.entry + 180 + p.offset + 360) % 360
      const [slat, slon] = destination(home.lat, home.lon, p.entry, spanKm / 2)
      const flown = ((((p.kt * 1.852 * now) / 3600 + p.phase * spanKm) % spanKm) + spanKm) % spanKm
      const [lat, lon] = destination(slat, slon, heading, flown)
      this.aircraft.set(p.hex, {
        hex: p.hex,
        callsign: p.call,
        altFt: p.altFt,
        speedKt: p.kt,
        trackDeg: heading,
        lat,
        lon,
        vrateFpm: 0,
        squawk: p.squawk,
        onGround: false,
        seen: now,
      })
    }
  }
}

/** Demo traffic. `entry` is where the track starts (bearing from home, 160 km out); `offset` angles it off a line through home. */
const DEMO_PLANES = [
  {
    hex: 'A1B2C3',
    call: 'UAL1543',
    altFt: 36000,
    kt: 460,
    entry: 290,
    offset: 8,
    squawk: '3341',
    phase: 0.1,
  },
  {
    hex: 'A4D5E6',
    call: 'SWA2210',
    altFt: 28000,
    kt: 420,
    entry: 20,
    offset: -12,
    squawk: '4521',
    phase: 0.45,
  },
  {
    hex: 'A7F801',
    call: 'DAL889',
    altFt: 39000,
    kt: 480,
    entry: 120,
    offset: 5,
    squawk: '2207',
    phase: 0.7,
  },
  {
    hex: 'A90123',
    call: 'N172SP',
    altFt: 5500,
    kt: 110,
    entry: 200,
    offset: 20,
    squawk: '1200',
    phase: 0.42,
  },
  {
    hex: 'AB4567',
    call: 'FDX77',
    altFt: 33000,
    kt: 450,
    entry: 60,
    offset: -25,
    squawk: '6610',
    phase: 0.3,
  },
  {
    hex: 'AC8910',
    call: 'LIFE1',
    altFt: 2500,
    kt: 130,
    entry: 330,
    offset: 2,
    squawk: '0301',
    phase: 0.47,
  },
  {
    hex: 'AD2345',
    call: 'N48TX',
    altFt: 9000,
    kt: 150,
    entry: 160,
    offset: -6,
    squawk: '7700',
    phase: 0.4,
  },
]
