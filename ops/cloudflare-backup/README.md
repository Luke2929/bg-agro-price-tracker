# BG Agro — independent fallback scheduler (optional, NOT activated)

The GitHub Actions `schedule` event is best-effort. This separate Cloudflare
Worker independently checks whether a recent `master` scrape succeeded. At
12:55, 16:55, 20:55 and 00:55 MYT it dispatches `scrape.yml` **only when**
the last success is more than 150 minutes old, no live run is underway and
no fallback dispatch was recently recorded. It never writes archived CSVs
itself: the existing GitHub workflow runs the archive guard and scrape.

**Installation requires Luke's explicit Cloudflare/provider decision and
permission. The pull request contains only inactive source code.**

1. Create a restricted GitHub fine-grained token for *this repository only*
   with `Actions: Read and write`. Never add it to source code, an issue,
   ChatGPT message or workflow logs.
2. In an authorized Cloudflare account, from this directory run
   `npx wrangler secret put GITHUB_TOKEN` and enter the token locally.
3. Optionally set `ALERT_WEBHOOK_URL` via `wrangler secret put` for a
   webhook that accepts `{ "text": "..." }` JSON. This is not an email system;
   use a configured webhook only if the operator approves it.
4. Deploy with `npx wrangler deploy`. Review Cron Triggers in Cloudflare.
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
