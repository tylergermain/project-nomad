import { FieldSensorService } from '#services/field_sensor_service'
import { fieldConfigValidator } from '#validators/field'
import type { HttpContext } from '@adonisjs/core/http'

export default class FieldController {
  async index({ inertia }: HttpContext) {
    return inertia.render('field')
  }

  /** Live GPS fix, aircraft with range/bearing, and sun/moon for the current position. */
  async state({}: HttpContext) {
    return FieldSensorService.instance.snapshot()
  }

  async config({}: HttpContext) {
    return FieldSensorService.instance.getConfig()
  }

  async updateConfig({ request }: HttpContext) {
    const payload = await request.validateUsing(fieldConfigValidator)
    await FieldSensorService.instance.updateConfig({
      gpsSource: payload.gpsSource,
      adsbSource: payload.adsbSource,
      homeLat: payload.homeLat ?? null,
      homeLon: payload.homeLon ?? null,
    })
    return FieldSensorService.instance.getConfig()
  }
}
