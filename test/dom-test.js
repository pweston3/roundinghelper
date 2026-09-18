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
// Check what the browser would actually fetch, rather than pattern-matching the
// source. A canonical link and a JSON-LD @context both carry absolute URLs and
// neither is ever requested; a stylesheet or a script src is the real risk.
{
  const {d} = boot();
  const fetched = [
    ...d.querySelectorAll("script[src],img[src],iframe[src],video[src],audio[src],source[src],embed[src],object[data]"),
    ...[...d.querySelectorAll("link[href]")].filter(l => {
      const rel = (l.getAttribute("rel") || "").toLowerCase();
      return !["canonical", "alternate", "author", "license", "manifest"].includes(rel);
    })
  ];
  const remote = fetched
    .map(e => e.getAttribute("src") || e.getAttribute("href") || e.getAttribute("data") || "")
    .filter(u => /^(https?:)?\/\//i.test(u));
  ok(remote.length === 0, `nothing on the page fetches from a remote origin (${JSON.stringify(remote)})`);
  ok(!/@import\s+url\(\s*['"]?(https?:)?\/\//i.test(html), "no remote @import in the stylesheet");
}
ok(/@font-face/.test(html) && /src:url\(data:font\/woff2;base64,/.test(html), "font embedded as a data URI");

// ---------- B. worksheet: key correctness, no duplicates, cap ----------
{
  const {$} = boot();
  $("mHub").click(); $("mSheet").click();
  const boxes = [...$("sheetPlaces").querySelectorAll("input")];
  ok(boxes.length === 8, "8 worksheet place options, got " + boxes.length);

  // defaults a teacher meets before touching anything
  ok(boxes.filter(b => b.checked).length === 5, "the five whole-number places start ticked");
  ok(boxes.slice(0, 5).every(b => b.checked), "and it is the whole numbers, not the decimals");
  ok(boxes.slice(5).every(b => !b.checked), "decimals start unticked");
  ok($("sheetKey").checked === false, "the answer key is off by default");

  // select all / clear all
  ok(!!$("pickall"), "there is a select-all control");
  ok($("pickall").textContent === "Select all", "it offers Select all while some are unticked");
  $("pickall").click();
  ok(boxes.every(b => b.checked), "Select all ticks every place");
  ok($("pickall").textContent === "Clear all", "and then offers Clear all");
  $("pickall").click();
  ok(boxes.every(b => !b.checked), "Clear all unticks every place");
  $("pickall").click();

  $("sheetCount").value = "14";
  $("sheetKey").checked = true;

  const PLACE_STR = {ten:"10", hundred:"100", thousand:"1000", "ten thousand":"10000",
    "hundred thousand":"100000", "whole number":"1", tenth:"0.1", hundredth:"0.01"};

  for(let run = 0; run < 10; run++){
    $("sheetMake").click();
    // the preview is one .page per printed page, and the key gets its own
    const pages = [...$("pageStack").children];
    ok(pages.length === 2, `run ${run}: problems and key are separate pages (got ${pages.length})`);
    ok(pages.every(el => el.classList.contains("sheetdoc")),
      `run ${run}: every page carries the document stylesheet class`);
    const sheet = pages[0];
    const probs = [];
    for(const sec of sheet.querySelectorAll(".sec")){
      const place = sec.querySelector("h3").textContent.match(/Round to the nearest (.+)\.$/)[1];
      ok(PLACE_STR[place] !== undefined, "known heading: " + place);

      // two real lists side by side, because WebKit drops CSS multicolumn when
      // it paginates and printed one long column instead
      const lists = sec.querySelectorAll("ol.probs");
      ok(lists.length === 2, `run ${run}: ${place} is laid out as two real lists (got ${lists.length})`);
      const counts = [...lists].map(l => l.children.length);
      ok(Math.abs(counts[0] - counts[1]) <= 1,
        `run ${run}: ${place} splits evenly between the columns (${JSON.stringify(counts)})`);

      // document order is left column then right, which is the order the
      // ordinals run in
      for(const li of sec.querySelectorAll("ol.probs li")){
        ok(li.children.length === 3, `run ${run}: a row has ordinal, value and rule`);
        probs.push({
          num: li.querySelector(".pn").textContent.trim(),
          shown: li.querySelector(".pv").textContent.trim(),
          place
        });
      }
    }
    ok(sheet.querySelectorAll(".sec").length > 0, `run ${run}: the sheet has sections`);
    ok(pages[1].querySelectorAll(".key .keycol").length === 4,
      `run ${run}: the key is four real columns`);
    const keyRows = [...pages[1].querySelectorAll(".key .ki")].map(k => ({
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

// ---------- A2. structured data for search and answer engines ----------
// Malformed JSON-LD fails silently: no error, no rich result, nothing to see.
{
  const {d} = boot();
  const blocks = [...d.querySelectorAll('script[type="application/ld+json"]')];
  ok(blocks.length === 1, `exactly one JSON-LD block (got ${blocks.length})`);

  let data = null;
  try { data = JSON.parse(blocks[0].textContent); }
  catch(e){ ok(false, "the JSON-LD parses: " + e.message); }

  if(data){
    const graph = data["@graph"] || [data];
    const app = graph.find(n => String(n["@type"]).includes("LearningResource"));
    const faq = graph.find(n => n["@type"] === "FAQPage");
    ok(!!app, "it describes a LearningResource");
    ok(!!faq, "and carries an FAQ block");

    ok(app.isAccessibleForFree === true, "marked free to use");
    ok(app.isFamilyFriendly === true, "marked family friendly");
    ok(/^\d+-\d+$/.test(app.typicalAgeRange || ""), `age range is a range (${app.typicalAgeRange})`);

    // the standards are the thing a teacher's search resolves against, and the
    // page claims them in prose, so the markup has to claim the same two
    const named = (app.educationalAlignment || []).map(x => x.targetName).sort();
    ok(named.length === 2, `two standards aligned (got ${named.length})`);
    for(const std of ["4.NBT.A.3", "5.NBT.A.4"]){
      ok(named.some(n => n.includes(std)), `aligned to ${std}`);
      ok(d.getElementById("hub").textContent.includes(std),
        `${std} is also claimed in the page's own text, not only in the markup`);
    }

    // marking up answers the page does not carry is a guideline violation
    const hub = d.getElementById("hub").textContent.replace(/\s+/g, " ").toLowerCase();
    const backing = {
      "How does Rounding Helper teach rounding?": "the number line stays hidden until step 2",
      "Which standards does Rounding Helper cover?": "round decimals to any place",
      "Does Rounding Helper cost anything or need an account?": "no accounts and nothing sent anywhere",
      "Does Rounding Helper work offline?": "works offline"
    };
    for(const q of faq.mainEntity){
      ok(typeof q.acceptedAnswer.text === "string" && q.acceptedAnswer.text.length > 20,
        `"${q.name}" has a real answer`);
      const proof = backing[q.name];
      ok(proof && hub.includes(proof.toLowerCase()),
        `"${q.name}" is backed by text on the page ("${proof}")`);
    }
  }

  const canon = d.querySelector('link[rel="canonical"]');
  ok(!!canon, "there is a canonical link");
  if(canon){
    const og = d.querySelector('meta[property="og:url"]');
    ok(canon.getAttribute("href") === og.getAttribute("content"),
      `canonical matches og:url (${canon.getAttribute("href")})`);
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

  // a first visit lands on the whole-number mix, not on tens
  const fresh = [...d.querySelectorAll(".chip")].findIndex(c => c.getAttribute("aria-pressed") === "true");
  ok(chips[fresh].textContent.trim() === "mix of these",
    `a fresh visit starts on "mix of these" (got "${chips[fresh].textContent.trim()}")`);
  ok(fresh === 5, `and it is the whole-number mix, not the decimal one (index ${fresh})`);
  const p0 = $("prompt").textContent;
  ok(/Round to the nearest (ten|hundred|thousand|ten thousand|hundred thousand)$/.test(p0),
    `its first question is a whole-number place ("${p0}")`);

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

// ---------- B3. a save missing "level" falls back to the default ----------
// `s.level|0` turns a missing field into 0, which used to be the default and is
// now tens, so a partial save silently ignored START_LEVEL.
{
  for(const [store, want, label] of [
    [null,                          "mix of these", "no storage at all"],
    [{seenIntro:true},              "mix of these", "save with no level field"],
    [{seenIntro:true, level:null},  "mix of these", "save with a null level"],
    [{seenIntro:true, level:0},     "ten",          "save that really is on tens"],
    [{seenIntro:true, level:99},    "mix of these", "save with an out-of-range level"]
  ]){
    const dom = new JSDOM(html, {runScripts:"dangerously", pretendToBeVisual:true,
      url:"https://roundinghelper.com/", virtualConsole:vc,
      beforeParse(w){ if(store) w.localStorage.setItem("rounding-v2", JSON.stringify(store)); }});
    const dd = dom.window.document;
    const on = [...dd.querySelectorAll(".chip")].find(c => c.getAttribute("aria-pressed") === "true");
    ok(on && on.textContent.trim() === want,
      `${label}: starts on "${want}" (got "${on ? on.textContent.trim() : "none"}")`);
  }
  // level 99 clamps to LAST, which is the decimals mix, so check it is not that
  const dom2 = new JSDOM(html, {runScripts:"dangerously", pretendToBeVisual:true,
    url:"https://roundinghelper.com/", virtualConsole:vc,
    beforeParse(w){ w.localStorage.setItem("rounding-v2", JSON.stringify({seenIntro:true})); }});
  const chips2 = [...dom2.window.document.querySelectorAll(".chip")];
  const at = chips2.findIndex(c => c.getAttribute("aria-pressed") === "true");
  ok(at === 5, `the fallback is the whole-number mix at index 5, not the decimal one (got ${at})`);
}

// ---------- B4. sound is a grown-up setting, off until asked for ----------
{
  const {d, $} = boot();
  ok(!d.getElementById("soundbtn"), "no sound button in the kid's nav");
  const nav = [...d.querySelectorAll("#topbar button")].map(b => b.id);
  ok(!nav.some(id => /sound/i.test(id)), `nav holds only ${JSON.stringify(nav)}`);

  const box = $("soundbox");
  ok(!!box && box.type === "checkbox", "the control is a checkbox on the grown-ups page");
  ok(d.getElementById("hub").contains(box), "and it lives inside the grown-ups section");
  ok(box.checked === false, "sound is off on a first visit");

  // turning it on has to persist, or a teacher sets it every morning
  box.checked = true;
  box.onchange.call(box);
  ok(JSON.parse(d.defaultView.localStorage.getItem("rounding-v2")).sound === true,
    "turning it on is saved");
  box.checked = false;
  box.onchange.call(box);
  ok(JSON.parse(d.defaultView.localStorage.getItem("rounding-v2")).sound === false,
    "turning it off is saved too");
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
