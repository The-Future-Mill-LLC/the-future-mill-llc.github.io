// 405 Live: how the 405 is flowing right now, stretch by stretch, for the game's real-time mode.
// Runs on a schedule (GitHub Actions, every 15 minutes) and writes the405/live.json next to the privacy page.
// The phones only ever read that file, so TomTom sees ~21 requests per run however many people play
// (about 2,000 a day, inside TomTom's free 2,500).
//
//   TOMTOM_KEY=... node scripts/live405.mjs            writes the405/live.json
// Every sample point's reading goes to the log (the Actions run page), to spot points that miss the freeway.
//
// Output: {"updated": ISO time, "source": "TomTom", "regions": {"valley": {"ratio": 0.62, "mph": 41, "freeMph": 66, "samples": 3}, ...}}
// ratio = current speed / free-flow speed, averaged over the stretch (1 = flowing freely, 0.2 = crawling).
// A region with no usable samples is left out, and the game falls back to the 405's usual pattern for it.

import { mkdirSync, writeFileSync } from "node:fs";

// Spots on the 405 itself, two or three per stretch of the game's map, snapped onto the freeway's exact path
// (OpenStreetMap, via an OSRM route along the I 405) so TomTom reads the freeway, not a street beside it.
const POINTS = {
  valley: [[34.24271, -118.47311], [34.20094, -118.47363], [34.17441, -118.46783]],
  pass: [[34.12144, -118.47935], [34.09478, -118.47646]],
  westside: [[34.04681, -118.44672], [34.01259, -118.41897]],
  lax: [[33.96023, -118.36944], [33.93071, -118.36853]],
  southBay: [[33.88484, -118.35300], [33.85974, -118.30505]],
  longBeach: [[33.82518, -118.21998], [33.80284, -118.13612]],
  oc: [[33.73278, -117.98979], [33.69054, -117.92305], [33.66463, -117.80465]],
};

const key = process.env.TOMTOM_KEY;
if (!key) { console.log("No TOMTOM_KEY set: skipping live traffic."); process.exit(0); }

async function sample([lat, lon]) {
  // zoom 10 only considers major roads, so the point snaps to the freeway rather than a street next to it
  const url = `https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/10/json?point=${lat},${lon}&unit=mph&key=${key}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`TomTom ${res.status} for ${lat},${lon}`);
  const f = (await res.json()).flowSegmentData;
  return { frc: f.frc, mph: f.currentSpeed, freeMph: f.freeFlowSpeed, closed: f.roadClosure, confidence: f.confidence, at: f.coordinates?.coordinate?.[0] };
}

const regions = {};
let failures = 0;
for (const [region, points] of Object.entries(POINTS)) {
  const good = [];
  for (const p of points) {
    try {
      const s = await sample(p);
      console.log(region.padEnd(10), p.join(","), JSON.stringify(s));
      // freeways only (FRC0, FRC1 at worst), and only readings TomTom is reasonably sure of
      if (!["FRC0", "FRC1"].includes(s.frc) || !(s.freeMph > 0) || s.confidence < 0.5) continue;
      good.push(s.closed ? { ...s, mph: 0 } : s);
    } catch (e) { failures++; console.error(String(e)); }
  }
  if (good.length === 0) continue;
  const mph = good.reduce((a, s) => a + s.mph, 0) / good.length;
  const freeMph = good.reduce((a, s) => a + s.freeMph, 0) / good.length;
  regions[region] = { ratio: Math.round((mph / freeMph) * 100) / 100, mph: Math.round(mph), freeMph: Math.round(freeMph), samples: good.length };
}

const out = { updated: new Date().toISOString(), source: "TomTom", regions };
console.log(JSON.stringify(out));
mkdirSync("the405", { recursive: true });
writeFileSync("the405/live.json", JSON.stringify(out) + "\n");
if (Object.keys(regions).length === 0) { console.error(`No live traffic at all (${failures} failed requests).`); process.exit(1); }
