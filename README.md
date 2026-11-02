# BG Agro · FAMA Price Tracker

**Malaysia agricultural market prices, made easier to explore.**

An independent BG Agro dashboard built from publicly available **FAMA (Federal Agricultural Marketing Authority)** market price observations. Search produce prices, compare Malaysian states, inspect price changes and export original records for review.

**[Open Live Dashboard](https://luke2929.github.io/bg-agro-price-tracker/)** · [Browse Original CSV Archive](data/daily/) · [View Automated Updates](https://github.com/Luke2929/bg-agro-price-tracker/actions/workflows/scrape.yml)

> **中文简介：** BG Agro 将 FAMA 的农业市场调查价格整理成简洁的 Dashboard。你可以按蔬菜、州属、日期和价格层级查询，比较历史变化，也可以将指定日期范围的原始数据下载成 Excel。数据按计划自动更新，**不是即时交易报价**。

## What you can do

| Feature | Description |
| --- | --- |
| **Market Prices** | Browse recorded prices by product, category, state, grade and survey date. |
| **Three Price Levels** | Compare **Ladang** (farm-gate), **Borong** (wholesale) and **Runcit** (retail) observations. |
| **1D / 7D / 30D Changes** | Compare the same product, grade, unit, price level and market on exact calendar dates. |
| **Top Movers** | See the largest comparable price increases and decreases for the selected price level. |
| **Compare & Trends** | Explore state-level prices, recorded history and individual market observations. |
| **Data & Export** | Filter original observations by date range, product, state, level, grade and market. |
| **Excel Downloads** | Export **Summary Data** for analysis or **Full Raw Data** with all 17 original FAMA fields. |
| **Automatic Updates** | GitHub Actions collects data and publishes the Dashboard twice daily. |

## Using the Dashboard

1. Open the **[BG Agro Dashboard](https://luke2929.github.io/bg-agro-price-tracker/)**. The latest available original CSV observations load automatically; you do not need to import a file.
2. In **Prices**, choose a vegetable, state or date. Switch between Ladang, Borong and Runcit to inspect price changes.
3. In **Compare & Trends**, select one product and price level to compare states and recorded historical prices.
4. In **Data & Export**, select the date range and filters. Use **Load selected range** for older archived dates, then download the Excel file you need.

### Understanding the numbers

- **Survey date (`tarikh_harga`)** is the date the FAMA price observation belongs to. **`systemdate`** is a separate timestamp recorded in the source data.
- **Market price averages** in the main table use the observations available under the selected filters.
- **1D / 7D / 30D percentages** compare **exactly** 1, 7 or 30 calendar days earlier. They use markets appearing on both dates for a like-for-like comparison.
- **Top Movers prices** are averages **across matched markets**. They may differ from the main table's average across all reporting markets.
- A dash (**—**) means there is no valid comparable observation. Missing dates or prices are **not** filled in, estimated or treated as zero.

These are FAMA survey observations, **not offers, guaranteed transaction prices or price forecasts**. Market coverage may vary by date, state and produce type.

## Summary Data vs Full Raw Data

| Excel export | Intended use | What's inside |
| --- | --- | --- |
| **Summary Data** | Quick review and internal analysis | Observed daily averages grouped by date, produce, state, price level, grade and unit, with counts. |
| **Full Raw Data** | Sharing original observations with customers or partners | Individual source records with the original 17 data fields (no summary averages replacing source prices). |

Full Raw Data fields:

`priceid`, `tarikh_harga`, `systemdate`, `negeri`, `daerah`, `lokasi`, `peringkat`, `sublevel`, `kategori`, `kumpulan`, `jenis`, `varieti`, `gred`, `unit`, `harga`, `average14`, `supply`.

The dashboard initially loads roughly **31 days** of original CSV records to support recent comparisons. Older dates in the repository are fetched **on demand** when you select them. A selected-range export checks that the requested dates have been retrieved; it does not silently produce a partial customer file when a download fails.

## Data source and coverage

- **Official data source:** [FAMA — Harga Pasaran Terkini](https://www.fama.gov.my/harga-pasaran-terkini), using publicly accessible AMI / Power BI observations.
- **Archived original data:** [`data/daily/YYYY-MM-DD.csv`](data/daily/) in this repository.
- **Archive start:** 27 June 2026; the history grows as new observations are collected.
- **Latest available date:** Shown inside the Dashboard; it depends on FAMA reporting and the most recent successful synchronization.
- **Scope:** Malaysian agricultural produce covered by the source, including vegetables, fruit and other reported categories. Reporting coverage is not necessarily uniform across states or days.

## How the data is updated

```mermaid
flowchart TD
    A["FAMA public AMI / Power BI data"] --> B["Python scraper"]
    B --> C["Original daily CSV archive"]
    C --> D["Aggregated site/data JSON"]
    C --> E["BG Agro V2 Dashboard"]
    D --> E
    E --> F["GitHub Pages"]
```

The [GitHub Actions workflow](.github/workflows/scrape.yml) runs automatically at:

| Malaysia Time (MYT, UTC+8) | UTC cron |
| --- | --- |
| **12:30 PM** | `30 4 * * *` |
| **11:00 PM** | `0 15 * * *` |

It can also be triggered manually. The workflow refreshes the source archive, rebuilds the dashboard JSON and deploys `site/` to GitHub Pages. This is **scheduled, automatically refreshed data**, not a second-by-second live feed.

## Project structure

| Path | Purpose |
| --- | --- |
| [`scraper/`](scraper/) | FAMA data retrieval and aggregation logic. |
| [`data/daily/`](data/daily/) | Archived original daily CSV observations. |
| [`site/`](site/) | BG Agro V2 Dashboard and prepared JSON data. |
| [`.github/workflows/scrape.yml`](.github/workflows/scrape.yml) | Automated scraping and GitHub Pages deployment. |
| [`tests/`](tests/) | Existing scraper and aggregation tests. |

For development and verification:

```bash
python -m pytest tests/
python -m scraper.scrape
python -m scraper.aggregate
cd site && python -m http.server 8000
```

The Python scraper uses the standard library. The dashboard is a static HTML/JavaScript app; its original daily CSV files are read from this public GitHub archive.

## Credits and disclaimer

- **Dashboard customization and project:** [BG Agro / Luke2929](https://github.com/Luke2929).
- **Price observations:** [Federal Agricultural Marketing Authority (FAMA), Malaysia](https://www.fama.gov.my/).

BG Agro is an **independent project** and is **not an official FAMA website** or endorsed by FAMA. Please verify important price or purchasing decisions against the original source and relevant market participants.
