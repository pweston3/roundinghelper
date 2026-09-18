// Question quality eval.
//
// dom-test.js asks "is the app correct". This asks "are the questions any
// good", which is a different question and the one that matters in a
// classroom. It samples thousands of real questions per level and checks the
// shape of the set: how often the halfway case comes up, whether the answer
// leans to one neighbour, whether a kid sees the same number twice in a
// sitting, and whether a lazy strategy beats reasoning.
//
//   node test/quality-eval.js            (default sample)
//   SAMPLE=20000 node test/quality-eval.js
//
// It exits non-zero if any band is breached, so it can gate a release.

const {JSDOM, VirtualConsole} = require("jsdom");
const path = require("path");
const html = require("fs").readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

const SAMPLE = Number(process.env.SAMPLE || 4000);
const SITTING = 20;          // questions a kid plausibly does in one go

let fails = 0, checks = 0;
function ok(cond, msg){
  checks++;
  if(!cond){ fails++; console.log("  FAIL  " + msg); }
}
function band(value, lo, hi, label){
  ok(value >= lo && value <= hi,
    `${label} is ${fmtPct(value)}, outside the ${fmtPct(lo)}-${fmtPct(hi)} band`);
}
const fmtPct = v => (100 * v).toFixed(1) + "%";

const PLACE_VALUE = {
  ten:10, hundred:100, thousand:1000, "ten thousand":10000,
  "hundred thousand":100000, "whole number":1, tenth:0.1, hundredth:0.01
};

// Independent half-up rounding on the displayed string, in integers only, so
// this never shares a line of arithmetic with the app it is checking.
function analyse(shown, placeName){
  const p = PLACE_VALUE[placeName];
  const bare = shown.replace(/,/g, "");
  const dec = (bare.split(".")[1] || "").length;
  const pdec = (String(p).split(".")[1] || "").length;
  const scale = Math.max(dec, pdec);
  const toUnits = str => {
    const [i, f = ""] = str.split(".");
    return BigInt(i + f.padEnd(scale, "0"));
  };
  const n = toUnits(bare);
  const pu = toUnits(p.toFixed(pdec));
  const lo = (n / pu) * pu;
  const hi = lo + pu;
  const half = (n - lo) * 2n === pu;
  const answer = (n - lo) * 2n >= pu ? hi : lo;
  return {n, pu, lo, hi, half, answer, up: answer === hi, scale,
          value: Number(bare), digits: bare.replace(/[^0-9]/g, "").length};
}

const dom = new JSDOM(html, {runScripts:"dangerously", pretendToBeVisual:true,
  url:"https://roundinghelper.com/", virtualConsole:new VirtualConsole()});
const d = dom.window.document;
const $ = id => d.getElementById(id);
const chips = () => [...d.querySelectorAll(".chip")];
const levelNames = chips().map((c, i) =>
  (c.textContent.trim() === "mix of these" ? (i < 6 ? "mix (whole)" : "mix (decimal)") : c.textContent.trim()));

console.log(`Sampling ${SAMPLE.toLocaleString()} questions per level\n`);
console.log("level             halfway   answer up   distinct   repeat in " + SITTING);
console.log("-".repeat(70));

const overall = {n:0, up:0, half:0};

for(let lv = 0; lv < chips().length; lv++){
  chips()[lv].click();
  const s = {n:0, up:0, half:0, seen:new Map(), sittingRepeats:0, sittings:0};
  let window = new Set();

  for(let i = 0; i < SAMPLE; i++){
    $("next").click();
    const shown = $("hero").textContent;
    const placeName = $("prompt").textContent.replace("Round to the nearest ", "").trim();

    ok(PLACE_VALUE[placeName] !== undefined, `${levelNames[lv]}: unknown place "${placeName}"`);
    const a = analyse(shown, placeName);

    // --- correctness invariants, on every single sample ---
    ok(a.lo <= a.n && a.n < a.hi, `${levelNames[lv]}: ${shown} is not between its neighbours`);
    ok(a.hi - a.lo === a.pu, `${levelNames[lv]}: neighbours for ${shown} are not one place apart`);
    ok(a.answer === a.lo || a.answer === a.hi, `${levelNames[lv]}: ${shown} rounds to neither neighbour`);
    ok(a.n % a.pu !== 0n, `${levelNames[lv]}: ${shown} is already round, so there is nothing to do`);
    if(!shown.includes(".")){
      ok(a.value <= 1000000, `${levelNames[lv]}: ${shown} exceeds the 1,000,000 cap`);
      ok(Number(a.answer) / 10 ** a.scale <= 1000000,
        `${levelNames[lv]}: ${shown} rounds past 1,000,000`);
    }

    s.n++; if(a.up) s.up++; if(a.half) s.half++;
    s.seen.set(shown, (s.seen.get(shown) || 0) + 1);

    // repeats inside one sitting are what a kid actually notices
    if(window.has(shown)) s.sittingRepeats++;
    window.add(shown);
    if(window.size >= SITTING || i % SITTING === SITTING - 1){ s.sittings++; window = new Set(); }
  }

  overall.n += s.n; overall.up += s.up; overall.half += s.half;

  const halfRate = s.half / s.n;
  const upRate = s.up / s.n;
  const distinct = s.seen.size / s.n;
  const repeatRate = s.sittingRepeats / Math.max(1, s.sittings);

  console.log(
    levelNames[lv].padEnd(17) +
    fmtPct(halfRate).padStart(7) +
    fmtPct(upRate).padStart(12) +
    (s.seen.size + "/" + s.n).padStart(11) +
    repeatRate.toFixed(2).padStart(13)
  );

  // --- quality bands ---
  // The halfway case is worth practising and worth not drowning in.
  band(halfRate, 0.08, 0.20, `${levelNames[lv]}: halfway rate`);
  // A kid who always taps the bigger neighbour should do no better than a coin.
  band(upRate, 0.44, 0.56, `${levelNames[lv]}: answer is the upper neighbour`);
}

console.log("-".repeat(70));
const upAll = overall.up / overall.n;
console.log(`all levels        ${fmtPct(overall.half / overall.n).padStart(5)}${fmtPct(upAll).padStart(12)}`);
console.log(`\n"always tap the bigger neighbour" scores ${fmtPct(upAll)}`);

band(upAll, 0.46, 0.54, 'the lazy "always bigger" strategy');

console.log(`\n${checks - fails}/${checks} checks passed`);
if(fails) console.log(`${fails} failing. These are quality bands, not crashes.`);
process.exit(fails ? 1 : 0);
