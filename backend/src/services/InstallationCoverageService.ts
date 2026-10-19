import axios, { AxiosError } from 'axios';
import { createHash } from 'crypto';
import { gitHubAppAuthService } from './GitHubAppAuthService';
import { regexRouter } from './RegexRouter';
import { VerificationFinding } from '../models/VerificationFinding';
import { RepositoryCoverage } from '../models/RepositoryCoverage';
import { logger } from '../utils/logger';

type Repository = { full_name: string; private: boolean };
type Branch = { name: string; commit: { sha: string } };
type TreeEntry = { path: string; type: string; sha: string; size?: number };
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
const MAX_BLOBS_PER_PASS = 200;
const MAX_BLOB_BYTES = 128 * 1024;
const INTERVAL_MS = 15 * 60 * 1000;

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

  start(): void {
    if (process.env['INSTALLATION_COVERAGE_ENABLED'] !== 'true') return;
    this.timer = setInterval(() => { void this.runOnce(); }, INTERVAL_MS);
    void this.runOnce();
    logger.init('[COVERAGE] Installation repository scanning enabled');
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async get<T>(url: string, token: string, params?: Record<string, unknown>): Promise<T> {
    const response = await axios.get<T>(`${API}${url}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
      params,
      timeout: 20000
    });
    return response.data;
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

  async runOnce(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const token = await gitHubAppAuthService.getValidToken();
      const repos = await this.repositories(token);
      if (!repos.length) return;
      const states = await RepositoryCoverage.find({ repository: { $in: repos.map(r => r.full_name) } }).lean();
      const byRepo = new Map(states.map(s => [s.repository, s]));
      repos.sort((a, b) => (byRepo.get(a.full_name)?.lastScannedAt?.getTime() || 0) - (byRepo.get(b.full_name)?.lastScannedAt?.getTime() || 0));
      await this.scanRepository(repos[0]!.full_name, token);
    } catch (error) {
      logger.warn(`[COVERAGE] Pass failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.running = false;
    }
  }

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
      const status = (error as AxiosError).response?.status;
      if (status === 403) return 'denied';
      if (status === 404) return 'unavailable';
      logger.warn(`[COVERAGE] Alert sync failed for ${repository}: ${error instanceof Error ? error.message : String(error)}`);
      return 'error';
    }
  }

  private async scanRepository(repository: string, token: string): Promise<void> {
    const previous = await RepositoryCoverage.findOne({ repository }).lean();
    const alertsPermission = await this.syncAlerts(repository, token);
    let cursorBranch = previous?.cursorBranch || 0;
    let cursorFile = previous?.cursorFile || 0;
    const resuming = cursorBranch > 0 || cursorFile > 0;
    let branchesSeen = resuming ? previous?.branchesSeen || 0 : 0;
    let filesSeen = resuming ? previous?.filesSeen || 0 : 0;
    let skippedBlobs = resuming ? previous?.skippedBlobs || 0 : 0;
    let truncatedTrees = resuming ? previous?.truncatedTrees || 0 : 0;
    let budget = MAX_BLOBS_PER_PASS;
    let error = '';

    try {
      const branches = await this.pages<Branch>(`/repos/${repository}/branches`, token);
      while (cursorBranch < branches.length && budget > 0) {
        const branch = branches[cursorBranch]!;
        const tree = await this.get<{ tree: TreeEntry[]; truncated: boolean }>(`/repos/${repository}/git/trees/${branch.commit.sha}`, token, { recursive: 1 });
        if (tree.truncated && cursorFile === 0) truncatedTrees++;
        const files = tree.tree.filter(entry => entry.type === 'blob' && (entry.size || 0) <= MAX_BLOB_BYTES);
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
                      path: file.path, branch: branch.name, commitSha: branch.commit.sha,
                      encoded: finding.encoded, state: 'observed', validity: 'unknown',
                      url: `https://github.com/${repository}/blob/${branch.commit.sha}/${file.path.split('/').map(encodeURIComponent).join('/')}`,
                      observedAt: new Date() } },
                    { upsert: true }
                  );
                }
              }
            }
            filesSeen++;
          } catch (blobError) {
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
      const complete = cursorBranch >= branches.length;
      if (complete) {
        cursorBranch = 0;
        cursorFile = 0;
      }
      await RepositoryCoverage.updateOne({ repository }, { $set: {
        repository, lastScannedAt: new Date(), branchesSeen: complete ? branches.length : branchesSeen,
        filesSeen, skippedBlobs, truncatedTrees, cursorBranch, cursorFile, alertsPermission, error,
        ...(complete ? { snapshotCompleteAt: new Date() } : {})
      } }, { upsert: true });
    } catch (scanError) {
      error = scanError instanceof Error ? scanError.message : String(scanError);
      await RepositoryCoverage.updateOne({ repository }, { $set: {
        repository, lastScannedAt: new Date(), branchesSeen, filesSeen, skippedBlobs, truncatedTrees,
        cursorBranch, cursorFile, alertsPermission, error
      } }, { upsert: true });
      logger.warn(`[COVERAGE] Repository scan failed for ${repository}: ${error}`);
    }
  }
}

export const installationCoverageService = new InstallationCoverageService();
