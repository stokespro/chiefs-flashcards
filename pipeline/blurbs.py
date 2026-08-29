"""Deterministic, IO-free generation of player "scouting flashcard" blurbs.

HARD RULE: no blurb string may contain a digit character. All numeric concepts
(round, experience tier, size) are spelled out in words. This is asserted by
callers/tests.

These are auto-generated notes derived only from public ESPN roster
attributes (position, size, experience, draft pedigree, roster status) via a
fixed rule template. They are NOT scouting reports and contain no statistics,
injury detail, or evaluative superlatives.
"""

from __future__ import annotations

import re

RULES_VERSION = 1

FAMILY_OF = {
    "QB": "QB",
    "WR": "OFF_SKILL", "TE": "OFF_SKILL", "RB": "OFF_SKILL", "FB": "OFF_SKILL",
    "OT": "OL", "G": "OL", "OG": "OL", "C": "OL", "OL": "OL",
    "DE": "DL", "DT": "DL", "NT": "DL",
    "LB": "LB", "ILB": "LB", "OLB": "LB", "MLB": "LB",
    "CB": "DB", "S": "DB", "DB": "DB", "FS": "DB", "SS": "DB",
    "PK": "ST", "K": "ST", "P": "ST", "LS": "ST",
}

FAMILY_POSITION_GROUP = {
    "QB": "Offense",
    "OFF_SKILL": "Offense",
    "OL": "Offense",
    "DL": "Defense",
    "LB": "Defense",
    "DB": "Defense",
    "ST": "Special Teams",
}


def family_of(position_abbrev):
    if not position_abbrev:
        return None
    return FAMILY_OF.get(position_abbrev.upper())


def position_group_for(position_abbrev):
    family = family_of(position_abbrev)
    return FAMILY_POSITION_GROUP.get(family)


# height_inches, weight_pounds norms (medians observed on this roster payload)
POSITION_NORMS = {
    "WR": (73, 196), "CB": (72, 195), "LB": (74, 235), "OT": (77, 311),
    "DE": (76, 260), "DT": (75, 311), "TE": (77, 250), "RB": (70, 210),
    "S": (72, 206), "G": (77, 308), "QB": (74, 219), "C": (75, 310),
    "P": (73, 200), "PK": (76, 205), "LS": (75, 240),
}

FAMILY_NORMS = {
    "OFF_SKILL": (73, 205), "OL": (77, 310), "DL": (76, 285), "LB": (74, 235),
    "DB": (72, 200), "ST": (75, 215), "QB": (74, 219),
}

H_TOL = 1.5


def _w_tol(norm_w):
    return max(8, round(0.05 * norm_w))


SIZE_PHRASE = {
    "long_and_thick": "long and powerfully built",
    "long_and_lean": "long and lean",
    "compact_and_thick": "compact and sturdy",
    "compact_and_quick": "compact and quick",
    "tall": "tall for the position",
    "sturdy": "sturdy",
    "lean": "lean",
    "compact": "compact",
}

SIZE_DEV_NOTE = {
    "long_and_thick": "Continuing to refine footwork and play speed at his size will help him fully leverage his frame.",
    "long_and_lean": "Adding functional strength to that long frame is a natural next step in his development.",
    "compact_and_thick": "Improving lateral quickness will help him make the most of his compact, powerful build.",
    "compact_and_quick": "Continuing to add strength will help him hold up against bigger competition.",
    "tall": "Polishing the finer technical details that come with a bigger frame remains a growth area.",
    "sturdy": "Sharpening quickness and change of direction will help him maximize his sturdy build.",
    "lean": "Adding strength and mass is a natural developmental focus for his frame.",
    "compact": "Refining technique will help him maximize a smaller frame against bigger competition.",
}


def size_band(position_abbrev, height_inches, weight_pounds):
    if height_inches is None or weight_pounds is None:
        return None

    norm = None
    if position_abbrev:
        norm = POSITION_NORMS.get(position_abbrev.upper())
    if norm is None:
        family = family_of(position_abbrev)
        if family:
            norm = FAMILY_NORMS.get(family)
    if norm is None:
        return None

    norm_h, norm_w = norm
    w_tol = _w_tol(norm_w)

    if height_inches > norm_h + H_TOL:
        h_bucket = "tall"
    elif height_inches < norm_h - H_TOL:
        h_bucket = "short"
    else:
        h_bucket = "mid"

    if weight_pounds > norm_w + w_tol:
        w_bucket = "heavy"
    elif weight_pounds < norm_w - w_tol:
        w_bucket = "light"
    else:
        w_bucket = "mid"

    combo_map = {
        ("tall", "heavy"): "long_and_thick",
        ("tall", "light"): "long_and_lean",
        ("tall", "mid"): "tall",
        ("short", "heavy"): "compact_and_thick",
        ("short", "light"): "compact_and_quick",
        ("short", "mid"): "compact",
        ("mid", "heavy"): "sturdy",
        ("mid", "light"): "lean",
        ("mid", "mid"): "balanced",
    }
    return combo_map[(h_bucket, w_bucket)]


def experience_tier(experience_years):
    if experience_years is None:
        return None
    if experience_years <= 0:
        return "rookie"
    if experience_years <= 2:
        return "developing"
    if experience_years <= 7:
        return "prime"
    return "veteran"


EXPERIENCE_STRENGTH = {
    "rookie": "As a rookie, he brings fresh energy and untapped upside to the room.",
    "developing": "With a couple of seasons of experience now, he continues to sharpen his role within the group.",
    "prime": "Now in the prime of his career, he brings valuable, hard-earned experience the team counts on.",
    "veteran": "As a long-tenured veteran, he brings a wealth of experience and leadership to the locker room.",
    None: "His experience level rounds out a well-balanced room.",
}

EXPERIENCE_DEV = {
    "rookie": "As a rookie, the speed of the professional game will take some time to slow down for him, and consistency is the next step.",
    "developing": "Still early in his career, he is continuing to build the consistency that comes with more experience.",
    "prime": "Even in his prime, there is always room to refine details and stay ahead of the league adjustments.",
    "veteran": "Like any veteran, staying fresh and continuing to adapt his game will matter as much as experience does.",
    None: "With limited public experience data available, his development path is simply one to keep watching.",
}


POSITION_ARCHETYPE = {
    "QB": "As the quarterback, he is the trigger man for the offense, tasked with reading defenses and delivering the ball on time",
    "WR": "Lining up at wide receiver, he looks to win one-on-one matchups and create separation down the field",
    "TE": "At tight end, he offers a versatile mix of blocking and receiving that keeps the offense flexible",
    "RB": "Working out of the backfield, he brings versatility as a runner and receiver who can change the pace of a drive",
    "FB": "Working as a fullback, he leads the way as a blocker and short-yardage option out of the backfield",
    "OT": "Anchoring the edge of the offensive line at tackle, he is charged with protecting the pocket and setting the tone in the run game",
    "G": "Working inside at guard, he provides the interior push and protection the offense leans on up front",
    "OG": "Working inside at guard, he provides the interior push and protection the offense leans on up front",
    "C": "At center, he sets the protection calls and gets the offensive line moving as one unit",
    "OL": "Working along the offensive line, he provides protection and movement up front for the offense",
    "DE": "Rushing off the edge at defensive end, he looks to pressure the quarterback and set the edge against the run",
    "DT": "Lining up at defensive tackle, he takes on double teams and clogs running lanes up the middle",
    "NT": "Anchoring the nose tackle spot, he commands double teams and holds his ground against the run",
    "LB": "Patrolling from linebacker, he reads plays quickly and helps the defense stay organized from sideline to sideline",
    "ILB": "Patrolling from inside linebacker, he reads plays quickly and helps the defense stay organized from sideline to sideline",
    "OLB": "Working from outside linebacker, he blends coverage range with the ability to pressure off the edge",
    "MLB": "Running the defense from middle linebacker, he is the communicator who gets everyone lined up correctly",
    "CB": "Covering receivers at cornerback, he relies on footwork and instincts to stay in phase down the field",
    "S": "Playing safety, he serves as the last line of defense, reading the quarterback and helping direct the secondary",
    "FS": "Playing free safety, he serves as the last line of defense, reading the quarterback from the deep middle of the field",
    "SS": "Playing strong safety, he mixes run support near the line with coverage responsibilities over the middle",
    "DB": "Playing in the defensive secondary, he relies on awareness and closing speed to limit opposing passing games",
    "PK": "As the placekicker, he is asked to be steady and precise whenever points are on the line",
    "K": "As the placekicker, he is asked to be steady and precise whenever points are on the line",
    "P": "Handling punting duties, he is asked to flip the field with hang time and placement",
    "LS": "Working as the long snapper, he provides the quiet, dependable foundation every kicking play depends on",
}

FAMILY_ARCHETYPE = {
    "QB": "As the quarterback, he is the trigger man for the offense, tasked with reading defenses and delivering the ball on time",
    "OFF_SKILL": "Playing a skill position on offense, he looks to create explosive plays whenever the ball is in his hands",
    "OL": "Working along the offensive line, he provides protection and movement up front for the offense",
    "DL": "Playing along the defensive line, he works to disrupt plays before they can develop",
    "LB": "Patrolling from linebacker, he reads plays quickly and helps the defense stay organized from sideline to sideline",
    "DB": "Playing in the defensive secondary, he relies on awareness and closing speed to limit opposing passing games",
    "ST": "Contributing on special teams, he brings a specialized skill that shows up in critical field-position moments",
}

GENERIC_ARCHETYPE = "He brings a role-specific skill set to the roster that the coaching staff continues to develop"


def _archetype(position_abbrev):
    abbrev = (position_abbrev or "").upper()
    if abbrev in POSITION_ARCHETYPE:
        return abbrev, POSITION_ARCHETYPE[abbrev]
    family = family_of(abbrev)
    if family and family in FAMILY_ARCHETYPE:
        return family, FAMILY_ARCHETYPE[family]
    return "GENERIC", GENERIC_ARCHETYPE


_DRAFT_RE = re.compile(r"^(\d{4}): Rd (\d+), Pk (\d+) \(([A-Z]+)\)$")

ROUND_WORD = {
    1: "first-round",
    2: "second-round",
    3: "mid-round",
    4: "mid-round",
    5: "late-round",
    6: "late-round",
    7: "late-round",
}


def parse_draft_display(display_draft):
    """Parse an ESPN displayDraft string.

    Returns a dict: year, round, pick, team, is_undrafted. A missing field or
    a string that does not match the expected pattern always resolves to
    is_undrafted=True rather than raising.
    """
    if isinstance(display_draft, str):
        match = _DRAFT_RE.match(display_draft.strip())
        if match:
            year, rnd, pick, team = match.groups()
            return {
                "year": int(year),
                "round": int(rnd),
                "pick": int(pick),
                "team": team,
                "is_undrafted": False,
            }
    return {
        "year": None,
        "round": None,
        "pick": None,
        "team": None,
        "is_undrafted": True,
    }


def _pedigree_sentence(draft, college):
    college_clause = " out of " + college if college else ""
    if draft.get("is_undrafted"):
        return (
            "He signed as an undrafted free agent" + college_clause +
            ", a path that rewards steady, hard-nosed improvement"
        )
    round_word = ROUND_WORD.get(draft.get("round"), "mid-round")
    return (
        "A " + round_word + " pick" + college_clause +
        ", he arrived with a track record that earned the coaching staff confidence on draft weekend"
    )


ROSTER_GROUP_NOTE = {
    "injuredReserveOrOut": "He is listed in the reserve/out group, so availability is the open question.",
    "suspended": "He is currently listed as suspended, so availability is the open question.",
    "practiceSquad": "He is on the practice squad and still working toward a game-day role.",
}


BANNED_TERMS = [
    "elite", "pro bowl", "all-pro", "mvp", "injur", "hurt", "concussion",
    "acl", "surgery", "bust", "worst", "overrated", "cut candidate",
    "trade", "holdout", "arrest", "suspension for",
]


def _sentence(text):
    text = text.strip()
    if not text.endswith("."):
        text += "."
    return text


def generate_blurb_meta(player):
    """Pure helper: compute (archetype_key, experience_tier, size_band)."""
    archetype_key, _ = _archetype(player.get("position_abbrev"))
    tier = experience_tier(player.get("experience_years"))
    band = size_band(
        player.get("position_abbrev"),
        player.get("height_inches"),
        player.get("weight_pounds"),
    )
    return archetype_key, tier, band


def generate_blurbs(player):
    """Generate (strengths, weaknesses) for a normalized player dict.

    Pure function: deterministic, no randomness, no clock, no IO. `player`
    must provide (values may be None):
        position_abbrev, height_inches, weight_pounds, experience_years,
        roster_group, profile_fetched, draft (dict incl. is_undrafted, round),
        college
    """
    archetype_key, tier, band = generate_blurb_meta(player)
    position_abbrev = player.get("position_abbrev")
    _, archetype_sentence = _archetype(position_abbrev)

    if band and band in SIZE_PHRASE:
        sentence1 = archetype_sentence + ", and his frame is best described as " + SIZE_PHRASE[band]
    else:
        sentence1 = archetype_sentence

    draft = player.get("draft") or {}
    if player.get("profile_fetched"):
        sentence2 = _pedigree_sentence(draft, player.get("college"))
    else:
        sentence2 = EXPERIENCE_STRENGTH.get(tier, EXPERIENCE_STRENGTH[None]).rstrip(".")

    strengths = _sentence(sentence1) + " " + _sentence(sentence2)

    dev_sentence1 = EXPERIENCE_DEV.get(tier, EXPERIENCE_DEV[None]).rstrip(".")
    roster_group = player.get("roster_group")
    second = ROSTER_GROUP_NOTE.get(roster_group)
    if second is None and band and band in SIZE_DEV_NOTE:
        second = SIZE_DEV_NOTE[band]

    if second:
        weaknesses = _sentence(dev_sentence1) + " " + _sentence(second)
    else:
        weaknesses = _sentence(dev_sentence1)

    return strengths, weaknesses
