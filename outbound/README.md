# outbound

Lead finder. Searches GitHub for public repos built with Lovable, v0 and Bolt, keeps the ones with a live product, scans them with the health scanner (static layer only, inside the `health:1.0` image) and posts each repo with a serious finding to the app's lead queue (`/api/ai/leads`, reviewed at `/admin/leads`). Nothing is sent to anyone: Peter writes every message.

```
npm --prefix outbound ci
npm --prefix outbound run find -- --limit 10
```

Flags: `--limit` (default 10), `--signals lovable,v0,bolt,replit`, `--max-scans` (default 60), `--dry-run` (scan, post nothing).

Needs `gh` logged in, Docker with `health:1.0` built (`npm --prefix health run image:build`), and `AIMEKO_TOKEN` in the environment or `~/ServerRoot/.env.agents`. `LEADS_API_BASE` overrides `https://app.vibecodedshit.com`.

Rules:

- Public repos only. No code from a scanned repo runs on the host; git clone runs no hooks.
- Contact comes from the owner's public GitHub profile and the live homepage. Commit emails are never read.
- A found secret is never tested against its provider, and its value is never stored (gitleaks runs redacted).
- This repo is public: no lead data, repo names or findings are committed. They live only in the app database.
- A depth-1 clone gives the history scan one commit, so a secret that exists only in git history is not found here.
