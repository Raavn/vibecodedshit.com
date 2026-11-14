# outbound

Lead finder. Searches GitHub for public repos built with Lovable, v0 and Bolt, keeps the ones with a live product, skips any repo already in the lead queue, scans the rest with the health scanner inside the `health:1.0` image (static layer first; a repo whose static layer has a ranking finding then gets a full run: install, build, typecheck, lint and tests) and posts each repo with a serious finding to the app's lead queue (`/api/ai/leads`, reviewed at `/admin/leads`). Nothing is sent to anyone: Peter writes every message.

```
npm --prefix health ci
npm --prefix outbound ci
npm --prefix outbound run find -- --limit 10
```

Flags: `--limit` (default 10), `--signals lovable,v0,bolt,replit`, `--max-scans` (default 60), `--dry-run` (scan, post nothing).

The script imports the scanner from `../health/src`, so `health/` needs its own dependencies installed first. Needs `gh` logged in, Docker with `health:1.0` built (`npm --prefix health run image:build`), and `AIMEKO_TOKEN` in the environment or `~/ServerRoot/.env.agents`. `LEADS_API_BASE` overrides `https://app.vibecodedshit.com`.

Rules:

- Public repos only. No code from a scanned repo runs on the host: every scan step runs in the container, and git clone runs no hooks.
- Install steps use their own package cache (`~/.cache/health/outbound-packages`), never the one your own scans share. `HEALTH_PACKAGE_CACHE` overrides it.
- Without `AIMEKO_TOKEN` (a `--dry-run` only) the queue is not checked, so queued repos are scanned again.
- Contact comes from the owner's public GitHub profile and the live homepage. Commit emails are never read.
- A found secret is never tested against its provider, and its value is never stored (gitleaks runs redacted).
- This repo is public: no lead data, repo names or findings are committed. They live only in the app database.
