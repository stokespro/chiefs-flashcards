"""Thin HTTP client for the ESPN public JSON endpoints used by this project.

No secrets are used or required -- these are public, unauthenticated endpoints.
"""

from __future__ import annotations

import json
import logging
import time
import urllib.error
import urllib.request

LOGGER = logging.getLogger("pipeline.espn")

USER_AGENT = "chiefs-flashcards/1.0 (family project; python-urllib)"

ROSTER_URL_TEMPLATE = (
    "https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/{team}/roster"
)
PROFILE_URL_TEMPLATE = (
    "https://site.web.api.espn.com/apis/common/v3/sports/football/nfl/athletes/{id}"
)


class EspnFetchError(Exception):
    """Raised when an ESPN endpoint cannot be fetched after retries."""


def _headers():
    return {
        "User-Agent": USER_AGENT,
        "Accept": "application/json",
    }


def fetch_json(url, timeout=20, retries=2):
    """Fetch a URL and parse it as JSON, retrying transient failures.

    Args:
        url: full URL to fetch.
        timeout: per-attempt socket timeout in seconds.
        retries: number of *extra* attempts after the first (so total
            attempts == retries + 1).

    Raises:
        EspnFetchError: if all attempts fail.
    """
    last_error = None
    attempts = max(0, int(retries)) + 1
    for attempt in range(1, attempts + 1):
        request = urllib.request.Request(url, headers=_headers())
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                raw = response.read()
                return json.loads(raw.decode("utf-8"))
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError,
                OSError, ValueError) as exc:
            last_error = exc
            LOGGER.warning(
                "Attempt %d/%d failed for %s: %s", attempt, attempts, url, exc
            )
            if attempt < attempts:
                time.sleep(min(1.0 * attempt, 3.0))
    raise EspnFetchError(f"Failed to fetch {url} after {attempts} attempt(s): {last_error}")


def head_ok(url, timeout=10):
    """Return True if a HEAD (or ranged GET fallback) request succeeds with 2xx."""
    request = urllib.request.Request(url, headers=_headers(), method="HEAD")
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return 200 <= response.status < 300
    except Exception:
        # Some CDNs reject HEAD; fall back to a small ranged GET.
        try:
            request = urllib.request.Request(url, headers=_headers(), method="GET")
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return 200 <= response.status < 300
        except Exception:
            return False


def roster_url(team):
    return ROSTER_URL_TEMPLATE.format(team=team)


def profile_url(athlete_id):
    return PROFILE_URL_TEMPLATE.format(id=athlete_id)
