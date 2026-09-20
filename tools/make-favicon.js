// Renders tools/favicon.html at 48 and 32 and packs both into favicon.ico.
//
//   CHROMIUM_PATH=/path/to/chrome node tools/make-favicon.js
//
// An .ico is a 6-byte header, then one 16-byte directory entry per image, then
// the image data. Every format that matters has read PNG inside .ico for well
// over a decade, so the entries hold PNGs rather than the old BMP encoding.

const {chromium} = require("playwright");
const fs = require("fs");
const path = require("path");

const SIZES = [48, 32];
const ROOT = path.join(__dirname, "..");

(async () => {
  const b = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ["--no-sandbox"]
  });
  const pngs = [];
  for(const s of SIZES){
    const p = await b.newPage({viewport: {width: s, height: s}, deviceScaleFactor: 1});
    await p.goto("file://" + path.join(__dirname, "favicon.html"));
    // The source lays out at 48; scale the box for the smaller one.
    await p.addStyleTag({content:
      `html,body{width:${s}px;height:${s}px}svg{width:${s}px;height:${s}px}`});
    pngs.push({size: s, data: await p.screenshot({omitBackground: false})});
    await p.close();
  }
  await b.close();

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);              // reserved
  header.writeUInt16LE(1, 2);              // 1 = icon
  header.writeUInt16LE(pngs.length, 4);

  let offset = 6 + 16 * pngs.length;
  const entries = [], blobs = [];
  for(const {size, data} of pngs){
    const e = Buffer.alloc(16);
    e.writeUInt8(size === 256 ? 0 : size, 0);   // 0 means 256
    e.writeUInt8(size === 256 ? 0 : size, 1);
    e.writeUInt8(0, 2);                          // palette size
    e.writeUInt8(0, 3);                          // reserved
    e.writeUInt16LE(1, 4);                       // color planes
    e.writeUInt16LE(32, 6);                      // bits per pixel
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    entries.push(e);
    blobs.push(data);
  }

  const out = Buffer.concat([header, ...entries, ...blobs]);
  fs.writeFileSync(path.join(ROOT, "favicon.ico"), out);
  console.log("favicon.ico written: " + out.length + " bytes, " +
    pngs.map(p => p.size + "x" + p.size).join(" + "));
})();
