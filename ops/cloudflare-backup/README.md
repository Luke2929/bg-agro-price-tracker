# BG Agro — independent fallback scheduler (deployment pending)

The GitHub Actions `schedule` event is best-effort. This separate Cloudflare
Worker independently checks whether a recent `master` scrape succeeded. Every
30 minutes from 09:25 through 23:55 MYT, it dispatches `scrape.yml` in **recent**
(five FAMA survey dates) mode **only when** the last success is more than
90 minutes old, no live run is underway and no fallback dispatch was recently
recorded. It never writes archived CSVs itself: the existing GitHub workflow
runs the source-count checks, archive guard, aggregator and Pages deployment.

**Luke requested automatic checks and recovery on 2026-11-07. This repository
contains the setup code, but the Worker is NOT deployed until a Cloudflare
account is connected or the account owner performs installation.**

1. Create a restricted GitHub fine-grained token for *this repository only*
   with `Actions: Read and write`. Never add it to source code, an issue,
   ChatGPT message or workflow logs.
2. In an authorized Cloudflare account, from this directory run
   `npx wrangler secret put GITHUB_TOKEN` and enter the token locally.
3. Optionally set `ALERT_WEBHOOK_URL` via `wrangler secret put` for a
   webhook that accepts `{ "text": "..." }` JSON. This is not an email system;
   use a configured webhook only if the operator approves it.
4. Deploy with `npx wrangler deploy`. Review Cron Triggers in Cloudflare. A
   deployed Worker should have the schedule `25,55 1-15 * * *` in UTC.
5. Observe at least two real executions and confirm GitHub Actions runs have
   the `workflow_dispatch` trigger only when the backup is needed.

If the GitHub token is removed/revoked or Cloudflare is unavailable, this
backup cannot dispatch. It is not a guarantee of real-time FAMA updates;
FAMA may have no newer official survey data. Compare survey date separately
from the execution date.

Official references:
- https://developers.cloudflare.com/workers/configuration/cron-triggers/
- https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event
- https://docs.github.com/en/rest/actions/workflow-runs#list-workflow-runs-for-a-workflow
