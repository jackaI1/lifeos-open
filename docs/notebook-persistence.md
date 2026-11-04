# Keeping lecture notes together

Lecture slides, handwriting and audio share a notebook timeline. Opening a
notebook while a route changes must not create a second slide dock. Concurrent
mount requests share the pending mount; an older route's teardown cannot remove
the dock used by the current route. Slides created after suspension start hidden
and remain hidden until the notebook is active again.

The [lecture lifecycle tests](../test/e2e/26-slide-session-race.spec.mjs) exercise
navigation and restoration. The [local reference](local-workspace.md#testing)
explains how to run browser checks with fictional notes and recordings.
