import { ScannedRepo } from '../models/ScannedRepo';
import { RepositoryCoverage } from '../models/RepositoryCoverage';
import { logger } from '../utils/logger';

type DiscoverySource = 'search' | 'events';
const REPOSITORY_NAME = /^[^/\s]+\/[^/\s]+$/;

/** Keep the historical-scan inventory aligned with both public incremental feeds. */
export async function recordPublicRepositories(names: string[], source: DiscoverySource): Promise<void> {
  const repositories = [...new Set(names.filter(name => REPOSITORY_NAME.test(name)))];
  if (!repositories.length) return;
  const now = new Date();
  await Promise.all([
    ScannedRepo.bulkWrite(repositories.map(fullName => ({ updateOne: {
      filter: { fullName }, update: { $set: { lastScannedAt: now } }, upsert: true
    } })), { ordered: false }),
    RepositoryCoverage.bulkWrite(repositories.map(repository => ({ updateOne: {
      filter: { repository },
      update: { $setOnInsert: { repository }, $set: source === 'search'
        ? { discoveredBySearch: true } : { discoveredByEvents: true } },
      upsert: true
    } })), { ordered: false })
  ]);
}

/** Existing ScannedRepo rows predate the coverage queue. Import them without resetting cursors. */
export async function importDiscoveredRepositories(): Promise<void> {
  const existing = new Set(await RepositoryCoverage.distinct('repository'));
  let cursor: unknown;
  let imported = 0;
  while (true) {
    const batch = await ScannedRepo.find(cursor ? { _id: { $gt: cursor } } : {})
      .sort({ _id: 1 }).limit(500).select('_id fullName').lean();
    if (!batch.length) break;
    const repositories = batch.filter(item => REPOSITORY_NAME.test(item.fullName) && !existing.has(item.fullName));
    if (repositories.length) {
      await RepositoryCoverage.bulkWrite(repositories.map(({ fullName: repository }) => ({ updateOne: {
        filter: { repository },
        update: { $setOnInsert: { repository }, $set: { discoveredBySearch: true } },
        upsert: true
      } })), { ordered: false });
      imported += repositories.length;
      repositories.forEach(item => existing.add(item.fullName));
    }
    cursor = batch[batch.length - 1]!._id;
  }
  logger.init(`[COVERAGE] Imported ${imported} public repositories into the history queue`);
}
