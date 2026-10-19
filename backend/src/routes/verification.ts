import { FastifyInstance } from 'fastify';
import { authenticateUser, AuthenticatedRequest } from '../middleware/auth';
import { RepositoryCoverage } from '../models/RepositoryCoverage';
import { ScannedRepo } from '../models/ScannedRepo';
import { VerificationFinding } from '../models/VerificationFinding';
import { installationCoverageService } from '../services/InstallationCoverageService';

export async function verificationRoutes(server: FastifyInstance) {
  server.addHook('preValidation', authenticateUser);
  server.get('/verification/status', async (_request, reply) => {
    const [repositories, discoveredRepositories, visitedRepositories, installedRepositories, findings, counts, last, coverage] = await Promise.all([
      RepositoryCoverage.countDocuments(),
      ScannedRepo.countDocuments(),
      RepositoryCoverage.countDocuments({ lastScannedAt: { $exists: true } }),
      RepositoryCoverage.countDocuments({ installed: true }),
      VerificationFinding.countDocuments(),
      VerificationFinding.aggregate<{ _id: string; count: number }>([
        { $group: { _id: '$validity', count: { $sum: 1 } } }
      ]),
      RepositoryCoverage.findOne().sort({ lastScannedAt: -1 }).select('lastScannedAt -_id').lean(),
      RepositoryCoverage.aggregate<{
        branchesSeen: number; commitsSeen: number; snapshotComplete: number;
        historyComplete: number; missingPatches: number; skippedLarge: number;
        skippedBinary: number; skippedBlobs: number; alertsDenied: number
      }>([{ $group: {
        _id: null,
        branchesSeen: { $sum: '$branchesSeen' },
        commitsSeen: { $sum: '$commitsSeen' },
        snapshotComplete: { $sum: { $cond: [{ $ifNull: ['$snapshotCompleteAt', false] }, 1, 0] } },
        historyComplete: { $sum: { $cond: [{ $ifNull: ['$historyCompleteAt', false] }, 1, 0] } },
        missingPatches: { $sum: '$missingPatches' },
        skippedLarge: { $sum: '$skippedLarge' },
        skippedBinary: { $sum: '$skippedBinary' },
        skippedBlobs: { $sum: '$skippedBlobs' },
        alertsDenied: { $sum: { $cond: [{ $eq: ['$alertsPermission', 'denied'] }, 1, 0] } }
      } }])
    ]);
    return reply.send({
      enabled: process.env['INSTALLATION_COVERAGE_ENABLED'] === 'true',
      scope: 'observed-public-repositories',
      ratePausedUntil: installationCoverageService.getRatePauseUntil(),
      repositories, discoveredRepositories, visitedRepositories, installedRepositories,
      queuedRepositories: Math.max(0, repositories - visitedRepositories), findings,
      validity: Object.fromEntries(counts.map(item => [item._id, item.count])),
      lastScannedAt: last?.lastScannedAt || null,
      coverage: coverage[0] || null
    });
  });
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
