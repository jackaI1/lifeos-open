import pytest

from experiment_analysis import simulate


@pytest.fixture(scope="session")
def orders():
    return simulate()[0]
