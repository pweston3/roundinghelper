# Rounding Helper

Free step-by-step rounding practice for roughly grades 4–5, at
[roundinghelper.com](https://roundinghelper.com).

Students round whole numbers up to 1,000,000 and decimals to the hundredth,
one step at a time: find the place, name the two round numbers it falls
between, find the digit that decides, then pick the closer neighbor. The
number line stays hidden until the reasoning starts, so the answer can't be
read off the screen.

Grown-ups get three extra tools behind one door: an explore mode for a
projector, a printable worksheet generator with a separate answer key, and
toggles for how much scaffolding each question gives.

Aligned to **4.NBT.A.3** (round multi-digit whole numbers to any place) and
**5.NBT.A.4** (round decimals to any place).

## Running it

Open `index.html` in a browser. That's the whole app — one self-contained
file, no build step, no dependencies, no backend.

## Testing

There is no test framework. `test/dom-test.js` drives the real DOM headlessly
and checks the things most likely to break: that every level's instruction
text names the digit the app actually accepts, that a generated worksheet's
answer key matches independently computed half-up rounding, that no problem
repeats across a sheet, that all four combinations of the scaffolding toggles
complete a question, and that the page makes no external requests.

```bash
npm install jsdom
node test/dom-test.js
```

## Privacy

No ads, no accounts, no analytics, and zero external requests at runtime.
The typeface is embedded in the file rather than loaded from a font CDN.
Progress is kept in `localStorage` in one browser and never leaves the
device. The site is directed at children under 13, so nothing third-party
is allowed to load through it.

## Contributing

`CLAUDE.md` documents the architecture, the hard constraints, the reasoning
behind the teaching sequence, and the bugs already fixed. Read it before
changing anything.

## License

The app is released under the MIT License (`LICENSE`). The embedded Outfit
typeface is licensed separately under the SIL Open Font License 1.1
(`OFL.txt`).
