import { FastifyInstance } from 'fastify';
import {
  getLeaksHandler,
  getProviderStatsHandler,
  getLeaksSchema,
  getProviderStatsSchema
} from '../controllers/exploreController';
import { authenticateUser } from '../middleware/auth';

export async function leaksRoutes(server: FastifyInstance) {
  server.addHook('preValidation', authenticateUser);
  server.get('/leaks', { schema: getLeaksSchema }, getLeaksHandler);
  server.get('/stats/providers', { schema: getProviderStatsSchema }, getProviderStatsHandler);
}
