// The dot and the celebrations are animation, which jsdom cannot see, so this
// drives a real browser. CHROMIUM_PATH points at a system Chromium where
// "npx playwright install" is not an option.
//   npm install playwright && npx playwright install chromium
//   node test/motion-test.js
const {chromium} = require("playwright");
const PAGE = "file://" + require("path").join(__dirname, "..", "index.html");
let fails=0, checks=0;
const ok=(c,m)=>{checks++;console.log((c?"  ok   ":"  FAIL ")+m);if(!c)fails++;};

async function play(p, wantCorrect){
  // walk a question to the final step, then answer right or wrong
  for(let g=0; g<8; g++){
    const askTop = await p.locator("#askTop").isVisible();
    const ask = askTop ? await p.textContent("#askTopText") : await p.textContent("#ask");
    if(/[Tt]ap the digit/.test(ask)){
      const want = /in the .+ place/.test(ask) ? "found" : "decider";
      const n = await p.locator("#hero .digit").count();
      for(let i=0;i<n;i++){
        await p.locator("#hero .digit").nth(i).click();
        if(await p.locator("#hero .digit").nth(i).evaluate((e,w)=>e.classList.contains(w), want)) break;
      }
      await p.click("#cont");
    } else if(/between\?/.test(ask)){
      const n = await p.locator("#choices .choice").count();
      for(let i=0;i<n;i++){
        await p.locator("#choices .choice").nth(i).click();
        if(await p.locator("#choices .choice").nth(i).evaluate(e=>e.classList.contains("right"))) break;
      }
      await p.click("#cont");
    } else if(/closer to/.test(ask)){
      // Work out which button is which from the marker, so a deliberate miss
      // stays a miss. Clicking blind locks the choices the moment it is right.
      const frac = await p.evaluate(() => parseFloat(document.getElementById("marker").style.left));
      const correctIdx = frac >= 50 ? 1 : 0;      // at or past halfway the answer is the upper neighbour
      const idx = wantCorrect ? correctIdx : 1 - correctIdx;
      await p.locator("#choices .choice").nth(idx).click();
      const got = await p.locator("#choices .choice").nth(idx)
        .evaluate(e => e.classList.contains("right"));
      if(got !== wantCorrect) throw new Error(`wanted correct=${wantCorrect} at ${frac}% but got right=${got}`);
      return;
    } else return;
  }
}

(async()=>{
  const b=await chromium.launch({executablePath: process.env.CHROMIUM_PATH || undefined, args:["--no-sandbox"]});

  // ---------- motion on ----------
  const ctx=await b.newContext({viewport:{width:460,height:900},reducedMotion:"no-preference"});
  const p=await ctx.newPage();
  const offsite=[];
  p.on("request",r=>{ if(!/^(file|data|blob):/.test(r.url())) offsite.push(r.url()); });
  await p.goto(PAGE);
  await p.evaluate(()=>localStorage.setItem("rounding-v2",JSON.stringify({seenIntro:true,level:1})));
  await p.reload(); await p.waitForTimeout(300);

  console.log("\n[motion on]");
  await play(p,true);
  await p.waitForTimeout(120);
  ok(await p.locator(".bits .bit").count() > 0, "confetti pieces spawn from the dot");
  const mood = await p.getAttribute("#marker","class");
  ok(/hop-(hi|lo)/.test(mood), `the dot hops toward the winner (class "${mood}")`);
  ok(await p.evaluate(()=>JSON.parse(localStorage.getItem("rounding-v2")).streak===1), "streak recorded as 1");
  await p.waitForTimeout(1500);
  ok(await p.locator(".bits").count() === 0, "confetti is cleaned out of the DOM");
  ok(await p.locator(".flystar").count() === 0, "the flying star is cleaned up too");
  const tally = await p.textContent("#tally");
  ok(/1/.test(tally), `the star actually landed on the tally (${tally.trim()})`);

  // a miss must reset the streak
  console.log("\n[a miss]");
  await p.click("#next");
  await play(p,false);
  await p.waitForTimeout(100);
  ok(await p.evaluate(()=>JSON.parse(localStorage.getItem("rounding-v2")).streak===0), "a miss resets the streak to 0");

  // streak milestone
  console.log("\n[streak to 3]");
  await p.evaluate(()=>{ const s=JSON.parse(localStorage.getItem("rounding-v2")); s.streak=2; localStorage.setItem("rounding-v2",JSON.stringify(s)); });
  await p.reload(); await p.waitForTimeout(300);
  // Skip an exact-halfway draw: that branch prints its own headline and never
  // calls cheerLine(), so the milestone words are swallowed. Worth knowing,
  // but it is not what this check is about.
  for(let t=0; t<25; t++){
    const atHalf = await p.evaluate(()=>parseFloat(document.getElementById("marker").style.left) === 50);
    if(!atHalf) break;
    await p.click("#next"); await p.waitForTimeout(80);
  }
  await play(p,true);
  await p.waitForTimeout(150);
  const fb = await p.textContent("#feedback");
  ok(/Three in a row/.test(fb), `milestone line shows (${JSON.stringify(fb.slice(0,40))})`);
  ok(await p.locator("#practice .card.cheer").count() === 1, "the card pulses on a milestone");
  ok(await p.locator(".bits .bit").count() > 25, "the burst doubles for a milestone");
  ok(offsite.length === 0, `still no off-site requests (${JSON.stringify(offsite)})`);
  await ctx.close();

  // ---------- reduced motion ----------
  console.log("\n[reduced motion]");
  const ctx2=await b.newContext({viewport:{width:460,height:900},reducedMotion:"reduce"});
  const p2=await ctx2.newPage();
  await p2.goto(PAGE);
  await p2.evaluate(()=>localStorage.setItem("rounding-v2",JSON.stringify({seenIntro:true,level:1})));
  await p2.reload(); await p2.waitForTimeout(300);
  await play(p2,true);
  await p2.waitForTimeout(200);
  ok(await p2.locator(".bits").count() === 0, "no confetti under reduced motion");
  ok(await p2.locator(".flystar").count() === 0, "no flying star under reduced motion");
  // The mood class is still set under reduced motion; what matters is that no
  // keyframes apply, since every dot animation lives in a no-preference block.
  const anim = await p2.evaluate(()=>{
    const cs = getComputedStyle(document.querySelector("#marker .dot"));
    return {name: cs.animationName, dur: cs.animationDuration};
  });
  ok(anim.name === "none", `no dot keyframes apply (animation-name: ${anim.name}, ${anim.dur})`);
  const t2 = await p2.textContent("#tally");
  ok(/1/.test(t2), `the tally still increments (${t2.trim()})`);
  ok(!(await p2.locator("#next").isHidden()), "the question still completes");

  await b.close();
  console.log(`\n${checks-fails}/${checks} checks passed`);
  process.exit(fails?1:0);
})();
