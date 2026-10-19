# Branch coverage and Live Verification plan

## Milestone 1 — branch coverage (implemented on this branch)

- Keep the existing public code search and push-event feeds.
- Enumerate public repositories accessible to the GitHub App installation.
- Walk every branch head, scan bounded text blobs with existing rules, and decode
  bounded Base64 literals and adjacent encoded-prefix/plain-suffix pairs before matching. Save only metadata and a one-way
  fingerprint; never copy a key into the verification collection.
- Persist branch and file cursors so a 200-blob pass resumes on the next cycle.
  Report skipped blobs, truncated Git trees, and scan errors.
- Import GitHub secret scanning alerts when the installation has `Secret scanning
  alerts: read`. GitHub's alert engine supplies history and all-branch coverage
  for its supported patterns.

## Milestone 2 — Live Verification (implemented on this branch)

- Sync GitHub alert `validity` and `is_base64_encoded` with `hide_secret=true`.
- Show `active`, `inactive`, or `unknown` as GitHub reports them. Custom branch
  matches remain `unknown` because no provider credential probe is made.
- Restrict the metadata dashboard to configured operator email addresses.
- Remove the existing full-key download API and copy buttons.

## Coverage limits and follow-up

- GitHub code search only indexes default branches. This supplement covers
  installed public repositories; a GitHub App installation is not an entitlement
  to read arbitrary repositories' secret scanning alerts.
- Files over 128 KiB, binary files, truncated recursive trees, and GitHub alert
  patterns without Base64 or validity support remain gaps. The UI reports the
  measurable gaps. Dynamic runtime assembly of a key also remains a gap. A future release can walk truncated trees nonrecursively and
  add repository-owner-authorized validation for custom patterns.
- Enable `INSTALLATION_COVERAGE_ENABLED=true`, set
  `VERIFICATION_OPERATOR_EMAILS`, and grant the App the permissions described
  in the README. Existing installations must accept the App permission change.
