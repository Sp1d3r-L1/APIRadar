import { FastifyInstance } from 'fastify';
import { authenticateUser, AuthenticatedRequest } from '../middleware/auth';
import { RepositoryCoverage } from '../models/RepositoryCoverage';
import { VerificationFinding } from '../models/VerificationFinding';

export async function verificationRoutes(server: FastifyInstance) {
  server.addHook('preValidation', authenticateUser);
  server.get('/verification', async (request: AuthenticatedRequest, reply) => {
    const operators = (process.env['VERIFICATION_OPERATOR_EMAILS'] || '')
      .split(',').map(email => email.trim().toLowerCase()).filter(Boolean);
    if (!request.user?.isAuthenticated || !operators.includes(request.user.email.toLowerCase())) {
      return reply.status(403).send({ error: 'Operator access required' });
    }
    const [coverage, findings, total] = await Promise.all([
      RepositoryCoverage.find().sort({ lastScannedAt: -1 }).limit(100).select('-_id -__v').lean(),
      VerificationFinding.find().sort({ observedAt: -1 }).limit(100)
        .select('repository source provider path branch encoded state validity url observedAt -_id').lean(),
      VerificationFinding.countDocuments()
    ]);
    return reply.send({ enabled: process.env['INSTALLATION_COVERAGE_ENABLED'] === 'true', coverage, findings, total });
  });
}
