/**
 * Field page sensor parsing and offline sky math: GPS (NMEA), aircraft (SBS),
 * great-circle helpers and sunrise/sunset/moon phase.
 *
 * Pure functions only, no MySQL, Redis, gpsd or an SDR needed:
 *   npm run test:unit
 */
import * as assert from 'node:assert/strict'
import { test } from 'node:test'

import { bearingDeg, destination, distanceKm } from '../../util/field_geo.js'
import { applyNmea, emptyFix, parseCoord } from '../../util/field_nmea.js'
import { applySbs, type Aircraft } from '../../util/field_sbs.js'
import { computeSky } from '../../util/field_sky.js'

const near = (actual: number, expected: number, tolerance: number) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} not within ${tolerance} of ${expected}`
  )

test('London to Paris distance and bearing match published values', () => {
  near(distanceKm(51.5074, -0.1278, 48.8566, 2.3522), 343.5, 2)
  near(bearingDeg(51.5074, -0.1278, 48.8566, 2.3522), 148.1, 1)
})

test('destination round-trips through distance and bearing', () => {
  const [lat, lon] = destination(39.7, -105, 72, 50)
  near(distanceKm(39.7, -105, lat, lon), 50, 0.01)
  near(bearingDeg(39.7, -105, lat, lon), 72, 0.01)
})

test('GGA and RMC sentences fill in a fix', () => {
  const fix = emptyFix()
  assert.ok(applyNmea(fix, '$GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,*47\r\n'))
  assert.equal(fix.hasFix, true)
  near(fix.lat!, 48.1173, 1e-4)
  near(fix.lon!, 11.516667, 1e-4)
  assert.equal(fix.sats, 8)
  assert.equal(fix.altM, 545.4)

  assert.ok(applyNmea(fix, '$GPRMC,123519,A,4807.038,N,01131.000,E,022.4,084.4,230394,003.1,W*6A'))
  near(fix.speedKmh!, 41.48, 0.01)
  assert.equal(fix.courseDeg, 84.4)
  assert.equal(fix.utcTime, '12:35:19')
})

test('a corrupted sentence is rejected and south/west are negative', () => {
  assert.equal(
    applyNmea(emptyFix(), '$GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,*48'),
    false
  )
  assert.equal(parseCoord('3345.120', 'S'), -(33 + 45.12 / 60))
  assert.equal(parseCoord('07023.500', 'W'), -(70 + 23.5 / 60))
})

test('SBS messages merge into one aircraft', () => {
  const map = new Map<string, Aircraft>()
  applySbs(
    map,
    'MSG,1,1,1,a1b2c3,1,2024/01/01,12:00:00.000,2024/01/01,12:00:00.000,UAL1543 ,,,,,,,,,,,',
    10
  )
  applySbs(
    map,
    'MSG,3,1,1,A1B2C3,1,2024/01/01,12:00:01.000,2024/01/01,12:00:01.000,,36000,,,39.81,-104.67,,,0,0,0,0',
    11
  )
  applySbs(
    map,
    'MSG,4,1,1,A1B2C3,1,2024/01/01,12:00:02.000,2024/01/01,12:00:02.000,,,455,271.3,,,-64,,0,0,0,0',
    12
  )
  applySbs(
    map,
    'MSG,6,1,1,A1B2C3,1,2024/01/01,12:00:03.000,2024/01/01,12:00:03.000,,,,,,,,7700,0,1,0,0',
    13
  )
  const a = map.get('A1B2C3')!
  assert.equal(a.callsign, 'UAL1543')
  assert.equal(a.altFt, 36000)
  assert.equal(a.lat, 39.81)
  assert.equal(a.speedKt, 455)
  assert.equal(a.vrateFpm, -64)
  assert.equal(a.squawk, '7700')
  assert.equal(a.seen, 13)
  assert.equal(applySbs(map, 'garbage', 14), false)
})

test('London midsummer sunrise and sunset are within five minutes', () => {
  // 2024-06-21 noon UTC. Sunrise about 03:43 UTC, sunset about 20:21 UTC.
  const sky = computeSky(51.5074, -0.1278, 1_718_971_200)
  const midnight = 1_718_928_000
  near(sky.sunrise! - midnight, 3 * 3600 + 43 * 60, 300)
  near(sky.sunset! - midnight, 20 * 3600 + 21 * 60, 300)
})

test("a Denver evening still reports that day's sunset", () => {
  // 2024-06-21 22:00 local (04:00 UTC next day).
  const now = 1_719_028_800
  const sky = computeSky(39.7392, -104.9903, now)
  assert.ok(sky.sunset! < now && now - sky.sunset! < 4 * 3600)
})

test('Svalbard in December is polar night', () => {
  assert.equal(computeSky(78.2, 15.6, 1_734_782_400).polar, 'night')
})

test('a known full moon is reported as full', () => {
  // 2024-01-25 17:54 UTC.
  const sky = computeSky(0, 0, 1_706_205_240)
  near(sky.moonPhase, 0.5, 0.03)
  assert.equal(sky.moonName, 'Full moon')
})
