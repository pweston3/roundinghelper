# Rounding Helper — project context

Free rounding practice for roughly grades 4–5, at roundinghelper.com.
Built for one 4th grader who was rounding every problem to the nearest
thousand regardless of what the question asked, then generalized for other
parents and teachers.

## Architecture

One self-contained `index.html`. No build step, no framework, no dependencies,
no backend, no third-party requests ever. Vanilla JS in a single IIFE, CSS in
one `<style>` block, the typeface embedded as a base64 WOFF2 data URI.

Deployed on GitHub Pages. Editing means editing `index.html` and pushing.

Three other files sit alongside it, and a visitor's browser requests none of
them. `og.png` is the link-preview image, fetched only by a sharing platform's
crawler. `apple-touch-icon.png` is the iOS home-screen icon, fetched only
when someone adds the site to a home screen. `favicon.ico` exists for search
crawlers, which cannot read the inline data URI the browser uses. Their sources
are in `tools/`, each with regeneration instructions in a comment.

`sw.js` is the offline cache. It is the only same-origin request the page
makes beyond itself, and it sends nothing anywhere.

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
- **A first visit starts on the whole-number mix, not on tens.** `START_LEVEL`
  finds it by name so reordering `LEVELS` cannot point it elsewhere. A single
  place lets a kid answer without reading the question, which is the habit
  this app exists to break. The load path has to fall back to `START_LEVEL`
  for a save with no `level`: `s.level|0` turns a missing field into 0, which
  is tens.
- **Every level is pickable at any time.** There is no gating, no padlocks,
  no "5 correct to unlock the next one" and no unlock-all escape hatch. The
  chips are ordered so the progression is still visible; a kid who is already
  fluent at tens should not have to grind through them. Old saves may still
  carry `unlocked` and `correctHere` fields; they are ignored, not migrated.
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
- **The question sits next to the thing it asks about.** A digit question
  renders above the number line, directly under the digits. It used to render
  below the line, where the two nearest numbers on screen were the end labels,
  and a 4th grader tapped those instead. The line also dims while a digit is
  the question, so it stops competing for the tap.
- **No arrow pointing up at the digits.** There was one. Centered under the
  row, it lands under whichever digit happens to sit in the middle, so on
  4,245 it pointed straight at the hundreds digit and gave the answer away.
  Anything that singles out one digit before the kid has chosen is the bug,
  not the hint.
- **Steps do not vanish on a timer.** A "Keep going" button fills over
  `STEP_WAIT` and then advances, or the kid taps it and goes at once. The
  old bare 1.9s setTimeout gave no clue why the screen was about to change
  and no way to hurry it.

## The dot and the celebrations

The marker dot is the one bit of personality on the practice screen, and it
is personality through motion only: no face, no name, no mascot, which the
5th graders at the top of the range would read as babyish. It drops onto the
rail when the neighbors are named, breathes while the last question is open,
teeters when the number sits within 10% of halfway (a nudge to look closely,
not a tell), hops toward the winning neighbor on a correct answer and shakes
on a miss. It always returns to its true position; the gap bar shows the
real distance.

A correct answer also gets confetti from the dot (DOM spans, no canvas, no
images), a star that flies from the winning button to the tally, and a
headline drawn from `CHEERS` that never repeats twice running. Correct
answers in a row build `state.streak` (persisted in `rounding-v2`, reset by
a miss); at 3, 5, 7, 10, 15 and every ten after, the line names the streak,
the card pulses `--yes-soft` and the burst doubles. The explanation line
under the headline is untouched by any of this.

All of it sits inside `prefers-reduced-motion: no-preference`; `calm()` in
the script skips the confetti and the star flight when the OS asks for
reduced motion. Nothing here changes on a timer without a button first.

`state.streak` is saved on both edges. The increment is easy to remember and
the reset on a miss is easy to forget; without the save, a miss then a reload
restores the streak and a milestone can be reached without ever getting that
many right in a row.

An exact-halfway question prints its own headline and never calls
`cheerLine()`, so on a milestone that happens to land on a halfway number the
burst doubles and the card pulses but nothing says "Three in a row". The
teaching line wins, by design.

`test/motion-test.js` covers all of this in a real browser, since jsdom
cannot see an animation. `test/fold-test.js` is the other layout test, for the
same reason: jsdom reports every element as 0x0, so only a browser can say
whether the button is on screen.

## Copy rules

- Written for a 9-year-old. Short sentences, no em-dash clauses, "less than 5"
  rather than "under 5."
- **American spelling everywhere**, in the copy, the comments and the tests:
  practicing, neighbor, color, center. `test/site-test.js` checks the rendered
  text of every page. `OFL.txt` and `LICENSE` are verbatim legal texts and are
  left alone.
- **Never say "step-by-step" in the metadata.** In math search that phrase
  belongs to the answer engines, where it means "we show you the worked
  solution." Here the child performs the steps, so it advertised the opposite
  of what the app does and read like one more calculator. The description names
  the action instead: "Kids tap through each step on a number line."
  Deliberately not a "game" either. It is not one, a kid arriving expecting one
  meets a four-step teaching sequence, and the term is held by sites built on
  the characters and timers the dot was designed to avoid.
- **A link is an invitation, so don't phrase one as a failure.** The guide was
  linked as "The mistake most children make", which is a fine heading on the
  page and a poor thing to ask someone to click.
- Say "went up" and "stayed," never "round up" and "round down." Rounding up
  changes the digit and rounding down doesn't, and students change it anyway.
- Never imply the answer ends at the underlined digit. It doesn't — the digits
  after it become zeros, and that's precisely the mistake being corrected.
- The product name appears only in the nav, the page title, and the printed
  worksheet. It stays off the kid's practice screen.

## Gotchas already fixed — don't regress them

- **The JSON-LD may only claim what the page actually says.** The FAQ answers
  in the structured data are all text carried under "For parents and teachers",
  and the two CCSS standards are named in the page's own prose as well as in
  the markup. Marking up answers the page does not carry is a search guideline
  violation, not a shortcut. `test/dom-test.js` checks each answer against the
  hub's text, and that the block parses at all, since malformed JSON-LD fails
  silently.
- **Never use CSS multicolumn on the worksheet.** WebKit honors `columns` on
  screen and drops it once it paginates, so an iPhone showed two tidy columns
  in the preview and then printed one long column across two sheets. The
  problems and the answer key are built as real side-by-side lists instead.
  Chromium handles multicol in print, so no rendering check catches a
  regression to it: `test/print-test.js` asserts the stylesheet never asks for
  it, and that the markup carries real columns sitting side by side.
- **The worksheet preview is the page, not a reflow of it.** It renders at
  816px, a real US Letter at the 14mm `@page` margin, and is then scaled with
  a transform to fit whatever space it has. Laying it out at the container's
  width instead is what made the answer rules collapse to stubs on a phone.
  `SHEET_CSS` is one string used by both the preview and the print window, so
  they cannot drift apart; the preview also needs it injected into this
  document or it silently falls back to the app's own styling and stops being
  a preview.
- **The worksheet controls apply on change, and the button only reshuffles.**
  One button used to carry both jobs, apply my settings and give me different
  numbers, and a teacher could not tell which it did. A sheet is now built on
  arrival, every control rebuilds on change, and the button says "New
  numbers". `#pickall` sets the boxes in code, which fires no change event, so
  it has to call `buildSheet()` itself.
- **The default sheet has to fit one piece of paper.** Five whole-number
  places at six each is 30 problems, and it sat 146px over a page until the
  row and heading spacing was tightened. `test/print-test.js` measures the
  real height against the printable area and fails if it spills, because a
  teacher printing a class set should not get a second sheet holding four
  problems.
- **Printing** must open a standalone document in a new window. `window.print()`
  from inside an embedded frame is blocked or prints the wrong page.
- **Number-line labels** are measured after render and pinned so wide values
  like 1,350,000 don't overhang the card. Percent positioning alone overflows.
- **The marker** gets an `instant` class on each new question so it doesn't
  slide across from the previous answer's position.
- **Worksheet problems** are deduplicated across the whole sheet, not per
  section. The tens pool is small enough that repeats were likely otherwise.
- **The page fetch in `sw.js` must bypass the HTTP cache.** A plain `fetch()`
  consults it first, and GitHub Pages sends `max-age=600` on HTML, so
  network-first quietly stopped reaching the network for ten minutes at a
  time and re-cached the stale page it got back. `cache: "no-store"` is
  load-bearing. `test/sw-test.js` serves `max-age=600` for the same reason:
  with `no-cache` it could not see this happen, and once did not.
- **The service worker is network-first for the page, on purpose.** A cached
  build can therefore never stick, which is the usual way a service worker
  ruins a static site. Do not "optimize" it to cache-first. `test/sw-test.js`
  fails if you do: it deploys a new build and asserts the new one wins, both
  online and on the next offline load. Bump `VERSION` in `sw.js` when the
  precache list changes, so stale entries get evicted.
- **`og:image` must be an absolute URL to a real file.** Crawlers don't run
  JavaScript and won't follow a `data:` URI, so the favicon trick doesn't
  work for it. They also cache hard: change the picture and the old one
  keeps appearing until the `?v=` on the tag is bumped.
- **Tappable digits need a visible affordance, not a `:hover` rule.** The
  digits are chips with a background and border during a tap step. Hover does
  nothing on the tablets this actually runs on.
- **Clear the instruction once its step is answered.** The digits stop being
  tappable at that moment, so leaving "Tap the digit..." on screen above a
  dead row of digits reads as a question that ignored you.
- **`apple-touch-icon.png` is square and opaque on purpose.** iOS applies
  its own squircle mask, so rounding the corners first leaves dark notches
  around the result, and iOS composites any transparency onto black.
- **The favicon** is an inline SVG data URI. Every `#` in it must be written
  as `%23`. Left raw, the browser reads it as a fragment, truncates the URI
  and the icon vanishes with no error anywhere.
- **A data URI favicon alone gets the generic globe in Google Search.** A
  crawler will not read `data:`, it needs an icon at a URL it can fetch, so the
  tab looked right for months while the search result showed a globe next to
  two competitors with real icons. `/favicon.ico` (48 and 32, built by
  `tools/make-favicon.js` from `tools/favicon.html`) is declared *before* the
  data URI; browsers prefer the SVG and never fetch it, so the page still makes
  exactly one request. It is full-bleed and square for the same reason
  `apple-touch-icon.png` is: Google masks favicons into a circle on mobile.
  `test/site-test.js` fetches every declared icon and fails on a `data:`-only
  page, on a non-200, and on an `.ico` that is not really an ICO container.
  Favicons in Search update only when the home page is recrawled, so expect
  days rather than minutes.
- **`max-image-preview:large` is opt-in.** Without the `robots` meta Google
  caps how large a preview it will show. Both pages carry
  `index, follow, max-image-preview:large, max-snippet:-1`, and the same test
  checks for it and that nothing has accidentally gone `noindex`.
- **The place hint is built from the place in the question, never from the
  shape of the number.** It used to branch on "does this number have a comma"
  and always walked left from it, so 5,950 to the nearest hundred was told how
  to find thousands. Decimals had the mirror of it, always pointing right,
  while the ones place on the whole-number level sits left of the point.
  `placeHint()` works from `q.p` and `q.scale`, and `test/dom-test.js` follows
  the hint's own directions to check where they land.
- **The last step has to fit a phone without scrolling, and it is the only
  step that can fail to.** `showContinue()` focuses "Keep going", and the
  browser scrolls a focused control into view, so the first three steps rescue
  themselves. `answerFinal` passes `preventScroll` on purpose, to keep the dot's
  celebration on screen, so "Next number" sat 84px below the fold on an iPhone
  SE and nothing brought it back. Two things fix it. An answered choice
  question is cleared (`clearAsk()`), the same rule the digit steps already
  follow. And `@media (max-height:700px)` gives back empty space only: card
  padding, margins, and the rail's slack above the marker and below the gap
  label. The rail's vertical geometry hangs off `--line-y` so that is one
  number, and `burst()` reads the confetti origin off the marker instead of a
  literal 69px. No touch target shrinks. `test/fold-test.js` walks every step
  at six phone viewports, with a seeded question stream so the longest
  messages (exactly halfway, streak milestone) are always in the sample.
- **`digitName` vs `name`** in `PLACES`: `name` is the place being rounded to
  ("hundred thousand"), `digitName` is the digit the student taps ("hundred
  thousands"). Getting these out of sync once made the app contradict itself.

## The prose pages

`index.html` is the app and stays one self-contained file. The prose pages are
separate documents with their own URLs, because a hidden section inside the app
shares one URL and search engines have nothing to rank. They share `site.css`
and `outfit.woff2`, both same origin, so no third party is involved. `sw.js`
precaches them, and its `VERSION` needs bumping whenever that list changes.

The prose pages follow the same navigation rule as every other grown-up
screen: the topbar exits the zone, an in-content `.backlink` returns to the
parent. `/#grown-ups` is a real address: `setMode` writes it with
`replaceState` on the way in and clears it on the way out, so a link can open
that screen directly and leaving cannot strand a hash that would reopen it on
the next reload. A reader should land back where they were, not on a child's
screen.

Links to them live on the grown-ups page and on the prose pages, never on the
kid's practice screen. Crawlers follow links inside hidden markup perfectly
well, so putting grown-up navigation in front of a child buys nothing. The
sitemap covers discovery.

## Navigation — one rule

**The topbar's right-hand button crosses the zone boundary and names where it
goes.** On practice it reads "Grown-ups". On every grown-up screen, including
the prose pages, it reads "← Practice". It used to say "Grown-ups" everywhere,
which made one control mean three things: go there, you are there, and go back
there.

The star tally shows only in the kid's zone. A score means nothing on a
grown-up screen, and hiding it is also what makes a prose page's topbar match
the app's, which is what made them feel like different sites.

Returning to a parent is a separate job, done by an in-content `.backlink`
reading "← For parents and teachers". Worksheet and Explore both said "Back to
practice" while calling `setMode("hub")`, for as long as they existed. The hub
has no backlink at all now: the topbar already does that, and two controls for
one job is what made this confusing to begin with. `test/dom-test.js` clicks
each backlink and checks its words against where it actually lands.

## Testing

No test framework. Verify changes by driving the real DOM headlessly:

```bash
npm install jsdom
node -e "const {JSDOM}=require('jsdom'); /* load index.html, click through */"
```

`test/quality-eval.js` (`npm run eval`) is the one to run before a classroom
uses this. It samples thousands of real questions per level and checks the
shape of the set rather than single answers: the halfway rate, whether the
answer leans to one neighbor, how often a number repeats inside a sitting.
It found that "always tap the bigger neighbor" scored 60%, because the old
generator injected 16% halfway cases on top of the ones that occur naturally
and halfway always rounds up. `HALF_RATE` and the derived `UP_RATE` in
`makeQuestion` hold it at a coin flip; change `HALF_RATE` and the balance
follows.

Worth asserting after any change to question generation or the step flow:

- every level's instruction text matches the digit the app actually accepts
- a full worksheet's answer key matches independently computed half-up rounding
- all four combinations of the two scaffolding toggles complete a question
- no duplicate problems across a generated sheet

When patching the file programmatically, verify every anchor string matches
exactly once before writing. Replacing an empty string inserts text between
every character in the file.

## Accessibility and audience notes

The two guided-step toggles live on the grown-ups page itself, not behind a
further door. They had a screen of their own holding two checkboxes and
nothing else, advertised as also unlocking every level, which it did not.

Touch targets are 44px minimum, and digits are 46×62 — NN/g recommends 2cm
targets for young children versus 1cm for adults, and 9–12 year olds sit
between. Motion is wrapped in `prefers-reduced-motion`.

Sound is off by default and its checkbox lives on the grown-ups page, not in
the kid's nav. It is not a preference to hand a child in a shared room: a
classroom of devices should be quiet unless a teacher decides otherwise, and
the alternative remedy, muting the device, also silences a screen reader or
text-to-speech that some of these students depend on. Parent and teacher tools live behind one "For grown-ups" door rather
than in the child's navigation.

## Open items

Nothing open right now.

## Settled

- **The kid-facing name stays "Rounding Helper."** It matches the domain, so
  a kid typing what a parent told them lands in the right place. It also
  reaches a kid in only two spots, the tab title and the nav button, because
  the practice screen carries no branding by design. A cuter name would date
  faster and read as babyish to the 5th graders at the top of the range.
