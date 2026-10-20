import mongoose from 'mongoose';
import axios from 'axios';
import { Leak } from '../models/Leak';
import { Secret } from '../models/Secret';
import { SecretVerificationJob } from '../models/SecretVerificationJob';
import { SecretReviewControl } from '../models/SecretReviewControl';
import { logger } from '../utils/logger';

type SecretRow = { _id: mongoose.Types.ObjectId; provider: string };
type SourceRow = { secretId: mongoose.Types.ObjectId; repoUrl: string; filePath: string };
type ReviewRow = { _id: mongoose.Types.ObjectId; secretId: mongoose.Types.ObjectId; detectedProvider: string; reviewAttempts: number };
type FailureTag = 'missing_source' | 'invalid_source' | 'source_not_found' | 'access_denied' | 'rate_limited' | 'timeout' | 'file_too_large' | 'network_error';

const FAILURE_PRIORITY: FailureTag[] = [
  'rate_limited', 'timeout', 'network_error', 'access_denied',
  'file_too_large', 'source_not_found', 'invalid_source', 'missing_source'
];

function failureTag(error: unknown): FailureTag {
  if (!axios.isAxiosError(error)) return 'network_error';
  if (error.response?.status === 429) return 'rate_limited';
  if (error.response?.status === 403) return 'access_denied';
  if (error.response?.status === 404) return 'source_not_found';
  if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') return 'timeout';
  if (error.message.includes('maxContentLength')) return 'file_too_large';
  return 'network_error';
}

function retryAt(attempt: number): Date {
  const delay = Math.min(2 * 60_000 * 2 ** Math.min(Math.max(attempt - 1, 0), 8), 8 * 60 * 60_000);
  return new Date(Date.now() + delay + Math.floor(Math.random() * 30_000));
}

const HINTS: Array<[string, RegExp]> = [
  ['deepseek', /deepseek/i],
  ['kimi_moonshot', /kimi|moonshot/i],
  ['glm_zhipu', /glm|zhipu|bigmodel/i],
  ['openrouter', /openrouter/i],
  ['siliconflow', /siliconflow/i],
  ['together', /together[._/-]?ai/i],
  ['fireworks', /fireworks[._/-]?ai/i],
  ['relay', /(?:^|[._/-])(one-api|new-api|proxy|relay|gateway)(?:[._/-]|$)/i],
  ['openai', /openai/i]
];

function attributionHints(contexts: string[]): string[] {
  const hints = new Set<string>();
  for (const context of contexts) {
    for (const [name, pattern] of HINTS) {
      if (pattern.test(context)) hints.add(name);
    }
  }
  return [...hints];
}

const SOURCE_HOSTS: Array<[string, RegExp]> = [
  ['deepseek', /\bapi\.deepseek\.com\b/i],
  ['kimi_moonshot', /\bapi\.moonshot\.cn\b|\bapi\.moonshot\.ai\b/i],
  ['glm_zhipu', /\bopen\.bigmodel\.cn\b/i],
  ['openrouter', /\bopenrouter\.ai\b/i],
  ['siliconflow', /\bapi\.siliconflow\.cn\b|\bapi\.siliconflow\.com\b/i],
  ['together', /\bapi\.together\.xyz\b/i],
  ['fireworks', /\bapi\.fireworks\.ai\b/i],
  ['openai', /\bapi\.openai\.com\b/i]
];

function sourceHints(content: string): string[] {
  const hints = new Set<string>();
  for (const [provider, pattern] of SOURCE_HOSTS) {
    if (pattern.test(content)) hints.add(provider);
  }
  if (/\b(?:base_url|api_base|openai_api_base|OPENAI_BASE_URL)\b.{0,120}https?:\/\//i.test(content)
      && /https?:\/\/(?!api\.openai\.com|api\.deepseek\.com|api\.moonshot\.(?:cn|ai)|open\.bigmodel\.cn|openrouter\.ai)[a-z0-9.-]+\/(?:v1|api)\b/i.test(content)) {
    hints.add('relay_candidate');
  }
  return [...hints];
}

function rawGitHubUrl(source: SourceRow): string | null {
  const match = /^https:\/\/github\.com\/([a-z0-9-]+)\/([a-z0-9_.-]+)\/?$/i.exec(source.repoUrl);
  if (!match) return null;
  const segments = source.filePath.split('/');
  if (!segments.length || segments.some(part => !part || part === '.' || part === '..')) return null;
  return `https://raw.githubusercontent.com/${match[1]}/${match[2]}/HEAD/${segments.map(encodeURIComponent).join('/')}`;
}

class SecretVerificationQueueService {
  private enabled = false;
  private completedAt: Date | null = null;
  private lastError: string | null = null;
  private reviewActive = false;
  private reviewInFlight = false;
  private reviewProcessed = 0;
  private reviewRetried = 0;
  private reviewCompletedAt: Date | null = null;
  private reviewError: string | null = null;

  start(): void {
    if (process.env['SECRET_VERIFICATION_QUEUE_ENABLED'] !== 'true') return;
    this.enabled = true;
    void this.initializeQueue().catch(error => {
      this.lastError = error instanceof Error ? error.message : String(error);
      logger.error(`[VERIFICATION-QUEUE] Backfill failed: ${this.lastError}`);
    });
    logger.init('[VERIFICATION-QUEUE] Existing key classification queue enabled');
  }

  getState(): { enabled: boolean; backfillComplete: boolean; completedAt: Date | null; error: string | null } {
    return { enabled: this.enabled, backfillComplete: Boolean(this.completedAt), completedAt: this.completedAt, error: this.lastError };
  }

  getReviewState() {
    return { active: this.reviewActive, processed: this.reviewProcessed, retried: this.reviewRetried,
      completedAt: this.reviewCompletedAt, error: this.reviewError };
  }

  async setReviewActive(active: boolean): Promise<{ ok: boolean; reason?: string }> {
    if (!this.enabled || !this.completedAt) return { ok: false, reason: 'The key queue is not ready' };
    if (active && this.reviewActive) return { ok: true };
    if (active && this.reviewInFlight) return { ok: false, reason: 'Previous review is stopping' };
    if (!active) {
      await SecretReviewControl.updateOne({ _id: 'operator' }, { $set: { active: false } }, { upsert: true });
      this.reviewActive = false;
      return { ok: true };
    }
    await SecretReviewControl.updateOne({ _id: 'operator' }, { $set: { active: true, startedAt: new Date() } }, { upsert: true });
    this.beginReview();
    return { ok: true };
  }

  private beginReview(): void {
    if (this.reviewInFlight) return;
    this.reviewActive = true;
    this.reviewInFlight = true;
    this.reviewProcessed = 0;
    this.reviewRetried = 0;
    this.reviewCompletedAt = null;
    this.reviewError = null;
    void this.reviewQueue()
      .catch(error => {
        this.reviewError = error instanceof Error ? error.message : String(error);
        logger.error(`[VERIFICATION-QUEUE] Review failed: ${this.reviewError}`);
        void SecretReviewControl.updateOne({ _id: 'operator' }, { $set: { active: false } });
      })
      .finally(() => {
        this.reviewActive = false;
        this.reviewInFlight = false;
      });
  }

  async enqueueSecret(secretId: mongoose.Types.ObjectId, provider: string): Promise<void> {
    if (!this.enabled) return;
    await this.enqueueBatch([{ _id: secretId, provider }]);
  }

  private async enqueueBatch(secrets: SecretRow[]): Promise<void> {
    if (!secrets.length) return;
    const leaks = await Leak.find({ secretId: { $in: secrets.map(secret => secret._id) } })
      .select('secretId repoUrl filePath').lean();
    const contexts = new Map<string, string[]>();
    for (const leak of leaks) {
      const id = leak.secretId.toString();
      if (!contexts.has(id)) contexts.set(id, []);
      contexts.get(id)!.push(`${leak.repoUrl || ''} ${leak.filePath || ''}`);
    }

    await SecretVerificationJob.bulkWrite(secrets.map(secret => {
      const openAICompatible = secret.provider === 'openai';
      const sources = contexts.get(secret._id.toString()) || [];
      return { updateOne: {
        filter: { secretId: secret._id },
        update: { $setOnInsert: {
          secretId: secret._id,
          detectedProvider: secret.provider,
          providerFamily: openAICompatible ? 'openai_compatible' : secret.provider,
          status: 'queued',
          gate: openAICompatible ? 'provider_attribution_required' : 'scope_required',
          result: 'not_checked',
          reviewStatus: 'pending',
          reviewAttempts: 0,
          sourceStatus: 'pending',
          sourceHints: []
        }, $set: {
          attributionHints: openAICompatible ? attributionHints(sources) : [],
          sourceCount: sources.length
        } },
        upsert: true
      } };
    }), { ordered: false });
  }

  private async initializeQueue(): Promise<void> {
    await SecretVerificationJob.init();
    await SecretVerificationJob.updateMany({ reviewStatus: { $exists: false } }, { $set: {
      reviewStatus: 'pending', reviewAttempts: 0, reviewFailureTag: null, reviewRetryAt: null
    } });
    await SecretVerificationJob.updateMany({ reviewStatus: 'reviewing' }, { $set: {
      reviewStatus: 'retry_queued', reviewFailureTag: 'interrupted', reviewRetryAt: new Date()
    } });
    let lastId: mongoose.Types.ObjectId | undefined;
    let processed = 0;
    while (true) {
      const filter = lastId ? { _id: { $gt: lastId } } : {};
      const secrets = await Secret.find(filter).sort({ _id: 1 }).limit(250)
        .select('_id provider').lean() as unknown as SecretRow[];
      if (!secrets.length) break;
      await this.enqueueBatch(secrets);
      processed += secrets.length;
      lastId = secrets[secrets.length - 1]!._id;
    }
    this.completedAt = new Date();
    logger.init(`[VERIFICATION-QUEUE] Classified ${processed} stored keys without sending provider requests`);
    const control = await SecretReviewControl.findById('operator').lean();
    if (control?.active) this.beginReview();
  }

  private async reviewQueue(): Promise<void> {
    while (this.reviewActive) {
      const retryDue = await SecretVerificationJob.find({
        reviewStatus: 'retry_queued', reviewRetryAt: { $lte: new Date() }
      }).sort({ reviewRetryAt: 1, _id: 1 }).limit(100)
        .select('_id secretId detectedProvider reviewAttempts').lean() as unknown as ReviewRow[];
      const due = retryDue.length ? retryDue : await SecretVerificationJob.find({ reviewStatus: 'pending' })
        .sort({ _id: 1 }).limit(100)
        .select('_id secretId detectedProvider reviewAttempts').lean() as unknown as ReviewRow[];
      if (!due.length) {
        this.reviewCompletedAt ||= new Date();
        await new Promise(resolve => setTimeout(resolve, 15_000));
        continue;
      }
      this.reviewCompletedAt = null;

      const knownProviderIds = due.filter(job => job.detectedProvider !== 'openai').map(job => job._id);
      if (knownProviderIds.length) {
        await SecretVerificationJob.updateMany({ _id: { $in: knownProviderIds } }, { $set: {
          reviewStatus: 'reviewed', reviewFailureTag: null, reviewRetryAt: null,
          sourceStatus: 'skipped', reviewedAt: new Date()
        }, $inc: { reviewAttempts: 1 } });
        this.reviewProcessed += knownProviderIds.length;
      }

      for (const job of due) {
        if (!this.reviewActive) break;
        if (job.detectedProvider !== 'openai') continue;
        const attempt = (job.reviewAttempts || 0) + 1;
        await SecretVerificationJob.updateOne({ _id: job._id }, { $set: { reviewStatus: 'reviewing' }, $inc: { reviewAttempts: 1 } });
        const result = await this.inspectSources(job.secretId).catch(() => ({
          inspected: false as const, hints: [], failure: 'network_error' as FailureTag
        }));
        if (result.inspected) {
          await SecretVerificationJob.updateOne({ _id: job._id }, { $set: {
            sourceHints: result.hints, sourceStatus: 'inspected', sourceInspectedAt: new Date(),
            reviewStatus: 'reviewed', reviewFailureTag: null, reviewRetryAt: null, reviewedAt: new Date()
          } });
        } else {
          await SecretVerificationJob.updateOne({ _id: job._id }, { $set: {
            sourceHints: [], sourceStatus: 'unavailable', sourceInspectedAt: new Date(),
            reviewStatus: 'retry_queued', reviewFailureTag: result.failure,
            reviewRetryAt: retryAt(attempt)
          } });
          this.reviewRetried += 1;
        }
        this.reviewProcessed += 1;
      }
    }
    logger.init(`[VERIFICATION-QUEUE] Metadata review paused after ${this.reviewProcessed} attempts; ${this.reviewRetried} returned to retry queue`);
  }

  private async inspectSources(secretId: mongoose.Types.ObjectId): Promise<{ inspected: boolean; hints: string[]; failure?: FailureTag }> {
    const sources = await Leak.find({ secretId }).select('secretId repoUrl filePath').limit(2).lean() as unknown as SourceRow[];
    const hints = new Set<string>();
    let inspected = false;
    const failures: FailureTag[] = [];
    if (!sources.length) failures.push('missing_source');
    for (const source of sources) {
      const url = rawGitHubUrl(source);
      if (!url) {
        failures.push('invalid_source');
        continue;
      }
      try {
        const response = await axios.get<string>(url, {
          timeout: 6000,
          maxRedirects: 0,
          maxContentLength: 256 * 1024,
          responseType: 'text',
          transformResponse: [data => data]
        });
        if (typeof response.data !== 'string') continue;
        inspected = true;
        for (const hint of sourceHints(response.data)) hints.add(hint);
      } catch (error) {
        failures.push(failureTag(error));
      }
    }
    if (inspected) return { inspected, hints: [...hints] };
    return { inspected, hints: [], failure: FAILURE_PRIORITY.find(tag => failures.includes(tag)) || 'network_error' };
  }
}

export const secretVerificationQueueService = new SecretVerificationQueueService();
