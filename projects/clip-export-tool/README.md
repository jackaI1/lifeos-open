# clip-export-tool

I built a clip export tool to learn how the underlying idea works. This is a learning project.

The walkthroughs use practice clips and captions; the test fixtures exercise the export steps.

## Setup

I use Python 3.9 or newer and FFmpeg, the free program that reads, edits and writes video. FFmpeg needs its `subtitles` filter, provided by libass, to draw captions. There are no Python dependencies for running the tool or its tests. Run commands from this repository's folder.

On macOS with Homebrew:

```sh
brew install python ffmpeg-full
export FFMPEG="$(brew --prefix ffmpeg-full)/bin/ffmpeg"
export FFPROBE="$(brew --prefix ffmpeg-full)/bin/ffprobe"
```

On Ubuntu or Debian:

```sh
sudo apt-get update
sudo apt-get install python3 ffmpeg fonts-dejavu-core
```

`FFMPEG` and `FFPROBE` can point to other installed builds. `ffprobe` is FFmpeg's companion for reading a video's size, length and audio information. If caption support is missing, the tool stops with a setup hint. Optionally, `python3 -m pip install .` installs the equivalent `clip-export` command.

## Choose the moments and captions

My edit list is a JSON file, a small text file of named entries. Times are seconds from the start of the source recording; the end is excluded. Names use letters, numbers, underscores and hyphens, and must be unique within one list.

```json
[
  {"name": "storm-overview", "start": 0.5, "end": 3.5, "tags": ["storm", "overview"]},
  {"name": "rainfall-slice", "start": 5, "end": 8, "tags": ["storm", "rainfall"]}
]
```

Captions use SRT, a text format with a number, a time interval and words to show:

```srt
1
00:00:00,000 --> 00:00:02,000
Typhoon Trami from above
```

I time captions against the **original source**, not each exported clip. The tool trims captions at cut boundaries and shifts them to the new clip's start. It burns the words into the picture, so they remain visible in any video player. Leave out `--captions` for a clean export.

Each moment produces these versions:

| Version | Pixels | Shape |
| --- | --- | --- |
| `vertical` | 1080 × 1920 | 9:16 |
| `square` | 1080 × 1080 | 1:1 |
| `widescreen` | 1920 × 1080 | 16:9 |

For just one shape, add `--formats square`. To fill the frame by cutting away the outer edges, add `--fit crop`. The default `--fit pad` preserves the whole frame. Both keep the picture's proportions, including footage stored with non-square pixels.

## Find footage and make a rough cut

I import names, source timestamps, caption paths and tags into SQLite, a database stored in a single local file. Importing the same source and clip name again updates that entry and keeps its ID.

```sh
python3 -m clip_export catalogue import examples/trami.mp4 examples/edits.json \
  --captions examples/captions.srt --db exports/footage.sqlite
python3 -m clip_export catalogue search --db exports/footage.sqlite --tag storm
python3 -m clip_export catalogue search --db exports/footage.sqlite --query rainfall
```

Search returns JSON with each clip's ID, name, source path, start, end and tags. Text searches match part of a name or tag; `--tag` matches a whole tag. Both ignore letter case for ordinary English text. Combine them to narrow the results.

In a new example database the IDs are 1 and 2. I can put the rainfall clip first and the overview second:

```sh
python3 -m clip_export rough-cut --db exports/footage.sqlite --ids 2 1 \
  --format square --output exports/rough-cut.mp4
```

Use the IDs returned by your own search. I can import several recordings into the same database and mix their clips. The result follows the ID order I give it, with captions and audio carried into the assembled video. Keep source files and caption files in place: the catalogue records absolute paths, not copies of the footage. I keep databases and exports out of Git because they can contain private paths or footage.

## Output and limits

I export MP4 files using H.264 video at 30 frames per second and AAC stereo audio at 48 kHz. Audio gets two-pass loudness normalisation: FFmpeg measures each cut first, then adjusts it toward −16 LUFS, a measure of perceived volume, with a −1.5 dB true-peak target to leave room below clipping. Silent footage gets a silent audio track so it can join other clips. Audio too short or silent to measure keeps its level; silence stays silent. Short audio tracks are padded with silence to cover the cut.

This is a repeatable cutting and export workflow. I still choose the cut points and write the captions myself. Cropping is centred and can remove an off-centre subject. Rough cuts use straight cuts, with no transitions or multitrack timeline, and AAC audio can add a small amount of padding at joins. Loudness normalisation cannot repair distorted recordings. The sample has a deliberately quiet generated tone, rather than original recorded audio; its [source, credit and reproduction command](examples/ATTRIBUTION.md) are included.

## Tests and limits

There are 4 test source files in this copy. That source count does not establish an execution result. This is a source snapshot, and running it on a new machine may need environment-specific setup.



The relocated workflow did not complete successfully within the migration batch. Local test sources remain available.

No project-specific GitHub Actions workflow was retained. The local test sources remain in this folder.
