# Rendering and measurement design

I wanted a reference path I could trust while changing how rays find objects. Both traversal paths share geometry and shading, but only the BVH traverses bounding boxes. The fixed scene contains 188 spheres (including one moving sphere) and five triangles. Geometry is regenerated each frame so build time includes scene construction and, in optimized mode, tree construction.

## Files and ownership

- `src/geometry.hpp`: vector math, sphere roots, two-sided Möller-Trumbore triangle intersection, slab boxes, closest-hit brute force and median-split BVH. The BVH borrows an immutable scene which must outlive it.
- `src/main.cpp`: deterministic scene, camera, Phong shading, bounded shadow rays, CLI and trace writer.
- `src/png.hpp`: RGB PNG chunks, zlib compression, checksums and checked file writes. Pillow independently decodes these files in tests.
- `tools/analyze.py`: trace validation, frame alignment, alert thresholds and Markdown/SVG reports.
- `tools/render_diff.py`: RGB pixel comparison, error metrics and magenta overlay.
- `tools/demo.py`: repeatable reference/optimized comparison and a deliberate missing-shadow example.

A BVH leaf holds at most four primitive indices. Internal nodes split the longest bounds axis at the median centroid. This is simpler to inspect than a surface-area cost heuristic, though it can visit more boxes. Exact distance ties select the lower original primitive ID in both traversal modes. Parallel slab directions are handled explicitly to avoid boundary NaNs. Triangle bounds may have zero thickness; slab equality remains a hit.

I offset shadow-ray origins by 0.0002 scene units and stop before the light. The fixed scene is roughly tens of units across; this constant is appropriate here but would need reconsidering for models at other scales. Shadow queries use closest-hit traversal, leaving early-out occlusion as a future optimization. The view is perspective, RGB output uses square-root gamma approximation, and Phong has an exponent of 48. Lighting is illustrative rather than physically calibrated.

## Trace schema, version 1

```json
{
  "schema_version": 1,
  "scene": "sphere-grid-v1/shadows",
  "width": 320,
  "height": 180,
  "mode": "bvh",
  "frames": [{
    "frame": 0,
    "build_ms": 0.1,
    "render_ms": 8.0,
    "encode_ms": 0.9,
    "total_ms": 9.0,
    "primary_rays": 57600,
    "shadow_rays": 38230,
    "primitive_tests": 360000,
    "box_tests": 1900000
  }]
}
```

The numbers above illustrate the format; actual measurements are in [example/bvh.json](example/bvh.json). All timing values are finite, nonnegative milliseconds measured with a monotonic clock. `encode_ms` includes compression and file writing, and `total_ms` covers build, render and encode, excluding trace serialization. `primitive_tests` counts attempted sphere/triangle intersections, and `box_tests` counts visited box tests. Counters reset every frame. One primary ray is sent per pixel; shadow rays are sent for lit-facing surface hits when shadows are enabled.

The scene identifier versions geometry, camera, shading and animation together, and includes shadow configuration. I must increment it when any of these change. `mode` is informational and intentionally allowed to differ when comparing the two traversal paths. Frame ID, scene ID and image dimensions identify the workload; different frame sets or scene settings are rejected rather than silently paired by row order.

Only `render_ms` triggers timing alerts. I report build and encoding separately so filesystem work does not look like slower intersections. Slow means strictly above the budget. Regression means strictly above both the relative and absolute limits. A positive increase from zero baseline time uses the absolute limit and is labelled "zero baseline". p95 uses nearest rank, which is the maximum for short sequences. I do not claim statistical significance from one run.

The image tool compares decoded 8-bit RGB channels. It marks a pixel when any channel's absolute difference exceeds the threshold; MAE averages all channels, including differences below that threshold. The overlay dims unchanged pixels and paints changed ones magenta. Equal dimensions are mandatory. This tool is for the renderer's opaque RGB output, not alpha compositing or perceptual similarity.

## Reproducing the checked-in example

Run the README setup and `python -m tools.demo --output runs/new-example`. The sample uses six frames at 320 × 180, single-threaded Release mode on an Apple Silicon Mac. `example/report.md` treats brute force as current and the BVH as baseline, intentionally demonstrating regressions with real measurements. Its source traces and first-frame images are checked in. The demo's per-frame exact pixel comparisons all passed; disabling shadows changed 1,367 of 57,600 pixels. Primitive-test counts are deterministic for this scene, while times depend on hardware.

The renderer refuses existing output directories. The analyzer also refuses to overwrite its input traces with its report or plot; the image tool protects its input files. Ordinary reports may be regenerated in place. No tool starts a server or leaves a background worker running.
