# Chiefs Flashcards

A small, mobile-first, no-build-step web app for browsing the Kansas City
Chiefs roster as flip-able "flashcards" -- tap a player to see auto-generated
profile notes on the back of the card.

This is a family project. It is not affiliated with the NFL, the Kansas City
Chiefs, or ESPN.

## Important disclaimer: what the "strengths" / "weaknesses" notes actually are

The **Auto-generated profile notes** on the back of each card are produced
entirely by a fixed, deterministic rule template (`pipeline/blurbs.py`) that
looks only at a handful of public ESPN roster attributes: position, listed
height/weight relative to typical values for that position, years of
experience, draft round (if any), and roster status (active / injured
reserve / suspended / practice squad).

They are:

- **NOT scouting reports.** No human or AI evaluated any player's actual play.
- **NOT statistics.** The notes never contain a single digit character --
  round numbers and experience are always spelled out in words
  ("first-round", "veteran") specifically so they cannot be mistaken for
  performance stats.
- **NOT** commentary on injuries, transactions, discipline, or any other
  sensitive topic. The only roster-status language allowed is a neutral
  reference to the literal ESPN group a player is listed in (e.g. "listed
  in the reserve/out group"), never a body part, injury type, or timeline.

Treat them the way you'd treat a description on the back of a trading card
made by a template, not a professional evaluation.

## Quick start

```bash
# 1) Build the data (fetches the live ESPN Chiefs roster + player profiles)
python3 pipeline/build_roster.py --validate -v

# 2) Serve the app (needed because most browsers block fetch() of local
#    files opened directly as file://)
./serve.sh
# then open http://localhost:8000 in a browser
```

If you skip step 2 and just double-click `app/index.html`, the app will
still work: it falls back to reading `app/roster.json` from the bundled
`app/roster.js` (`window.__ROSTER__`), which the pipeline keeps in sync with
`roster.json` on every build. If both fail to load, the app shows a panel
pointing you at `./serve.sh`.

## Data provenance

- Roster: `https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/{team}/roster`
- Player profile (per player id): `https://site.web.api.espn.com/apis/common/v3/sports/football/nfl/athletes/{id}`

Both are public, unauthenticated ESPN JSON endpoints. No API key or secret
is used or required. Requests identify themselves with the User-Agent
`chiefs-flashcards/1.0 (family project; python-urllib)`.

The profile endpoint's `draft` and `experience` keys are always null in
practice; this pipeline reads the `displayDraft` / `displayExperience` /
`displayDOB` / `displayBirthPlace` string variants instead, which ESPN does
populate.

Per-player profile fetches are wrapped so a single failure never aborts the
build: on failure, that player's profile-derived fields (draft pedigree,
display experience, DOB, birth place) simply degrade to `null`/roster-only
values, `profile_fetched` is `false` for that player, and the build
continues. A roster-fetch failure, by contrast, aborts the whole build
(exit code 1), since there is nothing meaningful to fall back to.

### Chiefs.com fallback (documented, not implemented)

If ESPN's public roster endpoint ever becomes unavailable, the Chiefs' own
site (`https://www.chiefs.com/team/players-roster/`) publishes a similar
roster table. This pipeline does **not** currently scrape or fall back to
that source -- it is documented here as the natural next data source to add
(`pipeline/espn.py` would need a sibling `chiefs_com.py` fetcher and a
matching parser in `pipeline/normalize.py`) if ESPN's feed is ever
retired or rate-limits this project.

## Rebuilding / refreshing the data

```bash
./refresh.sh                   # normal refresh, respects the 24h on-disk cache
./refresh.sh --refresh-cache   # force a full re-fetch, ignoring cache freshness
./refresh.sh --strict          # exit 2 if any validation warnings are present
```

`refresh.sh` is a thin wrapper around `pipeline/build_roster.py`; any extra
arguments are passed straight through.

### Phase 2 re-run command

Once the Chiefs make roster cuts down to the 53-man regular-season roster
(or any time the roster changes -- trades, practice squad moves, IR
activity), re-run:

```bash
python3 pipeline/build_roster.py --refresh-cache --validate --verify-headshots -v
```

`--refresh-cache` forces fresh data instead of the 24-hour cache,
`--validate` logs a validation summary, and `--verify-headshots` samples
headshot URLs live to confirm they still resolve. Check `validation.warnings`
and `validation.is_final_53` in the resulting `app/roster.json` to confirm
the roster has reached its final 53-man size.

## `pipeline/build_roster.py` CLI flags

| Flag | Default | Meaning |
| --- | --- | --- |
| `--team` | `kc` | ESPN team slug |
| `--out` | `app/roster.json` | Output path (a sibling `.js` fallback is also written) |
| `--cache-dir` | `tmp/cache` | On-disk response cache directory |
| `--cache-ttl-hours` | `24` | Cache freshness window |
| `--refresh-cache` | off | Ignore cache freshness, refetch everything |
| `--no-cache` | off | Bypass the cache entirely |
| `--skip-profiles` | off | Roster-only build (no per-player profile fetch) |
| `--delay` | `0.4` | Seconds between live profile fetches (politeness) |
| `--timeout` | `20` | Per-request network timeout, seconds |
| `--retries` | `2` | Extra retry attempts per request |
| `--validate` | off | Log a validation summary |
| `--expected-count` | `53` | Expected final roster size for informational checks |
| `--verify-headshots` | off | Sample headshot URLs with live HEAD requests |
| `--strict` | off | Exit 2 if any validation warnings are present |
| `--indent` | `2` | JSON indent width |
| `-v` / `--verbose` | off | Increase log verbosity (repeatable) |
| `--quiet` | off | Only log warnings and errors |

Exit codes: `0` ok, `2` strict-validation-failure, `1` unexpected error
(including a roster-fetch failure).

## Running the tests

```bash
python3 -m unittest discover -s tests -p "*_test.py" -v
python3 tests/contract_test.py
```

All tests are fully offline by default, running against fixtures in
`tests/fixtures/`. An optional live network check exists behind an
environment variable toggle (not a secret):

```bash
CHIEFS_NET_TEST=1 python3 -m unittest discover -s tests -p "*_test.py" -v
```

Two tests are skipped until `app/roster.json` has been generated at least
once (`python3 pipeline/build_roster.py`): the roster-json schema test and
the app.js field-usage contract test.

## Project layout

```
pipeline/         Data pipeline (fetch, cache, normalize, blurbs, validate)
app/              The static app itself (no build step)
tests/            Offline unit tests + fixtures
tmp/              Gitignored on-disk cache + scratch data
refresh.sh        Convenience wrapper around pipeline/build_roster.py
serve.sh          Tiny local HTTP server for app/
```
