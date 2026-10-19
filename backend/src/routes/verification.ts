import { FastifyInstance } from 'fastify';
import { authenticateUser, AuthenticatedRequest } from '../middleware/auth';
import { RepositoryCoverage } from '../models/RepositoryCoverage';
import { ScannedRepo } from '../models/ScannedRepo';
import { VerificationFinding } from '../models/VerificationFinding';
import { SecretVerificationJob } from '../models/SecretVerificationJob';
import { installationCoverageService } from '../services/InstallationCoverageService';
import { secretVerificationQueueService } from '../services/SecretVerificationQueueService';

function isOperator(request: AuthenticatedRequest): boolean {
  const operators = (process.env['VERIFICATION_OPERATOR_EMAILS'] || '')
    .split(',').map(email => email.trim().toLowerCase()).filter(Boolean);
  return Boolean(request.user?.isAuthenticated && operators.includes(request.user.email.toLowerCase()));
}

export async function verificationRoutes(server: FastifyInstance) {
  server.addHook('preValidation', authenticateUser);
  server.get('/verification/status', async (_request, reply) => {
    const [repositories, discoveredRepositories, visitedRepositories, installedRepositories, findings, counts, last, coverage, keyQueue, sourceInspected, sourceHintCounts] = await Promise.all([
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
      } }]),
      SecretVerificationJob.aggregate<{ _id: { provider: string; gate: string }; count: number }>([
        { $group: { _id: { provider: '$detectedProvider', gate: '$gate' }, count: { $sum: 1 } } }
      ]),
      SecretVerificationJob.countDocuments({ sourceStatus: 'inspected' }),
      SecretVerificationJob.aggregate<{ _id: string; count: number }>([
        { $unwind: '$sourceHints' },
        { $group: { _id: '$sourceHints', count: { $sum: 1 } } }
      ])
    ]);
    return reply.send({
      enabled: process.env['INSTALLATION_COVERAGE_ENABLED'] === 'true',
      scope: 'observed-public-repositories',
      ratePausedUntil: installationCoverageService.getRatePauseUntil(),
      installations: installationCoverageService.getInstallationCapacity(),
      repositories, discoveredRepositories, visitedRepositories, installedRepositories,
      queuedRepositories: Math.max(0, repositories - visitedRepositories), findings,
      validity: Object.fromEntries(counts.map(item => [item._id, item.count])),
      lastScannedAt: last?.lastScannedAt || null,
      coverage: coverage[0] || null,
      keyQueue: {
        ...secretVerificationQueueService.getState(),
        total: keyQueue.reduce((sum, row) => sum + row.count, 0),
        byProvider: Object.fromEntries(keyQueue.map(row => [row._id.provider, row.count])),
        attributionRequired: keyQueue.filter(row => row._id.gate === 'provider_attribution_required')
          .reduce((sum, row) => sum + row.count, 0),
        scopeRequired: keyQueue.filter(row => row._id.gate === 'scope_required')
          .reduce((sum, row) => sum + row.count, 0),
        sourceInspected,
        sourceHints: Object.fromEntries(sourceHintCounts.map(row => [row._id, row.count]))
      }
    });
  });
  server.get('/verification', async (request: AuthenticatedRequest, reply) => {
    if (!isOperator(request)) {
      return reply.status(403).send({ error: 'Operator access required' });
    }
    const [coverage, findings, total] = await Promise.all([
      RepositoryCoverage.find().sort({ lastScannedAt: -1 }).limit(100).select('-_id -__v').lean(),
      VerificationFinding.find().sort({ observedAt: -1 }).limit(100)
        .select('repository source provider path branch encoded state validity url observedAt -_id').lean(),
      VerificationFinding.countDocuments()
    ]);
    return reply.send({ enabled: process.env['INSTALLATION_COVERAGE_ENABLED'] === 'true', coverage, findings, total,
      keyReview: secretVerificationQueueService.getReviewState() });
  });

  server.post('/verification/review', async (request: AuthenticatedRequest, reply) => {
    if (!isOperator(request)) return reply.status(403).send({ error: 'Operator access required' });
    const body = request.body as { enabled?: unknown } | undefined;
    if (typeof body?.enabled !== 'boolean') return reply.status(400).send({ error: 'enabled must be a boolean' });
    const result = secretVerificationQueueService.setReviewActive(body.enabled);
    if (!result.ok) return reply.status(409).send({ error: result.reason });
    return reply.send({ keyReview: secretVerificationQueueService.getReviewState() });
  });
}
