import axios, { AxiosError } from 'axios';
import { createHash } from 'crypto';
import { gitHubAppAuthService } from './GitHubAppAuthService';
import { regexRouter } from './RegexRouter';
import { VerificationFinding } from '../models/VerificationFinding';
import { RepositoryCoverage } from '../models/RepositoryCoverage';
import { importDiscoveredRepositories } from './CoverageDiscoveryService';
import { logger } from '../utils/logger';

type Repository = { full_name: string; private: boolean };
type Branch = { name: string; commit: { sha: string } };
type TreeEntry = { path: string; type: string; sha: string; size?: number };
type CommitSummary = { sha: string };
type CommitDetail = { files?: Array<{ filename: string; patch?: string }> };
type SecretAlert = {
  number: number;
  state: string;
  secret_type: string;
  validity?: string;
  is_base64_encoded?: boolean;
  html_url: string;
  updated_at: string;
  first_location_detected?: { path?: string; commit_sha?: string };
};

const API = 'https://api.github.com';
const MAX_BLOBS_PER_PASS = 20;
const MAX_BLOB_BYTES = 1024 * 1024;
const MAX_COMMITS_PER_PASS = 2;
const INTERVAL_MS = 30 * 1000;
const CORE_RESERVE = 1500;
const EXTRA_CORE_RESERVE = 100;

class CoreBudgetExhausted extends Error {}
type RateBudget = { remaining: number | null; resetAt: number; blockedUntil: number; secondaryStrikes: number };

/** Decode bounded, printable Base64 literals and run the normal rules on their content. */
export function scanEncodedContent(content: string): Array<{ key: string; provider: string; encoded: boolean }> {
  const findings = regexRouter.scan(content).map(({ key, provider }) => ({ key, provider, encoded: false }));
  const seen = new Set(findings.map(f => f.key));
  const record = (key: string, provider: string) => {
    if (!seen.has(key)) {
      findings.push({ key, provider, encoded: true });
      seen.add(key);
    }
  };
  const literals = content.match(/(?:[A-Za-z0-9+/_-]{40,2048}={0,2})/g) || [];
  for (const literal of literals.slice(0, 1000)) {
    try {
      const decoded = Buffer.from(literal, 'base64').toString('utf8');
      if (!/^[\x09\x0a\x0d\x20-\x7e]+$/.test(decoded)) continue;
      for (const { key, provider } of regexRouter.scan(decoded)) record(key, provider);
    } catch { /* Invalid literals are ignored. */ }
  }
  // Common static composition: atob('c2st') + 'suffix' or 'c2st' + 'suffix'.
  // Only join adjacent string literals; never execute code from a repository.
  const encodedPrefixes = new Set(['sk-', 'sk-ant-', 'sk-or-', 'xai-', 'gsk_', 'groq_', 'csk-', 'AIza']);
  const adjacent = /['"]([A-Za-z0-9+/_-]{4,32}={0,2})['"]\s*\)?\s*\+\s*['"]([A-Za-z0-9_-]{20,120})['"]/g;
  let match: RegExpExecArray | null;
  while ((match = adjacent.exec(content)) !== null) {
    const prefix = Buffer.from(match[1]!, 'base64').toString('utf8');
    if (!encodedPrefixes.has(prefix)) continue;
    for (const { key, provider } of regexRouter.scan(prefix + match[2]!)) record(key, provider);
  }
  return findings;
}

class InstallationCoverageService {
  private timer?: NodeJS.Timeout;
  private running = false;
  private importPromise: Promise<void> | undefined;
  private primaryInstallationId = 0;
  private coverageInstallationIds: number[] = [];
  private tokenInstallations = new Map<string, number>();
  private budgets = new Map<number, RateBudget>();

  private registerToken(id: number, token: string): void {
    for (const [oldToken, oldId] of this.tokenInstallations) {
      if (oldId === id && oldToken !== token) this.tokenInstallations.delete(oldToken);
    }
    this.tokenInstallations.set(token, id);
  }

  private budget(id: number): RateBudget {
    let budget = this.budgets.get(id);
    if (!budget) {
      budget = { remaining: null, resetAt: 0, blockedUntil: 0, secondaryStrikes: 0 };
      this.budgets.set(id, budget);
    }
    if (Date.now() >= budget.resetAt) budget.remaining = null;
    return budget;
  }

  private pauseUntil(id: number): number {
    const budget = this.budget(id);
    const reserve = id === this.primaryInstallationId ? CORE_RESERVE : EXTRA_CORE_RESERVE;
    return Math.max(budget.blockedUntil,
      budget.remaining !== null && budget.remaining <= reserve ? budget.resetAt : 0);
  }

  getRatePauseUntil(): string | null {
    if (!this.coverageInstallationIds.length) return null;
    const pauses = this.coverageInstallationIds.map(id => this.pauseUntil(id));
    return pauses.every(until => until > Date.now())
      ? new Date(Math.min(...pauses)).toISOString() : null;
  }

  getInstallationCapacity(): { configured: number; available: number } {
    return {
      configured: this.coverageInstallationIds.length,
      available: this.coverageInstallationIds.filter(id => this.pauseUntil(id) <= Date.now()).length
    };
  }

  start(): void {
    if (process.env['INSTALLATION_COVERAGE_ENABLED'] !== 'true') return;
    this.importPromise = importDiscoveredRepositories().catch(error => {
      this.importPromise = undefined;
      throw error;
    });
    this.timer = setInterval(() => { void this.runOnce(); }, INTERVAL_MS);
    void this.runOnce();
    logger.init('[COVERAGE] Public discovery repository scanning enabled');
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async get<T>(url: string, token: string, params?: Record<string, unknown>): Promise<T> {
    const id = this.tokenInstallations.get(token);
    if (!id) throw new Error('Unregistered coverage installation token');
    const budget = this.budget(id);
    const pausedUntil = this.pauseUntil(id);
    if (pausedUntil > Date.now()) {
      throw new CoreBudgetExhausted(`GitHub installation ${id} paused until ${new Date(pausedUntil).toISOString()}`);
    }
    try {
      const response = await axios.get<T>(`${API}${url}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
        params,
        timeout: 20000
      });
      const remaining = Number(response.headers['x-ratelimit-remaining']);
      const reset = Number(response.headers['x-ratelimit-reset']);
      if (Number.isFinite(remaining)) budget.remaining = remaining;
      if (Number.isFinite(reset)) budget.resetAt = reset * 1000;
      budget.secondaryStrikes = 0;
      return response.data;
    } catch (error) {
      const response = (error as AxiosError).response;
      const remaining = Number(response?.headers?.['x-ratelimit-remaining']);
      const reset = Number(response?.headers?.['x-ratelimit-reset']);
      if (response && Number.isFinite(remaining)) budget.remaining = remaining;
      if (response && Number.isFinite(reset)) budget.resetAt = reset * 1000;
      const message = String((response?.data as { message?: string } | undefined)?.message || '');
      const secondary = /secondary rate limit|abuse detection/i.test(message) ||
        (response?.status === 429 && remaining > 0);
      if (secondary) {
        budget.secondaryStrikes++;
        const retryAfter = Number(response?.headers['retry-after']);
        const fallbackMs = Math.min(900_000, 60_000 * 2 ** Math.min(budget.secondaryStrikes - 1, 4));
        const retryUntil = Date.now() + (Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : fallbackMs);
        budget.blockedUntil = remaining === 0 ? Math.max(budget.resetAt, retryUntil) : retryUntil;
      } else if (response?.status === 429 || (response?.status === 403 && remaining === 0)) {
        const retryAfter = Number(response.headers['retry-after']);
        const retryUntil = Date.now() + (Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 60_000);
        budget.blockedUntil = remaining === 0 ? Math.max(budget.resetAt, retryUntil) : retryUntil;
      }
      if (response?.status === 403 || response?.status === 429) {
        logger.warn(`[COVERAGE] GitHub ${response.status} on ${url} for installation ${id}: ${message || 'no message'} (remaining ${response.headers['x-ratelimit-remaining'] || 'unknown'})`);
      }
      throw error;
    }
  }

  private async pages<T>(url: string, token: string, params?: Record<string, unknown>): Promise<T[]> {
    const all: T[] = [];
    for (let page = 1; ; page++) {
      const batch = await this.get<T[]>(url, token, { ...params, per_page: 100, page });
      all.push(...batch);
      if (batch.length < 100) break;
    }
    return all;
  }

  private async repositories(token: string): Promise<Repository[]> {
    const result: Repository[] = [];
    for (let page = 1; ; page++) {
      const data = await this.get<{ repositories: Repository[] }>('/installation/repositories', token, { per_page: 100, page });
      result.push(...data.repositories.filter(repo => !repo.private));
      if (data.repositories.length < 100) break;
    }
    return result;
  }

  private async branches(repository: string, token: string): Promise<Array<{ name: string; sha: string }>> {
    const branches = await this.pages<Branch>(`/repos/${repository}/branches`, token);
    return branches.map(branch => ({ name: branch.name, sha: branch.commit.sha }));
  }

  private async treeFiles(repository: string, sha: string, token: string): Promise<{ files: TreeEntry[]; fallbackUsed: boolean }> {
    const commit = await this.get<{ tree: { sha: string } }>(`/repos/${repository}/git/commits/${sha}`, token);
    const treeSha = commit.tree.sha;
    const recursive = await this.get<{ tree: TreeEntry[]; truncated: boolean }>(`/repos/${repository}/git/trees/${treeSha}`, token, { recursive: 1 });
    if (!recursive.truncated) return { files: recursive.tree.filter(entry => entry.type === 'blob'), fallbackUsed: false };

    // GitHub truncates large recursive trees. Walk subtrees without recursive=1.
    const queue: Array<{ sha: string; path: string }> = [{ sha: treeSha, path: '' }];
    const files: TreeEntry[] = [];
    while (queue.length) {
      const current = queue.shift()!;
      const tree = await this.get<{ tree: TreeEntry[]; truncated: boolean }>(`/repos/${repository}/git/trees/${current.sha}`, token);
      if (tree.truncated) throw new Error(`Unresolved tree truncation at ${current.path || '/'}`);
      for (const entry of tree.tree) {
        const path = current.path ? `${current.path}/${entry.path}` : entry.path;
        if (entry.type === 'tree') queue.push({ sha: entry.sha, path });
        if (entry.type === 'blob') files.push({ ...entry, path });
      }
    }
    return { files, fallbackUsed: true };
  }

  private async scanHistory(repository: string, token: string): Promise<void> {
    const previous = await RepositoryCoverage.findOne({ repository }).lean();
    let heads = previous?.historyHeads?.length ? previous.historyHeads : await this.branches(repository, token);
    let branchIndex = previous?.historyCursorBranch || 0;
    let page = previous?.historyCursorPage || 1;
    let index = previous?.historyCursorIndex || 0;
    const resuming = branchIndex > 0 || page > 1 || index > 0;
    let commitsSeen = resuming ? previous?.commitsSeen || 0 : 0;
    let missingPatches = resuming ? previous?.missingPatches || 0 : 0;
    let budget = MAX_COMMITS_PER_PASS;
    let historyError = '';
    let completed = false;

    try {
      while (branchIndex < heads.length && budget > 0) {
        const head = heads[branchIndex]!;
        const batch = await this.get<CommitSummary[]>(`/repos/${repository}/commits`, token, { sha: head.sha, per_page: 100, page });
        if (index >= batch.length) {
          if (batch.length < 100) {
            branchIndex++;
            page = 1;
          } else {
            page++;
          }
          index = 0;
          continue;
        }
        const commit = batch[index]!;
        let filePage = 1;
        while (true) {
          const detail = await this.get<CommitDetail>(`/repos/${repository}/commits/${commit.sha}`, token, { per_page: 100, page: filePage });
          const files = detail.files || [];
          for (const file of files) {
            if (!file.patch) {
              missingPatches++;
              continue;
            }
            for (const finding of scanEncodedContent(file.patch)) {
              const fingerprint = createHash('sha256').update(finding.key).digest('hex');
              const sourceId = `commit:${commit.sha}:${file.filename}:${fingerprint}`;
              await VerificationFinding.updateOne({ repository, sourceId }, { $set: {
                repository, sourceId, source: 'commit-diff', provider: finding.provider,
                path: file.filename, branch: head.name, commitSha: commit.sha,
                encoded: finding.encoded, state: 'historical', validity: 'unknown',
                url: `https://github.com/${repository}/commit/${commit.sha}`,
                observedAt: new Date()
              } }, { upsert: true });
            }
          }
          if (files.length < 100 || filePage >= 3) {
            if (files.length === 100 && filePage >= 3) missingPatches++;
            break;
          }
          filePage++;
        }
        commitsSeen++;
        budget--;
        index++;
      }
      completed = branchIndex >= heads.length;
    } catch (error) {
      historyError = error instanceof Error ? error.message : String(error);
      logger.warn(`[COVERAGE] History scan failed for ${repository}: ${historyError}`);
    }
    if (completed) {
      heads = [];
      branchIndex = 0;
      page = 1;
      index = 0;
    }
    await RepositoryCoverage.updateOne({ repository }, { $set: {
      repository, historyHeads: heads, historyCursorBranch: branchIndex,
      historyCursorPage: page, historyCursorIndex: index, commitsSeen,
      missingPatches, historyError,
      ...(completed ? { historyCompleteAt: new Date() } : {})
    } }, { upsert: true });
  }

  async runOnce(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      if (!this.importPromise) this.importPromise = importDiscoveredRepositories();
      await this.importPromise;
      this.coverageInstallationIds = await gitHubAppAuthService.getCoverageInstallationIds();
      this.primaryInstallationId = this.coverageInstallationIds[0]!;
      const primaryToken = await gitHubAppAuthService.getValidToken(this.primaryInstallationId);
      this.registerToken(this.primaryInstallationId, primaryToken);
      // Refresh the installation set periodically; public repository discovery is continuous.
      if (this.pauseUntil(this.primaryInstallationId) <= Date.now() &&
          (!this.installedAt || Date.now() - this.installedAt > 15 * 60_000)) {
        const repos = await this.repositories(primaryToken);
        if (repos.length) {
          await RepositoryCoverage.bulkWrite(repos.map(repo => ({ updateOne: {
            filter: { repository: repo.full_name },
            update: { $setOnInsert: { repository: repo.full_name }, $set: { installed: true } },
            upsert: true
          } })), { ordered: false });
        }
        this.installedAt = Date.now();
      }
      const active: Array<{ id: number; token: string }> = [];
      for (const id of this.coverageInstallationIds) {
        if (this.pauseUntil(id) > Date.now()) continue;
        try {
          const token = id === this.primaryInstallationId
            ? primaryToken : await gitHubAppAuthService.getValidToken(id);
          this.registerToken(id, token);
          active.push({ id, token });
        } catch (error) {
          logger.warn(`[COVERAGE] Installation ${id} token failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      if (!active.length) return;
      const next = await RepositoryCoverage.find().sort({ lastScannedAt: 1, _id: 1 })
        .limit(active.length).lean();
      for (const [index, { id, token }] of active.slice(0, next.length).entries()) {
        const repository = next[index]!;
        try {
          const alertToken = this.pauseUntil(this.primaryInstallationId) <= Date.now()
            ? primaryToken : undefined;
          await this.scanRepository(repository.repository, token, repository.installed, alertToken);
          await this.scanHistory(repository.repository, token);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          await RepositoryCoverage.updateOne({ repository: repository.repository },
            { $set: { lastScannedAt: new Date(), error: message } });
          logger.warn(`[COVERAGE] Installation ${id} pass failed for ${repository.repository}: ${message}`);
        }
      }
    } catch (error) {
      logger.warn(`[COVERAGE] Pass failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.running = false;
    }
  }

  private installedAt = 0;

  private async syncAlerts(repository: string, token: string): Promise<'ok' | 'denied' | 'unavailable' | 'error'> {
    try {
      const alerts = await this.pages<SecretAlert>(`/repos/${repository}/secret-scanning/alerts`, token, { hide_secret: true });
      for (const alert of alerts) {
        const validity = ['active', 'inactive'].includes(alert.validity || '') ? alert.validity as 'active' | 'inactive' : 'unknown';
        await VerificationFinding.updateOne(
          { repository, sourceId: `alert:${alert.number}` },
          { $set: {
            repository, sourceId: `alert:${alert.number}`, source: 'github-secret-scanning',
            provider: alert.secret_type, path: alert.first_location_detected?.path || '',
            commitSha: alert.first_location_detected?.commit_sha,
            encoded: Boolean(alert.is_base64_encoded), state: alert.state, validity,
            url: alert.html_url, observedAt: new Date(alert.updated_at)
          } },
          { upsert: true }
        );
      }
      return 'ok';
    } catch (error) {
      const response = (error as AxiosError).response;
      const status = response?.status;
      if (response?.status === 403) {
        const message = String((response.data as { message?: string } | undefined)?.message || '');
        return response.headers['x-ratelimit-remaining'] === '0' ||
          /rate limit|abuse detection/i.test(message) ? 'error' : 'denied';
      }
      if (status === 404) return 'unavailable';
      logger.warn(`[COVERAGE] Alert sync failed for ${repository}: ${error instanceof Error ? error.message : String(error)}`);
      return 'error';
    }
  }

  private async scanRepository(repository: string, token: string, installed: boolean, alertToken?: string): Promise<void> {
    const previous = await RepositoryCoverage.findOne({ repository }).lean();
    const alertsPermission = installed
      ? (alertToken ? await this.syncAlerts(repository, alertToken) : 'pending')
      : 'not-applicable';
    let cursorBranch = previous?.cursorBranch || 0;
    let cursorFile = previous?.cursorFile || 0;
    let heads = previous?.snapshotHeads?.length ? previous.snapshotHeads : await this.branches(repository, token);
    const resuming = cursorBranch > 0 || cursorFile > 0;
    let branchesSeen = resuming ? previous?.branchesSeen || 0 : 0;
    let filesSeen = resuming ? previous?.filesSeen || 0 : 0;
    let skippedBlobs = resuming ? previous?.skippedBlobs || 0 : 0;
    let skippedLarge = resuming ? previous?.skippedLarge || 0 : 0;
    let skippedBinary = resuming ? previous?.skippedBinary || 0 : 0;
    let truncatedTrees = resuming ? previous?.truncatedTrees || 0 : 0;
    let budget = MAX_BLOBS_PER_PASS;
    let error = '';

    try {
      while (cursorBranch < heads.length && budget > 0) {
        const branch = heads[cursorBranch]!;
        const tree = await this.treeFiles(repository, branch.sha, token);
        if (tree.fallbackUsed && cursorFile === 0) truncatedTrees++;
        if (cursorFile === 0) skippedLarge += tree.files.filter(entry => (entry.size || 0) > MAX_BLOB_BYTES).length;
        const files = tree.files.filter(entry => (entry.size || 0) <= MAX_BLOB_BYTES);
        while (cursorFile < files.length && budget > 0) {
          const file = files[cursorFile]!;
          budget--;
          try {
            const blob = await this.get<{ content: string; encoding: string }>(`/repos/${repository}/git/blobs/${file.sha}`, token);
            if (blob.encoding === 'base64') {
              const content = Buffer.from(blob.content, 'base64').toString('utf8');
              if (!content.includes('\0')) {
                for (const finding of scanEncodedContent(content)) {
                  const fingerprint = createHash('sha256').update(finding.key).digest('hex');
                  const sourceId = `snapshot:${branch.name}:${file.path}:${fingerprint}`;
                  await VerificationFinding.updateOne(
                    { repository, sourceId },
                    { $set: { repository, sourceId, source: 'branch-snapshot', provider: finding.provider,
                      path: file.path, branch: branch.name, commitSha: branch.sha,
                      encoded: finding.encoded, state: 'observed', validity: 'unknown',
                      url: `https://github.com/${repository}/blob/${branch.sha}/${file.path.split('/').map(encodeURIComponent).join('/')}`,
                      observedAt: new Date() } },
                    { upsert: true }
                  );
                }
              } else skippedBinary++;
            }
            filesSeen++;
          } catch (blobError) {
            if (blobError instanceof CoreBudgetExhausted || [403, 429].includes((blobError as AxiosError).response?.status || 0)) throw blobError;
            skippedBlobs++;
            logger.warn(`[COVERAGE] Blob skipped in ${repository}: ${blobError instanceof Error ? blobError.message : String(blobError)}`);
          }
          cursorFile++;
        }
        if (cursorFile >= files.length) {
          cursorFile = 0;
          cursorBranch++;
          branchesSeen++;
        }
      }
      const complete = cursorBranch >= heads.length;
      if (complete) {
        heads = [];
        cursorBranch = 0;
        cursorFile = 0;
      }
      await RepositoryCoverage.updateOne({ repository }, { $set: {
        repository, lastScannedAt: new Date(), branchesSeen,
        filesSeen, skippedBlobs, skippedLarge, skippedBinary, truncatedTrees,
        snapshotHeads: heads, cursorBranch, cursorFile, alertsPermission, error,
        ...(complete ? { snapshotCompleteAt: new Date() } : {})
      } }, { upsert: true });
    } catch (scanError) {
      error = scanError instanceof Error ? scanError.message : String(scanError);
      await RepositoryCoverage.updateOne({ repository }, { $set: {
        repository, lastScannedAt: new Date(), branchesSeen, filesSeen, skippedBlobs,
        skippedLarge, skippedBinary, truncatedTrees, snapshotHeads: heads,
        cursorBranch, cursorFile, alertsPermission, error
      } }, { upsert: true });
      logger.warn(`[COVERAGE] Repository scan failed for ${repository}: ${error}`);
    }
  }
}

export const installationCoverageService = new InstallationCoverageService();
