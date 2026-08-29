"""Post-build validation and count summaries for the roster payload."""

from __future__ import annotations

import logging
from collections import Counter, defaultdict

from pipeline import espn

LOGGER = logging.getLogger("pipeline.validate")


def compute_counts(players):
    total = len(players)
    by_roster_group = Counter(p.get("roster_group") or "unknown" for p in players)
    by_position = Counter(p.get("position_abbrev") or "unknown" for p in players)

    with_headshot = sum(1 for p in players if p.get("headshot_url"))
    with_profile = sum(1 for p in players if p.get("profile_fetched"))
    profile_failures = sum(1 for p in players if not p.get("profile_fetched"))

    missing_college = sum(1 for p in players if not p.get("college"))
    missing_age = sum(1 for p in players if p.get("age") is None)
    missing_jersey = sum(1 for p in players if not p.get("jersey"))

    jersey_groups = defaultdict(list)
    for p in players:
        jn = p.get("jersey_number")
        if jn is not None:
            jersey_groups[str(jn)].append(p.get("id"))
    duplicate_jersey_numbers = {
        jersey: ids for jersey, ids in jersey_groups.items() if len(ids) > 1
    }

    return {
        "total": total,
        "by_roster_group": dict(by_roster_group),
        "by_position": dict(by_position),
        "with_headshot": with_headshot,
        "with_profile": with_profile,
        "profile_failures": profile_failures,
        "missing_college": missing_college,
        "missing_age": missing_age,
        "missing_jersey": missing_jersey,
        "duplicate_jersey_numbers": duplicate_jersey_numbers,
    }


def _sample_headshot_urls(players, max_samples=10):
    urls = [p.get("headshot_url") for p in players if p.get("headshot_url")]
    if len(urls) <= max_samples:
        return urls
    step = max(1, len(urls) // max_samples)
    return urls[::step][:max_samples]


def compute_validation(players, counts, expected_count, verify_headshots=False,
                        timeout=10):
    warnings = []
    total = counts["total"]
    is_final_53 = total == expected_count

    if not is_final_53:
        warnings.append(
            "Roster has {total} players; expected {expected} for a final "
            "roster (this is common during the offseason/preseason before "
            "final roster cuts, or when practice-squad/IR players are "
            "included).".format(total=total, expected=expected_count)
        )

    headshots_verified = None
    if verify_headshots:
        sample = _sample_headshot_urls(players)
        if not sample:
            headshots_verified = None
        else:
            failures = [url for url in sample if not espn.head_ok(url, timeout=timeout)]
            headshots_verified = len(failures) == 0
            if failures:
                warnings.append(
                    "{count} of {sampled} sampled headshot URL(s) failed "
                    "verification.".format(count=len(failures), sampled=len(sample))
                )

    return {
        "expected_total": expected_count,
        "is_final_53": is_final_53,
        "headshots_verified": headshots_verified,
        "warnings": warnings,
    }
