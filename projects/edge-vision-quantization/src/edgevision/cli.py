"""Small commands that keep the full experiment inspectable and repeatable."""

import argparse
import ast
import json
from pathlib import Path

from .data import load_manifest, prepare, preprocess


def main():
    parser = argparse.ArgumentParser(description="Train and compare a PPE detector on edge CPUs")
    commands = parser.add_subparsers(dest="command", required=True)
    prep = commands.add_parser("prepare")
    prep.add_argument("--output", default="data")
    prep.add_argument("--archive")
    prep.add_argument("--seed", type=int, default=42)
    prep.add_argument("--calibration-count", type=int, default=64)
    train = commands.add_parser("train")
    train.add_argument("--data", required=True)
    train.add_argument("--output", default="artifacts")
    train.add_argument("--epochs", type=int, default=10)
    train.add_argument("--size", type=int, default=320)
    train.add_argument("--seed", type=int, default=42)
    train.add_argument("--device", default="cpu")
    export = commands.add_parser("export")
    export.add_argument("--checkpoint", required=True)
    export.add_argument("--output", default="artifacts/fp32.onnx")
    export.add_argument("--size", type=int, default=320)
    export.add_argument("--data", required=True, help="Use a calibration image for export parity")
    quant = commands.add_parser("quantize")
    quant.add_argument("--data", required=True)
    quant.add_argument("--fp32", default="artifacts/fp32.onnx")
    quant.add_argument("--output", default="artifacts/int8.onnx")
    bench = commands.add_parser("benchmark")
    bench.add_argument("--data", required=True)
    bench.add_argument("--fp32", default="artifacts/fp32.onnx")
    bench.add_argument("--int8", default="artifacts/int8.onnx")
    bench.add_argument("--output", default="artifacts/benchmark.json")
    bench.add_argument("--warmup", type=int, default=10)
    bench.add_argument("--repeats", type=int, default=200)
    bench.add_argument("--threads", type=int, default=1)
    bench.add_argument("--provider", choices=["cpu", "auto", "tensorrt"], default="cpu")
    predict = commands.add_parser("predict")
    predict.add_argument("--model", default="artifacts/int8.onnx")
    predict.add_argument("--image", required=True)
    predict.add_argument(
        "--data", help="Optional dataset manifest to override embedded class names"
    )
    predict.add_argument("--provider", choices=["cpu", "auto", "tensorrt"], default="auto")
    predict.add_argument("--confidence", type=float, default=0.25)
    predict.add_argument("--output", default="artifacts/prediction.jpg")
    args = parser.parse_args()
    if args.command == "prepare":
        print(prepare(args.output, args.archive, args.seed, args.calibration_count))
    elif args.command == "train":
        from .pipeline import train

        print(train(args.data, args.output, args.epochs, args.size, args.seed, args.device))
    elif args.command == "export":
        from .pipeline import check_export, export_model

        manifest = load_manifest(args.data)
        result = export_model(args.checkpoint, args.output, args.size)
        sample = preprocess(Path(args.data) / manifest["calibration"][0]["image"], args.size)[0]
        error = check_export(args.checkpoint, result, sample)
        Path(args.output).with_suffix(".parity.json").write_text(
            json.dumps({"max_absolute_error": error, "rtol": 0.001, "atol": 0.001}) + "\n"
        )
        print(f"{result}: max PyTorch/ONNX error {error:.6g}")
    elif args.command == "quantize":
        from .pipeline import quantize_dataset

        print(quantize_dataset(args.data, args.fp32, args.output))
    elif args.command == "benchmark":
        from .benchmark import benchmark

        report = benchmark(
            args.data,
            args.fp32,
            args.int8,
            args.output,
            args.warmup,
            args.repeats,
            args.threads,
            args.provider,
        )
        print(
            json.dumps(
                {k: report[k] for k in ("speedup", "size_reduction_percent", "map50_95_change")},
                indent=2,
            )
        )
    else:
        from .benchmark import decode
        from .runtime import session

        runtime = session(args.model, args.provider)
        if args.data:
            names = json.loads((Path(args.data) / "manifest.json").read_text())["names"]
        else:
            names = ast.literal_eval(runtime.get_modelmeta().custom_metadata_map["names"])
        if isinstance(names, dict):
            names = [names[i] for i in range(len(names))]
        tensor, geometry = preprocess(args.image, runtime.get_inputs()[0].shape[2])
        detections = decode(
            runtime.run(None, {"images": tensor})[0],
            geometry,
            len(names),
            args.confidence,
        )
        for detection in detections:
            detection["class"] = names[detection["category_id"]]
        from PIL import Image, ImageDraw, ImageFont

        image = Image.open(args.image).convert("RGB")
        draw = ImageDraw.Draw(image)
        font = ImageFont.load_default(size=max(12, image.width // 100))
        for detection in detections:
            x, y, w, h = detection["bbox"]
            draw.rectangle((x, y, x + w, y + h), outline="lime", width=2)
            draw.text(
                (x, max(0, y - 12)),
                f"{detection['class']} {detection['score']:.2f}",
                fill="lime",
                font=font,
                stroke_width=1,
                stroke_fill="black",
            )
        Path(args.output).parent.mkdir(parents=True, exist_ok=True)
        image.save(args.output)
        print(
            json.dumps(
                {
                    "providers": runtime.get_providers(),
                    "detections": detections,
                    "output": args.output,
                },
                indent=2,
            )
        )


if __name__ == "__main__":
    main()
