"""Contract test: every player field app.js reads must exist on every player
in app/roster.json (schema is null-tolerant, so "exists" == "key present").
"""

from __future__ import annotations

import json
import os
import re
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

KNOWN_PLAYER_FIELDS = set((
    "id full_name first_name last_name short_name jersey jersey_number "
    "position_abbrev position_name position_group roster_group status status_type "
    "age date_of_birth display_dob birth_place "
    "height_inches display_height weight_pounds display_weight "
    "college college_short college_abbrev experience_years display_experience "
    "draft headshot_url headshot_alt "
    "strengths weaknesses blurb_meta "
    "profile_fetched data_sources"
).split())

# Field-access patterns like `player.full_name`, `p.headshot_url`, `.jersey_number`
FIELD_ACCESS_RE = re.compile(r"(?:player|p)\.([a-zA-Z_][a-zA-Z0-9_]*)")


def read_app_js():
    with open(os.path.join(ROOT, "app", "app.js"), "r", encoding="utf-8") as fh:
        return fh.read()


def fields_read_by_app_js():
    source = read_app_js()
    found = set(m.group(1) for m in FIELD_ACCESS_RE.finditer(source))
    return found & KNOWN_PLAYER_FIELDS


class ContractTest(unittest.TestCase):
    def test_app_js_field_reads_exist_on_every_player(self):
        used_fields = fields_read_by_app_js()
        self.assertTrue(used_fields, "app.js did not appear to read any known player fields")

        roster_path = os.path.join(ROOT, "app", "roster.json")
        if not os.path.exists(roster_path):
            self.skipTest("app/roster.json has not been generated yet; run pipeline/build_roster.py")

        with open(roster_path, "r", encoding="utf-8") as fh:
            doc = json.load(fh)

        players = doc.get("players", [])
        self.assertTrue(players, "roster.json has no players")

        for field in sorted(used_fields):
            for player in players:
                self.assertIn(field, player,
                               msg="app.js reads player.%s but it is missing from a player record" % field)


if __name__ == "__main__":
    unittest.main()
