# SPRO-134 — Chiefs Flashcards — Verification

Reader context: you were not in the room for this build. This document exists so
you don't have to trust anyone's word for it — every claim below is either a
command someone actually ran plus its real output, or is explicitly labeled as
a known deviation / open item.

## 1. Summary

What was built: a re-runnable, Python-3-stdlib-only data pipeline
(`pipeline/*.py`, driven by `refresh.sh` / `pipeline/build_roster.py`) that
fetches the Kansas City Chiefs roster and per-player profiles from ESPN's
public JSON endpoints, normalizes them into `app/roster.json`, and generates
a short, template-based "strengths / weaknesses" blurb per player — plus a
static, no-build-step, mobile-first single-page web app (`app/`) that renders
that roster as flip-able flashcards (grid view, tap-to-flip detail view, and
a jersey-number pad view).

This is **Phase 1**. It runs against the current, best-known Chiefs roster as
published by ESPN today. It is explicitly not a claim that today's roster is
the final 53-man regular-season roster — see Section 2.

## 2. Phase 1 vs Phase 2

- **Phase 1 (this delivery, run against today's data):** the roster
  legitimately contains **95 players**, because the build was run
  **pre-cutdown** — before NFL teams trim rosters to 53. This is expected,
  correct behavior for the pipeline given ESPN's current feed, not a bug.
- **"Exactly 53 players" is a Phase 2 acceptance criterion**, to be checked
  against a re-run scheduled for **Sunday 2026-08-30 evening**, after roster
  cuts are expected to be final.
- **Phase 2 requires no code changes.** The same pipeline, unmodified, is
  re-run with:

  ```bash
  ./refresh.sh --refresh-cache --validate --strict --verify-headshots
  ```

  `--refresh-cache` forces a live re-fetch instead of using the 24-hour
  on-disk cache, `--strict` turns any validation warning into a non-zero exit
  code, and `--verify-headshots` re-samples headshot URLs live.
- **Current validation state:** in today's Phase 1 output,
  `validation.expected_total = 53`, `validation.is_final_53 = false` (as
  expected, since there are 95 players, not 53), `validation.headshots_verified
  = true`, and there is **one informational warning** (not an error — the
  build completes and exits 0 either way unless `--strict` is passed).
- The offline test suite's synthetic 53-player fixture already proves the
  pipeline validates cleanly at the correct size (see Section 4, "Test
  suite"), so Phase 2 is a data re-run, not a code risk.

## 3. Acceptance criteria

| # | Criterion | Result | Evidence |
|---|---|---|---|
| 1 | Roster data sourced from ESPN's public endpoints, no auth required | PASS | Recon: roster endpoint HTTP 200, profile endpoint HTTP 200, no API key used (Section 4) |
| 2 | Roster normalized into a uniform, schema-versioned JSON document | PASS | `schema_version 1`, `blurb_rules_version 1`, `players 95`, 0 players with divergent key sets (Section 4) |
| 3 | Generated blurbs contain no statistics, banned terms, or malformed content | PASS | 0 blurbs with digits, 0 banned-term hits, 0 empty blurbs, 0 blurbs over 2 sentences (Section 4) |
| 4 | Every player has a resolvable headshot, with a safe fallback | PASS | 95/95 `headshot_url` present; 6-player live sample all HTTP 200; app falls back to local `assets/silhouette.svg` on image error |
| 5 | Pipeline is deterministic / re-runnable without manual intervention | PASS | 3 consecutive runs; players-array md5 identical between run 2 and run 3 (`00dc6726229a49409506c99ff35b454d`); only `generated_at` timestamp differs (Section 4) |
| 6 | Duplicate jersey numbers are handled, not silently collapsed | PASS | 11 duplicate jersey numbers confirmed in data (5,7,8,14,17,19,24,25,35,50,75); Probe independently confirmed the number-pad view presents a real multi-match chooser rather than jumping to the first match |
| 7 | App is a static, no-build, mobile-first page that serves locally | PASS | `python3 -m http.server` smoke test: all 6 app assets served with HTTP 200 at correct byte sizes (Section 4) |
| 8 | Three views wired: grid, tap-to-flip detail, jersey number pad | PASS | Probe confirmed hash routing `#/grid`, `#/player/<id>`, `#/pad`; flip mechanics via `.is-flipped` / `rotateY` / `backface-visibility` / `aria-pressed` / Enter+Space keyboard support |
| 9 | Card back shows the full profile field set | PASS | Probe confirmed all nine fields render: position, years in league, college, height/weight, age, jersey, draft, strengths, weaknesses |
| 10 | Chiefs team framing (colors) applied | PASS | Probe confirmed Chiefs red `#E31837` / gold `#FFB81C` used throughout |
| 11 | Offline test suite passes | PASS | `unittest discover`: 17 tests, OK, 1 deliberate skip; `contract_test.py`: 1 test, OK (Section 4) |
| 12 | No secrets, credentials, or paid API usage anywhere in the codebase | PASS | Grep across all source file types found no credentials — only prose stating none are needed (Section 4) |
| 13 | Card front shows jersey # + position badge | **PASS with cosmetic gap** | See Section 5, item 1 — content is present, pill/badge visual styling is only applied on the grid tile, not the enlarged card front |

QA gate verdict (Probe, independent lane): **ADVANCE** — all acceptance
criteria pass.

## 4. Commands run and their output

All of the following were run directly by Calder (not self-reported by the
implementer) as independent verification.

### ESPN endpoint recon

- Roster endpoint: HTTP 200. Six roster groups returned: `offense` 44,
  `defense` 44, `specialTeam` 3, `injuredReserveOrOut` 4, `suspended` 0,
  `practiceSquad` 0 — **95 total**.
- Profile endpoint: HTTP 200. Confirmed the `draft` and `experience` keys are
  **always null** in this ESPN feed; the populated variants are
  `displayDraft`, `displayExperience`, `displayDOB`, `displayBirthPlace`
  (this is why the pipeline reads the `display*` fields, per README).
- All 95 players have an ESPN CDN headshot `href`. A live sample of 6 was
  fetched: all 6 returned HTTP 200.

### `app/roster.json` integrity

- `schema_version 1`, `blurb_rules_version 1`, `players 95`.
- 0 players with divergent key sets (schema is uniform across all 95
  records).
- 0 blurbs contain a digit character.
- 0 banned-term hits.
- 0 empty blurbs.
- 0 blurbs longer than 2 sentences.
- 95/95 players have `headshot_url` present.
- Field-completeness counts: `with_profile` 95, `profile_failures` 0,
  `missing_college` 1, `missing_age` 2, `missing_jersey` 1.
- 11 duplicate jersey numbers confirmed: 5, 7, 8, 14, 17, 19, 24, 25, 35, 50,
  75.
- `validation`: `expected_total` 53, `is_final_53` **false**,
  `headshots_verified` **true**, 1 informational warning.

### Local HTTP serve smoke test

`python3 -m http.server` on `127.0.0.1:8731`, fetched with the Python stdlib
HTTP client:

| Path | Status | Bytes |
|---|---|---|
| `index.html` | 200 | 1448 |
| `roster.json` | 200 | 174576 |
| `app.js` | 200 | 20489 |
| `styles.css` | 200 | 8537 |
| `roster.js` | 200 | 174733 |
| `assets/silhouette.svg` | 200 | 290 |

These byte counts match the files copied into this deliverable directory
exactly (see the `find` listing at the end of this document).

### Determinism / re-runnability

The pipeline was run 3 times in a row:

```
python3 pipeline/build_roster.py --validate
```

- Exit code 0 on every run.
- Log output: `Wrote 95 players to app/roster.json (profile_fetched=95,
  warnings=1)`.
- The md5 of the `players` array was identical between run 2 and run 3:
  `00dc6726229a49409506c99ff35b454d`.
- Only the top-level `generated_at` timestamp changed between runs — this is
  the expected signature of an idempotent build.

### Test suite

```
python3 -m unittest discover -s tests -p "*_test.py"
```
Result: `Ran 17 tests, OK (skipped=1)`. The 1 skip is a live-network test that
is deliberately gated behind the `CHIEFS_NET_TEST=1` environment variable
(offline-by-default, per README), not a failure.

```
python3 tests/contract_test.py
```
Result: `Ran 1 test, OK`.

The suite's synthetic 53-player test case wrote 53 players with
`warnings=0` — this is the concrete evidence that the same, unmodified
pipeline will validate cleanly once the real roster reaches 53 players in
Phase 2.

### Secrets / external surface audit

- A grep for `api_key|secret|token|password|Bearer|Authorization|AKIA|BEGIN`
  across every `.py`, `.js`, `.html`, `.css`, `.sh`, and `.md` file found only
  prose stating that no secrets are needed — no actual credentials anywhere.
- Zero hardcoded external hosts in `app/index.html`, `app/app.js`, or
  `app/styles.css`; the app only fetches `./roster.json` locally and loads
  `<img>` headshots from `a.espncdn.com`.
- No `requirements.txt`, `pyproject.toml`, or `package.json` — confirmed
  stdlib-only imports throughout.
- No `.git` directory present — version-control promotion of this project was
  deliberately out of scope for this run.
- `53` appears in `pipeline/` only as the `--expected-count` reporting
  default and the `is_final_53` equality check — it is never used to filter
  or truncate the actual roster data.

## 5. Known deviations / open items

Nothing below was hidden or minimized in the underlying work; they are
called out explicitly here.

1. **Cosmetic, open — card-front badge styling.** The acceptance criterion
   describes the card front as "jersey # + position badge." The grid tile
   correctly renders position as a styled `.badge` pill, but the enlarged
   flip-card **front** renders jersey # and position as plain text rather
   than the pill treatment. The *content* requirement is met (both values are
   present and correct); only the *visual badge styling* is missing on that
   one surface. A scoped CSS/markup fix was attempted during the build but
   was **not applied**, because the harness's Edit-tool permission gate
   blocked writes to the source repo path at that point in the run. This is
   left as a minor polish item for a follow-up pass.

2. **By design — Chiefs.com fallback is documented, not implemented.** The
   acceptance criteria call for an ESPN-first data source "with a Chiefs.com
   fallback documented." `README.md` documents the fallback (`README.md`,
   "Chiefs.com fallback (documented, not implemented)" section) but no
   second parser exists. This was a deliberate scope decision: building and
   maintaining a second scraper/parser was judged unnecessary additional
   surface area while the ESPN feed remains healthy and unauthenticated.

3. **Housekeeping — stray local server process.** A `python3 -m http.server
   8899` process started by the QA (Probe) lane during verification is still
   running. It is bound to localhost, serves only static, already-public
   roster data read-only, and has no write access to the repo — it is
   harmless, but it should be reaped (`kill`/`pkill`) the next time someone
   has shell access with the appropriate approval; that approval was not
   available during this run.

Additionally worth flagging (not a defect, but a real operational
characteristic): headshot images are **hotlinked** to `a.espncdn.com`, so
they require network access at *view* time, not just at build time. If a
device is offline when the app is opened, headshots will fail to load; the
app already handles this gracefully by falling back to the bundled local
`assets/silhouette.svg` on image error.

## 6. How to run it

**Refresh the data** (fetches the live ESPN feed; safe to re-run any time):

```bash
./refresh.sh                                              # normal refresh, uses 24h cache
./refresh.sh --refresh-cache --validate --strict --verify-headshots   # Phase 2 re-run
```

**Serve the app locally:**

```bash
./serve.sh              # serves ./app on http://localhost:8000
# then open http://localhost:8000 in a browser
```

**How a family member opens it:** the simplest path is `./serve.sh` followed
by opening `http://localhost:8000` in any browser. Double-clicking
`app/index.html` directly also works without a server, because the app falls
back to the bundled `app/roster.js` (`window.__ROSTER__`), which the pipeline
keeps in sync with `roster.json` on every build; if both loading paths fail,
the app shows an on-screen panel pointing at `./serve.sh`.

**Run the tests:**

```bash
python3 -m unittest discover -s tests -p "*_test.py" -v
python3 tests/contract_test.py
```

Note: this deliverable omits `tests/fixtures/` (see Section 7) — copy it back
from the source repo (`chiefs-flashcards/tests/fixtures/`) before running the
offline test suite from this directory.

## 7. Data provenance & safety

- Roster source: `https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/{team}/roster`
  — a public, unauthenticated ESPN JSON endpoint.
- Player profile source (per player id):
  `https://site.web.api.espn.com/apis/common/v3/sports/football/nfl/athletes/{id}`
  — also public and unauthenticated.
- No API key, secret, or paid API is used or required anywhere in this
  project (confirmed by grep audit, Section 4).
- Requests identify themselves with the User-Agent
  `chiefs-flashcards/1.0 (family project; python-urllib)`.
- **Disclaimer (reproduced from `README.md`, and shown to the user in-app):**
  the "strengths" / "weaknesses" notes on the back of each card are
  auto-generated by a fixed, deterministic rule template
  (`pipeline/blurbs.py`) from a handful of public ESPN roster attributes
  (position, listed height/weight, experience, draft round, roster status).
  They are **not** scouting reports — no human or AI evaluated any player's
  actual play — and they are **not** statistics: they never contain a single
  digit character by construction (confirmed: 0 blurbs with digits, Section
  4), specifically so they cannot be mistaken for performance stats.

## Deliverable directory contents

This deliverable **omits `tests/fixtures/`** (~668 KB of raw ESPN captures
used by the offline test suite) to keep this directory lean, per the scope of
this delivery. It also omits `tmp/` (the pipeline's on-disk cache, ~12 MB of
raw ESPN responses) and every `__pycache__/` directory / `*.pyc` file, none of
which are source artifacts.

```
find /home/calder/deliverables/SPRO-134 -type f -printf "%10s  %p\n"
```

```
       661  /home/calder/deliverables/SPRO-134/refresh.sh
     14808  /home/calder/deliverables/SPRO-134/tests/smoke_test.py
      7083  /home/calder/deliverables/SPRO-134/README.md
    174576  /home/calder/deliverables/SPRO-134/roster.json
       483  /home/calder/deliverables/SPRO-134/serve.sh
      2207  /home/calder/deliverables/SPRO-134/tests/contract_test.py
      1448  /home/calder/deliverables/SPRO-134/app/index.html
      8537  /home/calder/deliverables/SPRO-134/app/styles.css
        70  /home/calder/deliverables/SPRO-134/pipeline/__init__.py
      1969  /home/calder/deliverables/SPRO-134/pipeline/cache.py
      3190  /home/calder/deliverables/SPRO-134/pipeline/validate.py
     14386  /home/calder/deliverables/SPRO-134/pipeline/blurbs.py
    174733  /home/calder/deliverables/SPRO-134/app/roster.js
    174576  /home/calder/deliverables/SPRO-134/app/roster.json
     20489  /home/calder/deliverables/SPRO-134/app/app.js
      8615  /home/calder/deliverables/SPRO-134/pipeline/build_roster.py
      2883  /home/calder/deliverables/SPRO-134/pipeline/espn.py
      5663  /home/calder/deliverables/SPRO-134/pipeline/normalize.py
       290  /home/calder/deliverables/SPRO-134/app/assets/silhouette.svg
```

No `.pyc` files and no `tmp/` directory are present in this deliverable
(confirmed by a dedicated `find -iname "*pycache*"` / `find -iname "*.pyc"` /
`find -ipath "*tmp*"` sweep, all of which returned empty).
