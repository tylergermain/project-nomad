import vine from '@vinejs/vine'

// host or host:port, e.g. "host.docker.internal:2947". Empty means the default host and port.
const HOST_PORT = String.raw`(:[A-Za-z0-9.-]+(:\d{1,5})?)?`

export const GPS_SOURCE_PATTERN = new RegExp(
  String.raw`^(off|demo|gpsd${HOST_PORT}|/dev/[A-Za-z0-9._/-]+)$`
)
export const ADSB_SOURCE_PATTERN = new RegExp(String.raw`^(off|demo|sbs${HOST_PORT})$`)

export const fieldConfigValidator = vine.compile(
  vine.object({
    gpsSource: vine.string().trim().maxLength(200).regex(GPS_SOURCE_PATTERN),
    adsbSource: vine.string().trim().maxLength(200).regex(ADSB_SOURCE_PATTERN),
    homeLat: vine.number().min(-90).max(90).nullable().optional(),
    homeLon: vine.number().min(-180).max(180).nullable().optional(),
  })
)
