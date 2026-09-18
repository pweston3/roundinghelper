// The prose pages and the links between them. They are separate documents with
// their own URLs, which is the only shape search engines can rank, so they need
// checking separately from the app.
//   npm run test:site      (CHROMIUM_PATH overrides the browser)
const {chromium} = require("playwright");
const http = require("http"); const fs = require("fs"); const path = require("path");
const SRC = path.join(__dirname, ".."), PORT = 8755;
const T = {".html":"text/html",".css":"text/css",".js":"text/javascript",".png":"image/png",
           ".woff2":"font/woff2",".xml":"application/xml",".txt":"text/plain"};
const server = http.createServer((req,res)=>{
  let p = decodeURIComponent(req.url.split("?")[0]);
  if(p.endsWith("/")) p += "index.html";
  const f = path.join(SRC, p);
  if(!f.startsWith(SRC) || !fs.existsSync(f) || fs.statSync(f).isDirectory()){ res.writeHead(404); return res.end("nope"); }
  res.writeHead(200, {"Content-Type": T[path.extname(f)]||"application/octet-stream", "Cache-Control":"max-age=600"});
  res.end(fs.readFileSync(f));
});
let fails=0, checks=0;
const ok=(c,m)=>{checks++;console.log((c?"  ok   ":"  FAIL ")+m);if(!c)fails++;};
(async()=>{
  await new Promise(r=>server.listen(PORT,"127.0.0.1",r));
  const base=`http://localhost:${PORT}/`;
  const b=await chromium.launch({executablePath: process.env.CHROMIUM_PATH || undefined, args:["--no-sandbox"]});
  const ctx=await b.newContext({viewport:{width:900,height:1000}});
  const p=await ctx.newPage();
  const offsite=[];
  p.on("request",r=>{ if(!r.url().startsWith(base) && !/^(data|blob):/.test(r.url())) offsite.push(r.url()); });

  console.log("\n[the new page]");
  const resp = await p.goto(base+"how-to-round/");
  ok(resp.status()===200, `it serves at /how-to-round/ (${resp.status()})`);
  ok(offsite.length===0, `no third-party requests (${JSON.stringify(offsite)})`);

  const info = await p.evaluate(()=>{
    const clone=document.body.cloneNode(true);
    clone.querySelectorAll("script,style").forEach(e=>e.remove());
    const ld=[...document.querySelectorAll('script[type="application/ld+json"]')];
    let parsed=null, err=null;
    try{ parsed=JSON.parse(ld[0].textContent); }catch(e){ err=e.message; }
    return {
      title: document.title,
      words: clone.textContent.trim().split(/\s+/).filter(Boolean).length,
      h1: document.querySelector("h1").textContent,
      h2s: [...document.querySelectorAll("h2")].map(h=>h.id),
      canonical: document.querySelector('link[rel=canonical]').href,
      ldErr: err,
      ldTypes: parsed ? parsed["@graph"].map(n=>n["@type"]) : null,
      font: getComputedStyle(document.body).fontFamily,
      links: [...document.querySelectorAll("a[href]")].map(a=>a.getAttribute("href"))
    };
  });
  console.log("   title:", JSON.stringify(info.title), `(${info.title.length} chars)`);
  ok(info.words > 500, `it carries real prose (${info.words} words, against 30 on the app)`);
  ok(!info.ldErr, `structured data parses${info.ldErr?": "+info.ldErr:""}`);
  ok(JSON.stringify(info.ldTypes)==='["HowTo","FAQPage"]', `HowTo + FAQPage (${JSON.stringify(info.ldTypes)})`);
  ok(/Outfit/.test(info.font), `it uses the same typeface as the app (${info.font.split(",")[0]})`);
  ok(info.h2s.every(Boolean), `every section has an anchor (${info.h2s.length})`);

  // the deep link from the app's footer must actually land somewhere
  const target = "the-mistake-most-children-make";
  ok(info.h2s.includes(target), `the app's deep link target exists (#${target})`);

  console.log("\n[the app's footer]");
  await p.goto(base);
  await p.evaluate(()=>localStorage.setItem("rounding-v2",JSON.stringify({seenIntro:true})));
  await p.reload(); await p.waitForTimeout(300);
  ok(await p.locator("#practice .hubfoot").count()===0, "no footer on the kid's practice screen");
  await p.click("#mHub"); await p.waitForTimeout(200);
  const footLinks = await p.$$eval("#hub .hubfoot a", els => els.map(a => a.textContent.trim()));
  ok(footLinks.length === 1, `one link on the grown-ups page (${JSON.stringify(footLinks)})`);
  // a link is an invitation, so it should not be phrased as a failure
  ok(!/mistake|wrong|error|fail|problem/i.test(footLinks.join(" ")),
    `and it reads as an invitation rather than a negative (${JSON.stringify(footLinks)})`);
  const href = await p.locator("#hub .hubfoot a").first().getAttribute("href");
  const r2 = await p.goto(base + href.replace(/^\//,""));
  ok(r2.status()===200, `and the first one goes somewhere real (${href} -> ${r2.status()})`);

  console.log("\n[the round trip]");
  // The prose page is reached from the grown-ups screen, so "back" has to
  // return there rather than dumping the reader on the kid's practice screen.
  await p.goto(base);
  await p.evaluate(()=>localStorage.setItem("rounding-v2",JSON.stringify({seenIntro:true})));
  await p.reload(); await p.waitForTimeout(250);
  await p.click("#mHub"); await p.waitForTimeout(200);
  ok(new URL(p.url()).hash === "#grown-ups", `opening the grown-ups screen names itself in the URL (${new URL(p.url()).hash || "none"})`);

  // the same button now exits, rather than saying "Grown-ups" while you are on it
  const hubBar = (await p.textContent("#mHub")).replace(/\s+/g," ").trim();
  ok(hubBar === "\u2190 Practice", `and the topbar button flips to the exit (${hubBar})`);
  ok(!(await p.locator("#tally").isVisible()), "the kid's star tally is not shown on a grown-up screen");
  ok((await p.$$eval("#hub .backlink", e => e.length)) === 0,
    "and the hub has no second back link doubling the topbar");

  await p.click("#hub .hubfoot a"); await p.waitForTimeout(400);
  ok(p.url().includes("/how-to-round/"), "its link reaches the prose page");
  // one rule everywhere: the topbar button crosses the zone and names where it
  // goes, so a prose page's topbar reads the same as any grown-up screen's
  const proseBar = (await p.textContent(".topbar .practice")).replace(/\s+/g," ").trim();
  ok(proseBar === "\u2190 Practice", `the prose page's topbar exits the zone (${proseBar})`);

  // and returning to the parent is the in-content link, as on the worksheet
  const proseBack = (await p.textContent(".backlink")).replace(/\s+/g," ").trim();
  ok(proseBack === "\u2190 For parents and teachers",
    `it returns to its parent by an in-content link (${proseBack})`);
  await p.click(".backlink"); await p.waitForTimeout(500);
  ok(await p.locator("#hub").isVisible(), "which lands on the grown-ups screen, not the kid's");
  ok(!(await p.locator("#practice").isVisible()), "the kid's screen is not what a grown-up gets dropped onto");

  // leaving must not strand the hash, or a reload would reopen the hub
  await p.click("#mHub"); await p.waitForTimeout(250);
  ok(new URL(p.url()).hash === "", `leaving clears the hash (${new URL(p.url()).hash || "none"})`);
  await p.reload(); await p.waitForTimeout(300);
  ok(await p.locator("#practice").isVisible(), "so a reload returns to practice");

  console.log("\n[American spelling]");
  {
    const pages = [base, base+"how-to-round/"];
    const bad = /\b(practis(e|ing|ed)|neighbour|colour|centre|honour|behaviour|whilst|amongst|labelled)\b/i;
    for(const u of pages){
      await p.goto(u); await p.waitForTimeout(200);
      const text = await p.evaluate(()=>{
        const c=document.body.cloneNode(true);
        c.querySelectorAll("script,style").forEach(e=>e.remove());
        return c.textContent;
      });
      const hit = text.match(bad);
      ok(!hit, `${u.replace(base,"/")} uses American spelling${hit?` (found "${hit[0]}")`:""}`);
    }
  }

  console.log("\n[offline]");
  await p.goto(base);
  await p.waitForFunction(()=>navigator.serviceWorker.controller!==null,null,{timeout:15000});
  const cached = await p.evaluate(async()=>{
    const k=await caches.keys(); const c=await caches.open(k[0]);
    return {cache:k[0], urls:(await c.keys()).map(r=>new URL(r.url).pathname).sort()};
  });
  ok(cached.cache==="rounding-v3", `cache version bumped (${cached.cache})`);
  for(const want of ["/how-to-round/","/site.css","/outfit.woff2"]) {
    ok(cached.urls.includes(want), `precached ${want}`);
  }
  await ctx.setOffline(true);
  const off = await p.goto(base+"how-to-round/");
  ok(off && off.status()===200, "the new page loads with the network off");
  ok((await p.textContent("h1")).includes("How to round"), "and still has its content");

  await b.close(); server.close();
  console.log(`\n${checks-fails}/${checks} checks passed`);
  process.exit(fails?1:0);
})();
