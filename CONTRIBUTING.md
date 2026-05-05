# Contributing to Veridrop

Thanks for considering a contribution! This is an open-source project under
AGPL-3.0 — your fixes and additions help the whole AI relay community.

## Quick links

- **Issues / bug reports**: [github.com/canarybyte/veridrop/issues](https://github.com/canarybyte/veridrop/issues)
- **Live service**: [veridrop.org](https://veridrop.org) — useful for "this relay
  shows X but I expected Y" reports (paste the `/r/{job_id}` URL)
- **Design docs**: [DESIGN.md](DESIGN.md) — architecture overview
- **Detector design**: [DESIGN.md §3 / §6](DESIGN.md) — how each detector works

## Setting up locally

```bash
git clone git@github.com:canarybyte/veridrop.git
cd veridrop

python3 -m venv venv
./venv/bin/pip install -e ".[dev,web]"

# Run the test suite (should be ~240 tests, all passing)
./venv/bin/pytest tests/ -v

# Boot the local web service (http://localhost:8000)
VERIDROP_JOBS_DIR=/tmp/veridrop-dev ./venv/bin/uvicorn web.server:app --reload
```

## What kinds of PRs are welcome

| Type | Examples | Notes |
|---|---|---|
| 🐛 **Bug fixes** | False positives in long-context, edge cases in tokenizer estimation, broken UI states | Always include a regression test |
| 🔬 **New detectors** | Cache-control honoring, image-input detection, system-fingerprint check | See [DESIGN.md §6.2](DESIGN.md) for `ActiveDetector` / `PassiveDetector` interfaces |
| 🌐 **New protocols** | Anthropic Bedrock, Vertex AI native, Mistral, DeepSeek | Mirror the `protocols/anthropic/` structure; aim for ≥80% test coverage |
| 📊 **Baseline data** | New official model baselines for `data/baselines/` | Run `bench.sh` against the official API; commit only the JSON output |
| 📖 **Docs / FAQ** | New questions, translations, examples | Bilingual welcome (中文 + English) |
| 🎨 **UI / UX** | Better mobile layout, accessibility, dark mode | Don't add JS frameworks — keep it vanilla |

## What's NOT in scope

- **Anti-relay tools**: Veridrop verifies relays, not bypasses them. Don't propose
  features that help users evade rate limits / account bans.
- **Closed-source enterprise extensions**: Per AGPL-3.0, modifications running as
  a service must also be open-sourced. PRs adding closed-source hooks will be
  rejected.
- **Affiliate / commission code**: Business-layer code lives in a separate
  private repo by design (see [README.md `项目治理`](README.md)). The public
  repo is for the trust path only — detection, scoring, transparency.

## Code style

- **Python**: PEP 8, but loose. Function comments explain *why*, not *what*.
  See existing code for tone — comments often note the bug-of-the-day or the
  gotcha being defended against.
- **Tests**: pytest, async via `pytest-asyncio`. Mock external API calls;
  never make real upstream calls in unit tests.
- **Detector pattern**: see `protocols/anthropic/detectors/identity.py` for
  the canonical small detector. Keep `run()` short; helpers go in
  `_underscored_helpers()` below the class.
- **Commit messages**: imperative (`fix:`, `feat:`, `docs:` etc.). Bilingual
  is fine.

## PR process

1. **Open an issue first** if the change is non-trivial — saves both of us time
   if the design needs discussion.
2. **One feature per PR**. Multiple unrelated changes get split or asked for splits.
3. **Tests must pass** locally before pushing (`./venv/bin/pytest tests/`).
   CI will rerun them on push.
4. **Update docs** if you changed user-facing behavior — README, FAQ, or
   in-code docstrings.

## Reporting bugs

Open an issue with:

- **What you expected**: e.g. "I sent X to relay Y, expected `pass`"
- **What happened**: e.g. "got `fail` with summary 'Z' — but Y is the
  official anthropic.com"
- **The `/r/{job_id}` URL** if you ran on veridrop.org
- **The full JSON** if you ran locally (`detect -o report.json`)

Live data is the fastest path to a fix — half the bugs we've found this year
came from someone running a real relay and noticing surprising output.

## Security

If you find a security vulnerability (e.g. a way the service could log API
keys, an injection vector, etc.), please **do NOT open a public issue**. See
[SECURITY.md](SECURITY.md) for responsible disclosure.

## License

By submitting a PR, you agree your contribution is licensed under
**AGPL-3.0-or-later** — same as the rest of the project. We don't require
a CLA.
