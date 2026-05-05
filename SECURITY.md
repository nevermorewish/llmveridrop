# Security Policy

Veridrop's product premise is **"users entrust us with their API keys to test
relay authenticity"**. Security isn't a checkbox — it's the whole business.

## How we handle API keys

This is the bit users care most about. Verifiable from the code:

| What we do | Where you can verify |
|---|---|
| API keys live ONLY in the in-memory `Job` object during a detection run | [`web/jobs.py`](web/jobs.py) — search for `api_key` |
| Keys are NEVER written to the report JSON | [`web/jobs.py:_run`](web/jobs.py) — `mask_api_key()` is the only thing that touches disk |
| Keys are NEVER written to logs | No print/log statements include `api_key` (grep verifies it) |
| Keys are NEVER persisted in any database | We don't have a database for jobs at all — JSON files only, masked |
| Reports show keys masked: `sk-y7xU••••••0h` | [`mask_api_key`](src/relay_detector/models.py) function |
| `.env` files are gitignored | [`.gitignore`](.gitignore) |
| Production deployment is on a single, owned VPS — no third-party processors | We never sell, share, or proxy keys to any vendor |

If you don't trust the hosted service, **clone and run locally**. The same code
in this repo IS the production code at veridrop.org.

## Reporting a vulnerability

If you find any of:

- A way to extract API keys from the running service (memory / process / logs)
- A code path that writes keys to disk, even temporarily
- A code path that sends user keys to any non-upstream destination
- A relay-side detection bypass that would silently mark a fraudulent relay as authentic
- Any other security issue

**Please do NOT open a public GitHub issue.** Instead:

- Email: open an issue marked "[SECURITY]" with NO sensitive details, asking
  for a private channel; or
- Use GitHub's [private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
  on this repo

We aim to respond within **72 hours**. For confirmed issues:

- We patch
- We notify the live service operators (veridrop.org)
- We publish an advisory at [GitHub Security Advisories](https://github.com/canarybyte/veridrop/security/advisories)
  after a reasonable disclosure window (typically 14 days, longer if the bug is severe)
- We credit the reporter (unless they prefer anonymity)

## What's IN scope

- Anything in this repository's code, configurations, or default deployment setup
- The hosted service at veridrop.org
- API key handling, both in-memory and on-the-wire (TLS expectations)
- Authentication / authorization on any future admin features

## What's OUT of scope

- **Upstream relay vulnerabilities**: if `some-relay.com` has a bug, that's
  their responsibility, not ours. Veridrop just tests them.
- **DoS / rate-limit** on veridrop.org: we run on a single VPS; obviously
  someone can DDoS it. Not a vulnerability per se.
- **Phishing sites**: people may set up fake "veridrop.io" / "veridrop.cn"
  trying to steal API keys. We're aware. Always verify the URL is `veridrop.org`.
- **Self-hosted misconfigurations**: if you run Veridrop in a way that
  exposes keys (e.g. enable verbose logging, expose `web_data/`), that's on you.

## Defense in depth

We design for the case where the operator's server itself gets compromised:

- Keys never touch disk — even a full filesystem dump won't have them
- Reports are masked at write time — no "raw before mask" form exists
- The code doesn't have a "verbose mode" that prints keys (intentional)

If you find any exception to these claims in the code, please report it.

## Bug bounty

We don't have a paid bug bounty program. We do have public credit + a
co-author commit attribution if you'd like one. AGPL means we're a community
project, not a venture-backed company — sorry, no cash.

Thanks for reading this. Veridrop only works if it's actually trustworthy,
and the only way to keep it trustworthy is for people like you to keep it
honest.
