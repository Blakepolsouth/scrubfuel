import { CATALOG, PANTRY, RECIPES } from "./food.js";
import { STEPS } from "./steps.js";
import { walmartCartURL, amazonCartURL, AMAZON, AMAZON_TAG } from "./stores.js";
import { SLOT_NAMES, DEPT_ORDER, buildPlan, finalizePlan, poolForSlot, hydration, encodeCfg, decodeCfg, fmtQty } from "./planner.js";

const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const HOST = location.hostname;
const PREVIEW = !(HOST === "scrubfuel.com" || HOST.endsWith(".scrubfuel.com") || HOST.endsWith(".netlify.app") || HOST === "localhost" || HOST === "127.0.0.1" || HOST.endsWith(".test"));
const MAX = 5, DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const store = {
  get(k, d) { try { const v = localStorage.getItem("sf:" + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem("sf:" + k, JSON.stringify(v)); } catch (e) {} }
};

/* ── state ──
   Shifts are saved by calendar date, so Mon/Tue/Wed stay Mon/Tue/Wed as the week goes on. */
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fromIso = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const today = new Date(); today.setHours(0, 0, 0, 0);
const TODAY = iso(today);
const DEFAULT = { store: "publix", anchor: TODAY, dates: {}, len: 12, dayStart: "07:00", nightStart: "19:00", f: { odor: true, speed: true, nomic: false, hydro: true }, diet: { v: false, df: false, gf: false, nf: false }, post: false, style: "mix", seed: 1, swaps: null, nope: [] };
const saved = store.get("settings", null);
const RETURNING = !!saved;
let S = Object.assign(structuredClone(DEFAULT), saved || {});
if (Array.isArray(S.week)) { S.anchor = TODAY; S.dates = {}; S.week.forEach((t, i) => { if (t !== "off") S.dates[iso(addDays(today, i))] = t; }); delete S.week; }
if (!saved) { S.dates = { [TODAY]: "night", [iso(addDays(today, 1))]: "night", [iso(addDays(today, 2))]: "night" }; }
if (!Array.isArray(S.nope)) S.nope = [];
let newWeek = false;
if (fromIso(S.anchor) > today || (today - fromIso(S.anchor)) / 864e5 > 6) {      // stretch is over: start a fresh week
  newWeek = RETURNING && Object.keys(S.dates).length > 0;
  S.anchor = TODAY; S.dates = {}; S.swaps = null; store.set("checks", {}); store.set("prep", {});
}
let DAYS = [];
const setDays = () => { DAYS = Array.from({ length: 7 }, (_, i) => addDays(fromIso(S.anchor), i)); };
setDays();

const shared = new URLSearchParams(location.search).get("p");
let fromShare = false;
if (shared) {
  const c = decodeCfg(shared);
  if (c) {
    fromShare = true; S.anchor = TODAY; setDays(); S.dates = {}; S.swaps = null;
    c.types.forEach((t, i) => { S.dates[iso(DAYS[i])] = t; });
    Object.assign(S, { len: c.len, dayStart: c.dayStart, nightStart: c.nightStart, f: c.f, diet: c.diet, post: c.post, style: c.style, seed: c.seed });
  }
  history.replaceState(null, "", location.pathname);
}

let plan = null, picks = [], activeShift = 0;
const typeOf = d => S.dates[iso(d)] || "off";

function cfg() {
  const shifts = [];
  DAYS.forEach(d => { const t = typeOf(d); if (t !== "off" && shifts.length < MAX) shifts.push({ type: t, label: DOW[d.getDay()], date: iso(d) }); });
  return { shifts, len: S.len, dayStart: S.dayStart, nightStart: S.nightStart, f: S.f, diet: S.diet, post: S.post, style: S.style, seed: S.seed, exclude: S.nope };
}
const save = () => store.set("settings", S);

/* ── step 1: shift strip ── */
function renderDays() {
  const n = Object.values(S.dates).length;
  $("#days").innerHTML = DAYS.map((d, i) => {
    const t = typeOf(d), k = iso(d), past = d < today;
    return `<button type="button" class="day${past ? " past" : ""}${k === TODAY ? " now" : ""}" data-d="${k}" data-type="${t}" aria-label="${DOW[d.getDay()]} ${d.getMonth() + 1}/${d.getDate()}: ${t === "off" ? "off" : t + " shift"}">
      <span class="dn">${k === TODAY ? "Today" : DOW[d.getDay()]}</span><span class="dd">${d.getMonth() + 1}/${d.getDate()}</span>
      <span class="ic">${t === "day" ? "☀" : t === "night" ? "☾" : ""}</span><span class="ty">${t === "off" ? "off" : t}</span></button>`;
  }).join("");
  const restart = S.anchor !== TODAY ? ` <button type="button" class="linkbtn" id="restartBtn">Start from today</button>` : "";
  $("#shiftCount").innerHTML = (n ? `${n} shift${n > 1 ? "s" : ""} · max ${MAX}` : "Tap a day: off → day → night") + restart;
}
$("#days").addEventListener("click", e => {
  const b = e.target.closest(".day"); if (!b) return;
  const k = b.dataset.d, cur = S.dates[k] || "off", n = Object.values(S.dates).length;
  const next = cur === "off" ? "day" : cur === "day" ? "night" : "off";
  if (cur === "off" && n >= MAX) { toast(`Up to ${MAX} shifts per plan`); return; }
  if (next === "off") delete S.dates[k]; else S.dates[k] = next;
  save(); renderDays(); regen();
});
$("#shiftCount").addEventListener("click", e => {
  if (!e.target.closest("#restartBtn")) return;
  const keep = {}; DAYS.forEach(d => { if (d >= today && S.dates[iso(d)]) keep[iso(d)] = S.dates[iso(d)]; });
  S.anchor = TODAY; S.dates = keep; S.swaps = null; setDays(); save(); renderDays(); regen(); toast("Week now starts today");
});

function setSeg(sel, attr, val) { $$(`${sel} button`).forEach(b => b.setAttribute("aria-checked", String(b.dataset[attr] == val))); }
$("#lenSeg").addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; S.len = +b.dataset.len; setSeg("#lenSeg", "len", S.len); save(); regen(); });
$("#styleSeg").addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; S.style = b.dataset.style; setSeg("#styleSeg", "style", S.style); save(); regen(); });
$("#dayStart").addEventListener("change", e => { S.dayStart = e.target.value || "07:00"; save(); regen(); });
$("#nightStart").addEventListener("change", e => { S.nightStart = e.target.value || "19:00"; save(); regen(); });
$$(".rule").forEach(b => b.addEventListener("click", () => { const k = b.dataset.f; S.f[k] = !S.f[k]; b.setAttribute("aria-pressed", String(S.f[k])); save(); k === "hydro" ? renderPlan() : regen(); }));
$$(".chip").forEach(b => b.addEventListener("click", () => { const k = b.dataset.d; S.diet[k] = !S.diet[k]; b.setAttribute("aria-pressed", String(S.diet[k])); save(); regen(); }));
$("#postToggle").addEventListener("change", e => { S.post = e.target.checked; save(); regen(); });
$("#shuffleBtn").addEventListener("click", () => { S.seed = (Math.random() * 1e9) >>> 0 || 1; save(); regen(); toast("New plan"); });

function syncControls() {
  setSeg("#storeSeg", "store", S.store);
  setSeg("#lenSeg", "len", S.len); setSeg("#styleSeg", "style", S.style);
  $("#dayStart").value = S.dayStart; $("#nightStart").value = S.nightStart; $("#postToggle").checked = S.post;
  $$(".rule").forEach(b => b.setAttribute("aria-pressed", String(!!S.f[b.dataset.f])));
  $$(".chip").forEach(b => b.setAttribute("aria-pressed", String(!!S.diet[b.dataset.d])));
}

/* ── step 3: plan ── */
const toMin = s => { const [h, m] = s.split(":").map(Number); return h * 60 + (m || 0); };
const hm = m => { m = ((Math.round(m) % 1440) + 1440) % 1440; const h = Math.floor(m / 60), mm = m % 60; return `${h % 12 || 12}:${String(mm).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`; };
function slotTime(it, c) {
  const sh = c.shifts[it.shift], st = toMin(sh.type === "night" ? c.nightStart : c.dayStart), L = c.len * 60;
  if (it.slot === "pre") return hm(st - 60);
  if (it.slot === "meal") return hm(st + L * .45);
  if (it.slot === "post") return hm(st + L + 30);
  return hm(st + (it.idx === 2 ? L * .25 : L * .72));
}

/* Swaps are remembered for as long as the shifts and rules stay the same */
const sigOf = c => encodeCfg(c) + "|" + c.shifts.map(s => s.date).join(",") + "|" + c.exclude.join(",");
function regen() {
  const c = cfg();
  if (!c.shifts.length) { plan = null; picks = []; renderPlan(); return; }
  plan = buildPlan(c); picks = plan.items.map(it => it.recipe);
  const sig = sigOf(c);
  if (S.swaps && S.swaps.sig === sig) {
    let changed = false;
    for (const k in S.swaps.map) { const r = RECIPES.find(x => x.id === S.swaps.map[k]); if (r && picks[k] !== undefined) { picks[k] = r; changed = true; } }
    if (changed) plan = finalizePlan(c, picks);
  } else if (S.swaps) { S.swaps = null; save(); }
  if (activeShift >= c.shifts.length) activeShift = 0;
  renderPlan();
}

function badges(r, slot) {
  const b = [`<span class="badge p">${r.p} g protein</span>`, `<span class="badge">⏱ ${r.eat} min</span>`];
  if (r.odor === 0) b.push(`<span class="badge">No odor</span>`); else if (r.odor === 2) b.push(`<span class="badge warn">Strong smell</span>`);
  if (r.mic === 0) b.push(`<span class="badge">🧊 Eat cold</span>`); else if (r.mic === 1) b.push(`<span class="badge">Good cold or warm</span>`); else b.push(`<span class="badge warn">Needs microwave</span>`);
  if (r.hand) b.push(`<span class="badge">One hand</span>`);
  return b.join("");
}

function renderPlan() {
  const empty = !plan;
  $("#stats").hidden = $("#shiftTabs").hidden = empty; $("#shuffleBtn").hidden = empty;
  $("#grocery").hidden = empty; $(".unit").hidden = empty; $("#prepday").hidden = empty;
  renderSetupBar(); renderNope();
  if (empty) { $("#slots").innerHTML = `<div class="slot empty"><h3>Tap at least one day in Step 1 to build your plan.</h3></div>`; $("#hydro").innerHTML = ""; renderToday(); return; }
  const c = plan.cfg, g = plan.grocery;
  $("#stats").innerHTML = `
    <div class="stat hl"><b>${g.zeroWaste}%</b><span>fresh food used up</span></div>
    <div class="stat"><b>$${g.perMeal.toFixed(2)}</b><span>per meal, roughly</span></div>
    <div class="stat"><b>$${Math.round(g.checkout)}</b><span>one-trip checkout</span></div>`;
  $("#shiftTabs").innerHTML = c.shifts.map((s, i) => `<button type="button" class="tab" role="tab" data-i="${i}" aria-selected="${i === activeShift}">${s.type === "night" ? "☾" : "☀"} ${s.label}</button>`).join("");
  const items = plan.items.map((it, k) => ({ ...it, k })).filter(it => it.shift === activeShift);
  const prot = items.reduce((t, it) => t + (it.recipe ? it.recipe.p : 0), 0), snackP = items.filter(it => it.slot === "snack" && it.recipe).reduce((t, it) => t + it.recipe.p, 0);
  $("#slots").innerHTML = `<p class="protline"><b>≈ ${prot} g protein</b> this shift, including ${snackP} g from protein snacks.</p>` + items.map(it => {
    const r = it.recipe;
    if (!r) return `<div class="slot empty"><div class="when">${SLOT_NAMES[it.slot]}</div><h3>No meal fits every rule here. Try turning off a diet filter.</h3></div>`;
    const share = it.shares && it.shares.length ? it.shares.map(s => `<p class="share">♻ <b>Shared ${esc(s.name)}</b> with ${esc(s.with.join(" and "))}, so none goes to waste.</p>`).join("") : "";
    const relax = it.relaxed && it.relaxed.length ? `<p class="share">ℹ Not enough options fit every rule, so this one relaxes: ${esc(it.relaxed.join(", "))}.</p>` : "";
    return `<article class="slot"><div class="when">${SLOT_NAMES[it.slot]} · ${slotTime(it, c)}</div>
      <h3>${esc(r.n)}</h3><button type="button" class="swap" data-k="${it.k}" aria-label="Swap ${esc(r.n)}">↻ Swap</button>
      <div class="badges">${badges(r, it.slot)}</div><p class="prep">${esc(r.prep)}</p>${share}${relax}
      <button type="button" class="howto" data-k="${it.k}">📖 Recipe & how to make it</button></article>`;
  }).join("");
  renderHydro();
  renderPrep();
  renderGrocery();
  renderToday();
  renderRemind(); scheduleSync();
}
$("#shiftTabs").addEventListener("click", e => { const b = e.target.closest(".tab"); if (!b) return; activeShift = +b.dataset.i; renderPlan(); });
$("#slots").addEventListener("click", e => {
  const h = e.target.closest(".howto"); if (h) { openRecipe(+h.dataset.k); return; }
  const b = e.target.closest(".swap"); if (!b) return;
  const k = +b.dataset.k, it = plan.items[k], { pool } = poolForSlot(it.slot, plan.cfg);
  if (pool.length < 2) { toast("No other options fit these rules"); return; }
  const sameShift = new Set(plan.items.filter((x, j) => x.shift === it.shift && j !== k).map(x => x.recipe && x.recipe.id));
  let i = pool.indexOf(picks[k]), tries = 0, next;
  do { i = (i + 1) % pool.length; next = pool[i]; tries++; } while ((next === picks[k] || sameShift.has(next.id)) && tries < pool.length);
  picks[k] = next; plan = finalizePlan(plan.cfg, picks);
  const sig = sigOf(plan.cfg); if (!S.swaps || S.swaps.sig !== sig) S.swaps = { sig, map: {} };
  S.swaps.map[k] = next.id; save(); renderPlan();
});

/* Recipe popup */
const ingName = (c, q) => c.unit === "ea" ? c.name.replace(/ \(.*\)/, "") : c.name.replace(/ \(.*\)/, "");
let recipeOpen = -1;
function openRecipe(k) {
  const it = plan.items[k], r = it.recipe; if (!r) return; recipeOpen = k;
  const steps = STEPS[r.id] || [r.prep];
  $("#recipeTitle").textContent = r.n;
  $("#recipeBody").innerHTML = `<p class="rmeta">${SLOT_NAMES[it.slot]} · ${esc(plan.cfg.shifts[it.shift].label)} · ${slotTime(it, plan.cfg)}</p>
    <div class="badges">${badges(r, it.slot)}</div>
    <h4>Ingredients <span>(1 serving)</span></h4>
    <ul class="ing">${r.i.map(([key, q]) => { const c = CATALOG[key]; return `<li><span>${esc(ingName(c, q))}</span><b>${esc(fmtQty(q, c.unit))}</b></li>`; }).join("")}
    ${r.pan.map(p => `<li class="pan"><span>${esc(PANTRY[p])}</span><b>pantry</b></li>`).join("")}</ul>
    <h4>How to make it</h4>
    <ol class="steps">${steps.map(s => `<li>${esc(s)}</li>`).join("")}</ol>
    <p class="tip"><b>Packing tip:</b> ${esc(r.prep)}</p>
    ${it.shares && it.shares.length ? `<p class="tip">♻ Uses the same ${esc(it.shares.map(s => s.name).join(" and "))} as ${esc([...new Set(it.shares.flatMap(s => s.with))].slice(0, 2).join(" and "))}.</p>` : ""}`;
  $("#sheetBack").hidden = $("#recipeSheet").hidden = false;
  $("#recipeSheet").scrollTop = 0; $("#recipeClose").focus();
}
function closeRecipe() { $("#recipeSheet").hidden = true; if ($("#installSheet").hidden) $("#sheetBack").hidden = true; }
$("#recipeClose").addEventListener("click", closeRecipe);
$("#nopeBtn").addEventListener("click", () => {
  const it = plan.items[recipeOpen]; if (!it || !it.recipe) return;
  const r = it.recipe; if (!S.nope.includes(r.id)) S.nope.push(r.id);
  save(); closeRecipe(); regen(); toast(`Got it. No more ${r.n.toLowerCase()}.`);
});
function renderNope() {
  const n = S.nope.length, el = $("#nopeLine");
  el.hidden = !n; if (n) el.innerHTML = `${n} meal${n > 1 ? "s" : ""} hidden because you marked ${n > 1 ? "them" : "it"} "not for me". <button type="button" class="linkbtn" id="nopeReset">Show again</button>`;
}
$("#nopeLine").addEventListener("click", e => { if (!e.target.closest("#nopeReset")) return; S.nope = []; save(); regen(); toast("Hidden meals are back"); });

/* ── setup summary bar: returning users land on their plan, not the settings ── */
let setupOpen = !RETURNING;
function renderSetupBar() {
  const bar = $("#setupBar"), c = cfg();
  const nights = c.shifts.filter(s => s.type === "night").length, days = c.shifts.length - nights;
  const parts = [nights && `${nights} night${nights > 1 ? "s" : ""}`, days && `${days} day${days > 1 ? "s" : ""}`].filter(Boolean).join(" + ") || "No shifts yet";
  const rules = [S.f.odor && "zero odor", S.f.speed && "7-min", S.f.nomic && "no microwave"].filter(Boolean).join(", ");
  bar.innerHTML = `<span><b>${parts}</b> · ${S.len} hr${rules ? ` · ${rules}` : ""}</span><span class="edit">${setupOpen ? "Done ▴" : "Edit ▾"}</span>`;
  bar.hidden = !RETURNING; bar.setAttribute("aria-expanded", String(setupOpen));
  $("#setup").hidden = !setupOpen; $("#hero").hidden = RETURNING;
}
$("#setupBar").addEventListener("click", () => { setupOpen = !setupOpen; renderSetupBar(); if (setupOpen) $("#setup").scrollIntoView({ behavior: "smooth", block: "start" }); });

/* ── Today card: the reason to open the app every shift ── */
function shiftWindow(sh, c) {
  const st = toMin(sh.type === "night" ? c.nightStart : c.dayStart), start = new Date(fromIso(sh.date)); start.setMinutes(st);
  return { start, end: new Date(start.getTime() + c.len * 36e5), st };
}
const rel = (d, now) => { const days = Math.round((new Date(d).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / 864e5); return days === 0 ? "today" : days === 1 ? "tomorrow" : `${DOW[d.getDay()]}`; };
function renderToday() {
  const el = $("#today");
  if (!plan || !RETURNING) { el.hidden = true; return; }
  const c = plan.cfg, now = new Date();
  let idx = -1, mode = "";
  for (let i = 0; i < c.shifts.length; i++) {
    const w = shiftWindow(c.shifts[i], c);
    if (now >= w.start && now < w.end) { idx = i; mode = "on"; break; }
    if (now < w.start) { idx = i; mode = (w.start - now) < 18 * 36e5 ? "soon" : "later"; break; }
  }
  if (idx < 0) {
    el.hidden = false;
    el.innerHTML = `<div class="tdhead"><span class="tdtag">Stretch done</span><h2>You made it. 🎉</h2></div><p class="tdsub">No more shifts in this plan. Tap <b>Edit</b> to set up your next stretch.</p>`;
    return;
  }
  const sh = c.shifts[idx], w = shiftWindow(sh, c), packed = store.get("packed", {}), pk = packed[sh.date] || {};
  const its = plan.items.map((it, k) => ({ ...it, k })).filter(it => it.shift === idx && it.recipe);
  const pre = its.find(it => it.slot === "pre"), bag = its.filter(it => it.slot === "meal" || it.slot === "snack");
  const prot = its.reduce((t, it) => t + it.recipe.p, 0);
  const title = mode === "on" ? `On shift until ${hm(w.st + c.len * 60)}` : `${sh.type === "night" ? "☾ Night" : "☀ Day"} shift ${rel(w.start, now)} at ${hm(w.st)}`;
  const tag = mode === "on" ? "Now" : mode === "soon" ? "Up next" : "Next shift";
  let next = "";
  if (S.f.hydro) {
    const h = hydration(sh.type, sh.type === "night" ? c.nightStart : c.dayStart, c.len);
    const ev = h.events.map(e => ({ ...e, at: new Date(fromIso(sh.date).getTime() + e.m * 6e4) })).find(e => e.at > now && !(e.k === "food" && e.m < w.st));
    if (ev) next = `<p class="tdnext"><span>${ev.k === "stop" ? "☕" : ev.k === "caf" ? "☕" : ev.k === "dip" ? "⚡" : ev.k === "food" ? "🍽" : "💧"}</span><span><b>${esc(ev.t)}</b> at ${ev.time}</span></p>`;
  }
  const done = bag.filter(it => pk[it.k]).length;
  el.hidden = false;
  el.innerHTML = `<div class="tdhead"><span class="tdtag">${tag}</span><h2>${title}</h2></div>
    ${next}
    ${pre && mode !== "on" ? `<p class="tdsub">Eat before you go: <button type="button" class="linkbtn" data-r="${pre.k}">${esc(pre.recipe.n)}</button></p>` : ""}
    <div class="bag"><div class="baghead"><b>${mode === "on" ? "In your bag" : "Pack your bag"}</b><span>${done}/${bag.length} packed · ≈ ${prot} g protein</span></div>
    ${bag.map(it => `<div class="bagrow"><label><input type="checkbox" data-pack="${it.k}" data-date="${sh.date}"${pk[it.k] ? " checked" : ""}><span><small>${it.slot === "meal" ? "Meal" : "Protein snack"}</small>${esc(it.recipe.n)}</span></label><button type="button" class="howmini" data-r="${it.k}" aria-label="How to make ${esc(it.recipe.n)}">📖</button></div>`).join("")}</div>
    <p class="tdsub tdrem">${S.remind && S.remind.on ? "🔔 Reminders are on for this stretch." : `🔕 <button type="button" class="linkbtn" id="tdRemind">Turn on shift reminders</button> so you don't have to remember.`}</p>`;
}
$("#today").addEventListener("click", e => {
  if (e.target.closest("#tdRemind")) { $("#remind").scrollIntoView({ behavior: "smooth", block: "center" }); return; }
  const b = e.target.closest("[data-r]"); if (b) openRecipe(+b.dataset.r);
});
$("#today").addEventListener("change", e => {
  const t = e.target; if (!t.dataset.pack) return;
  const p = store.get("packed", {}); const d = p[t.dataset.date] = p[t.dataset.date] || {};
  if (t.checked) d[t.dataset.pack] = 1; else delete d[t.dataset.pack];
  for (const k in p) if (k < iso(addDays(today, -2))) delete p[k];
  store.set("packed", p); renderToday();
});

/* ── Prep day: batch tasks across the whole stretch ── */
function prepTasks() {
  const cnt = {}, u = plan.use; plan.items.forEach(it => { if (it.recipe) cnt[it.recipe.id] = (cnt[it.recipe.id] || 0) + 1; });
  const has = (...ids) => ids.reduce((t, id) => t + (cnt[id] || 0), 0);
  const T = [];
  if (u.chicken) T.push(["chicken", `Pull the rotisserie chicken off the bone and portion it (${fmtQty(u.chicken, "oz")} total).`, 10]);
  if (u.quinoa) T.push(["quinoa", `Cook ${fmtQty(u.quinoa, "cup")} dry quinoa with twice the water, 15 minutes. Cool and refrigerate.`, 20]);
  if (u.pasta) T.push(["pasta", `Cook ${fmtQty(u.pasta, "oz")} pasta, rinse cold, toss with a little oil.`, 15]);
  const turkeyCooked = has("turkey-taco-bowl", "turkey-chili");
  if (turkeyCooked) T.push(["turkey", `Brown ${fmtQty(4 * turkeyCooked, "oz")} ground turkey with taco seasoning${has("turkey-chili") ? "; simmer the chili portion with beans and salsa" : ""}.`, 20]);
  if (has("sweet-potato-bean-bowl")) T.push(["sp", `Roast ${has("sweet-potato-bean-bowl")} cubed sweet potato${has("sweet-potato-bean-bowl") > 1 ? "es" : ""} at 425°F for 25 minutes.`, 30]);
  if (has("tofu-teriyaki-box")) T.push(["tofu", `Press and pan-crisp tofu, glaze with soy and honey (${has("tofu-teriyaki-box")} serving${has("tofu-teriyaki-box") > 1 ? "s" : ""}).`, 20]);
  if (has("eggs-grapes")) T.push(["eggs", `Hard-boil ${2 * has("eggs-grapes")} eggs, 10 minutes, then ice water. Peel now.`, 15]);
  if (has("egg-bites")) T.push(["bites", `Bake ${2 * has("egg-bites")} spinach cheddar egg bites at 350°F for 20 minutes.`, 25]);
  if (has("energy-bites", "protein-oat-bites")) T.push(["balls", `Mix and roll ${3 * has("energy-bites") + 4 * has("protein-oat-bites")} energy or protein bites; chill.`, 15]);
  if (has("overnight-oats")) T.push(["oats", `Mix ${has("overnight-oats")} jar${has("overnight-oats") > 1 ? "s" : ""} of overnight oats (do these the night before).`, 5]);
  if (has("peanut-noodle-bowl")) T.push(["sauce", `Whisk the peanut sauce and toss with the noodles.`, 5]);
  if (u.edamame) T.push(["edamame", `Move frozen edamame to the fridge the night before you need it.`, 1]);
  const snacks = plan.items.filter(it => it.slot === "snack" && it.recipe).length;
  if (snacks) T.push(["bags", `Portion ${snacks} protein snacks into grab bags, one set per shift.`, 10]);
  return T;
}
const prepMinutes = T => Math.max(10, Math.round(T.reduce((t, x) => t + x[2], 0) * 0.7 / 5) * 5);
function renderPrep() {
  const T = prepTasks(), done = store.get("prep", {});
  $("#prepMeta").textContent = T.length ? `about ${prepMinutes(T)} min` : "";
  $("#prepList").innerHTML = T.length ? T.map(([k, t]) => `<li><label class="${done[k] ? "done" : ""}"><input type="checkbox" data-prep="${k}"${done[k] ? " checked" : ""}><span>${esc(t)}</span></label></li>`).join("") : `<li class="none">No cooking needed for this plan. Just shop and pack.</li>`;
}
$("#prepList").addEventListener("change", e => { const k = e.target.dataset.prep; if (!k) return; const d = store.get("prep", {}); if (e.target.checked) d[k] = 1; else delete d[k]; store.set("prep", d); e.target.closest("label").classList.toggle("done", e.target.checked); });

function renderHydro() {
  const el = $("#hydro");
  if (!S.f.hydro) { el.innerHTML = ""; el.hidden = true; return; }
  el.hidden = false;
  const c = plan.cfg, sh = c.shifts[activeShift], h = hydration(sh.type, sh.type === "night" ? c.nightStart : c.dayStart, c.len);
  el.innerHTML = `<h3>💧 ${esc(sh.label)} caffeine & hydration</h3>
    <p class="sub">Shift ${h.start} to ${h.end}. Planned sleep around ${h.sleep}, so the caffeine cutoff is about ${h.cutoff}.</p>
    <div class="tl">${h.events.map(e => `<div class="ev" data-k="${e.k}"><time>${e.time}</time><div><b>${esc(e.t)}</b><span>${esc(e.d)}</span></div></div>`).join("")}</div>`;
}

/* ── step 4: grocery ── */
function checks() { return store.get("checks", {}); }
function renderGrocery() {
  const g = plan.grocery, done = checks(), st = STORES[S.store];
  $("#listMeta").textContent = `${g.rows.length} items`;
  const lo = g.leftovers.slice(0, 4);
  $("#waste").innerHTML = `<div class="meter" role="img" aria-label="${g.zeroWaste}% of fresh food used"><i style="width:${g.zeroWaste}%"></i></div>
    <p><b>${g.zeroWaste}% zero-waste.</b> Ingredients are shared across meals so packages get finished, not tossed.</p>
    ${lo.length ? `<ul>${lo.map(l => `<li>Left over: ${esc(l.left)} ${esc(l.name.toLowerCase())} (${esc(l.keeps)})</li>`).join("")}</ul>` : ""}`;
  const by = {};
  g.rows.forEach(r => (by[r.dept] = by[r.dept] || []).push(r));
  $("#list").innerHTML = DEPT_ORDER.filter(d => by[d]).map(d => `<div class="dept"><h3>${d}</h3>${by[d].map(r => `
    <div class="itemrow${st ? " shop" : ""}"><label class="item${done[r.key] ? " done" : ""}"><input type="checkbox" data-key="${r.key}"${done[r.key] ? " checked" : ""}>
      <span class="nm">${esc(r.name)}${r.uses ? `<small>${esc(r.uses)}${r.left ? ` · ${esc(r.left)} left` : ""}</small>` : ""}</span><span class="q">${esc(r.buy)}</span></label>
      ${st ? `<a class="find" href="${st.search(r.instacart.name)}" target="_blank" rel="noopener" aria-label="Find ${esc(r.name)} at ${st.name}">🔍</a>` : ""}</div>`).join("")}</div>`).join("");
  const s2 = STORES[S.store];
  $("#openStore").hidden = !s2;
  if (s2) $("#openStore").textContent = S.store === "walmart" ? "🛒 Add everything to my Walmart cart" : `🛒 Open ${s2.name}`;
  $("#exportNote").textContent = S.store === "walmart" ? "One tap puts the whole list in your Walmart cart for pickup or delivery. If something's out of stock at your store, Walmart offers a replacement." : s2 ? `Tap 🔍 next to any item to find it at ${s2.name}, then add it to your cart. "Open ${s2.name}" also copies your full list.` : "Copy or share the list, or check items off here as you shop.";
  renderAmazon();
  $("#pantry").innerHTML = g.pantry.length ? `<b>Check your pantry:</b> ${g.pantry.map(esc).join(", ")}` : "";
}
$("#list").addEventListener("change", e => {
  const k = e.target.dataset.key; if (!k) return;
  const c = checks(); if (e.target.checked) c[k] = 1; else delete c[k]; store.set("checks", c);
  e.target.closest(".item").classList.toggle("done", e.target.checked);
});

function listText() {
  const g = plan.grocery, by = {};
  g.rows.forEach(r => (by[r.dept] = by[r.dept] || []).push(r));
  const lines = [`ScrubFuel grocery list (${plan.cfg.shifts.length} shift${plan.cfg.shifts.length > 1 ? "s" : ""})`, ""];
  DEPT_ORDER.filter(d => by[d]).forEach(d => { lines.push(d.toUpperCase()); by[d].forEach(r => lines.push(`☐ ${r.name}: ${r.buy}`)); lines.push(""); });
  if (g.pantry.length) lines.push("Pantry check: " + g.pantry.join(", "), "");
  lines.push(`Est. $${Math.round(g.checkout)} · ${g.zeroWaste}% zero-waste · scrubfuel.com`);
  return lines.join("\n");
}
async function copy(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch (e) {
    const t = $("#copyArea"); t.value = text; t.select();
    try { return document.execCommand("copy"); } catch (e2) { return false; }
  }
}
$("#copyBtn").addEventListener("click", async () => toast(await copy(listText()) ? "List copied" : "Couldn't copy, try Share"));
$("#shareListBtn").addEventListener("click", async () => {
  const text = listText();
  if (navigator.share) { try { await navigator.share({ title: "Grocery list", text }); return; } catch (e) { if (e.name === "AbortError") return; } }
  toast(await copy(text) ? "List copied" : "Couldn't share");
});

function planURL() { return `https://scrubfuel.com/?p=${encodeCfg(plan.cfg)}`; }
$("#sharePlanBtn").addEventListener("click", async () => {
  const c = plan.cfg, n = c.shifts.length, nights = c.shifts.filter(s => s.type === "night").length;
  const text = `My ScrubFuel plan for ${n} shift${n > 1 ? "s" : ""}${nights ? ` (${nights} night${nights > 1 ? "s" : ""})` : ""}: breakroom-proof meals and one grocery run, ${plan.grocery.zeroWaste}% zero-waste.`;
  const url = planURL();
  if (navigator.share) { try { await navigator.share({ title: "ScrubFuel plan", text, url }); return; } catch (e) { if (e.name === "AbortError") return; } }
  toast(await copy(`${text} ${url}`) ? "Plan link copied" : "Couldn't share");
});

/* Store shopping mode: each item links to that store's own search. No API needed. */
const STORES = {
  publix: { name: "Publix", home: "https://delivery.publix.com/store/publix/storefront", search: q => `https://delivery.publix.com/store/publix/s?k=${encodeURIComponent(q)}` },
  walmart: { name: "Walmart", home: "https://www.walmart.com/", search: q => `https://www.walmart.com/search?q=${encodeURIComponent(q)}` }
};
$("#storeSeg").addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; S.store = b.dataset.store; setSeg("#storeSeg", "store", S.store); save(); if (plan) renderGrocery(); });
$("#openStore").addEventListener("click", () => {
  const st = STORES[S.store]; if (!st) return;
  if (S.store === "walmart") { const url = walmartCartURL(plan.use); if (url) { const w = window.open(url, "_blank"); if (!w) location.href = url; toast("Opening your Walmart cart…"); return; } }
  copyAndOpen(st.home, st.name);
});

/* Amazon: shelf-stable protein snacks as multipacks, shipped */
function amazonKeys() {
  const keys = new Set(Object.keys(plan.use).filter(k => AMAZON[k]));
  if (S.f.hydro) keys.add("electrolyte");
  if (keys.size < 2) ["jerky", "proteinbar", "rtdshake"].forEach(k => keys.add(k));
  return [...keys].filter(k => AMAZON[k]);
}
function renderAmazon() {
  const keys = amazonKeys();
  $("#amazon").innerHTML = `<div class="azhead"><b>📦 Stock your locker</b><span>Shelf-stable protein, shipped to your door</span></div>
    <ul>${keys.map(k => `<li><span>${esc(AMAZON[k].name)}</span><small>${esc(AMAZON[k].pack)}</small></li>`).join("")}</ul>
    <button class="btn" id="amazonBtn" type="button">Add these to my Amazon cart</button>
    <p class="note">Multipacks last a few weeks. If you order these, skip them on your grocery run.${AMAZON_TAG ? " ScrubFuel may earn a small commission." : ""}</p>`;
}
$("#amazon").addEventListener("click", e => {
  if (!e.target.closest("#amazonBtn")) return;
  const url = amazonCartURL(amazonKeys()); if (!url) return;
  const w = window.open(url, "_blank"); if (!w) location.href = url;
});

/* No API key needed: copy the list, then open the store so it can be pasted into search */
async function copyAndOpen(url, store) {
  const ok = await copy(listText());   // copy first, while the tap still counts as a user action
  const win = window.open(url, "_blank"); if (win) { try { win.opener = null; } catch (e) {} }
  toast(ok ? `List copied. Opening ${store}…` : `Opening ${store}…`);
  if (!win) location.href = url;
}

/* Instacart (enabled when the site has an Instacart Developer Platform key) */
async function checkInstacart() {
  if (PREVIEW) return;
  try { const r = await fetch("/api/instacart"); const j = await r.json(); if (j.enabled) { $("#instacartBtn").hidden = false; $("#exportNote").textContent = "Instacart opens with every item ready to add to your cart at a store you pick. Or copy the list for Walmart."; } } catch (e) {}
}
$("#instacartBtn").addEventListener("click", async () => {
  const btn = $("#instacartBtn"), win = window.open("", "_blank");
  btn.disabled = true; btn.textContent = "Building your cart…";
  try {
    const r = await fetch("/api/instacart", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: `ScrubFuel: ${plan.cfg.shifts.length}-shift groceries`, items: plan.grocery.rows.map(r => r.instacart), linkback: planURL() }) });
    const j = await r.json();
    if (!r.ok || !j.url) throw new Error(j.error || "failed");
    if (win) win.location.href = j.url; else location.href = j.url;
  } catch (e) { if (win) win.close(); toast("Instacart didn't respond. Copy the list instead."); }
  btn.disabled = false; btn.textContent = "🛒 Send to Instacart";
});

/* ── Shift reminders (web push). The phone works out the times; the server just delivers them. ── */
const RTYPES = [
  ["pack", "🎒 Pack your bag", "75 min before each shift, with your meal and snacks"],
  ["caf", "☕ Last call for caffeine", "6 hours before your planned sleep"],
  ["dip", "⚡ Protein snack at the slump", "3 AM dip on nights, afternoon slump on days"],
  ["prep", "🔪 Prep night", "The evening before your stretch starts"],
  ["next", "🗓 Plan your next stretch", "The day after your last shift"]
];
if (!S.remind) S.remind = { on: false, pack: true, caf: true, dip: true, prep: true, next: true };
const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const b64ToBytes = b64 => { const p = "=".repeat((4 - b64.length % 4) % 4), raw = atob((b64 + p).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(raw, c => c.charCodeAt(0)); };
const at = (dateIso, min) => new Date(fromIso(dateIso).getTime() + min * 6e4);
const clockOf = d => hm(d.getHours() * 60 + d.getMinutes());
function remindEvents() {
  if (!plan) return [];
  const c = plan.cfg, R = S.remind, ev = [], now = Date.now();
  c.shifts.forEach((sh, i) => {
    const w = shiftWindow(sh, c), its = plan.items.filter(it => it.shift === i && it.recipe);
    const meal = its.find(it => it.slot === "meal"), snacks = its.filter(it => it.slot === "snack"), prot = its.reduce((t, it) => t + it.recipe.p, 0);
    const when = sh.type === "night" ? "tonight's" : "today's";
    if (R.pack) ev.push({ at: w.start.getTime() - 75 * 6e4, tag: "pack-" + sh.date, title: `🎒 Pack for ${when} shift`,
      body: `${meal ? meal.recipe.n : "Your meal"}${snacks.length ? " + " + snacks.map(s => s.recipe.n).join(", ") : ""}. About ${prot} g protein today.` });
    const h = hydration(sh.type, sh.type === "night" ? c.nightStart : c.dayStart, c.len);
    const stop = h.events.find(e => e.k === "stop"), dip = h.events.find(e => e.k === "dip");
    if (R.caf && stop) ev.push({ at: at(sh.date, stop.m).getTime(), tag: "caf-" + sh.date, title: "☕ Last call for caffeine",
      body: `Sleep's planned around ${h.sleep}. Water or electrolytes from here.` });
    if (R.dip && dip) { const sn = snacks[snacks.length - 1]; ev.push({ at: at(sh.date, dip.m).getTime(), tag: "dip-" + sh.date,
      title: sh.type === "night" ? "⚡ 3 AM dip: protein time" : "⚡ Afternoon slump: protein time",
      body: `${sn ? sn.recipe.n + " and" : "A protein snack and"} a glass of water beats sugar or another coffee.` }); }
  });
  const first = c.shifts[0], last = c.shifts[c.shifts.length - 1];
  if (R.prep && first) { const T = prepTasks(); if (T.length > 1) ev.push({ at: at(first.date, -6 * 60).getTime(), tag: "prep", title: "🔪 Prep night",
    body: `${T.length} quick tasks, about ${prepMinutes(T)} min, and your whole stretch is ready. Tap for the checklist.` }); }
  if (R.next && last) { const lw = shiftWindow(last, c); const d = new Date(lw.end); d.setHours(18, 0, 0, 0); if (d < lw.end) d.setDate(d.getDate() + 1);
    ev.push({ at: d.getTime(), tag: "next", title: "🗓 Got your next shifts?", body: "Tap them in and get one grocery list for the whole stretch." }); }
  return ev.filter(e => e.at > now).sort((a, b) => a.at - b.at);
}
function renderRemind() {
  const R = S.remind, el = $("#remind"), ok = pushSupported() && !PREVIEW;
  el.hidden = !plan;
  $("#remindToggle").setAttribute("aria-checked", String(!!R.on));
  $("#remindList").innerHTML = R.on ? RTYPES.map(([k, t, d]) => `<label class="rmrow"><input type="checkbox" data-rk="${k}"${R[k] ? " checked" : ""}><span><b>${t}</b><small>${d}</small></span></label>`).join("") : "";
  const ev = plan ? remindEvents() : [];
  let note = "";
  if (!ok) note = IOS && !standalone ? "On iPhone, reminders need ScrubFuel on your Home Screen first: tap Get the app at the top, then come back here." : "This browser can't do notifications. Try Chrome, or on iPhone, add ScrubFuel to your Home Screen.";
  else if (R.on) note = ev.length ? `Next: ${ev[0].title.replace(/^\W+\s*/, "")} · ${DOW[new Date(ev[0].at).getDay()]} ${clockOf(new Date(ev[0].at))}` : "Nothing left to remind you about in this plan.";
  else if (IOS && !standalone) note = "On iPhone, add ScrubFuel to your Home Screen first (Get the app, top right).";
  $("#remindNote").textContent = note;
}
let syncT, lastSync = "";
function scheduleSync(confirm = false) { if (!S.remind.on || PREVIEW) return; clearTimeout(syncT); syncT = setTimeout(() => syncRemind(confirm), confirm ? 0 : 1200); }
async function syncRemind(confirm) {
  try {
    const reg = await navigator.serviceWorker.ready; let sub = await reg.pushManager.getSubscription();
    if (!sub) { const { publicKey } = await (await fetch("/api/reminders")).json(); sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) }); }
    const events = remindEvents(), key = JSON.stringify(events) + sub.endpoint;
    if (!confirm && key === lastSync) return;
    const r = await fetch("/api/reminders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "sync", subscription: sub.toJSON(), events, confirm, firstLabel: events[0] ? `${DOW[new Date(events[0].at).getDay()]} ${clockOf(new Date(events[0].at))}` : "" }) });
    if (r.status === 410) { await sub.unsubscribe(); lastSync = ""; return syncRemind(confirm); }
    if (!r.ok) throw new Error("sync " + r.status);
    lastSync = key;
  } catch (e) { if (confirm) { toast("Couldn't turn on reminders. Try again in a moment."); S.remind.on = false; save(); renderRemind(); renderToday(); } }
}
$("#remindToggle").addEventListener("click", async () => {
  const R = S.remind;
  if (R.on) {
    R.on = false; save(); renderRemind(); renderToday();
    try { const reg = await navigator.serviceWorker.ready, sub = await reg.pushManager.getSubscription(); if (sub) await fetch("/api/reminders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "off", subscription: sub.toJSON() }) }); } catch (e) {}
    toast("Reminders off"); return;
  }
  if (PREVIEW || !pushSupported()) { renderRemind(); if (IOS && !standalone) openSheet(); else toast("Notifications aren't available in this browser"); return; }
  const perm = await Notification.requestPermission();
  if (perm !== "granted") { $("#remindNote").textContent = "Notifications are blocked for ScrubFuel. Allow them in your phone or browser settings, then try again."; return; }
  R.on = true; save(); renderRemind(); renderToday(); lastSync = ""; await syncRemind(true);
  if (S.remind.on) toast("Reminders on. Check for a test notification.");
});
$("#remindList").addEventListener("change", e => { const k = e.target.dataset.rk; if (!k) return; S.remind[k] = e.target.checked; save(); renderRemind(); scheduleSync(); });

/* ── toast ── */
let tt;
function toast(msg) {
  let t = $(".toast"); if (!t) { t = document.createElement("div"); t.className = "toast"; t.setAttribute("role", "status"); document.body.appendChild(t); }
  t.textContent = msg; t.hidden = false; clearTimeout(tt); tt = setTimeout(() => { t.hidden = true; }, 2200);
}

/* ── install ── */
const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
const ua = navigator.userAgent, IOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1), ANDROID = /Android/.test(ua);
if (!standalone) $("#installBtn").hidden = false;
function openSheet() {
  const steps = IOS
    ? [`Tap the <b>Share</b> button <span aria-hidden="true">⬆︎</span> in Safari's toolbar.`, `Scroll and tap <b>Add to Home Screen</b>.`, `Tap <b>Add</b>. ScrubFuel opens full-screen like an app.`]
    : ANDROID ? [`Tap the <b>⋮</b> menu in Chrome (top right).`, `Tap <b>Add to Home screen</b> or <b>Install app</b>.`, `Tap <b>Install</b>.`]
    : [`In Chrome or Edge, click the install icon in the address bar, or open the browser menu.`, `Choose <b>Install ScrubFuel</b>.`];
  $("#installSteps").innerHTML = `<ol>${steps.map(s => `<li>${s}</li>`).join("")}</ol>`;
  $("#sheetBack").hidden = $("#installSheet").hidden = false;
}
function closeSheet() { $("#sheetBack").hidden = $("#installSheet").hidden = $("#recipeSheet").hidden = true; }
$("#installBtn").addEventListener("click", async () => {
  const p = window.__bip;
  if (p) { try { p.prompt(); const r = await p.userChoice; window.__bip = null; if (r && r.outcome === "accepted") { $("#installBtn").hidden = true; return; } } catch (e) {} }
  openSheet();
});
$("#installClose").addEventListener("click", closeSheet);
$("#sheetBack").addEventListener("click", closeSheet);
window.addEventListener("appinstalled", () => { $("#installBtn").hidden = true; closeSheet(); });
document.addEventListener("keydown", e => { if (e.key === "Escape") closeSheet(); });

if (!PREVIEW && "serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));

/* ── boot ── */
syncControls(); renderDays(); regen(); checkInstacart();
if (fromShare) { save(); toast("Opened a shared plan. Edit it for your shifts."); }
else if (newWeek) { save(); setupOpen = true; renderSetupBar(); toast("New week! Tap your next shifts."); }
else if (!RETURNING) save();
setInterval(() => { if (plan && document.visibilityState === "visible") renderToday(); }, 60000);
if (HOST.endsWith(".test")) window.__sf = { remindEvents: () => { S.remind = { ...S.remind, pack: true, caf: true, dip: true, prep: true, next: true }; return remindEvents(); } };
