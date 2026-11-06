import pytest

from robot import create_app, simulate


@pytest.fixture
def config():
    return dict(part_size_mm=10, camera_noise_mm=1, gripper_tolerance_mm=1, trials=1000, seed=42)


def test_repeatable_and_conserves_trials(config):
    result = simulate(config)
    assert result == simulate(config)
    assert result["successes"] + sum(result["failures"].values()) == config["trials"]
    assert 0 < result["success_rate"] < 1


def test_noise_and_tolerance_have_expected_effects(config):
    assert simulate({**config, "camera_noise_mm": 0})["success_rate"] == 1
    assert simulate({**config, "gripper_tolerance_mm": 2})["success_rate"] > simulate(config)["success_rate"]
    assert simulate({**config, "part_size_mm": 1})["failures"]["outside_camera_window"] > 0


@pytest.mark.parametrize(
    "field,value",
    [
        ("trials", 0),
        ("trials", True),
        ("camera_noise_mm", -1),
        ("part_size_mm", float("nan")),
        ("seed", 1.5),
        ("gripper_tolerance_mm", 0),
    ],
)
def test_validation(config, field, value):
    with pytest.raises(ValueError):
        simulate({**config, field: value})


def test_api_persists_and_compares(tmp_path, config):
    path = str(tmp_path / "runs.sqlite")
    client = create_app(path).test_client()
    assert client.post("/runs", json={}).status_code == 400
    one = client.post("/runs", json=config)
    two = client.post("/runs", json={**config, "gripper_tolerance_mm": 2})
    assert one.status_code == two.status_code == 201
    assert client.get("/compare?ids=1,2").json["success_rate_change"] > 0
    assert client.get("/compare?ids=1,1").status_code == 400
    assert client.get("/compare?ids=1,99").status_code == 404
    assert client.get("/runs/99").status_code == 404
    reopened = create_app(path).test_client()
    assert len(reopened.get("/runs").json["runs"]) == 2
    assert reopened.get("/runs/1").json == one.json
