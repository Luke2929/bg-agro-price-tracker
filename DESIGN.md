# FAMA Price Tracker — Design Document

Tracks daily Malaysian farm produce prices from FAMA (Lembaga Pemasaran Pertanian
Persekutuan) at three market levels — **Ladang** (farm-gate), **Borong** (wholesale),
**Runcit** (retail) — and presents trends in a static dashboard on GitHub Pages.

## 1. Data source (verified 2026-07-25)

The FAMA page https://www.fama.gov.my/harga-pasaran-terkini embeds a public
"Publish to web" Power BI report. Its data API is directly queryable — no HTML
scraping, no authentication.

- **Embed URL param `r`** (base64 JSON): `{"k":"b41dccd7-d9f7-4f56-80fe-127696493f53","t":"ba79c739-fdba-4c53-a51b-b0a614bae87f","c":10}`
- **Resource key**: `b41dccd7-d9f7-4f56-80fe-127696493f53` (send as header `X-PowerBI-ResourceKey`)
- **API host**: `https://wabi-south-east-asia-api.analysis.windows.net`
  - `POST /public/reports/querydata?synchronous=true` — run semantic queries
  - `GET  /public/reports/{resourceKey}/modelsAndExploration?preferReadOnlySession=true` — report metadata
  - `POST /public/reports/conceptualschema` — table/column schema (body `{"modelIds":[6546643]}`)
- **Model id**: `6546643`; **Dataset id**: `185b7047-f327-4ef7-897a-3168956a1850`
  (send in `ApplicationContext.DatasetId`). Model name: "Paparan Harian Harga AMI Seluruh Malaysia".
- **Data table (entity)**: `API Harga (30hari)` — **rolling ~30-day window** (~3,500 rows/day,
  ~103k rows total). Older data disappears from the source; our repo is the archive.
- Responses may be gzipped regardless of Accept-Encoding — sniff magic bytes `\x1f\x8b`.
- Working spike code: `scraper/reference_spike.py`.

### Columns we capture (entity `API Harga (30hari)`)

| Column           | Meaning                                            |
|------------------|----------------------------------------------------|
| `priceid`        | unique row id — **dedupe key**                     |
| `tarikh harga`   | price date (epoch ms in DSR responses)             |
| `systemdate`     | entry timestamp string `YYYY-MM-DD HH:MM:SS.ffffff` — powers update-time analysis |
| `negeri`         | state                                              |
| `daerah`         | district                                           |
| `lokasi`         | market / collection point name                     |
| `peringkat`      | price level: `Ladang` / `Borong` / `Runcit`        |
| `sublevel`       | sub-level detail                                   |
| `varieti`        | product/variety name (BM)                          |
| `kategori`, `kumpulan`, `jenis` | category hierarchy                  |
| `gred MID`       | grade (e.g. F.A.Q, A/B/C)                          |
| `unit`           | Kilogram / Biji / ...                              |
| `harga`          | price (RM)                                         |
| `average14`      | source-computed 14-day average                     |
| `supply`         | supply indicator                                   |

### Query mechanics (from spike)

Semantic query JSON: `From` = `[{"Name":"t","Entity":"API Harga (30hari)","Type":0}]`,
`Select` = Column / Aggregation expressions, optional `Where` with
`Comparison`/`In` filters (used for per-date × per-state chunking),
`Binding.DataReduction.Primary.Top.Count` up to 30000.
Responses are DSR format: `ValueDicts` (string dictionaries `D0…Dn`), rows `C`
arrays with `R` repeat-bitmask (bit i set ⇒ column i repeats previous row's value)
and `Ø` null-bitmask. The decoder must handle both bitmasks.

## 2. Repository layout

```
fama-price-tracker/
├── DESIGN.md
├── README.md
├── requirements.txt            # stdlib-only preferred; pandas allowed if needed
├── scraper/
│   ├── __init__.py
│   ├── powerbi.py              # querydata client + DSR decoder (pure stdlib)
│   ├── scrape.py               # CLI: fetch window → data/daily/*.csv (idempotent merge)
│   ├── aggregate.py            # CLI: data/daily/*.csv → site/data/*.json
│   └── reference_spike.py      # verified spike code (reference only)
├── data/daily/YYYY-MM-DD.csv   # raw archive, one file per price date
├── site/                       # static dashboard (GitHub Pages artifact)
│   ├── index.html
│   ├── assets/…                # vendored JS/CSS (no CDN at runtime is OK on Pages, but vendor to be safe)
│   └── data/…                  # generated JSONs (gitignored? NO — committed, Pages serves them)
├── tests/
└── .github/workflows/scrape.yml
```

## 3. Contract A — daily CSV (`data/daily/YYYY-MM-DD.csv`)

UTF-8, header row, one file per **price date** (`tarikh harga`), sorted by `priceid`:

```
priceid,tarikh_harga,systemdate,negeri,daerah,lokasi,peringkat,sublevel,kategori,kumpulan,jenis,varieti,gred,unit,harga,average14,supply
```

- `tarikh_harga` as `YYYY-MM-DD`; `harga`/`average14` as decimal strings; empty for null.
- Scheduled daytime polls scan the latest five available survey dates; the nightly,
  manual and code-push runs scan the entire upstream rolling window. Per-date CSVs
  merge by `priceid`, preserving older source snapshots for auditability.
- **V2.2 canonicalization:** an existing `priceid` can move to a different FAMA
  survey date. The archived rows are never deleted solely for that reason, but
  the latest dated version is the only one included in current-price calculations.
  `meta.json.superseded_priceids` identifies prior versions for the browser.

## 4. Contract B — dashboard JSONs (`site/data/`)

- `catalog.json` — `{ "products": [{"id": "<slug>", "name": "...", "kategori": "...", "unit": "...", "grades": [...], "levels": [...], "latest": {"Ladang": x|null, "Borong": x|null, "Runcit": x|null}}], "states": [...], "dates": {"min": "...", "max": "..."} }`
- `series/<product-slug>.json` — `{ "name": ..., "unit": ..., "dates": ["YYYY-MM-DD",...], "national": {"Ladang": [x|null,...], "Borong": [...], "Runcit": [...]}, "by_state": {"PERAK": {"Ladang": [...], ...}, ...} }`
  Values = mean of `harga` across rows for that (date, level, [state], product), 2 dp.
- `latest.json` — **v2 (post-review)**: last-known national averages per product×level.
  `{"date": <max archive date>, "rows": [{"id","name","unit","level","price","date","n","dod","dod_from","wow","wow_from","reliable"}]}`
  - `price` = last non-null national mean on or before max date, looking back ≤14 days; `date` = that reading's date; `n` = row count behind the mean.
  - `dod` = `price` minus the previous available non-null point strictly before `date`; `dod_from` = that point's date; null if none.
  - `wow` = `price` minus nearest non-null point on or before `date - 7 days`; `wow_from` = its date; null if none.
  - `reliable` = false when the dod comparison is distorted by basket change: prev point's `n` differs by >50% or the contributing state sets' Jaccard overlap < 50% (exact set equality proved too strict — FAMA rotates surveyed states week to week); UI must exclude `reliable:false` rows from Top Movers (still shown in the table).
- `latest_state/<STATE>.json` — same shape as `latest.json` plus a `"state"` key, computed over
  that state's rows only (one file per state in catalog `states`, raw state string as filename).
  These are legacy derived API artifacts; the current browser Dashboard calculates
  state prices and matched-market movements from canonical original CSV records.
- `meta.json` — `{ "generated_at_utc", "window": {...}, "row_count", "canonical_row_count", "superseded_row_count", "superseded_priceids": {date: [priceid, ...]}, "archive_dates": [...], "archive_versions": {...}, "update_times": {...}, "source": "..." }`. `row_count` includes every archived CSV row; canonical counts exclude older re-dated versions.
- Slug: lowercase varieti + grade when needed for uniqueness, non-alnum → `-`.
- Product identity = (`varieti`, `gred`) when a varieti has >1 grade (e.g. TELUR AYAM A/B/C),
  else `varieti` alone.
- **Slug stability (v2)**: aggregator persists `site/data/slugs.json` mapping identity-key →
  slug. Existing assignments are never changed or reused, even if the identity rule would now
  produce a different slug (e.g. a varieti gaining a second grade keeps its original slug for
  the original grade... the NEW grade gets a new suffixed slug). Series files no longer in the
  catalog are deleted from `site/data/series/`.
- `catalog.json` products carry only fields the UI reads: `id,name,kategori,unit,grades`
  (drop `levels`/`latest` — dead payload).
- Comparison-date semantics: every DoD/WoW figure is disclosed with its actual
  baseline date, not misrepresented as an exact one-day gap. **Important:** the
  legacy generated JSONs still use row-weighted cross-sectional means; the
  current Dashboard calculates equal-market weights and matched-market changes
  directly from canonical original CSVs. These methods must not be presented as
  the same series until the JSON API has been versioned and migrated.

## 5. Dashboard (Phase 4)

Static, no build step. Vendored ECharts. Views:
1. **Overview**: latest-date table (product, level prices, DoD/WoW change), search box,
   top movers strip. Default scope = All Malaysia national average; a persistent
   scope toggle offers **Perak** one click away (user is Perak-based).
2. **Product detail**: line chart, x = date, three series (Ladang/Borong/Runcit),
   state selector (All + each state), grade selector where applicable.
3. **Compare**: 2–4 products on one chart at a chosen level.
4. **About/meta**: data source explanation, update-time histogram, last-scrape status.

Design: follow the `dataviz` skill system (loaded during Phase 4).
Mobile-friendly (user will check prices on phone).

## 6. Automation (Phase 5)

`.github/workflows/scrape.yml`:
- `schedule`: 09:37–21:37 every two hours MYT (recent five dates), plus a full
  23:37 MYT scan; `workflow_dispatch` remains available. GitHub's timezone is
  explicitly `Asia/Kuala_Lumpur`. Scheduled triggers may still be delayed/dropped.
- Steps: checkout → setup-python → `python -m scraper.scrape` → conditional
  aggregate → freshness audit → commit & push if changed → deploy Pages only
  when data/code changed.
- Concurrency group to avoid overlapping runs; commit as github-actions bot.

## 7. Verification requirements (every phase)

- Scraper: row counts per (date × negeri) must match a control aggregation query;
  spot-check ≥5 (product, level, state, date) averages against the live report.
- Aggregator: unit tests with synthetic CSVs; national average must equal
  mean over rows (not mean of state means) — document the choice: **mean over rows**.
- Dashboard: renders from real generated JSONs; check a known value end-to-end
  (e.g. TELUR AYAM gred A ≈ RM0.47 on 2026-07-25, national).
- Honest reporting: any mismatch is surfaced, not smoothed over.
