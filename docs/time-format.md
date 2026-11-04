# Time display

Settings has a time-format choice alongside the theme. It defaults to 24-hour
time and is saved in workspace preferences, with a local display cache so it is
available during startup. The shared clock formatter covers wall times and
timestamp displays. Stored dates, API values, calendar calculations, elapsed
durations and native time inputs keep their existing formats.

Custom clock entry accepts either 24-hour or AM/PM text. No data migration is
needed. Tests cover saving the preference, reloading it, native input values
and keyboard use. See [the local reference](local-workspace.md#testing) to run them.
