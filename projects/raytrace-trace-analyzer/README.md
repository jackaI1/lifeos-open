# raytrace-trace-analyzer

I built a small image renderer and frame comparison tool to learn how the underlying idea works. This is a learning project.

## Run the example

I use a C++17 compiler, Python 3.10 or newer, CMake and zlib (the PNG compression library). On macOS I install the command-line compiler with `xcode-select --install` and zlib with `brew install zlib`. On Ubuntu, `sudo apt-get install build-essential zlib1g-dev python3-venv` supplies the system dependencies.

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install cmake -r requirements.txt
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release -DPython3_EXECUTABLE="$(which python)"
cmake --build build --parallel 2
python -m tools.demo
```

Open `runs/demo/report.md` to read the results. Its accompanying SVG file is the timing plot. `runs/demo/bvh/frame_0000.png` is the first rendered picture, and `runs/demo/shadow-diff.png` marks the pixels affected by switching shadows off in magenta. I keep a [sample report](docs/example/report.md) and its [input traces](docs/example/) in this repository so the output is visible before installing anything.

The demo compares all six optimized frames with the reference images, then treats the slower reference run as a candidate change to show what a regression alert looks like. In my checked-in run at 320 × 180 pixels, all six pairs were pixel-identical. The optimized run performed 2,175,225 object tests versus 110,962,069 for the reference, about 51 times fewer. Turning shadows off changed 1,367 pixels in the first frame. Timing measurements vary with the computer and background load.

## Compare my own runs

```sh
# Output directories must be new, so I cannot accidentally replace an earlier run.
./build/raytrace --output runs/before --width 320 --height 180 --frames 6
./build/raytrace --output runs/after --width 320 --height 180 --frames 6
python -m tools.analyze runs/after/trace.json --baseline runs/before/trace.json \
  --output runs/comparison.md --budget-ms 16.67 --regression-pct 10 --min-delta-ms 1
python -m tools.render_diff runs/before/frame_0000.png runs/after/frame_0000.png \
  --output runs/diff.png --threshold 0
```

The analyzer flags render times above the frame budget. A regression must exceed both the percentage increase and the minimum extra milliseconds, so tiny fluctuations do not trigger an alert. It matches frame IDs and rejects different scenes, dimensions or sets of frames. Without `--baseline`, it just checks the frame budget. The image tool reports changed-pixel count, mean absolute channel error and the largest channel error. `--threshold 10` ignores channel changes of 10 or less when highlighting pixels; error measurements still include them.

Both tools exit with `0` for no alerts, `1` for detected differences or timing alerts, and `2` for invalid input. An alert still writes the report or image. `--brute-force` selects the reference renderer, and `--no-shadows` provides a deliberate visual change to inspect. `./build/raytrace --help` lists the renderer's options.

## How I built it

I wrote the renderer in C++. Each camera ray finds the nearest sphere or triangle. Phong shading combines a small amount of ambient light, light facing the surface and a shiny highlight. A second ray checks whether another object blocks the light, producing hard shadows.

A bounding volume hierarchy (BVH) is a tree of boxes around groups of objects. If a ray misses a box, I skip all the objects inside it. I split each group at its midpoint along its longest axis and stop at four objects per leaf. The brute-force path checks every object and gives me a simple correctness reference. Both paths use the same intersection and shading code.

Every frame writes one JSON record with scene/tree construction time, rendering time, PNG encoding/write time, total time, primary and shadow ray counts, object tests and box tests. The Python analyzer produces a Markdown table, median and p95 timings, regression details and a plot. [Design notes](docs/design.md) explain the trace format and comparison rules. I used the [PBRT chapter on bounding volume hierarchies](https://pbr-book.org/4ed/Primitives_and_Intersection_Acceleration/Bounding_Volume_Hierarchies) as background for the tree structure.

My current scene is built into the program and animated deterministically by frame ID. This is a single-threaded CPU renderer with one sample per pixel, hard shadows and local lighting. It does not load arbitrary models, simulate reflected light or smooth jagged edges. Timing comparisons are per frame, so I repeat Release runs before judging a small performance change.

## Tests and limits

There are 3 test source files in this copy. No test pass count is claimed here: I have not re-run the project suite as part of this move. This is a source snapshot, and running it on a new machine may need environment-specific setup.


Project checks run from this directory through the path-filtered hub workflows: `raytrace-trace-analyzer-ci.yml`.
