<h1 align="center">
  <img src="logos/icons/transparent_logo.webp" alt="APIRadar Logo" width="75" valign="middle" style="vertical-align: middle; margin-right: 12px; background: transparent; border: none;" /> APIRadar — Real-Time Leaked API Key Scanner
</h1>

<p align="center">
  Scans public GitHub repositories in real time for leaked API keys using regex pattern matching and entropy filters, displaying redacted findings on a Next.js dashboard.
</p>

<p align="center">
  <a href="https://apiradar.bot.nu/" target="_blank" rel="noopener noreferrer"><img src="https://img.shields.io/badge/Live_Demo-apiradar.bot.nu-F59E0B?style=for-the-badge&logo=google-chrome&logoColor=white" alt="Live Demo" /></a>
  <a href="https://github.com/zaim-abbasi/APIRadar/stargazers" target="_blank" rel="noopener noreferrer"><img src="https://img.shields.io/github/stars/zaim-abbasi/APIRadar?style=for-the-badge&logo=github&color=10B981" alt="GitHub Stars" /></a>
  <a href="https://www.producthunt.com/products/api-radar/launches/api-radar-2" target="_blank" rel="noopener noreferrer"><img src="https://img.shields.io/badge/Product_Hunt-Featured-DA552F?style=for-the-badge&logo=product-hunt&logoColor=white" alt="Product Hunt" /></a>
  <a href="https://opensource.org/licenses/MIT" target="_blank" rel="noopener noreferrer"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge" alt="License: MIT" /></a>
</p>

<p align="center">
  <a href="https://nextjs.org/" target="_blank" rel="noopener noreferrer"><img src="https://img.shields.io/badge/Next.js-000000?style=for-the-badge&logo=next.js&logoColor=white" alt="Next.js" /></a>
  <a href="https://www.fastify.io/" target="_blank" rel="noopener noreferrer"><img src="https://img.shields.io/badge/Fastify-000000?style=for-the-badge&logo=fastify&logoColor=white" alt="Fastify" /></a>
  <a href="https://www.typescriptlang.org/" target="_blank" rel="noopener noreferrer"><img src="https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" /></a>
  <a href="https://www.mongodb.com/" target="_blank" rel="noopener noreferrer"><img src="https://img.shields.io/badge/MongoDB-47A248?style=for-the-badge&logo=mongodb&logoColor=white" alt="MongoDB" /></a>
  <a href="https://tailwindcss.com/" target="_blank" rel="noopener noreferrer"><img src="https://img.shields.io/badge/Tailwind_CSS-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white" alt="Tailwind CSS" /></a>
  <a href="https://twitter.com/intent/tweet?text=APIRadar%20%E2%80%94%20Real-time%20leaked%20API%20key%20scanner%20for%20public%20GitHub%20repos.&url=https://github.com/zaim-abbasi/APIRadar&hashtags=opensource,security,nextjs,typescript" target="_blank" rel="noopener noreferrer"><img src="https://img.shields.io/badge/Share-Tweet_Project-1DA1F2?style=for-the-badge&logo=x&logoColor=white" alt="Tweet Project" /></a>
</p>

<p align="center">
  <i>Note: APIRadar has migrated from <code>apiradar.live</code> to <a href="https://apiradar.bot.nu/" target="_blank" rel="noopener noreferrer">apiradar.bot.nu</a>.</i>
</p>

<br />

<p align="center">
  <img src="public/screenshots/homepage.png" alt="APIRadar Real-Time Threat Radar Homepage" width="100%" />
  <br />
  <sub><i>Note: All dashboard screenshots and telemetry statistics reflect live data as of September 6, 2026.</i></sub>
</p>

---

## Table of Contents

- [How Secret Detection Works](#how-secret-detection-works)
- [Supported Providers](#supported-providers)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Environment Setup](#environment-setup)
  - [Installation & Running](#installation--running)
- [Adding a New Provider](#adding-a-new-provider)
- [Contributing](#contributing)
- [Disclaimer](#disclaimer)
- [License](#license)

---

## How Secret Detection Works

APIRadar candidate strings are validated through a 6-stage pipeline: **RegEx trigger matching** ([RegexRouter.ts](backend/src/services/RegexRouter.ts)), **prefix/suffix sanitization**, **placeholder keyword filtering**, **[Shannon Entropy](https://en.wikipedia.org/wiki/Entropy_(information_theory)) calculation ($H \ge 2.5$)**, and **[trigram Markov model](https://en.wikipedia.org/wiki/Markov_chain) scoring** ([apiKeyValidator.ts](backend/src/services/apiKeyValidator.ts)).

The trigram Markov model (`model.json`) was custom-trained on the [Google 10,000 English Corpus](https://github.com/first20hours/google-10000-english) to calculate letter transition probabilities and eliminate natural language false positives.

---

## Supported Providers

APIRadar monitors leaked secrets across **OpenAI**, **Anthropic**, **Google Gemini**, **OpenRouter**, **xAI (Grok)**, **Groq**, **Cerebras**, **Slack Tokens & Webhooks**, **Discord Tokens & Webhooks**, and **Telegram Bot Tokens**.

<p align="center">
  <img src="public/screenshots/explore.png" alt="APIRadar Credential Exposures & Supported Providers Dashboard" width="100%" />
</p>

> [!TIP]
> **Want to monitor a custom secret format?** APIRadar is fully extensible. See [Adding a New Provider](#adding-a-new-provider) below to register custom regex rules in 3 simple steps.

---

## Getting Started

### Prerequisites

- **[Node.js](https://nodejs.org/)**: v18.0.0 or higher
- **[MongoDB](https://www.mongodb.com/docs/manual/installation/)**: v6.0 or higher
- **GitHub App**: App ID & RSA Private Key. See [GitHub Docs: Registering a GitHub App](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app) to create one.

---

### Environment Setup

Create `.env` files in the root and `backend/` directories:

#### Root `.env`

```env
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_BACKEND_URL=http://localhost:3001
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=your_nextauth_secret_here
```

#### Backend `backend/.env`

```env
PORT=3001
NODE_ENV=development

MONGODB_URI=mongodb://localhost:27017/apiradar

NEXTAUTH_SECRET=your_nextauth_secret_here
ENCRYPTION_KEY=your_32_character_encryption_key

RATE_LIMIT_MAX=300
RATE_LIMIT_WINDOW=60000
CORS_ORIGINS=http://localhost:3000

GITHUB_APP_ID=your_github_app_id
GITHUB_APP_CLIENT_ID=your_github_app_client_id
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----\n"
# GITHUB_APP_PRIVATE_KEY_PATH=keys/github-app.private-key.pem
GITHUB_APP_INSTALLATION_ID=your_primary_installation_id
# Comma-separated installation IDs from other accounts using this same App.
# GITHUB_COVERAGE_INSTALLATION_IDS=second_installation_id,third_installation_id
INSTALLATION_COVERAGE_ENABLED=true
VERIFICATION_OPERATOR_EMAILS=you@example.com
SECRET_VERIFICATION_QUEUE_ENABLED=true
```

The **Live Verification** tab reads findings from public repositories discovered by the
existing global code search or public push-event feed, as well as public repositories
accessible to the GitHub App installation. Existing discoveries in `ScannedRepo` are
imported into a durable branch/history queue on startup; later discoveries enter the
same queue. Grant the App `Contents: read` for branch snapshots and, optionally,
`Secret scanning alerts: read` to import GitHub's historical alerts and provider-reported
validity. Enable secret scanning for each repository in GitHub. The operator email must
match the Google account used to sign in. Alert sync requests `hide_secret=true`; the
dashboard shows metadata only. GitHub returns `active`, `inactive`, or `unknown` only
where validity checks are supported and available. Branch snapshot matches remain
`unknown`. The public tab shows aggregate counts; repository and path details
require an authenticated email in `VERIFICATION_OPERATOR_EMAILS`.

Stored `Secret` records enter a separate review queue when
`SECRET_VERIFICATION_QUEUE_ENABLED=true`. Startup backfills existing records,
and new findings are queued after ingestion. Jobs deduplicate by secret ID and
retain a detected provider, source count, and review gate. A generic `sk-`
match is classified as OpenAI-compatible until its actual provider can be
attributed. The Live Verification panel shows per-provider queue counts.
Only an email in `VERIFICATION_OPERATOR_EMAILS` can use the manual **Start
review** control. That pass rereads current public source files for API URL
clues and records only provider hints, inspection status, and timestamps; it
does not store file contents or send authentication requests using discovered
keys. A file may have changed since detection, and multiple provider URLs in
one file remain ambiguous. Queue and source hints do not establish validity.
Failed source reads retain a reason tag (`rate_limited`, `timeout`,
`source_not_found`, and similar), return to the review queue, and receive a
bounded exponential retry time while operator review remains active. Review
progress, retry counts, and failure tags are shown in Live Verification.

After reviewing source-file clues and establishing which provider owns a key,
an operator can check a key they control with the standalone script below.
It accepts only a key explicitly supplied in `OWNED_PROVIDER_KEY`, sends one
read-only request to a fixed official endpoint, and prints only a status. It
does not read the APIRadar database or verification queue. Generic `sk-`
matches and files containing several provider URLs need attribution before a
provider is selected; source hints alone do not prove a key's provider.

```bash
OWNED_PROVIDER_KEY='your-own-key' node tools/verify-owned-provider-key.mjs openai
# Also supported: deepseek, openrouter
```

The endpoints are OpenAI `GET /v1/models`, DeepSeek `GET /models`, and
OpenRouter `GET /api/v1/key`. A successful authentication response does not
establish access to a particular paid model. The script treats access errors,
rate limits, and transport errors separately from a successful response.

The existing global code search still covers GitHub's indexed default branches and
the public event listener watches recent pushes. The backfill now traverses branch
heads and reachable commit history of every public repository those feeds discover.
The App installation additionally supplies GitHub's secret scanning alerts for
installed public repositories. A worker selects one oldest unvisited repository
per configured installation every 30 seconds, scans up to 20 text blobs and two
commits per pass, and reserves 1,500 GitHub core API requests on the primary
installation for incremental feeds. Additional installations keep a 100-request
reserve each. Work is bounded to one repository per installation per pass and
backs off on core and secondary rate limits. Only the primary installation
enumerates installed repositories and reads secret scanning alerts; the others
process the existing public queue. It resumes from saved
cursors and walks truncated Git
trees one subtree at a time. Files over 1 MiB, binary files, and commit files
without a complete patch are reported as coverage gaps.
The App installation does not grant access to secret scanning alerts for arbitrary
public repositories. Queued, visited, and completed counts in Live Verification
distinguish scope registration from actual scan completion. Public search and event
feeds do not enumerate every GitHub repository. The former full-key download route
has been removed.

---

### Installation & Running

1. **Clone the repository**:

   ```bash
   git clone https://github.com/zaim-abbasi/APIRadar.git
   cd APIRadar
   ```

2. **Install dependencies**:

   ```bash
   npm install
   cd backend && npm install && cd ..
   ```

3. **Start development server (Frontend + Backend)**:

   ```bash
   npm run dev:all
   ```

   - Frontend UI: `http://localhost:3000`
   - Backend API: `http://localhost:3001`

---

## Adding a New Provider

To add a provider, update three files:

1. **Add matching rule** in [backend/src/services/RegexRouter.ts](backend/src/services/RegexRouter.ts):

```typescript
{
  name: 'cohere',                         // Unique provider ID (lowercase)
  label: 'Cohere',                       // UI display label
  regex: /\b(cohere_[a-zA-Z0-9]{32,64})\b/, // Use \b word boundaries to prevent false positives
  prefixes: ['cohere_']                  // Static search prefix strings for Code Search
}
```

2. **Strip static prefixes** in [backend/src/services/apiKeyValidator.ts](backend/src/services/apiKeyValidator.ts):

```typescript
secretPart = secretPart.replace(/^cohere_/, ""); // Strips fixed prefix so entropy & Markov scoring evaluate raw key randomness
```

3. **Register UI constants** in [lib/constants.ts](lib/constants.ts):

```typescript
export const PROVIDER_NAMES = ['cohere', ...] as const;
export const PROVIDER_LABELS = [{ value: 'cohere', label: 'Cohere' }, ...] as const;
```

Run `cd backend && npm run build && npm run test` to verify your changes.

---

## Contributing

Contributions are welcome! Whether you are adding new API provider regex patterns, improving detection algorithms, or submitting UI enhancements:

1. Browse open issues or look for tags like [`good first issue`](https://github.com/zaim-abbasi/APIRadar/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) and [`help wanted`](https://github.com/zaim-abbasi/APIRadar/issues?q=is%3Aissue+is%3Aopen+label%3A%22help+wanted%22).
2. Fork the repo and create a feature branch (`git checkout -b feature/my-changes`).
3. Format (`npm run format`) and lint (`npm run lint`).
4. Confirm the backend builds (`cd backend && npm run build`).
5. Submit a [Pull Request](https://github.com/zaim-abbasi/APIRadar/pulls).

If you find APIRadar useful, consider starring the repository to help other security researchers and developers discover it.

---

## Disclaimer

This software is intended solely for security research, defensive monitoring, and educational purposes. The authors and maintainers assume no responsibility or liability for how this software is deployed or used, nor for any damages, security incidents, unauthorized access, API billing charges, or data breaches resulting from its operation.

Users are solely responsible for ensuring compliance with applicable laws, third-party terms of service (including GitHub API policies), and security regulations when hosting or executing APIRadar.

---

## License

Distributed under the MIT License. See [LICENSE](LICENSE) for details.
