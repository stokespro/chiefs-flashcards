"""Offline smoke tests for the Chiefs flashcards data pipeline.

Fully offline: uses on-disk fixtures under tests/fixtures/. No network calls
unless CHIEFS_NET_TEST=1 is set (see test_live_network, which is skipped by
default).
"""

from __future__ import annotations

import itertools
import json
import os
import re
import sys
import unittest
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
FIXTURES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures")

from pipeline import blurbs, build_roster, cache, espn, normalize, validate  # noqa: E402


def load_fixture(name):
    with open(os.path.join(FIXTURES, name), "r", encoding="utf-8") as fh:
        return json.load(fh)


EXPECTED_PLAYER_KEYS = set((
    "id full_name first_name last_name short_name jersey jersey_number "
    "position_abbrev position_name position_group roster_group status status_type "
    "age date_of_birth display_dob birth_place "
    "height_inches display_height weight_pounds display_weight "
    "college college_short college_abbrev experience_years display_experience "
    "draft headshot_url headshot_alt "
    "strengths weaknesses blurb_meta "
    "profile_fetched data_sources"
).split())

DRAFT_KEYS = set("display year round pick team is_undrafted".split())
BLURB_META_KEYS = set("archetype_key experience_tier size_band rules_version".split())


def build_all_players_from_fixture(with_profiles=False):
    roster = load_fixture("kc_roster.json")
    mahomes = load_fixture("mahomes_profile.json")["athlete"]
    allen = load_fixture("cyrus_allen_profile.json")["athlete"]
    players = []
    for roster_group, item in normalize.iter_roster_athletes(roster):
        pid = item.get("id")
        if with_profiles and pid == mahomes["id"]:
            p = normalize.build_player(item, roster_group, mahomes, True)
        elif with_profiles and pid == allen["id"]:
            p = normalize.build_player(item, roster_group, allen, True)
        else:
            p = normalize.build_player(item, roster_group, None, False)
        players.append(p)
    return players


class SchemaTests(unittest.TestCase):
    """AC1: schema completeness/types."""

    def test_every_key_present_on_every_player(self):
        players = build_all_players_from_fixture()
        self.assertEqual(len(players), 95)
        for p in players:
            self.assertEqual(set(p.keys()), EXPECTED_PLAYER_KEYS,
                              msg="player %s missing/extra keys" % p.get("id"))
            self.assertEqual(set(p["draft"].keys()), DRAFT_KEYS)
            self.assertEqual(set(p["blurb_meta"].keys()), BLURB_META_KEYS)

    def test_types(self):
        players = build_all_players_from_fixture(with_profiles=True)
        for p in players:
            self.assertIsInstance(p["id"], str)
            self.assertIsInstance(p["strengths"], str)
            self.assertIsInstance(p["weaknesses"], str)
            self.assertIsInstance(p["profile_fetched"], bool)
            self.assertIsInstance(p["data_sources"], list)
            if p["jersey_number"] is not None:
                self.assertIsInstance(p["jersey_number"], int)
            if p["age"] is not None:
                self.assertIsInstance(p["age"], int)
            if p["height_inches"] is not None:
                self.assertIsInstance(p["height_inches"], int)
            if p["weight_pounds"] is not None:
                self.assertIsInstance(p["weight_pounds"], int)
            self.assertIsInstance(p["draft"], dict)
            self.assertIsInstance(p["blurb_meta"], dict)


class MissingFieldToleranceTests(unittest.TestCase):
    """AC2: missing college/age/jersey tolerance (never raises, degrades to None)."""

    def test_missing_fields_tolerated(self):
        players = build_all_players_from_fixture()
        counts = validate.compute_counts(players)
        self.assertEqual(counts["missing_college"], 1)
        self.assertEqual(counts["missing_age"], 2)
        self.assertEqual(counts["missing_jersey"], 1)
        for p in players:
            if not p["college"]:
                self.assertIsNone(p["college"])
            if p["jersey"] is None:
                self.assertIsNone(p["jersey_number"])


class BlurbSizeBandTests(unittest.TestCase):
    """Exact size-band bucketing, using WR norms (73in / 196lb, w_tol=10)."""

    def test_all_nine_bands(self):
        cases = [
            (78, 230, "long_and_thick"),
            (78, 170, "long_and_lean"),
            (78, 196, "tall"),
            (68, 230, "compact_and_thick"),
            (68, 170, "compact_and_quick"),
            (68, 196, "compact"),
            (73, 230, "sturdy"),
            (73, 170, "lean"),
            (73, 196, "balanced"),
        ]
        for height, weight, expected in cases:
            got = blurbs.size_band("WR", height, weight)
            self.assertEqual(got, expected, msg="h=%s w=%s" % (height, weight))

    def test_missing_data_or_unknown_position_gives_none(self):
        self.assertIsNone(blurbs.size_band("WR", None, 200))
        self.assertIsNone(blurbs.size_band("WR", 74, None))
        self.assertIsNone(blurbs.size_band("ZZ", 74, 220))


BANNED_TERMS_TO_CHECK = [t for t in blurbs.BANNED_TERMS if t != "suspended"]


def assert_blurb_quality(testcase, text, roster_group):
    testcase.assertTrue(text and text.strip(), msg="blurb text was empty")
    testcase.assertIsNone(re.search(r"\d", text), msg="blurb contained a digit: %r" % text)
    sentence_count = len([s for s in text.split(". ") if s.strip()])
    testcase.assertLessEqual(sentence_count, 2, msg="too many sentences: %r" % text)
    low = text.lower()
    for term in BANNED_TERMS_TO_CHECK:
        testcase.assertNotIn(term, low, msg="banned term %r in %r" % (term, text))
    if "suspended" in low:
        testcase.assertEqual(roster_group, "suspended",
                              msg="'suspended' used outside the roster-group template: %r" % text)


class BlurbMatrixTests(unittest.TestCase):
    """AC3: synthetic matrix over position x tier x size x draft x roster_group."""

    def test_matrix_quality(self):
        positions = sorted(set(blurbs.POSITION_ARCHETYPE) | {"EDGE", "ZZ"})
        tiers_years = [0, 1, 5, 10, None]
        size_variants = [
            (None, None),      # unknown size
            (78, 230), (78, 170), (78, 196),
            (68, 230), (68, 170), (68, 196),
            (73, 230), (73, 170), (73, 196),
        ]
        roster_groups = list(normalize.ROSTER_GROUPS_ORDER)
        draft_variants = [
            ("2017: Rd 1, Pk 10 (KC)", True),
            (None, True),
            (None, False),
        ]

        total = 0
        for abbrev, years, (h, w), roster_group, (draft_display, profile_fetched) in itertools.product(
            positions, tiers_years, size_variants, roster_groups, draft_variants
        ):
            draft = (blurbs.parse_draft_display(draft_display) if profile_fetched
                     else {"display": None, "year": None, "round": None,
                           "pick": None, "team": None, "is_undrafted": None})
            player = {
                "position_abbrev": abbrev,
                "height_inches": h,
                "weight_pounds": w,
                "experience_years": years,
                "roster_group": roster_group,
                "profile_fetched": profile_fetched,
                "draft": draft,
                "college": "Sample State" if profile_fetched else None,
            }
            strengths, weaknesses = blurbs.generate_blurbs(player)
            assert_blurb_quality(self, strengths, roster_group)
            assert_blurb_quality(self, weaknesses, roster_group)
            total += 1
        self.assertGreater(total, 1000)


class DeterminismTests(unittest.TestCase):
    """AC4: determinism -- identical strings on repeat, byte-identical builds."""

    def test_generate_blurbs_is_deterministic(self):
        player = {
            "position_abbrev": "QB", "height_inches": 75, "weight_pounds": 227,
            "experience_years": 9, "roster_group": "offense", "profile_fetched": True,
            "draft": blurbs.parse_draft_display("2017: Rd 1, Pk 10 (KC)"),
            "college": "Texas Tech",
        }
        first = blurbs.generate_blurbs(player)
        second = blurbs.generate_blurbs(player)
        self.assertEqual(first, second)

    def test_two_builds_are_byte_identical(self):
        players_a = build_all_players_from_fixture(with_profiles=True)
        players_b = build_all_players_from_fixture(with_profiles=True)
        players_a = normalize.sort_players(players_a)
        players_b = normalize.sort_players(players_b)
        self.assertEqual(
            json.dumps(players_a, sort_keys=True),
            json.dumps(players_b, sort_keys=True),
        )


class DraftParsingTests(unittest.TestCase):
    """AC5: draft parsing incl. None/garbage -> is_undrafted without raising."""

    def test_valid_draft_string(self):
        result = blurbs.parse_draft_display("2017: Rd 1, Pk 10 (KC)")
        self.assertEqual(result["year"], 2017)
        self.assertEqual(result["round"], 1)
        self.assertEqual(result["pick"], 10)
        self.assertEqual(result["team"], "KC")
        self.assertFalse(result["is_undrafted"])

    def test_none_and_garbage_never_raise(self):
        for bad in (None, "", "garbage", "2017 Rd 1 Pk 10", 12345, {}, [], "2017: Rd X, Pk 10 (KC)"):
            result = blurbs.parse_draft_display(bad)
            self.assertTrue(result["is_undrafted"])
            self.assertIsNone(result["year"])
            self.assertIsNone(result["round"])
            self.assertIsNone(result["pick"])
            self.assertIsNone(result["team"])


class ValidationTests(unittest.TestCase):
    """AC6: validation warnings and --strict exit codes, fully offline (network mocked)."""

    def _run_build_roster(self, roster_doc, out_path, extra_args=None):
        def fake_fetch_json(url, timeout=20, retries=2):
            if "roster" in url:
                return roster_doc
            raise AssertionError("profile fetch should not happen with --skip-profiles: " + url)

        argv = [
            "--team", "kc", "--out", out_path, "--skip-profiles", "--no-cache",
            "--validate", "--expected-count", "53",
        ] + (extra_args or [])
        with mock.patch("pipeline.espn.fetch_json", side_effect=fake_fetch_json):
            return build_roster.main(argv)

    def test_95_players_warns_but_exits_zero(self):
        roster_doc = load_fixture("kc_roster.json")
        out_path = os.path.join(FIXTURES, "_tmp_out_95.json")
        try:
            code = self._run_build_roster(roster_doc, out_path)
            self.assertEqual(code, 0)
            with open(out_path) as fh:
                doc = json.load(fh)
            self.assertEqual(doc["counts"]["total"], 95)
            self.assertFalse(doc["validation"]["is_final_53"])
            self.assertTrue(doc["validation"]["warnings"])
        finally:
            if os.path.exists(out_path):
                os.remove(out_path)
            tmp = out_path.replace(".json", ".js")
            if os.path.exists(tmp):
                os.remove(tmp)

    def test_synthetic_53_has_no_count_warning(self):
        roster_doc = load_fixture("kc_roster.json")
        synthetic = make_synthetic_roster(roster_doc, 53)
        out_path = os.path.join(FIXTURES, "_tmp_out_53.json")
        try:
            code = self._run_build_roster(synthetic, out_path)
            self.assertEqual(code, 0)
            with open(out_path) as fh:
                doc = json.load(fh)
            self.assertEqual(doc["counts"]["total"], 53)
            self.assertTrue(doc["validation"]["is_final_53"])
            self.assertEqual(doc["validation"]["warnings"], [])
        finally:
            if os.path.exists(out_path):
                os.remove(out_path)
            tmp = out_path.replace(".json", ".js")
            if os.path.exists(tmp):
                os.remove(tmp)

    def test_strict_mode_exits_2_on_warnings(self):
        roster_doc = load_fixture("kc_roster.json")
        out_path = os.path.join(FIXTURES, "_tmp_out_strict.json")
        try:
            code = self._run_build_roster(roster_doc, out_path, extra_args=["--strict"])
            self.assertEqual(code, 2)
        finally:
            if os.path.exists(out_path):
                os.remove(out_path)
            tmp = out_path.replace(".json", ".js")
            if os.path.exists(tmp):
                os.remove(tmp)


def make_synthetic_roster(roster_doc, target_total):
    """Return a deep-copied roster doc whose athlete groups sum to target_total."""
    doc = json.loads(json.dumps(roster_doc))
    remaining = target_total
    for group in doc["athletes"]:
        items = group["items"]
        take = min(len(items), remaining)
        group["items"] = items[:take]
        remaining -= take
    return doc


class DuplicateJerseyTests(unittest.TestCase):
    """AC7: duplicate jerseys map to lists (11 known dups -> two-entry lists)."""

    def test_eleven_duplicate_jerseys(self):
        players = build_all_players_from_fixture()
        counts = validate.compute_counts(players)
        dups = counts["duplicate_jersey_numbers"]
        self.assertEqual(len(dups), 11)
        for jersey, ids in dups.items():
            self.assertEqual(len(ids), 2, msg="jersey %s expected 2 entries" % jersey)


class RosterJsonSchemaTests(unittest.TestCase):
    """AC8: json.load(app/roster.json) ok and schema_version == 1."""

    def test_roster_json_loads_and_has_schema_version(self):
        roster_path = os.path.join(ROOT, "app", "roster.json")
        if not os.path.exists(roster_path):
            self.skipTest("app/roster.json has not been generated yet; run pipeline/build_roster.py")
        with open(roster_path, "r", encoding="utf-8") as fh:
            doc = json.load(fh)
        self.assertEqual(doc["schema_version"], 1)
        self.assertIn("players", doc)
        self.assertIsInstance(doc["players"], list)
        self.assertGreater(len(doc["players"]), 0)
        for key in ("blurb_rules_version", "generated_at", "source", "counts", "validation"):
            self.assertIn(key, doc)


class LiveNetworkTests(unittest.TestCase):
    """Optional live network check, off by default. Set CHIEFS_NET_TEST=1 to enable."""

    @unittest.skipUnless(os.environ.get("CHIEFS_NET_TEST") == "1",
                          "live network test disabled (set CHIEFS_NET_TEST=1 to enable)")
    def test_live_roster_endpoint_reachable(self):
        data = espn.fetch_json(espn.roster_url("kc"), timeout=10, retries=1)
        self.assertIn("athletes", data)


if __name__ == "__main__":
    unittest.main()
