// Does the way forward stay on screen?
//
// Every other test here asks whether the app is correct. This one asks whether
// a kid can see the button, which jsdom cannot answer at all: it has no layout,
// so every element it reports is 0x0 and sits at the origin.
//
// The bug it was written for: at the last step the number line, both choices,
// two lines of explanation and "Next number" all stack up, and on an iPhone SE
// the button finished 84px below the fold. The three earlier steps never showed
// it, because showContinue() focuses "Keep going" and the browser scrolls a
// focused control into view. answerFinal deliberately passes preventScroll so
// the dot's celebration stays put, which is right, and which is also why the
// last step was the only one that could hide its own button.
//
//   CHROMIUM_PATH=/path/to/chrome node test/fold-test.js
//
// Math.random is seeded before the app's script runs, so the question stream is
// the same every time and the sample reliably contains the long cases: the
// exactly-halfway explanation and a streak milestone, which are the tallest
// messages the app can print.

const {chromium} = require("playwright");
const path = require("path");
const APP = "file://" + path.join(__dirname, "..", "index.html");

// Web viewport heights, not device heights. iOS spends roughly 140-190pt on the
// status bar, the address bar and the toolbar, and Chrome keeps more of it than
// Safari does.
const SIZES = [
  {w: 375, h: 553, name: "iPhone SE, Chrome"},
  {w: 390, h: 615, name: "iPhone 14, Chrome"},
  {w: 390, h: 664, name: "iPhone 14, Safari"},
  {w: 414, h: 622, name: "iPhone 11, Chrome"},
  {w: 430, h: 745, name: "iPhone 14 Pro Max, Safari"},
  {w: 768, h: 954, name: "iPad portrait"}
];
const QUESTIONS = 12;
const LEVEL = 4;              // hundred thousand: the widest numbers and the longest lines

let fails = 0, checks = 0;
function ok(cond, msg){
  checks++;
  if(cond) return;
  fails++;
  console.log("  FAIL  " + msg);
}

// A tiny seeded generator, so the same questions come up on every run.
const SEED_SCRIPT = `(function(){
  var s = 20240917 >>> 0;
  Math.random = function(){
    s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
})();`;

async function stepOf(p){
  const top = await p.locator("#askTop").isVisible();
  const t = top ? await p.textContent("#askTopText") : await p.textContent("#ask");
  if(/Tap the digit in the .+ place/.test(t)) return "place";
  if(/tap the digit to the right/i.test(t)) return "decider";
  if(/between\?/.test(t)) return "neighbors";
  if(/closer to/.test(t)) return "final";
  return null;
}

// Tap until the one the app accepts. Each step marks its own digit, so the
// place digit still carrying .found at the decider step cannot fool this.
async function answerDigit(p, mark){
  const n = await p.locator("#hero .digit").count();
  for(let i = 0; i < n; i++){
    await p.locator("#hero .digit").nth(i).click();
    if(await p.locator("#hero .digit").nth(i).evaluate((e, m) => e.classList.contains(m), mark)) return;
  }
}
async function answerChoice(p){
  const n = await p.locator("#choices .choice").count();
  for(let i = 0; i < n; i++){
    await p.locator("#choices .choice").nth(i).click();
    if(await p.locator("#choices .choice").nth(i).evaluate(e => e.classList.contains("right"))) return;
  }
}

// Where the button a kid is meant to press next ends up, and whether anything
// else is sitting on top of it.
async function button(p){
  return p.evaluate(() => {
    for(const id of ["cont", "next"]){
      const e = document.getElementById(id);
      if(!e || e.hidden) continue;
      const r = e.getBoundingClientRect();
      const mid = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return {
        id: id,
        top: Math.round(r.top),
        bottom: Math.round(r.bottom),
        height: e.offsetHeight,
        // Where it would sit if the page had not moved. showContinue focuses
        // the button, and the browser scrolls a focused control into view, so
        // bottom alone cannot tell a step that fits from one the browser
        // rescued. The rescue is fine; it just costs the topbar, so it is
        // worth being able to see which is which.
        natural: Math.round(r.bottom + window.scrollY),
        scrolled: Math.round(window.scrollY),
        covered: !(mid === e || e.contains(mid))
      };
    }
    return null;
  });
}

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ["--no-sandbox"]
  });

  const seen = {};

  for(const s of SIZES){
    console.log("\n[" + s.name + "]  " + s.w + "x" + s.h);
    const ctx = await browser.newContext({viewport: {width: s.w, height: s.h}});
    const p = await ctx.newPage();
    await p.addInitScript(SEED_SCRIPT);
    await p.goto(APP);
    await p.evaluate(lv => localStorage.setItem("rounding-v2",
      JSON.stringify({seenIntro: true, level: lv})), LEVEL);
    await p.reload();
    await p.waitForTimeout(200);

    let worst = null, kinds = {}, rescued = 0;

    for(let n = 0; n < QUESTIONS; n++){
      for(let guard = 0; guard < 8; guard++){
        const step = await stepOf(p);
        if(!step) break;

        if(step === "place") await answerDigit(p, "found");
        else if(step === "decider") await answerDigit(p, "decider");
        else await answerChoice(p);
        await p.waitForTimeout(60);

        const b = await button(p);
        if(b){
          // The whole button, not just its first pixel. A button whose label is
          // cut off by the fold is not a button a child can read.
          ok(b.bottom <= s.h,
            `${s.name}: after the ${step} step the button runs ${b.bottom - s.h}px past the fold`);
          ok(!b.covered,
            `${s.name}: after the ${step} step something is sitting on top of the button`);
          ok(b.height >= 44,
            `${s.name}: the ${b.id} button is ${b.height}px tall, under the 44px minimum`);
          if(!worst || b.natural > worst.natural) worst = Object.assign({step: step}, b);
          if(b.scrolled > 0) rescued++;
        }

        // The answer buttons are tapped by the same fingers. Nothing reclaimed
        // for the sake of the fold may take one of them under the minimum.
        // offsetHeight, not the bounding rect: a correct choice is mid-pop when
        // this runs, and the rect reports the scaled box.
        const small = await p.evaluate(() => [...document.querySelectorAll("#choices .choice")]
          .map(e => e.offsetHeight).filter(h => h < 44));
        ok(small.length === 0,
          `${s.name}: a choice button is only ${small[0]}px tall, under the 44px minimum`);

        if(step === "final"){
          // An answered question must not still be on screen. The choices are
          // locked by now and the line under them already gives the answer.
          const stale = await p.evaluate(() => {
            const a = document.getElementById("ask");
            return !a.hidden && a.textContent.trim() !== "";
          });
          ok(!stale, `${s.name}: "So is ... closer to" is still on screen after it was answered`);

          const fb = (await p.textContent("#feedback")).trim();
          kinds[/Right in the middle/.test(fb) ? "halfway"
              : /in a row/.test(fb) ? "milestone" : "plain"] = true;
          break;
        }
        if(!(await p.locator("#cont").isHidden())) await p.click("#cont");
        await p.waitForTimeout(40);
      }
      await p.click("#next");
      await p.waitForTimeout(40);
    }

    Object.keys(kinds).forEach(k => { seen[k] = true; });
    const over = worst.natural - s.h;
    console.log("  tallest step (" + worst.step + "): button ends at " + worst.natural +
      "px of " + s.h + (over > 0
        ? ", " + over + "px past the fold before the browser scrolls it in"
        : ", " + (-over) + "px to spare"));
    if(rescued) console.log("  " + rescued + " step(s) relied on the focus scroll to show it");
    console.log("  messages covered: " + Object.keys(kinds).sort().join(", "));
    await ctx.close();
  }

  // If the sample stopped containing the long messages the numbers above stop
  // meaning anything, so say so rather than passing quietly.
  ok(seen.halfway, "the sample never hit an exactly-halfway question, so the longest explanation went untested");
  ok(seen.milestone, "the sample never hit a streak milestone, so the longest headline went untested");

  await browser.close();
  console.log("\n" + (checks - fails) + "/" + checks + " checks passed");
  process.exit(fails ? 1 : 0);
})();
