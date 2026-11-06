# BG Agro V3.1 — Product Detail Architecture & Algorithm Review

Status: approved for integration into `master` by Luke on 2026-11-06. Keep
`/v3/` and `/v3.1/` independent. The old classic dashboard at `/` is replaced
with a lightweight redirect to `/v3/` (the previous source remains in Git history).

## Scope and non-negotiable constraints

- Build a **separate `site/v3.1/` dashboard**, based on V3 with a product detail
  drill-down. Do not edit `site/v3/` or the classic `site/index.html`; both
  dashboards must retain their original paths. V3 receives only the new logo,
  favicon and a link to V3.1, without changing its price algorithms.
- Reuse the published `site/data/v3/overview.json`, `history-index.json`,
  per-product history JSON and `data/daily/YYYY-MM-DD.csv`. **No archive CSV,
  aggregation algorithm, deployment workflow or published JSON schema changes.**
- Identity is the exact `(varieti, gred, unit)` tuple, encoded with `||` exactly
  as in `scraper.market_math.product_key`. Ladang, Borong and Runcit are separate
  price levels and must never be combined.

## Source / calculation contracts

| Feature | Data source | Calculation and validity |
| --- | --- | --- |
| Latest national / state prices | `overview.prices` | Already canonical and equal-weighted per source market; display separate Ladang/Borong/Runcit cards with market counts, or `—` when missing. |
| Daerah / Lokasi price cards | Latest-date raw CSV | Filter exact product, grade, unit, state, district and location; apply `superseded_priceids`, keep the latest row for duplicate `priceid`; mean within each distinct `(negeri, daerah, lokasi, sublevel)` market, then equal-weight distinct market means. Never label a state average as a specific district's price. |
| History trend | `history/{product hash}.json` | Filter only actual recorded dates for the selected price level, national / state and 30 / 90 / 180-day window. Gaps remain absent. Historical national/state survey averages can change market composition. |
| State comparison | `overview.prices` | Exact product identity and chosen price level; display each reported state separately, with number of surveyed markets. No unreported state is assigned a price. |
| Raw market table | Latest-date original CSV | Show exact source entries, including blank prices as `—`, excluding superseded/duplicate price IDs. Filter by the same product identity and hierarchy; paginate instead of truncating without a continuation. |

**Crucial limitation:** the per-product history JSON has only national and state
aggregates, not historical district/location observations. Therefore changing
Daerah or Lokasi affects the **latest raw price cards and market rows only**;
history is explicitly labeled as a state/national reference, never a local
historical price. Do not invent local history or stock-style OHLC candles.

## User journey

1. Open V3.1 at `/v3.1/`. Click a real product from today's quick prices, price table,
   watchlist, or historical view and navigate to the internal detail screen.
2. Show the three separate latest-price cards and one chosen-level historical
   chart. The view defaults to all Malaysia, Borong, 90 days.
3. Select `Negeri → Daerah → Lokasi` from actual current-date product records.
   When a district or market is chosen, recalculate the three cards from those
   filtered source observations. Keep the historic chart and state comparison
   explicitly scoped to the selected state (or national scope).
4. Inspect full original market records with a visible count and `Load more`.
5. Return to the originating V3 screen without losing the existing filters.

## Release gates

1. Pure JavaScript unit tests cover strict product identity, grade/unit
   separation, price-level separation, superseded/duplicate IDs, blank prices,
   equal-weight markets and hierarchical filtering.
2. DOM tests assert all detail controls, the same six V3.1 navigation routes,
   and **absence of product detail in original `site/v3/index.html`**.
   Existing Python/JavaScript regression suites pass.
3. Browser smoke test: open product, switch scope, check trend and states,
   filter raw data, paginate, go back; verify mobile width where available.
4. `git diff` / archive guard confirm `data/daily` untouched; review diff
   against `master` before creating a PR.
5. Publish only after the final archive-preservation, CI and Pages checks. The
   classic root redirects to `/v3/`; V3.1 is available at `/v3.1/` without
   changing the calculation code inside V3.
