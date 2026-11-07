"""Fictional intake records, grouped splits, and tamper/leakage checks."""

import hashlib
import json
import random
import re
from pathlib import Path

FIELDS = ("name", "member_id", "region", "status")
SPLITS = ("train", "validation", "test")
TEMPLATES = (
    "Name: {name}\nMember ID: {member_id}\nRegion: {region}\nStatus: {status}",
    "Intake | status={status}; region={region}; member={member_id}; name={name}.",
    "The member {name} ({member_id}) is in {region}. Membership status: {status}.",
    "REGION [{region}]\nPERSON [{name}]\nSTATE [{status}]\nMEMBER [{member_id}]",
    "Membership {member_id}: {name}. Current state is {status}; office region is {region}.",
    "{name} / region: {region} / ID: {member_id} / status: {status}",
)


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def normalized(text):
    return re.sub(r"\s+", " ", text).strip().casefold()


def audit(splits):
    """Reject duplicates and entity/answer overlap before any model sees the data."""
    seen_inputs, seen_entities, seen_targets, seen_ids = {}, {}, {}, set()
    for split in SPLITS:
        rows = splits[split]
        if not rows:
            raise ValueError(f"Empty split: {split}")
        for row in rows:
            if row["id"] in seen_ids:
                raise ValueError("Duplicate row ID")
            seen_ids.add(row["id"])
            target = row["target"]
            if set(target) != set(FIELDS) or any(
                v is not None and not isinstance(v, str) for v in target.values()
            ):
                raise ValueError("Target must have exactly the four string/null fields")
            key = normalized(row["input"])
            if key in seen_inputs:
                raise ValueError("Duplicate input (including normalized duplicates)")
            seen_inputs[key] = split
            for value, seen in (
                (row["entity_id"], seen_entities),
                (canonical(target), seen_targets),
            ):
                if value in seen and seen[value] != split:
                    raise ValueError("Cross-split entity or answer leakage")
                seen[value] = split


def prepare(directory, train=512, validation=64, test=128, seed=42):
    sizes = dict(zip(SPLITS, (train, validation, test), strict=True))
    if any(n < 2 or n % 2 for n in sizes.values()):
        raise ValueError("Split sizes must be positive even numbers, at least two")
    rng = random.Random(seed)
    entities = list(range(sum(sizes.values()) // 2))
    rng.shuffle(entities)
    splits, offset = {}, 0
    for split, size in sizes.items():
        rows = []
        for entity in entities[offset : offset + size // 2]:
            # All values are fabricated. No real source records or identifiers are used.
            target = {
                "name": f"Fiction-{rng.randrange(10000):04d}",
                "member_id": f"SYN-{entity:05d}",
                "region": rng.choice(("north", "south", "east", "west")),
                "status": rng.choice(("active", "pending", "closed")),
            }
            missing = rng.random() < 0.2
            if missing:
                target["region"] = None
            for variant, template_index in enumerate(rng.sample(range(len(TEMPLATES)), 2)):
                values = {k: (v if v is not None else "not provided") for k, v in target.items()}
                text = TEMPLATES[template_index].format(**values)
                if variant:
                    text += "\nClerk note: unrelated order REF-999 is pending. Ignore this order."
                rows.append(
                    {
                        "id": f"{entity}-{variant}",
                        "entity_id": str(entity),
                        "input": text,
                        "target": target,
                        "template": template_index,
                    }
                )
        rng.shuffle(rows)
        splits[split] = rows
        offset += size // 2
    audit(splits)
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    for split, rows in splits.items():
        (directory / f"{split}.jsonl").write_text("".join(canonical(row) + "\n" for row in rows))
    manifest = {
        "generator_version": 1,
        "seed": seed,
        "license": "CC0-1.0",
        "counts": sizes,
        "entity_variants": 2,
        "sha256": {s: sha256(directory / f"{s}.jsonl") for s in SPLITS},
    }
    (directory / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return manifest


def load_splits(directory):
    from datasets import load_dataset

    directory = Path(directory)
    manifest = json.loads((directory / "manifest.json").read_text())
    for split in SPLITS:
        if sha256(directory / f"{split}.jsonl") != manifest["sha256"][split]:
            raise ValueError(f"Data hash mismatch: {split}")
    dataset = load_dataset("json", data_files={s: str(directory / f"{s}.jsonl") for s in SPLITS})
    if {s: len(dataset[s]) for s in SPLITS} != manifest["counts"]:
        raise ValueError("Data count mismatch")
    audit(dataset)
    return dataset, manifest
