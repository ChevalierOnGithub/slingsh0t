import type { FastifyPluginAsync } from 'fastify'
import { PRESETS } from '../presets'

export const presetsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/network-presets', async () => PRESETS)
}
