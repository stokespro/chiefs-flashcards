#!/usr/bin/env python3
"""Build app/roster.json from the ESPN Chiefs roster + player profile feeds.

Usage:
    python3 pipeline/build_roster.py --validate -v

See README.md for the full flag reference and provenance notes.
"""

from __future__ import annotations

import argparse
import datetime
import json
import logging
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from pipeline import blurbs, cache, espn, normalize, validate

LOGGER = logging.getLogger("pipeline.build_roster")

SCHEMA_VERSION = 1


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description="Build the Chiefs flashcards roster.json")
    parser.add_argument("--team", default="kc", help="ESPN team slug (default: kc)")
    parser.add_argument("--out", default="app/roster.json", help="Output path for roster.json")
    parser.add_argument("--cache-dir", default="tmp/cache", help="On-disk cache directory")
    parser.add_argument("--cache-ttl-hours", type=float, default=24.0,
                         help="Cache freshness window in hours")
    parser.add_argument("--refresh-cache", action="store_true",
                         help="Ignore cache freshness and refetch everything")
    parser.add_argument("--no-cache", action="store_true",
                         help="Bypass the cache entirely (no read, no write)")
    parser.add_argument("--skip-profiles", action="store_true",
                         help="Skip the per-player profile fetch (roster-only build)")
    parser.add_argument("--delay", type=float, default=0.4,
                         help="Delay in seconds between live profile fetches")
    parser.add_argument("--timeout", type=float, default=20.0,
                         help="Per-request network timeout in seconds")
    parser.add_argument("--retries", type=int, default=2,
                         help="Extra retry attempts per request")
    parser.add_argument("--validate", action="store_true",
                         help="Log a validation summary after building")
    parser.add_argument("--expected-count", type=int, default=53,
                         help="Expected final roster size used for informational checks")
    parser.add_argument("--verify-headshots", action="store_true",
                         help="Sample headshot URLs with live HEAD requests")
    parser.add_argument("--strict", action="store_true",
                         help="Exit 2 if any validation warnings are present")
    parser.add_argument("--indent", type=int, default=2, help="JSON indent for roster.json")
    parser.add_argument("-v", "--verbose", action="count", default=0,
                         help="Increase log verbosity (-v, -vv)")
    parser.add_argument("--quiet", action="store_true", help="Only log warnings and errors")
    return parser.parse_args(argv)


def configure_logging(verbose, quiet):
    if quiet:
        level = logging.WARNING
    elif verbose >= 2:
        level = logging.DEBUG
    elif verbose >= 1:
        level = logging.INFO
    else:
        level = logging.WARNING
    logging.basicConfig(level=level, format="%(levelname)s %(name)s: %(message)s")


def utc_now_iso():
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def fetch_roster(args):
    url = espn.roster_url(args.team)
    data, _ = cache.fetch_with_cache(
        url, args.cache_dir, args.cache_ttl_hours, args.no_cache, args.refresh_cache,
        lambda u: espn.fetch_json(u, timeout=args.timeout, retries=args.retries),
    )
    return url, data


def build(args):
    LOGGER.info("Fetching roster for team=%s", args.team)
    roster_url, roster_json = fetch_roster(args)

    players = []
    for roster_group, item in normalize.iter_roster_athletes(roster_json):
        athlete_id = item.get("id")
        profile_athlete = None
        profile_fetched = False

        if not args.skip_profiles and athlete_id:
            try:
                url = espn.profile_url(athlete_id)
                data, was_network_hit = cache.fetch_with_cache(
                    url, args.cache_dir, args.cache_ttl_hours, args.no_cache,
                    args.refresh_cache,
                    lambda u: espn.fetch_json(u, timeout=args.timeout, retries=args.retries),
                )
                profile_athlete = data.get("athlete") if isinstance(data, dict) else None
                profile_fetched = profile_athlete is not None
                if was_network_hit and args.delay > 0:
                    time.sleep(args.delay)
            except Exception as exc:  # noqa: BLE001
                LOGGER.warning("Profile fetch failed for %s (id=%s): %s",
                                item.get("fullName"), athlete_id, exc)
                profile_athlete = None
                profile_fetched = False

        player = normalize.build_player(item, roster_group, profile_athlete, profile_fetched)
        players.append(player)

    players = normalize.sort_players(players)

    counts = validate.compute_counts(players)
    validation = validate.compute_validation(
        players, counts, args.expected_count,
        verify_headshots=args.verify_headshots, timeout=args.timeout,
    )

    if args.validate:
        LOGGER.info("Validation: total=%s expected=%s is_final_53=%s warnings=%s",
                    counts["total"], validation["expected_total"],
                    validation["is_final_53"], validation["warnings"])

    team_info = roster_json.get("team") or {}
    season_info = roster_json.get("season") or {}

    roster_doc = {
        "schema_version": SCHEMA_VERSION,
        "blurb_rules_version": blurbs.RULES_VERSION,
        "generated_at": utc_now_iso(),
        "source": {
            "roster_endpoint": roster_url,
            "profile_endpoint_template": espn.PROFILE_URL_TEMPLATE,
            "espn_timestamp": roster_json.get("timestamp"),
            "season": season_info.get("year"),
            "team": team_info.get("abbreviation") or args.team,
        },
        "counts": counts,
        "validation": validation,
        "players": players,
    }

    return roster_doc, validation


def write_atomic(path, doc, indent):
    out_dir = os.path.dirname(os.path.abspath(path)) or "."
    os.makedirs(out_dir, exist_ok=True)
    fd_path = path + ".tmp"
    with open(fd_path, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, indent=indent, ensure_ascii=False, sort_keys=False)
        fh.write("\n")
    os.replace(fd_path, path)


def write_js_fallback(json_path, doc, indent):
    """Write a sibling roster.js exposing window.__ROSTER__ for file:// use.

    Kept byte-for-byte in sync with roster.json by generating it from the
    same in-memory document on every build (see README data-provenance
    section for why this exists: fetch() of a local JSON file fails under
    file:// CORS in most browsers, but a plain <script src> does not).
    """
    base, _ext = os.path.splitext(json_path)
    js_path = base + ".js"
    payload = json.dumps(doc, indent=indent, ensure_ascii=False, sort_keys=False)
    tmp_path = js_path + ".tmp"
    with open(tmp_path, "w", encoding="utf-8") as fh:
        fh.write("// Auto-generated by pipeline/build_roster.py -- do not edit by hand.\n")
        fh.write("// Fallback data source for file:// usage without a local server.\n")
        fh.write("window.__ROSTER__ = ")
        fh.write(payload)
        fh.write(";\n")
    os.replace(tmp_path, js_path)


def main(argv=None):
    args = parse_args(argv)
    configure_logging(args.verbose, args.quiet)

    try:
        roster_doc, validation = build(args)
    except espn.EspnFetchError as exc:
        LOGGER.error("Roster fetch failed, aborting: %s", exc)
        return 1
    except Exception as exc:  # noqa: BLE001
        LOGGER.error("Unexpected error building roster: %s", exc, exc_info=True)
        return 1

    try:
        write_atomic(args.out, roster_doc, args.indent)
        write_js_fallback(args.out, roster_doc, args.indent)
    except Exception as exc:  # noqa: BLE001
        LOGGER.error("Failed to write %s: %s", args.out, exc, exc_info=True)
        return 1

    LOGGER.warning(
        "Wrote %s players to %s (profile_fetched=%s, warnings=%s)",
        roster_doc["counts"]["total"], args.out,
        roster_doc["counts"]["with_profile"], len(validation["warnings"]),
    )

    if args.strict and validation["warnings"]:
        LOGGER.error("Strict mode: %d validation warning(s) present", len(validation["warnings"]))
        return 2

    return 0


if __name__ == "__main__":
    sys.exit(main())
