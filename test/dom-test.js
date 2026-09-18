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

// wait for the step timer to move the question on
async function waitForAskChange($, before, budget = 3500){
  const t0 = Date.now();
  while(Date.now() - t0 < budget){
    if($("ask").textContent !== before) return true;
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
ok(!/<(script|img)[^>]+src=|<link[^>]+href=/i.test(html), "no external script/img/link tags");
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
        for(const li of el.children) probs.push({shown: li.textContent.trim(), place});
      }
    }
    const key = [...sheet.querySelector(".key").textContent
      .replace(/^Answer key/, "").matchAll(/\d+\.\s*([\d,]+(?:\.\d+)?)/g)].map(m => m[1]);

    ok(probs.length === key.length,
      `run ${run}: ${probs.length} problems vs ${key.length} key entries`);

    probs.forEach((p, i) => {
      const expect = roundHalfUp(p.shown.replace(/,/g, ""), PLACE_STR[p.place]);
      ok(key[i] === expect,
        `run ${run} #${i+1}: ${p.shown} to nearest ${p.place} => key "${key[i]}", expected "${expect}"`);
      if(!p.shown.includes(".")){
        ok(Number(p.shown.replace(/,/g, "")) <= 1000000, "value within cap: " + p.shown);
      }
    });

    const seen = new Set();
    let dupes = 0;
    probs.forEach(p => { if(seen.has(p.shown)) dupes++; seen.add(p.shown); });
    ok(dupes === 0, `run ${run}: ${dupes} duplicate problems across the sheet`);
  }
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
  $("unlockall").click();
  for(let level = 0; level < 10; level++){
    [...d.querySelectorAll(".chip")][level].click();
    for(let rep = 0; rep < 40; rep++){
      $("next").click();
      const asked = $("ask").textContent.match(/Tap the digit in the (.+) place/);
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

// ---------- D. all four scaffolding combinations complete a question ----------
for(const findplace of [true, false]) for(const scaffold of [true, false]){
  const {d, $} = boot();
  const tag = `findplace=${findplace} scaffold=${scaffold}`;
  $("unlockall").click();
  for(const [id, val] of [["findplace", findplace], ["scaffold", scaffold]]){
    const el = $(id);
    if(el.checked !== val){ el.checked = val; el.onchange.call(el); }
  }

  for(let level = 0; level < 10; level++){
    [...d.querySelectorAll(".chip")][level].click();
    const seenStages = [];
    let guard = 0, done = false;

    while(guard++ < 8 && !done){
      const ask = $("ask").textContent;
      const digitStage = /Tap the digit in the .+ place/.test(ask) ? "place"
                       : /tap the digit to the right/i.test(ask) ? "decider" : null;

      if(digitStage){
        seenStages.push(digitStage);
        // the place digit keeps its .found mark into the decider stage, so each
        // stage must look for its own mark, not just "any mark".
        const want = digitStage === "place" ? "found" : "decider";
        const digits = [...$("hero").querySelectorAll(".digit")];
        let moved = false;
        for(const b of digits){
          b.click();
          if(b.classList.contains(want)){ moved = true; break; }
        }
        ok(moved, `${tag} L${level}: a digit was accepted at the ${digitStage} step`);
        if(!moved) break;
        ok(await waitForAskChange($, ask), `${tag} L${level}: ${digitStage} step advanced`);

      } else if(/between\?/.test(ask)){
        seenStages.push("pair");
        const btns = [...$("choices").children];
        let moved = false;
        for(const b of btns){ b.click(); if(b.classList.contains("right")){ moved = true; break; } }
        ok(moved, `${tag} L${level}: a neighbor pair was accepted`);
        if(!moved) break;
        ok(await waitForAskChange($, ask), `${tag} L${level}: neighbor step advanced`);

      } else if(/closer to/.test(ask)){
        seenStages.push("final");
        const btns = [...$("choices").children];
        let moved = false;
        for(const b of btns){ b.click(); if(b.classList.contains("right")){ moved = true; break; } }
        ok(moved, `${tag} L${level}: the final answer was accepted`);
        ok(!$("next").hidden, `${tag} L${level}: "Next number" appears`);
        done = moved;

      } else {
        ok(false, `${tag} L${level}: unexpected question "${ask}"`);
        break;
      }
    }
    ok(done, `${tag} L${level}: question completed (stages: ${seenStages.join(">") || "none"})`);

    // the steps that each toggle turns on must actually be the ones that ran
    ok(seenStages.includes("place") === findplace,
      `${tag} L${level}: place step present == findplace`);
    ok(seenStages.includes("decider") === findplace,
      `${tag} L${level}: decider step present == findplace`);
    ok(seenStages.includes("pair") === scaffold,
      `${tag} L${level}: neighbor step present == scaffold`);
  }
}

console.log("\n" + (checks - fails) + "/" + checks + " checks passed");
process.exit(fails ? 1 : 0);
})();
