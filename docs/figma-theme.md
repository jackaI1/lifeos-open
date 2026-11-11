# Figma theme import

`tools/figma-theme.mjs` reads three colour styles from a Figma file and prints
a LifeOS custom theme. It does not change the running app; you paste the
colours into Settings yourself.

## Set up the Figma file (about 2 minutes)

1. In Figma, make three **Fill** styles with these exact names:
   `Theme/Primary`, `Theme/Display` and `Theme/Chassis`.
   Each one needs a shape that uses it, so it appears in the file.
   Use fully opaque solid colours.
2. Copy the file key from the file's address. In
   `figma.com/design/<key>/Name`, the key is the part after `/design/`.
3. For a live fetch, create a personal access token in Figma under
   Settings, Security. Keep it in your shell only, never in a committed file:
   `export FIGMA_TOKEN=...`

## Use it

Live file:

    FIGMA_TOKEN=... npm run theme:figma -- --key <file key> --name "My theme"

Saved file (for example a JSON export you downloaded yourself):

    npm run theme:figma -- --file design.json --name "My theme" --out theme.json

Options: `--base` picks the theme the custom one starts from (`midnight` by
default; any id from `public/themes.js`).

The output has `base`, `name`, `primary`, `display` and `chassis`. It is
checked with the same validator Settings uses, so a bad colour fails here.

## Apply it in LifeOS

Open Settings, choose **Theme**, press **Customize**, enter the name and the
three hex colours from the output, then **Save theme**.

## Limits

- Only Fill styles with solid colours are read. Gradients, images and
  transparent fills stop the import with a message.
- Figma's API is rate-limited; a saved file works offline.
- The tests use `test/fixtures/figma-theme-file.json`, a made-up file in
  Figma's file format. They do not contact Figma.
