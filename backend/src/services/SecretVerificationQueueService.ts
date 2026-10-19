import mongoose from 'mongoose';
import axios from 'axios';
import { Leak } from '../models/Leak';
import { Secret } from '../models/Secret';
import { SecretVerificationJob } from '../models/SecretVerificationJob';
import { logger } from '../utils/logger';

type SecretRow = { _id: mongoose.Types.ObjectId; provider: string };
type SourceRow = { secretId: mongoose.Types.ObjectId; repoUrl: string; filePath: string };

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
  private reviewCompletedAt: Date | null = null;
  private reviewError: string | null = null;

  start(): void {
    if (process.env['SECRET_VERIFICATION_QUEUE_ENABLED'] !== 'true') return;
    this.enabled = true;
    void this.backfill().catch(error => {
      this.lastError = error instanceof Error ? error.message : String(error);
      logger.error(`[VERIFICATION-QUEUE] Backfill failed: ${this.lastError}`);
    });
    logger.init('[VERIFICATION-QUEUE] Existing key classification queue enabled');
  }

  getState(): { enabled: boolean; backfillComplete: boolean; completedAt: Date | null; error: string | null } {
    return { enabled: this.enabled, backfillComplete: Boolean(this.completedAt), completedAt: this.completedAt, error: this.lastError };
  }

  getReviewState() {
    return { active: this.reviewActive, processed: this.reviewProcessed, completedAt: this.reviewCompletedAt, error: this.reviewError };
  }

  setReviewActive(active: boolean): { ok: boolean; reason?: string } {
    if (!this.enabled || !this.completedAt) return { ok: false, reason: 'The key queue is not ready' };
    if (active && this.reviewActive) return { ok: true };
    if (active && this.reviewInFlight) return { ok: false, reason: 'Previous review is stopping' };
    if (!active) {
      this.reviewActive = false;
      return { ok: true };
    }
    this.reviewActive = true;
    this.reviewInFlight = true;
    this.reviewProcessed = 0;
    this.reviewCompletedAt = null;
    this.reviewError = null;
    void this.reviewQueue()
      .catch(error => {
        this.reviewError = error instanceof Error ? error.message : String(error);
        logger.error(`[VERIFICATION-QUEUE] Review failed: ${this.reviewError}`);
      })
      .finally(() => {
        this.reviewActive = false;
        this.reviewInFlight = false;
      });
    return { ok: true };
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

  private async backfill(): Promise<void> {
    await SecretVerificationJob.init();
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
  }

  private async reviewQueue(): Promise<void> {
    let lastId: mongoose.Types.ObjectId | undefined;
    while (this.reviewActive) {
      const filter = lastId ? { _id: { $gt: lastId } } : {};
      const secrets = await Secret.find(filter).sort({ _id: 1 }).limit(250)
        .select('_id provider').lean() as unknown as SecretRow[];
      if (!secrets.length) break;
      await this.enqueueBatch(secrets);
      const reviewed: mongoose.Types.ObjectId[] = [];
      for (const secret of secrets) {
        if (!this.reviewActive) break;
        if (secret.provider === 'openai') await this.inspectSources(secret._id);
        reviewed.push(secret._id);
      }
      if (reviewed.length) {
        await SecretVerificationJob.updateMany({ secretId: { $in: reviewed } }, { $set: { reviewedAt: new Date() } });
      }
      this.reviewProcessed += reviewed.length;
      lastId = secrets[secrets.length - 1]!._id;
    }
    if (this.reviewActive) this.reviewCompletedAt = new Date();
    logger.init(`[VERIFICATION-QUEUE] Metadata review finished after ${this.reviewProcessed} keys`);
  }

  private async inspectSources(secretId: mongoose.Types.ObjectId): Promise<void> {
    const sources = await Leak.find({ secretId }).select('secretId repoUrl filePath').limit(2).lean() as unknown as SourceRow[];
    const hints = new Set<string>();
    let inspected = false;
    for (const source of sources) {
      const url = rawGitHubUrl(source);
      if (!url) continue;
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
      } catch {
        // The current public file can be missing, moved, or too large.
      }
    }
    await SecretVerificationJob.updateOne({ secretId }, { $set: {
      sourceHints: [...hints],
      sourceStatus: inspected ? 'inspected' : 'unavailable',
      sourceInspectedAt: new Date()
    } });
  }
}

export const secretVerificationQueueService = new SecretVerificationQueueService();
