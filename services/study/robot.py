"""A repeatable classroom pick model, not a real robot controller."""

import json
import math
import os
import random
import sqlite3

from flask import Flask, jsonify, request


def simulate(config):
    fields = {"part_size_mm", "camera_noise_mm", "gripper_tolerance_mm", "trials", "seed"}
    if set(config) != fields:
        raise ValueError("Send exactly: " + ", ".join(sorted(fields)))
    for key, lo, hi in [
        ("part_size_mm", 1, 100),
        ("camera_noise_mm", 0, 20),
        ("gripper_tolerance_mm", 0.01, 10),
    ]:
        value = config[key]
        if (
            isinstance(value, bool)
            or not isinstance(value, (int, float))
            or not math.isfinite(value)
            or not lo <= value <= hi
        ):
            raise ValueError(f"{key} must be between {lo} and {hi}")
    for key, lo, hi in [("trials", 1, 10000), ("seed", 0, 2147483647)]:
        if type(config[key]) is not int or not lo <= config[key] <= hi:
            raise ValueError(f"{key} must be an integer between {lo} and {hi}")
    rng = random.Random(config["seed"])
    failures = {"outside_camera_window": 0, "gripper_misalignment": 0}
    for _ in range(config["trials"]):
        error = math.hypot(rng.gauss(0, config["camera_noise_mm"]), rng.gauss(0, config["camera_noise_mm"]))
        if error > config["part_size_mm"] / 2:
            failures["outside_camera_window"] += 1
        elif error > config["gripper_tolerance_mm"]:
            failures["gripper_misalignment"] += 1
    successes = config["trials"] - sum(failures.values())
    return {"successes": successes, "success_rate": successes / config["trials"], "failures": failures}


def create_app(path=None):
    app = Flask(__name__)
    app.config["MAX_CONTENT_LENGTH"] = 8192
    path = path or os.environ.get("PICK_DATABASE", "picks.sqlite")

    def connect():
        db = sqlite3.connect(path)
        db.row_factory = sqlite3.Row
        return db

    with connect() as db:
        db.execute(
            "CREATE TABLE IF NOT EXISTS runs (id INTEGER PRIMARY KEY, config TEXT NOT NULL, result TEXT NOT NULL)"
        )

    def row(r):
        return {"id": r["id"], "config": json.loads(r["config"]), **json.loads(r["result"])}

    @app.get("/healthz")
    def health():
        return {"ok": True}

    @app.post("/runs")
    def create_run():
        config = request.get_json(silent=True)
        try:
            if not isinstance(config, dict):
                raise ValueError("Send a JSON configuration object")
            result = simulate(config)
        except ValueError as error:
            return jsonify(error=str(error)), 400
        with connect() as db:
            cursor = db.execute(
                "INSERT INTO runs(config,result) VALUES(?,?)", (json.dumps(config), json.dumps(result))
            )
            run_id = cursor.lastrowid
        return jsonify(id=run_id, config=config, **result), 201

    @app.get("/runs")
    def runs():
        with connect() as db:
            return jsonify(runs=[row(r) for r in db.execute("SELECT * FROM runs ORDER BY id DESC LIMIT 100")])

    @app.get("/runs/<int:run_id>")
    def run(run_id):
        with connect() as db:
            found = db.execute("SELECT * FROM runs WHERE id=?", (run_id,)).fetchone()
        return (jsonify(row(found)), 200) if found else (jsonify(error="Run not found"), 404)

    @app.get("/compare")
    def compare():
        try:
            ids = [int(value) for value in request.args.get("ids", "").split(",")]
            if len(ids) != 2 or len(set(ids)) != 2:
                raise ValueError()
        except ValueError:
            return jsonify(error="Supply two different run IDs: ?ids=1,2"), 400
        with connect() as db:
            found = [db.execute("SELECT * FROM runs WHERE id=?", (i,)).fetchone() for i in ids]
        if any(r is None for r in found):
            return jsonify(error="Run not found"), 404
        rows = [row(r) for r in found]
        return jsonify(runs=rows, success_rate_change=rows[1]["success_rate"] - rows[0]["success_rate"])

    return app
