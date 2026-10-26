import logger from '@adonisjs/core/services/logger'
import type { ApplicationService } from '@adonisjs/core/types'

/**
 * Starts the Field page's GPS and ADS-B readers when the web server boots, so
 * positions and aircraft are already being tracked before anyone opens the page.
 * Sources default to 'off', in which case nothing connects.
 */
export default class FieldSensorProvider {
  constructor(protected app: ApplicationService) {}

  async boot() {
    if (this.app.getEnvironment() !== 'web') return

    setImmediate(async () => {
      try {
        const { FieldSensorService } = await import('#services/field_sensor_service')
        await FieldSensorService.instance.start()
      } catch (err: any) {
        logger.warn(`[FieldSensorProvider] Field sensors not started: ${err?.message ?? err}`)
      }
    })
  }
}
