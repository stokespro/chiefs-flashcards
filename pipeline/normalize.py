"""Turn raw ESPN roster + profile payloads into the normalized player schema.

Every key in the returned player dict is always present; unknown values are
represented as None (never omitted), so the frontend never has to guard for
missing keys.
"""

from __future__ import annotations

import logging

from pipeline import blurbs

LOGGER = logging.getLogger("pipeline.normalize")

ROSTER_GROUPS_ORDER = [
    "offense", "defense", "specialTeam",
    "injuredReserveOrOut", "suspended", "practiceSquad",
]


def _to_int(value):
    if value is None:
        return None
    try:
        return int(round(float(value)))
    except (TypeError, ValueError):
        return None


def _clean_str(value):
    if value is None:
        return None
    value = str(value).strip()
    return value or None


def iter_roster_athletes(roster_json):
    """Yield (roster_group, raw_athlete_dict) for every player on the roster."""
    for group in roster_json.get("athletes", []):
        roster_group = group.get("position")
        for item in group.get("items", []):
            yield roster_group, item


def _date_only(iso_datetime):
    if not iso_datetime:
        return None
    return str(iso_datetime).split("T", 1)[0] or None


def build_player(item, roster_group, profile_data, profile_fetched, headshot_verified=None):
    """Build the full normalized player dict for a single roster athlete.

    `item` is the raw roster athlete dict. `profile_data` is the raw
    `athlete` dict from the profile endpoint, or None if not fetched /
    fetch failed. `profile_fetched` reflects whether a *successful* profile
    fetch occurred for this player.
    """
    position = item.get("position") or {}
    college = item.get("college") or {}
    status = item.get("status") or {}
    headshot = item.get("headshot") or {}
    experience = item.get("experience") or {}

    position_abbrev = _clean_str(position.get("abbreviation"))
    position_name = _clean_str(position.get("name"))
    position_group = blurbs.position_group_for(position_abbrev)

    jersey = _clean_str(item.get("jersey"))
    jersey_number = _to_int(jersey) if jersey else None

    height_inches = _to_int(item.get("height"))
    weight_pounds = _to_int(item.get("weight"))

    experience_years = experience.get("years")
    if experience_years is not None:
        experience_years = _to_int(experience_years)

    college_name = _clean_str(college.get("name"))
    college_short = _clean_str(college.get("shortName"))
    college_abbrev = _clean_str(college.get("abbrev"))

    display_dob = None
    birth_place = None
    display_experience = None
    display_draft_raw = None

    if profile_fetched and profile_data:
        display_dob = _clean_str(profile_data.get("displayDOB"))
        birth_place = _clean_str(profile_data.get("displayBirthPlace"))
        display_experience = _clean_str(profile_data.get("displayExperience"))
        display_draft_raw = profile_data.get("displayDraft")

    if profile_fetched:
        draft = blurbs.parse_draft_display(display_draft_raw)
        draft["display"] = _clean_str(display_draft_raw)
    else:
        draft = {
            "display": None, "year": None, "round": None,
            "pick": None, "team": None, "is_undrafted": None,
        }

    data_sources = ["roster"]
    if profile_fetched:
        data_sources.append("profile")

    player = {
        "id": _clean_str(item.get("id")),
        "full_name": _clean_str(item.get("fullName")),
        "first_name": _clean_str(item.get("firstName")),
        "last_name": _clean_str(item.get("lastName")),
        "short_name": _clean_str(item.get("shortName")),
        "jersey": jersey,
        "jersey_number": jersey_number,
        "position_abbrev": position_abbrev,
        "position_name": position_name,
        "position_group": position_group,
        "roster_group": roster_group,
        "status": _clean_str(status.get("name")),
        "status_type": _clean_str(status.get("type")),
        "age": _to_int(item.get("age")),
        "date_of_birth": _date_only(item.get("dateOfBirth")),
        "display_dob": display_dob,
        "birth_place": birth_place,
        "height_inches": height_inches,
        "display_height": _clean_str(item.get("displayHeight")),
        "weight_pounds": weight_pounds,
        "display_weight": _clean_str(item.get("displayWeight")),
        "college": college_name,
        "college_short": college_short,
        "college_abbrev": college_abbrev,
        "experience_years": experience_years,
        "display_experience": display_experience,
        "draft": draft,
        "headshot_url": _clean_str(headshot.get("href")),
        "headshot_alt": _clean_str(headshot.get("alt")) or _clean_str(item.get("fullName")),
        "profile_fetched": bool(profile_fetched),
        "data_sources": data_sources,
    }

    strengths, weaknesses = blurbs.generate_blurbs(player)
    archetype_key, tier, band = blurbs.generate_blurb_meta(player)

    player["strengths"] = strengths
    player["weaknesses"] = weaknesses
    player["blurb_meta"] = {
        "archetype_key": archetype_key,
        "experience_tier": tier,
        "size_band": band,
        "rules_version": blurbs.RULES_VERSION,
    }

    return player


def sort_key(player):
    # Spec: sorted by position_group, position_abbrev, jersey_number, last_name.
    return (
        player.get("position_group") or "",
        player.get("position_abbrev") or "",
        player.get("jersey_number") if player.get("jersey_number") is not None else 9999,
        player.get("last_name") or "",
    )


def sort_players(players):
    return sorted(players, key=sort_key)
