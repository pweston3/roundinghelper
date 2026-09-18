# Rounding Helper — project context

Free rounding practice for roughly grades 4–5, at roundinghelper.com.
Built for one 4th grader who was rounding every problem to the nearest
thousand regardless of what the question asked, then generalized for other
parents and teachers.

## Architecture

One self-contained `index.html`. No build step, no framework, no dependencies,
no backend, no network requests at runtime. Vanilla JS in a single IIFE, CSS in
one `<style>` block, the typeface embedded as a base64 WOFF2 data URI.

Deployed on GitHub Pages. Editing means editing `index.html` and pushing.

## Hard constraints — do not break these

- **Zero external requests.** No CDNs, no Google Fonts, no analytics. The app
  tells parents "Nothing collected," and the site is directed at children under
  13, where COPPA covers what third parties collect through the site, not just
  what the site collects. Any script you add makes that badge a false claim.
- **Whole-number levels cap at 1,000,000.** Grade 4 expectations for this domain
  (CCSS 4.NBT.A.3) are limited to whole numbers at or below one million. The
  `hundred thousand` entry in `PLACES` is pinned to 6 digits for this reason.
- **All rounding math runs on scaled integers**, never floats. Each place in
  `PLACES` carries a `scale`; a displayed value is `units / scale`. This is why
  decimals don't produce 0.30000000000000004. Keep new work in integer units.
- **Progress lives in `localStorage` under `rounding-v2`.** No accounts, no
  server. A separate frozen v1 build uses `rounding-v1` — don't reuse that key.

## The teaching sequence — the order is the product

Four steps per question, in this order:

1. Tap the digit in the named place → underlined teal
2. Name the two round numbers it falls between → number line appears
3. Tap the digit immediately right of it, the "decider" → boxed pink
4. Choose which neighbor it's closer to

Why it's ordered this way:

- Step 1 exists because finding the place is the actual failure mode. Most
  rounding tools hand the place to the student already highlighted.
- The number line stays hidden until step 2 so the answer can't be read off
  the screen before the reasoning happens.
- The decider (step 3) sits immediately before the judgment it informs. It was
  originally at step 2 and that was wrong: the pink box shouted while the
  question asked about a different digit.
- Only one digit is marked up at a time. Visual emphasis must always match the
  question currently being asked.

## Copy rules

- Written for a 9-year-old. Short sentences, no em-dash clauses, "less than 5"
  rather than "under 5."
- Say "went up" and "stayed," never "round up" and "round down." Rounding up
  changes the digit and rounding down doesn't, and students change it anyway.
- Never imply the answer ends at the underlined digit. It doesn't — the digits
  after it become zeros, and that's precisely the mistake being corrected.
- The product name appears only in the nav, the page title, and the printed
  worksheet. It stays off the kid's practice screen.

## Gotchas already fixed — don't regress them

- **Printing** must open a standalone document in a new window. `window.print()`
  from inside an embedded frame is blocked or prints the wrong page.
- **Number-line labels** are measured after render and pinned so wide values
  like 1,350,000 don't overhang the card. Percent positioning alone overflows.
- **The marker** gets an `instant` class on each new question so it doesn't
  slide across from the previous answer's position.
- **Worksheet problems** are deduplicated across the whole sheet, not per
  section. The tens pool is small enough that repeats were likely otherwise.
- **`digitName` vs `name`** in `PLACES`: `name` is the place being rounded to
  ("hundred thousand"), `digitName` is the digit the student taps ("hundred
  thousands"). Getting these out of sync once made the app contradict itself.

## Testing

No test framework. Verify changes by driving the real DOM headlessly:

```bash
npm install jsdom
node -e "const {JSDOM}=require('jsdom'); /* load index.html, click through */"
```

Worth asserting after any change to question generation or the step flow:

- every level's instruction text matches the digit the app actually accepts
- a full worksheet's answer key matches independently computed half-up rounding
- all four combinations of the two scaffolding toggles complete a question
- no duplicate problems across a generated sheet

When patching the file programmatically, verify every anchor string matches
exactly once before writing. Replacing an empty string inserts text between
every character in the file.

## Accessibility and audience notes

Touch targets are 44px minimum, and digits are 46×62 — NN/g recommends 2cm
targets for young children versus 1cm for adults, and 9–12 year olds sit
between. Motion is wrapped in `prefers-reduced-motion`. Sound is off by
default. Parent and teacher tools live behind one "For grown-ups" door rather
than in the child's navigation.

## Open items

- Verify the embedded font renders (headless testing can't check this)
- Decide whether the kid-facing title stays "Rounding Helper"
- Consider a favicon and an og:image for link previews
