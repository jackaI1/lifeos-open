"""Local CPU inference. No audio or transcript is sent to a hosted service."""
import argparse
import json
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest")
    parser.add_argument("--output")
    parser.add_argument("--model", default="base.en")
    parser.add_argument("--language", default="en")
    parser.add_argument("--download", action="store_true")
    parser.add_argument("--download-only", action="store_true")
    args = parser.parse_args()
    from faster_whisper import WhisperModel

    # Model download is an explicit setup step; normal jobs work offline.
    model = WhisperModel(args.model, device="cpu", compute_type="int8",
                         cpu_threads=2, num_workers=1,
                         local_files_only=not (args.download or args.download_only))
    if args.download_only:
        return
    if not args.manifest or not args.output:
        parser.error("--manifest and --output are required for transcription")
    manifest = json.loads(Path(args.manifest).read_text())
    if not isinstance(manifest, list) or not 1 <= len(manifest) <= 500:
        raise ValueError("Expected 1–500 audio paths")
    output = []
    for audio in manifest:
        segments, info = model.transcribe(audio, language=args.language,
                                          beam_size=5, temperature=0,
                                          condition_on_previous_text=False,
                                          vad_filter=True)
        output.append({"duration": info.duration, "segments": [
            {"start": s.start, "end": s.end, "text": s.text}
            for s in segments]})
    Path(args.output).write_text(json.dumps(output, ensure_ascii=False))


if __name__ == "__main__":
    main()
