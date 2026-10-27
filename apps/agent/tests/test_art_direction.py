"""Each new site gets a composition of its own, not the one the user's last sites got."""

import random

from rafiq_agent.core import art_direction as ad
from rafiq_agent.core.designs import brief_message
from rafiq_agent.locales import EN, RU


def test_sites_get_a_direction_and_apps_dont():
    assert ad.wants_direction({"kind": "موقع"})
    assert ad.wants_direction({"kind": "صفحة هبوط"})
    assert ad.wants_direction({"kind": "Website"})  # saved in English
    assert not ad.wants_direction({"kind": "لوحة تحكم"})
    assert not ad.wants_direction({"type": "board"})


def test_pick_avoids_recent_and_fits_the_page_shape():
    rng = random.Random(1)
    recent = ["poster", "index", "tour"]
    for _ in range(40):
        key = ad.pick({"layout": "طويلة بقصة كاملة"}, recent, rng)
        assert key not in recent
        assert "long" in ad.DIRECTIONS[key]["suits"]


def test_pick_falls_back_to_the_oldest_used():
    shape = {"layout": "قصيرة ومركّزة"}
    suited = [k for k, d in ad.DIRECTIONS.items() if "short" in d["suits"]]
    assert ad.pick(shape, list(suited)) == suited[-1]


def test_the_direction_is_named_in_the_kickoff_and_translated():
    text = brief_message({"kind": "موقع", "art": "collage"})
    assert ad.DIRECTIONS["collage"]["name"] in text
    for d in ad.DIRECTIONS.values():
        assert d["name"] in EN and d["name"] in RU
    assert ad.DIRECTIONS["collage"]["brief"] in ad.direction_note("collage")
