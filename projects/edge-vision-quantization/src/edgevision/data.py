"""Public dataset provenance and content-disjoint, reproducible splits."""

import hashlib
import json
import random
import urllib.request
import zipfile
from pathlib import Path

import numpy as np
import yaml
from PIL import Image

DATA_URL = "https://github.com/ultralytics/assets/releases/download/v0.0.0/construction-ppe.zip"
# The prepare command requires this exact archive, not a mutable auto-download.
DATA_SHA256 = "e5817aa9c73f33e525d76ca6bc6af4e4eac9dcea9bcfef1cfd1a71c09fbc1232"


def file_hash(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def pixel_hash(path):
    with Image.open(path) as image:
        rgb = image.convert("RGB")
        digest = hashlib.sha256(str(rgb.size).encode())
        digest.update(rgb.tobytes())
        return digest.hexdigest()


def make_manifest(root, names, seed=42, calibration_count=64):
    root = Path(root)
    seen = set()

    def records(split):
        rows = []
        for image in sorted((root / "images" / split).glob("*")):
            if image.suffix.lower() not in {".jpg", ".jpeg", ".png"}:
                continue
            digest = file_hash(image)
            pixels = pixel_hash(image)
            # Official validation takes precedence over duplicate training images.
            if pixels in seen:
                continue
            seen.add(pixels)
            label = root / "labels" / split / (image.stem + ".txt")
            rows.append(
                {
                    "image": image.relative_to(root).as_posix(),
                    "label": label.relative_to(root).as_posix(),
                    "sha256": digest,
                    "pixel_sha256": pixels,
                    "label_sha256": file_hash(label),
                }
            )
        return rows

    validation = records("val")
    train = records("train")
    if not 0 < calibration_count < len(train):
        raise ValueError("calibration_count must leave at least one training image")
    random.Random(seed).shuffle(train)
    return {
        "seed": seed,
        "names": names,
        "source_url": DATA_URL,
        "archive_sha256": DATA_SHA256,
        "train": train[calibration_count:],
        "calibration": train[:calibration_count],
        "validation": validation,
    }


def validate_manifest(manifest, root):
    seen = set()
    seen_pixels = set()
    for split in ("train", "calibration", "validation"):
        for row in manifest[split]:
            if row["sha256"] in seen:
                raise ValueError("content overlap between dataset records")
            seen.add(row["sha256"])
            for field, hash_field in [("image", "sha256"), ("label", "label_sha256")]:
                path = (Path(root) / row[field]).resolve()
                if not path.is_relative_to(Path(root).resolve()):
                    raise ValueError("manifest path escapes dataset root")
                if file_hash(path) != row[hash_field]:
                    raise ValueError(f"changed {field}: {row[field]}")
            pixels = pixel_hash(Path(root) / row["image"])
            if pixels in seen_pixels:
                raise ValueError("pixel content overlap between dataset records")
            seen_pixels.add(pixels)
            if "pixel_sha256" in row and pixels != row["pixel_sha256"]:
                raise ValueError(f"changed pixels: {row['image']}")


def load_manifest(root):
    manifest = json.loads((Path(root) / "manifest.json").read_text())
    validate_manifest(manifest, root)
    return manifest


def prepare(output, archive=None, seed=42, calibration_count=64):
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    archive = Path(archive) if archive else output / "construction-ppe.zip"
    if not archive.exists():
        urllib.request.urlretrieve(DATA_URL, archive)
    if file_hash(archive) != DATA_SHA256:
        raise ValueError("archive checksum mismatch; refusing a changed dataset release")
    with zipfile.ZipFile(archive) as source:
        for member in source.infolist():
            if not (output / member.filename).resolve().is_relative_to(output.resolve()):
                raise ValueError("unsafe archive path")
        source.extractall(output)
    candidates = list(output.rglob("images/train"))
    if len(candidates) != 1:
        raise ValueError("expected one dataset root")
    root = candidates[0].parent.parent
    config = root / "data.yaml"
    names = yaml.safe_load(config.read_text())["names"]
    if isinstance(names, dict):
        names = [names[i] for i in range(len(names))]
    manifest = make_manifest(root, names, seed, calibration_count)
    validate_manifest(manifest, root)
    (root / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    write_training_config(root, manifest)
    return root


def write_training_config(root, manifest):
    """Regenerate train-only paths from verified records, never stale user config."""
    root = Path(root)
    train_file = root / "train.txt"
    train_file.write_text(
        "".join(str((root / r["image"]).resolve()) + "\n" for r in manifest["train"])
    )
    config = root / "experiment.yaml"
    config.write_text(
        yaml.safe_dump(
            {
                "path": str(root.resolve()),
                "train": str(train_file.resolve()),
                "val": str(train_file.resolve()),
                "names": manifest["names"],
            }
        )
    )
    return config


def preprocess(image, size):
    """Square letterbox shared by calibration, evaluation and image prediction."""
    image = Image.open(image).convert("RGB")
    w, h = image.size
    scale = min(size / w, size / h)
    nw, nh = round(w * scale), round(h * scale)
    left, top = (size - nw) // 2, (size - nh) // 2
    canvas = Image.new("RGB", (size, size), (114, 114, 114))
    canvas.paste(image.resize((nw, nh), Image.Resampling.BILINEAR), (left, top))
    tensor = np.asarray(canvas).transpose(2, 0, 1)[None].astype(np.float32) / 255
    return np.ascontiguousarray(tensor), (w, h, nw / w, nh / h, left, top)
