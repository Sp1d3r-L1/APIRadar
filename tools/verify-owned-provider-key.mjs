#!/usr/bin/env node

// Manual check for an operator-supplied key. This script has no database or queue access.
const endpoints = Object.freeze({
  openai: 'https://api.openai.com/v1/models',
  deepseek: 'https://api.deepseek.com/models',
  openrouter: 'https://openrouter.ai/api/v1/key'
});

const provider = process.argv[2];
const key = process.env.OWNED_PROVIDER_KEY;

if (!Object.hasOwn(endpoints, provider) || process.argv.length !== 3 || !key || /[\r\n\x00-\x1f\x7f]/.test(key)) {
  process.stderr.write('Usage: OWNED_PROVIDER_KEY=<your-key> node tools/verify-owned-provider-key.mjs <openai|deepseek|openrouter>\n');
  process.exitCode = 2;
} else {
  try {
    const response = await fetch(endpoints[provider], {
      method: 'GET',
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(8000)
    });
    await response.body?.cancel();

    const result = response.status >= 200 && response.status < 300
      ? 'authenticated'
      : response.status === 401
        ? 'rejected'
        : response.status === 429
          ? 'rate_limited'
          : 'inconclusive';
    process.stdout.write(JSON.stringify({ provider, result, httpStatus: response.status, checkedAt: new Date().toISOString() }) + '\n');
    if (result !== 'authenticated') process.exitCode = 1;
  } catch {
    process.stdout.write(JSON.stringify({ provider, result: 'inconclusive', reason: 'request_failed', checkedAt: new Date().toISOString() }) + '\n');
    process.exitCode = 1;
  }
}
