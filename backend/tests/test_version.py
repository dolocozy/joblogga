import json
import re
from pathlib import Path

import pytest

from app import __version__
from app.main import app

SEMVER = re.compile(r"^\d+\.\d+\.\d+$")


def test_the_version_is_a_plain_semantic_version():
    assert SEMVER.match(__version__), __version__


def test_the_api_reports_that_version():
    assert app.openapi()["info"]["version"] == __version__


def test_frontend_and_backend_share_one_version():
    """A release is one version for the whole project. If only one side is bumped, this says so."""
    package = Path(__file__).resolve().parents[2] / "frontend" / "package.json"
    if not package.exists():
        pytest.skip("frontend/ is not part of this checkout")
    assert json.loads(package.read_text())["version"] == __version__
