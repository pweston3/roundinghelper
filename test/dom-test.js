// Drives the real DOM headlessly. See the Testing section of CLAUDE.md.
//   npm install jsdom && node test/dom-test.js

const {JSDOM, VirtualConsole} = require("jsdom");
const fs = require("fs");
const html = fs.readFileSync(__dirname + "/../index.html", "utf8");
const vc = new VirtualConsole();

let fails = 0, checks = 0;
const ok = (c, m) => { checks++; if(!c){ fails++; console.log("FAIL: " + m); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function boot(){
  const dom = new JSDOM(html, {runScripts:"dangerously", pretendToBeVisual:true,
    url:"https://roundinghelper.com/", virtualConsole:vc});
  return {d:dom.window.document, $:id=>dom.window.document.getElementById(id), dom};
}

// The question sits above the number line for a digit step and below it for a
// choice step, so read whichever slot is live.
function currentAsk($){
  return $("askTop").hidden ? $("ask").textContent : $("askTopText").textContent;
}

// Steps no longer advance on a timer alone: a "Keep going" button appears and
// either fills or gets tapped. Tapping it is what the test does.
function advance($){
  const b = $("cont");
  if(b.hidden) return false;
  b.click();
  return true;
}

// wait for the step timer to move the question on
async function waitForAskChange($, before, budget = 3500){
  const t0 = Date.now();
  while(Date.now() - t0 < budget){
    if(currentAsk($) !== before) return true;
    await sleep(40);
  }
  return false;
}

// ---------- independent half-up rounding oracle, integers only ----------
function roundHalfUp(numStr, placeStr){
  const dec = s => (s.split(".")[1] || "").length;
  const scale = Math.max(dec(numStr), dec(placeStr));
  const units = s => { const [i, f=""] = s.split("."); return BigInt(i + f.padEnd(scale, "0")); };
  const n = units(numStr), p = units(placeStr);
  const lo = (n / p) * p;
  const ans = (n - lo) * 2n >= p ? lo + p : lo;
  const outDec = dec(placeStr);
  const s = ans.toString().padStart(scale + 1, "0");
  let ip = scale ? s.slice(0, -scale) : s;
  let fp = scale ? s.slice(-scale) : "";
  fp = fp.slice(0, outDec);
  ip = ip.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return outDec ? ip + "." + fp : ip;
}
ok(roundHalfUp("4730","100")  === "4,700",  "oracle: 4730 -> nearest hundred");
ok(roundHalfUp("4750","100")  === "4,800",  "oracle: 4750 -> nearest hundred (half up)");
ok(roundHalfUp("3.25","0.1")  === "3.3",    "oracle: 3.25 -> nearest tenth");
ok(roundHalfUp("12.5","1")    === "13",     "oracle: 12.5 -> nearest whole");
ok(roundHalfUp("949999","100000") === "900,000", "oracle: 949999 -> nearest hundred thousand");

(async () => {

// ---------- A. no external requests, font embedded ----------
ok(!/fonts\.(googleapis|gstatic)\.com/.test(html), "no Google Fonts reference");
// inline data: URIs are fine; what must never appear is a remote reference
ok(!/(src|href)\s*=\s*["']?(https?:)?\/\//i.test(html), "no remote script/img/link references");
ok(/@font-face/.test(html) && /src:url\(data:font\/woff2;base64,/.test(html), "font embedded as a data URI");

// ---------- B. worksheet: key correctness, no duplicates, cap ----------
{
  const {$} = boot();
  $("mHub").click(); $("mSheet").click();
  const boxes = [...$("sheetPlaces").querySelectorAll("input")];
  ok(boxes.length === 8, "8 worksheet place options, got " + boxes.length);
  boxes.forEach(b => b.checked = true);
  $("sheetCount").value = "14";
  $("sheetKey").checked = true;

  const PLACE_STR = {ten:"10", hundred:"100", thousand:"1000", "ten thousand":"10000",
    "hundred thousand":"100000", "whole number":"1", tenth:"0.1", hundredth:"0.01"};

  for(let run = 0; run < 10; run++){
    $("sheetMake").click();
    const sheet = $("sheet");
    const probs = [];
    let place = null;
    for(const el of sheet.children){
      if(el.tagName === "H3"){
        place = el.textContent.match(/Round to the nearest (.+)\.$/)[1];
        ok(PLACE_STR[place] !== undefined, "known heading: " + place);
      } else if(el.tagName === "OL"){
        // each row is an ordinal, a value and an answer rule, in fixed slots
        for(const li of el.children){
          ok(li.children.length === 3, `run ${run}: a row has ordinal, value and rule`);
          probs.push({
            num: li.querySelector(".pn").textContent.trim(),
            shown: li.querySelector(".pv").textContent.trim(),
            place
          });
        }
      }
    }
    const keyRows = [...sheet.querySelectorAll(".key .ki")].map(k => ({
      num: k.querySelector(".pn").textContent.trim(),
      val: k.querySelector(".pv").textContent.trim()
    }));
    const key = keyRows.map(k => k.val);

    ok(probs.length === key.length,
      `run ${run}: ${probs.length} problems vs ${key.length} key entries`);

    probs.forEach((p, i) => {
      const expect = roundHalfUp(p.shown.replace(/,/g, ""), PLACE_STR[p.place]);
      ok(key[i] === expect,
        `run ${run} #${i+1}: ${p.shown} to nearest ${p.place} => key "${key[i]}", expected "${expect}"`);
      if(!p.shown.includes(".")){
        ok(Number(p.shown.replace(/,/g, "")) <= 1000000, "value within cap: " + p.shown);
      }
      // the key must be numbered to match the sheet, or it cannot be graded against
      ok(keyRows[i] && keyRows[i].num === p.num,
        `run ${run} #${i+1}: key ordinal ${keyRows[i] && keyRows[i].num} matches sheet ordinal ${p.num}`);
      ok(p.num === String(i + 1) + ".", `run ${run}: rows numbered continuously (${p.num})`);
    });

    // the score box must total what the sheet actually contains
    const score = sheet.querySelector(".sheet-head").textContent;
    ok(score.includes("/ " + probs.length),
      `run ${run}: score box reads / ${probs.length} (head = "${score.replace(/\s+/g," ").trim()}")`);
    ok(!score.includes("TOTALCOUNT"), `run ${run}: the total placeholder was filled in`);

    const seen = new Set();
    let dupes = 0;
    probs.forEach(p => { if(seen.has(p.shown)) dupes++; seen.add(p.shown); });
    ok(dupes === 0, `run ${run}: ${dupes} duplicate problems across the sheet`);
  }
}

// ---------- B2. every level is pickable straight away ----------
{
  const {d, $} = boot();
  const chips = [...d.querySelectorAll(".chip")];
  ok(chips.length === 10, `10 level chips, got ${chips.length}`);
  ok(chips.every(c => !c.classList.contains("locked")), "no chip is locked");
  ok(chips.every(c => !/\u{1F512}/u.test(c.textContent)), "no padlock glyphs");
  ok(!$("unlockall"), "the unlock-all link is gone");
  ok(!$("levelup"), "the level-up banner is gone");

  // picking the last level from a standing start must just work
  chips[chips.length - 1].click();
  // renderChips rebuilds the row, so the pressed state lives on a fresh node
  const after = [...d.querySelectorAll(".chip")];
  ok(after[after.length - 1].getAttribute("aria-pressed") === "true",
    "the hardest level can be chosen immediately");
  const hero = $("hero").textContent;
  ok(/\d/.test(hero), `a question was generated for it (${hero})`);

  // and the choice survives a reload
  const saved = JSON.parse(d.defaultView.localStorage.getItem("rounding-v2"));
  ok(saved.level === 9, `the pick is saved (level ${saved.level})`);
  ok(saved.unlocked === undefined, "no unlocked field is written any more");
}

// ---------- C. instruction text matches the digit the app accepts ----------
const WHOLE = ["ones","tens","hundreds","thousands","ten thousands","hundred thousands","millions"];
const DEC = ["tenths","hundredths","thousandths"];
const placeNameAt = (fromRight, scale) => {
  const k = fromRight - (String(scale).length - 1);
  return k >= 0 ? (WHOLE[k] || "") : (DEC[-k-1] || "");
};
{
  const {d, $} = boot();
  for(let level = 0; level < 10; level++){
    [...d.querySelectorAll(".chip")][level].click();
    for(let rep = 0; rep < 40; rep++){
      $("next").click();
      const asked = currentAsk($).match(/Tap the digit in the (.+) place/);
      ok(!!asked, `L${level}: stage 0 asks for a place`);
      if(!asked) break;
      const shown = $("hero").textContent;
      const dp = shown.indexOf(".");
      const scale = dp === -1 ? 1 : Math.pow(10, shown.length - dp - 1);
      const digits = [...$("hero").querySelectorAll(".digit")];
      let hit = -1;
      for(let i = 0; i < digits.length; i++){
        digits[i].click();
        if(digits[i].classList.contains("found")){ hit = i; break; }
      }
      ok(hit !== -1, `L${level}: one digit is accepted for "${shown}"`);
      if(hit === -1) break;
      const raw = digits.map(x => x.textContent).join("");
      const got = placeNameAt(raw.length - 1 - hit, scale);
      ok(got === asked[1],
        `L${level}: asked "${asked[1]}", accepts the digit in "${got}" (${shown})`);
    }
  }
}

// ---------- C2. the hint's directions land on the digit being asked for ----------
// The hint used to be chosen from the shape of the number rather than the place
// in the question, so a comma sent it walking left whatever was asked. This
// follows the hint literally and checks where it points.
{
  const {d, $} = boot();
  for(let level = 0; level < 10; level++){
    [...d.querySelectorAll(".chip")][level].click();
    for(let rep = 0; rep < 25; rep++){
      $("next").click();
      const asked = currentAsk($).match(/Tap the digit in the (.+) place/);
      ok(!!asked, `L${level}: stage 0 asks for a place`);
      if(!asked) break;

      if($("hint").hidden) $("hintbtn").click();
      const hint = $("hint").textContent.trim();
      const shown = $("hero").textContent;

      ok(hint.includes(asked[1]) || /Count from the right/.test(hint),
        `L${level}: hint names the "${asked[1]}" place (hint: "${hint}", number: ${shown})`);

      // where does the hint actually point?
      const digits = [...$("hero").querySelectorAll(".digit")];
      const glyphs = [...shown];                       // includes , and .
      let aimed = -1;
      const m = hint.match(/Go (\d+) steps? (left|right)/);
      if(m){
        const mark = hint.includes("decimal point") ? "." : ",";
        const at = glyphs.indexOf(mark);
        ok(at !== -1, `L${level}: the landmark "${mark}" is on screen (${shown})`);
        const dir = m[2] === "left" ? -1 : 1;
        let i = at, moved = 0;
        while(moved < Number(m[1])){
          i += dir;
          if(i < 0 || i >= glyphs.length) break;
          if(glyphs[i] !== "," && glyphs[i] !== ".") moved++;
        }
        ok(moved === Number(m[1]), `L${level}: the walk stays on the number (${shown}, "${hint}")`);
        aimed = glyphs.slice(0, i).filter(c => c !== "," && c !== ".").length;
      } else if(/just .?left.? of it/.test(hint)) {
        const at = glyphs.indexOf(".");
        aimed = glyphs.slice(0, at).filter(c => c !== "," && c !== ".").length - 1;
      } else {
        // "Count from the right: ones, tens, hundreds."
        const listed = hint.split(":")[1].replace(".", "").split(",").length;
        aimed = digits.length - listed;
      }

      // and which digit does the app actually accept?
      let hit = -1;
      for(let i = 0; i < digits.length; i++){
        digits[i].click();
        if(digits[i].classList.contains("found")){ hit = i; break; }
      }
      ok(hit !== -1, `L${level}: a digit is accepted`);
      ok(aimed === hit,
        `L${level}: hint points at digit ${aimed}, app accepts ${hit} (${shown}, asked "${asked[1]}", hint: "${hint}")`);
    }
  }
}

// ---------- D. all four toggle combinations complete a question ----------
for(const findplace of [true, false]) for(const scaffold of [true, false]){
  const {d, $} = boot();
  const tag = `findplace=${findplace} scaffold=${scaffold}`;
  for(const [id, val] of [["findplace", findplace], ["scaffold", scaffold]]){
    const el = $(id);
    if(el.checked !== val){ el.checked = val; el.onchange.call(el); }
  }

  for(let level = 0; level < 10; level++){
    [...d.querySelectorAll(".chip")][level].click();
    const seenStages = [];
    let guard = 0, done = false;

    while(guard++ < 8 && !done){
      const ask = currentAsk($);
      const digitStage = /Tap the digit in the .+ place/.test(ask) ? "place"
                       : /tap the digit to the right/i.test(ask) ? "decider" : null;

      if(digitStage){
        seenStages.push(digitStage);
        // the question must sit with the digits, not under the number line,
        // and the line must stop competing for the tap
        ok(!$("askTop").hidden, `${tag} L${level}: ${digitStage} question sits above the line`);
        ok($("ask").textContent === "", `${tag} L${level}: lower slot empty on a digit step`);
        ok($("linewrap").classList.contains("recede"),
          `${tag} L${level}: number line recedes during the ${digitStage} step`);
        ok($("hero").classList.contains("pick"),
          `${tag} L${level}: digits carry the pressable look`);

        // the place digit keeps its .found mark into the decider step, so each
        // step must look for its own mark rather than any mark at all
        const want = digitStage === "place" ? "found" : "decider";
        const digits = [...$("hero").querySelectorAll(".digit")];
        let moved = false;
        for(const b of digits){
          b.click();
          if(b.classList.contains(want)){ moved = true; break; }
        }
        ok(moved, `${tag} L${level}: a digit was accepted at the ${digitStage} step`);
        if(!moved) break;
        ok(advance($), `${tag} L${level}: Keep going advanced the ${digitStage} step`);

      } else if(/between\?/.test(ask)){
        seenStages.push("pair");
        ok($("askTop").hidden, `${tag} L${level}: neighbour question sits with its buttons`);
        ok(!$("linewrap").classList.contains("recede"),
          `${tag} L${level}: number line at full strength for the neighbour step`);
        const btns = [...$("choices").children];
        let moved = false;
        for(const b of btns){ b.click(); if(b.classList.contains("right")){ moved = true; break; } }
        ok(moved, `${tag} L${level}: a neighbour pair was accepted`);
        if(!moved) break;
        ok(advance($), `${tag} L${level}: Keep going advanced the neighbour step`);

      } else if(/closer to/.test(ask)){
        seenStages.push("final");
        ok($("askTop").hidden, `${tag} L${level}: final question sits with its buttons`);
        const btns = [...$("choices").children];
        let moved = false;
        for(const b of btns){ b.click(); if(b.classList.contains("right")){ moved = true; break; } }
        ok(moved, `${tag} L${level}: the final answer was accepted`);
        ok($("cont").hidden, `${tag} L${level}: no Keep going after the last step`);
        ok(!$("next").hidden, `${tag} L${level}: "Next number" appears instead`);
        done = moved;

      } else {
        ok(false, `${tag} L${level}: unexpected question "${ask}"`);
        break;
      }
    }
    ok(done, `${tag} L${level}: question completed (steps: ${seenStages.join(">") || "none"})`);
    ok(seenStages.includes("place") === findplace, `${tag} L${level}: place step present == findplace`);
    ok(seenStages.includes("decider") === findplace, `${tag} L${level}: decider step present == findplace`);
    ok(seenStages.includes("pair") === scaffold, `${tag} L${level}: neighbour step present == scaffold`);
  }
}

// ---------- E. the step button fills and also moves on by itself ----------
{
  const {d, $} = boot();
  const digits = [...$("hero").querySelectorAll(".digit")];
  for(const b of digits){ b.click(); if(b.classList.contains("found")) break; }

  ok(!$("cont").hidden, "Keep going appears after a step is answered");
  ok(/%$/.test($("contBar").style.width), "its bar was given a width to animate to");
  ok(/ms linear$/.test($("contBar").style.transition), "the bar fills over a duration rather than jumping");
  ok(d.activeElement === $("cont"), "focus lands on the button instead of the body");

  const before = currentAsk($);
  await sleep(7400);   // let it fill and fire on its own
  ok(currentAsk($) !== before, "the step advances on its own once the bar fills");
  ok($("cont").hidden, "the button goes away after advancing");

  // starting a fresh question must cancel a step still counting down
  const {$: $2} = boot();
  const d2 = [...$2("hero").querySelectorAll(".digit")];
  for(const b of d2){ b.click(); if(b.classList.contains("found")) break; }
  ok(!$2("cont").hidden, "a step is pending");
  $2("next").click();
  ok($2("cont").hidden, "a new question clears the pending step button");
}

console.log("\n" + (checks - fails) + "/" + checks + " checks passed");
process.exit(fails ? 1 : 0);
})();
