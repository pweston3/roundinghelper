// Service worker test. Runs against a throwaway copy of the site over HTTP,
// because service workers do not run on file:// and we must be free to mutate
// index.html to exercise the upgrade path.
const {chromium} = require("playwright");
const http = require("http");
const fs = require("fs");
const path = require("path");

const SRC = require("path").join(__dirname, "..");
const DIR = require("path").join(require("os").tmpdir(), "roundinghelper-sw-test");
const PORT = 8731;

let fails = 0, checks = 0;
const ok = (c, m) => { checks++; console.log((c ? "  ok   " : "  FAIL ") + m); if(!c) fails++; };

fs.rmSync(DIR, {recursive:true, force:true});
fs.mkdirSync(DIR, {recursive:true});
for(const f of ["index.html","sw.js","og.png","apple-touch-icon.png"]) {
  fs.copyFileSync(path.join(SRC,f), path.join(DIR,f));
}

const TYPES = {".html":"text/html", ".js":"text/javascript", ".png":"image/png"};
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if(p === "/") p = "/index.html";
  const file = path.join(DIR, p);
  if(!file.startsWith(DIR) || !fs.existsSync(file)){ res.writeHead(404); return res.end("nope"); }
  res.writeHead(200, {"Content-Type": TYPES[path.extname(file)] || "application/octet-stream",
                      // what GitHub Pages actually sends. With "no-cache" here the
                      // suite cannot see a stale page being served, and once did not.
                      "Cache-Control": "max-age=600"});
  res.end(fs.readFileSync(file));
});

(async () => {
  await new Promise(r => server.listen(PORT, "127.0.0.1", r));
  const base = `http://localhost:${PORT}/`;
  // CHROMIUM_PATH lets this run against a system Chromium where
  // "npx playwright install" is not an option.
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ["--no-sandbox"]
  });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  const offsite = [];
  page.on("request", r => {
    const u = r.url();
    if(!u.startsWith(base) && !/^(data|blob):/.test(u)) offsite.push(u);
  });

  // ---- 1. install ----
  console.log("\n[1] first visit, worker installs");
  await page.goto(base);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, {timeout:15000})
    .then(() => ok(true, "worker took control of the page"))
    .catch(() => ok(false, "worker never took control"));

  const cached = await page.evaluate(async () => {
    const keys = await caches.keys();
    const c = await caches.open(keys[0]);
    return {keys, urls: (await c.keys()).map(r => new URL(r.url).pathname).sort()};
  });
  ok(cached.keys.length === 1 && cached.keys[0] === "rounding-v2",
    `one cache named rounding-v2 (got ${JSON.stringify(cached.keys)})`);
  for(const want of ["/", "/index.html", "/og.png", "/apple-touch-icon.png"]) {
    ok(cached.urls.includes(want), `precached ${want}`);
  }
  ok(offsite.length === 0, `no off-site requests (${JSON.stringify(offsite)})`);

  // ---- 2. offline ----
  console.log("\n[2] network off, the app still loads and plays");
  await ctx.setOffline(true);
  await page.goto(base, {waitUntil:"load"});
  const heroText = await page.textContent("#hero").catch(() => "");
  ok(/\d/.test(heroText), `a question rendered offline (hero = "${heroText}")`);

  // and it is actually usable, not just painted
  await page.evaluate(() => localStorage.setItem("rounding-v2", JSON.stringify({seenIntro:true})));
  await page.goto(base, {waitUntil:"load"});
  const n = await page.locator("#hero .digit").count();
  let advanced = false;
  for(let i=0;i<n;i++){
    await page.locator("#hero .digit").nth(i).click();
    if(await page.locator("#hero .digit").nth(i).evaluate(e => e.classList.contains("found"))){
      advanced = true; break;
    }
  }
  ok(advanced, "a question can be answered offline");
  const imgOffline = await page.evaluate(() => fetch("og.png").then(r => r.ok).catch(() => false));
  ok(imgOffline, "og.png served from cache offline");

  // ---- 3. upgrade: a new build must win, never the cached one ----
  console.log("\n[3] back online with a new build deployed");
  await ctx.setOffline(false);
  const html = fs.readFileSync(path.join(DIR,"index.html"), "utf8");
  fs.writeFileSync(path.join(DIR,"index.html"),
    // match the tag, not its wording, so retitling the app cannot quietly turn
    // this upgrade check into a no-op that still reports green
    html.replace(/<title>[^<]*<\/title>/, "<title>NEWBUILD</title>"));

  await page.goto(base, {waitUntil:"load"});
  const t1 = await page.title();
  ok(t1.includes("NEWBUILD"), `new build served on the next load (title = "${t1}")`);

  // ---- 4. version bump evicts the old cache ----
  console.log("\n[4] worker version bumped");
  const sw = fs.readFileSync(path.join(DIR,"sw.js"), "utf8");
  fs.writeFileSync(path.join(DIR,"sw.js"), sw.replace('const VERSION = "v2"', 'const VERSION = "v3"'));
  await page.goto(base, {waitUntil:"load"});
  await page.evaluate(() => navigator.serviceWorker.getRegistration().then(r => r && r.update()));
  await page.waitForTimeout(2500);
  await page.goto(base, {waitUntil:"load"});
  await page.waitForTimeout(1500);
  const keys2 = await page.evaluate(() => caches.keys());
  ok(keys2.includes("rounding-v3"), `v3 cache created (got ${JSON.stringify(keys2)})`);
  ok(!keys2.includes("rounding-v2"), "old cache deleted, no stale assets left behind");

  // ---- 5. still offline-capable after the upgrade ----
  console.log("\n[5] offline again after upgrading");
  await ctx.setOffline(true);
  await page.goto(base, {waitUntil:"load"});
  const t2 = await page.title();
  ok(t2.includes("NEWBUILD"), `offline now serves the NEW build, not the old one (title = "${t2}")`);

  await browser.close();
  server.close();
  console.log(`\n${checks - fails}/${checks} checks passed`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); server.close(); process.exit(1); });
