/* ScrubFuel planner: picks meals for each shift so packages get used up, builds the grocery list,
   and lays out a hydration and caffeine timeline. Pure logic, no DOM. */
import { CATALOG, PANTRY, RECIPES } from "./food.js";

export const SLOT_NAMES = { pre: "Before shift", meal: "On-shift meal", snack: "Protein snack", post: "After shift" };
export const ON_FLOOR = { meal: 1, snack: 1 };
export const DEPT_ORDER = ["Produce", "Deli", "Meat", "Dairy & Eggs", "Bakery", "Frozen", "Pantry", "Snacks", "Beverages"];

/* Seeded random so a plan stays the same until someone taps Shuffle */
function rng(seed) { let s = (seed >>> 0) || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 1e9) / 1e9; }; }

export function eligible(r, slot, cfg) {
  if (!r.slots.includes(slot)) return false;
  const d = r.d.split(" ");
  for (const k of ["v", "df", "gf", "nf"]) if (cfg.diet[k] && !d.includes(k)) return false;
  if (slot === "snack" && !cfg.lowp && r.p < 10) return false;   // on-shift snacks are protein snacks
  if (ON_FLOOR[slot]) {
    if (cfg.f.odor && r.odor > 0) return false;
    if (cfg.f.nomic && r.mic > 1) return false;
    if (cfg.f.speed && (r.eat > 7 || (slot === "snack" && !r.hand))) return false;
  }
  return true;
}

export function slotsFor(cfg) {
  const out = [];
  cfg.shifts.forEach((sh, i) => {
    const list = ["pre", "meal", "snack", "snack"]; if (cfg.post) list.push("post");
    list.forEach((slot, j) => out.push({ shift: i, slot, idx: j }));
  });
  return out;
}

/* How fast leftovers spoil once opened: 1 = use within days, 0.4 = keeps 1–2 weeks, 0.1 = keeps for weeks */
export const SPOIL = { spinach: 1, greens: 1, berries: 1, avocado: 1, banana: 1, tomato: 1, cucumber: 1, pepper: 1, snappeas: 1, hummus: 1, chicken: 1, turkey: 1, groundturkey: 1, tofu: 1, cottage: 1, mozz: 1, feta: 1, chickpeas: 1, blackbeans: 1,
  milk: .4, yogurt: .4, carrots: .4, grapes: .4, apple: .4, sweetpotato: .4, pesto: .4, salsa: .4, tortilla: .4, bread: .4, lemon: .4, lime: .4,
  cheddar: .1, eggs: .1, stringcheese: .1 };
const spoil = k => SPOIL[k] ?? (CATALOG[k].perishable ? .4 : 0);
/* Dollar value of food likely to go bad, given total quantities used */
function wasteOf(use) {
  let w = 0;
  for (const k in use) { const c = CATALOG[k]; const f = spoil(k); if (!f) continue; const pk = Math.ceil(use[k] / c.pkg - 1e-9); w += (pk * c.pkg - use[k]) / c.pkg * c.price * f; }
  return w;
}
function costOf(use) { let t = 0; for (const k in use) { const c = CATALOG[k]; t += Math.ceil(use[k] / c.pkg - 1e-9) * c.price; } return t; }
const addUse = (use, r) => { const u = { ...use }; r.i.forEach(([k, q]) => { u[k] = (u[k] || 0) + q; }); return u; };

/* Pool for a slot. If the filters leave nothing, relax them one at a time and say so. */
const RELAX = [["speed", "Speed eat"], ["nomic", "No microwave"], ["odor", "Zero odor"]];
function poolFor(slot, cfg) {
  let pool = RECIPES.filter(r => eligible(r, slot, cfg));
  if (pool.length || !ON_FLOOR[slot]) return { pool, relaxed: [] };
  const f = { ...cfg.f }, relaxed = [];
  if (slot === "snack") { pool = RECIPES.filter(r => eligible(r, slot, { ...cfg, lowp: true })); if (pool.length) return { pool, relaxed: ["10 g protein minimum"] }; cfg = { ...cfg, lowp: true }; relaxed.push("10 g protein minimum"); }
  for (const [k, label] of RELAX) {
    if (!f[k]) continue; f[k] = false; relaxed.push(label);
    pool = RECIPES.filter(r => eligible(r, slot, { ...cfg, f }));
    if (pool.length) break;
  }
  return { pool, relaxed };
}

/* What makes a plan good: little food wasted, variety, enough protein, sensible cost. Lower is better. */
function objective(picks, slots, cfg) {
  const use = {}; let pen = 0; const count = {}, perShift = {};
  picks.forEach((r, k) => {
    if (!r) return; const s = slots[k];
    r.i.forEach(([key, q]) => { use[key] = (use[key] || 0) + q; });
    count[r.id] = (count[r.id] || 0) + 1;
    const ps = perShift[s.shift] = perShift[s.shift] || {}; if (ps[r.id]) pen += 4; ps[r.id] = 1;  // no repeats inside one shift
    if (s.slot === "meal") pen += Math.max(0, 28 - r.p) / 7;            // shift meal should carry protein
    if (s.slot === "pre") pen += Math.max(0, 20 - r.p) / 10;
    if (s.slot === "snack") pen += Math.max(0, 15 - r.p) / 6;            // protein snacks: aim for 15 g+
  });
  const n = cfg.shifts.length;
  for (const id in count) {
    const c = count[id];
    if (cfg.style === "batch") pen += c > n ? (c - n) * 1.5 : 0;           // batch: repeating across shifts is the point
    else pen += (c - 1) * 2.0;                                              // mix: variety
  }
  if (cfg.style === "batch") { const meals = new Set(picks.filter((r, k) => r && slots[k].slot === "meal").map(r => r.id)); pen += Math.max(0, meals.size - Math.ceil(n / 3)) * 1.2; }
  return { score: wasteOf(use) * 3.2 + 0.03 * costOf(use) + pen, use };
}

function runOnce(cfg, slots, pools, rand) {
  const picks = slots.map((s, k) => { const p = pools[k].pool; return p.length ? p[Math.floor(rand() * p.length)] : null; });
  let cur = objective(picks, slots, cfg).score;
  for (let pass = 0; pass < 4; pass++) {            // hill climb: try every alternative in every slot
    let improved = false;
    const order = slots.map((_, k) => k).sort(() => rand() - .5);
    for (const k of order) {
      const pool = pools[k].pool; if (pool.length < 2) continue;
      let best = picks[k], bestScore = cur;
      for (const r of pool) { if (r === picks[k]) continue; picks[k] = r; const sc = objective(picks, slots, cfg).score; if (sc < bestScore - 1e-9) { best = r; bestScore = sc; } }
      picks[k] = best; if (bestScore < cur - 1e-9) { cur = bestScore; improved = true; }
    }
    if (!improved) break;
  }
  return { picks, score: cur };
}

export function poolForSlot(slot, cfg) { return poolFor(slot, cfg); }
/* Rebuild totals, notes and the grocery list after someone swaps a meal */
export function finalizePlan(cfg, picks) {
  const slots = slotsFor(cfg), { use } = objective(picks, slots, cfg);
  const items = slots.map((s, k) => ({ ...s, recipe: picks[k], relaxed: poolFor(s.slot, cfg).relaxed }));
  const shares = shareNotes(items, cfg); items.forEach((it, k) => { it.shares = shares[k] || []; });
  return { items, use, grocery: grocery(use, items), cfg };
}

export function buildPlan(cfg) {
  const slots = slotsFor(cfg), rand = rng(cfg.seed || 1), pools = slots.map(s => poolFor(s.slot, cfg));
  let best = null;
  for (let t = 0; t < 14; t++) { const r = runOnce(cfg, slots, pools, rand); if (!best || r.score < best.score) best = r; }
  const { use } = objective(best.picks, slots, cfg);
  const items = slots.map((s, k) => ({ ...s, recipe: best.picks[k], relaxed: pools[k].relaxed }));
  const shares = shareNotes(items, cfg);
  items.forEach((it, k) => { it.shares = shares[k] || []; });
  return { items, use, grocery: grocery(use, items), cfg };
}

/* Which slots split the same package (e.g. half an avocado on Shift 1, the rest on Shift 2) */
const SHORT = { pre: "before-shift meal", meal: "shift meal", snack: "snack", post: "after-shift snack" };
export function slotLabel(it, cfg) { const sh = cfg.shifts[it.shift]; return `${sh.label || "Shift " + (it.shift + 1)} ${SHORT[it.slot]}`; }
function shareNotes(items, cfg) {
  const notes = {}, cum = {};
  const pkgs = {}; // key -> package index -> Set(item idx)
  items.forEach((it, idx) => {
    if (!it.recipe) return;
    it.recipe.i.forEach(([k, q]) => {
      const c = CATALOG[k]; if (spoil(k) < 1 || c.pkg <= q) { cum[k] = (cum[k] || 0) + q; return; }
      const a = cum[k] || 0, b = a + q; cum[k] = b;
      for (let p = Math.floor(a / c.pkg + 1e-9); p <= Math.floor((b - 1e-9) / c.pkg); p++) { ((pkgs[k] = pkgs[k] || {})[p] = pkgs[k][p] || new Set()).add(idx); }
    });
  });
  for (const k in pkgs) for (const p in pkgs[k]) {
    const set = [...pkgs[k][p]]; if (set.length < 2) continue;
    set.forEach(idx => {
      const others = set.filter(j => j !== idx && items[j].recipe.id !== items[idx].recipe.id);
      if (!others.length) return;
      (notes[idx] = notes[idx] || []).push({ key: k, name: CATALOG[k].name.toLowerCase().replace(/ \(.*\)/, ""), with: [...new Set(others.map(j => slotLabel(items[j], cfg)))].slice(0, 2) });
    });
  }
  for (const i in notes) { const seen = new Set(); notes[i] = notes[i].filter(n => !seen.has(n.key) && seen.add(n.key)); }
  return notes;
}

const fmtQty = (q, unit) => {
  const r = Math.round(q * 4) / 4, w = Math.floor(r), f = r - w, frac = f === .25 ? "¼" : f === .5 ? "½" : f === .75 ? "¾" : "";
  const num = (w ? w : "") + frac || "0";
  return unit === "ea" ? num : `${num} ${unit}`;
};
export { fmtQty };

export function grocery(use, items) {
  const rows = [], pantry = new Set();
  (items || []).forEach(it => it.recipe && it.recipe.pan.forEach(p => pantry.add(PANTRY[p])));
  let checkout = 0, eaten = 0, wasteVal = 0, perishVal = 0;
  for (const k in use) {
    const c = CATALOG[k], q = use[k], n = Math.ceil(q / c.pkg - 1e-9), left = n * c.pkg - q;
    checkout += n * c.price; eaten += q / c.pkg * c.price;
    if (c.perishable) { perishVal += n * c.price; wasteVal += left / c.pkg * c.price * spoil(k); }
    const single = c.pkg === 1 && c.unit === "ea";
    rows.push({
      key: k, name: c.name, dept: c.dept, count: n, perishable: c.perishable,
      buy: single ? `${n}` : `${n} × ${c.label}`,
      uses: single ? "" : `uses ${fmtQty(q, c.unit)}`,
      left: c.perishable && left / c.pkg >= 0.15 ? fmtQty(left, c.unit) : null, keeps: spoil(k) >= 1 ? "use within a few days" : spoil(k) >= .4 ? "keeps 1–2 weeks" : "keeps for weeks",
      instacart: { name: c.name.replace(/ \(.*\)/, ""), display_text: single ? c.name : `${c.name} (${c.label})`, line_item_measurements: [{ quantity: n, unit: single ? "each" : "package" }] }
    });
  }
  rows.sort((a, b) => (DEPT_ORDER.indexOf(a.dept) - DEPT_ORDER.indexOf(b.dept)) || a.name.localeCompare(b.name));
  const meals = (items || []).filter(it => it.recipe).length;
  return {
    rows, pantry: [...pantry].sort(), checkout, eaten, perMeal: meals ? eaten / meals : 0,
    zeroWaste: perishVal ? Math.max(0, Math.min(100, Math.round((1 - wasteVal / perishVal) * 100))) : 100,
    leftovers: rows.filter(r => r.left).map(r => ({ name: r.name, left: r.left, keeps: r.keeps })).sort((a, b) => (a.keeps === "use within a few days" ? 0 : 1) - (b.keeps === "use within a few days" ? 0 : 1))
  };
}

/* ───────── Hydration & caffeine ───────── */
const hm = m => { m = ((m % 1440) + 1440) % 1440; const h = Math.floor(m / 60), mm = m % 60, ap = h >= 12 ? "PM" : "AM"; return `${h % 12 || 12}:${String(mm).padStart(2, "0")} ${ap}`; };
const toMin = s => { const [h, m] = s.split(":").map(Number); return h * 60 + (m || 0); };
export function hydration(type, startStr, lenH) {
  const S = toMin(startStr), E = S + lenH * 60, night = type === "night";
  const sleep = night ? E + 90 : Math.max(E + 180, toMin("22:30") + (toMin("22:30") < S ? 1440 : 0));
  const cutoff = sleep - 6 * 60;
  const ev = [];
  ev.push({ m: S - 60, k: "food", t: "Eat your before-shift meal", d: "Protein plus slow carbs, so you're not running on empty in the first rush." });
  ev.push({ m: S, k: "caf", t: "Coffee OK", d: "Start-of-shift caffeine is fine. Pair it with water." });
  ev.push({ m: S + 120, k: "water", t: "Water check", d: "Refill your bottle. Aim to drink steadily, not all at once at break." });
  const mid = S + Math.round(lenH * 60 * 0.45);
  ev.push({ m: mid, k: "food", t: "On-shift meal", d: "Your main meal. Eat it even if you're not hungry yet." });
  ev.push({ m: S + Math.round(lenH * 60 * 0.55), k: "lyte", t: "Electrolytes", d: "Mid-shift is a good time for an electrolyte drink, especially after hours in PPE." });
  if (cutoff > S && cutoff < E) ev.push({ m: cutoff, k: "stop", t: "Last call for caffeine", d: `About 6 hours before you plan to sleep (around ${hm(sleep)}), so it doesn't wreck your rest.` });
  else if (cutoff <= S) ev.push({ m: S + 30, k: "stop", t: "Go easy on caffeine today", d: `Your sleep is planned for ${hm(sleep)}, so caffeine this shift will likely cut into it.` });
  if (night) ev.push({ m: Math.max(S + 360, toMin("03:00") + (toMin("03:00") < S ? 1440 : 0)), k: "dip", t: "Beat the 3 AM dip", d: "Protein snack plus water instead of sugar or another coffee. Bright light and a short walk help too." });
  else ev.push({ m: Math.max(S + 360, toMin("15:00")), k: "dip", t: "Afternoon slump", d: "Grab-snack time: protein and water, not the vending machine." });
  ev.push({ m: E - 90, k: "water", t: "Water check", d: "Finish your bottle now rather than right before bed." });
  ev.push({ m: E, k: "end", t: "Shift over", d: night ? "Skip caffeine. Have a small, light snack and wear sunglasses on the drive home to help you sleep." : "Small dinner, then wind down. No caffeine." });
  return { events: ev.sort((a, b) => a.m - b.m).map(e => ({ ...e, time: hm(e.m) })), sleep: hm(sleep), cutoff: hm(cutoff), start: hm(S), end: hm(E) };
}

/* Share code: compact settings in the URL so a coworker opens the same plan */
export function encodeCfg(cfg) {
  const o = { s: cfg.shifts.map(s => s.type === "night" ? "N" : "D").join(""), l: cfg.len, ds: cfg.dayStart, ns: cfg.nightStart, f: ["odor", "speed", "nomic", "hydro"].filter(k => cfg.f[k]).join(","), d: ["v", "df", "gf", "nf"].filter(k => cfg.diet[k]).join(","), p: cfg.post ? 1 : 0, y: cfg.style === "batch" ? "b" : "m", r: cfg.seed };
  return btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function decodeCfg(code) {
  try {
    const b = code.replace(/-/g, "+").replace(/_/g, "/"); const o = JSON.parse(atob(b + "===".slice((b.length + 3) % 4)));
    if (!/^[DN]{1,5}$/.test(o.s)) return null;
    const ok = t => /^\d{2}:\d{2}$/.test(t || "");
    const f = String(o.f || "").split(","), d = String(o.d || "").split(",");
    return { types: o.s.split("").map(c => c === "N" ? "night" : "day"), len: [8, 10, 12].includes(+o.l) ? +o.l : 12, dayStart: ok(o.ds) ? o.ds : "07:00", nightStart: ok(o.ns) ? o.ns : "19:00",
      f: { odor: f.includes("odor"), speed: f.includes("speed"), nomic: f.includes("nomic"), hydro: f.includes("hydro") }, diet: { v: d.includes("v"), df: d.includes("df"), gf: d.includes("gf"), nf: d.includes("nf") },
      post: !!o.p, style: o.y === "b" ? "batch" : "mix", seed: (+o.r >>> 0) || 1 };
  } catch (e) { return null; }
}
