// Worksheet and print fidelity.
//
// The preview used to be a narrow reflow of the sheet inside the app's card,
// so on a phone the answer rules collapsed to stubs and it looked nothing like
// what came out of the printer. It is now the page itself, laid out at print
// width and scaled down. These checks hold that: the same content, the same
// stylesheet, and a default sheet that fits on one piece of paper.
//
// jsdom cannot lay anything out, so this needs a real browser.
//   npm install playwright && npx playwright install chromium
//   node test/print-test.js            (CHROMIUM_PATH overrides the browser)

const {chromium} = require("playwright");
const path = require("path");
const PAGE = "file://" + path.join(__dirname, "..", "index.html");

// US Letter at the 14mm @page margin, in CSS pixels
const PRINT_W = Math.round((8.5 - 2 * 14 / 25.4) * 96);   // 710
const PRINT_H = Math.round((11 - 2 * 14 / 25.4) * 96);    // 950

let fails = 0, checks = 0;
const ok = (c, m) => { checks++; console.log((c ? "  ok   " : "  FAIL ") + m); if(!c) fails++; };

async function openSheet(ctx){
  const p = await ctx.newPage();
  await p.goto(PAGE);
  await p.evaluate(() => localStorage.setItem("rounding-v2", JSON.stringify({seenIntro:true})));
  await p.reload();
  await p.click("#mHub");
  await p.click("#mSheet");
  await p.waitForTimeout(150);
  return p;
}

// Lay a page's content out at the true printable width and measure it.
const measure = (p, W) => p.evaluate(({W}) => {
  const probe = document.createElement("div");
  probe.className = "sheetdoc";
  probe.style.cssText = `position:absolute;left:-9999px;top:0;width:${W}px`;
  document.body.appendChild(probe);
  const out = [...document.querySelectorAll("#pageStack .page")].map(pg => {
    probe.innerHTML = pg.innerHTML;
    const overflowing = [...probe.querySelectorAll("*")]
      .filter(e => e.getBoundingClientRect().right > W + 1).length;
    return {h: Math.ceil(probe.getBoundingClientRect().height), overflowing};
  });
  probe.remove();
  return out;
}, {W});

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ["--no-sandbox"]
  });

  // ---------- 1. defaults a teacher meets ----------
  console.log("\n[1] defaults");
  {
    const ctx = await browser.newContext({viewport:{width:390, height:900}});
    const p = await openSheet(ctx);
    const boxes = await p.$$eval("#sheetPlaces input", els =>
      els.map(e => ({checked: e.checked, label: e.parentElement.textContent.trim()})));
    const on = boxes.filter(b => b.checked).map(b => b.label);
    ok(on.length === 5 && on.every(l => !/tenth|hundredth|whole number/.test(l)),
      `the five whole-number places start ticked: ${JSON.stringify(on)}`);
    ok(await p.isChecked("#sheetKey") === false, "the answer key starts off");
    ok(await p.inputValue("#sheetCount") === "6", "six problems per section to start");
    await ctx.close();
  }

  // ---------- 2. the default sheet fits one piece of paper ----------
  console.log("\n[2] paper");
  {
    const ctx = await browser.newContext({viewport:{width:390, height:900}});
    const p = await openSheet(ctx);
    await p.click("#sheetMake");
    await p.waitForTimeout(250);
    const [problems] = await measure(p, PRINT_W);
    ok(problems.h <= PRINT_H,
      `the default sheet is ${problems.h}px against ${PRINT_H}px of page` +
      (problems.h > PRINT_H ? ` and spills by ${problems.h - PRINT_H}px` : ""));
    ok(problems.overflowing === 0, `nothing runs past the ${PRINT_W}px printable width`);

    // and the key, when asked for, is its own sheet rather than a tail
    await p.setChecked("#sheetKey", true);
    await p.click("#sheetMake");
    await p.waitForTimeout(250);
    const pages = await measure(p, PRINT_W);
    ok(pages.length === 2, `problems and key are separate pages (got ${pages.length})`);
    ok(pages[1].h <= PRINT_H, `the key fits its page (${pages[1].h}px)`);
    await ctx.close();
  }

  // ---------- 3. the preview is the printout, not a reflow of it ----------
  console.log("\n[3] preview matches print");
  for(const width of [390, 820]){
    const ctx = await browser.newContext({viewport:{width, height:1000}});
    const p = await openSheet(ctx);
    await p.setChecked("#sheetKey", true);
    await p.click("#sheetMake");
    await p.waitForTimeout(250);

    // offsetWidth, not getBoundingClientRect: the stack is scaled, and the rect
    // reports the scaled size while offsetWidth reports what it was laid out at.
    const laidOutAt = await p.$eval("#pageStack .page", el => el.offsetWidth);
    ok(Math.round(laidOutAt) === 816,
      `at ${width}px the page is still laid out at 816px, then scaled (got ${Math.round(laidOutAt)})`);
    const scale = await p.$eval("#pageStack", el => {
      const m = getComputedStyle(el).transform.match(/matrix\(([\d.]+)/);
      return m ? Number(m[1]) : 1;
    });
    ok(scale > 0 && scale <= 1, `the stack is scaled to fit (${scale.toFixed(2)})`);

    await p.evaluate(() => { window.print = () => {}; });
    const popPromise = ctx.waitForEvent("page");
    await p.click("#sheetPrint");
    const pop = await popPromise;
    await pop.waitForTimeout(500);
    await pop.evaluate(() => { window.print = () => {}; });

    const previewVals = await p.$$eval("#pageStack .pv", e => e.map(x => x.textContent));
    const printVals = await pop.$$eval(".pv", e => e.map(x => x.textContent));
    ok(previewVals.length > 0 && JSON.stringify(previewVals) === JSON.stringify(printVals),
      `at ${width}px the printed problems are the ones on screen (${previewVals.length} values)`);

    const previewCss = await p.evaluate(() =>
      [...document.querySelectorAll("style")].map(s => s.textContent).join("").includes(".sheetdoc .rule"));
    const printCss = await pop.evaluate(() =>
      [...document.querySelectorAll("style")].map(s => s.textContent).join("").includes(".sheetdoc .rule"));
    ok(previewCss && printCss, `at ${width}px both documents carry the sheet stylesheet`);

    const printBlocks = await pop.$$eval(".sheetdoc", e => e.length);
    ok(printBlocks === 2, `at ${width}px the print document has both pages (${printBlocks})`);

    // the rule is the thing that collapsed before; it must be a real line
    const ruleW = await pop.$eval(".rule", el => el.getBoundingClientRect().width);
    ok(ruleW > 100, `the answer rule is a usable length, not a stub (${Math.round(ruleW)}px)`);
    await ctx.close();
  }

  // ---------- 4. a long sheet says where it breaks ----------
  console.log("\n[4] long sheets");
  {
    const ctx = await browser.newContext({viewport:{width:390, height:900}});
    const p = await openSheet(ctx);
    await p.click("#pickall");                  // every place
    await p.selectOption("#sheetCount", "14");
    await p.click("#sheetMake");
    await p.waitForTimeout(300);
    const marks = await p.$$eval("#pageStack .pbreak", e => e.map(x => x.getAttribute("data-label")));
    ok(marks.length > 0, `a long sheet shows where the printer cuts: ${JSON.stringify(marks)}`);
    ok(marks[0] === "page 2", `the first marker is labelled page 2 (got ${marks[0]})`);
    await ctx.close();
  }

  // ---------- 5. select all / clear all ----------
  console.log("\n[5] select all");
  {
    const ctx = await browser.newContext({viewport:{width:390, height:900}});
    const p = await openSheet(ctx);
    await p.click("#pickall");
    ok((await p.$$eval("#sheetPlaces input", e => e.filter(x => x.checked).length)) === 8,
      "Select all ticks all eight places");
    ok(await p.textContent("#pickall") === "Clear all", "and the control flips to Clear all");
    await p.click("#pickall");
    ok((await p.$$eval("#sheetPlaces input", e => e.filter(x => x.checked).length)) === 0,
      "Clear all unticks everything");
    await p.click("#sheetMake");
    await p.waitForTimeout(200);
    ok((await p.textContent("#pageStack")).includes("Pick at least one"),
      "and an empty selection says so instead of printing a blank sheet");
    await ctx.close();
  }

  await browser.close();
  console.log(`\n${checks - fails}/${checks} checks passed`);
  process.exit(fails ? 1 : 0);
})();
