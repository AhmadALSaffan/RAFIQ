"""The update channel is a saved setting: stable by default, beta on request, nothing else."""

import pytest
from pydantic import ValidationError

from rafiq_agent.schemas.settings import AppSettings


def test_stable_unless_chosen_otherwise():
    assert AppSettings().update_channel == "stable"
    assert AppSettings(update_channel="beta").update_channel == "beta"


def test_an_unknown_channel_is_refused():
    with pytest.raises(ValidationError):
        AppSettings(update_channel="nightly")
