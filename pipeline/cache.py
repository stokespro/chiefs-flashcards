"""Simple on-disk JSON cache for ESPN responses.

Keeps the pipeline polite to ESPN by avoiding redundant requests within a
configurable TTL window. Not thread-safe; this is a single-process CLI tool.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import time

LOGGER = logging.getLogger("pipeline.cache")


def _cache_path(cache_dir, url):
    digest = hashlib.sha256(url.encode("utf-8")).hexdigest()
    return os.path.join(cache_dir, f"{digest}.json")


def _read_cache_file(path):
    try:
        with open(path, "r", encoding="utf-8") as fh:
            envelope = json.load(fh)
        return envelope.get("fetched_at"), envelope.get("data")
    except (OSError, ValueError, json.JSONDecodeError):
        return None, None


def _write_cache_file(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    envelope = {"fetched_at": time.time(), "data": data}
    tmp_path = path + ".tmp"
    with open(tmp_path, "w", encoding="utf-8") as fh:
        json.dump(envelope, fh)
    os.replace(tmp_path, path)


def fetch_with_cache(url, cache_dir, ttl_hours, no_cache, refresh_cache, fetch_fn):
    """Return (data, was_network_hit) for `url`, using an on-disk cache.

    `fetch_fn(url)` performs the actual network call and returns parsed JSON.
    """
    if no_cache:
        return fetch_fn(url), True

    path = _cache_path(cache_dir, url)

    if not refresh_cache and os.path.exists(path):
        fetched_at, data = _read_cache_file(path)
        if fetched_at is not None and data is not None:
            age_hours = (time.time() - fetched_at) / 3600.0
            if age_hours <= ttl_hours:
                LOGGER.debug("Cache hit for %s (age %.2fh)", url, age_hours)
                return data, False

    data = fetch_fn(url)
    try:
        _write_cache_file(path, data)
    except OSError as exc:
        LOGGER.warning("Could not write cache for %s: %s", url, exc)
    return data, True
