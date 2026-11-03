import { CATALOG, PANTRY } from "./food.js";
import { STEPS } from "./steps.js";
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

/* ── state ── */
const today = new Date(); today.setHours(0, 0, 0, 0);
const DAYS = Array.from({ length: 7 }, (_, i) => { const d = new Date(today); d.setDate(d.getDate() + i); return d; });
const DEFAULT = { week: ["night", "night", "night", "off", "off", "off", "off"], len: 12, dayStart: "07:00", nightStart: "19:00", f: { odor: true, speed: true, nomic: false, hydro: true }, diet: { v: false, df: false, gf: false, nf: false }, post: false, style: "mix", seed: 1 };
let S = Object.assign(structuredClone(DEFAULT), store.get("settings", {}));
if (!Array.isArray(S.week) || S.week.length !== 7) S.week = DEFAULT.week.slice();

const shared = new URLSearchParams(location.search).get("p");
let fromShare = false;
if (shared) {
  const c = decodeCfg(shared);
  if (c) {
    fromShare = true;
    S.week = Array.from({ length: 7 }, (_, i) => c.types[i] || "off");
    Object.assign(S, { len: c.len, dayStart: c.dayStart, nightStart: c.nightStart, f: c.f, diet: c.diet, post: c.post, style: c.style, seed: c.seed });
  }
  history.replaceState(null, "", location.pathname);
}

let plan = null, picks = [], activeShift = 0;

function cfg() {
  const shifts = [];
  S.week.forEach((t, i) => { if (t !== "off" && shifts.length < MAX) shifts.push({ type: t, label: DOW[DAYS[i].getDay()] }); });
  return { shifts, len: S.len, dayStart: S.dayStart, nightStart: S.nightStart, f: S.f, diet: S.diet, post: S.post, style: S.style, seed: S.seed };
}
const save = () => store.set("settings", S);

/* ── step 1: shift strip ── */
function renderDays() {
  const n = S.week.filter(t => t !== "off").length;
  $("#days").innerHTML = DAYS.map((d, i) => {
    const t = S.week[i];
    return `<button type="button" class="day" data-i="${i}" data-type="${t}" aria-label="${DOW[d.getDay()]} ${d.getMonth() + 1}/${d.getDate()}: ${t === "off" ? "off" : t + " shift"}">
      <span class="dn">${i === 0 ? "Today" : DOW[d.getDay()]}</span><span class="dd">${d.getMonth() + 1}/${d.getDate()}</span>
      <span class="ic">${t === "day" ? "☀" : t === "night" ? "☾" : ""}</span><span class="ty">${t === "off" ? "off" : t}</span></button>`;
  }).join("");
  $("#shiftCount").textContent = n ? `${n} shift${n > 1 ? "s" : ""} · max ${MAX}` : "Tap a day: off → day → night";
}
$("#days").addEventListener("click", e => {
  const b = e.target.closest(".day"); if (!b) return;
  const i = +b.dataset.i, cur = S.week[i];
  const n = S.week.filter(t => t !== "off").length;
  let next = cur === "off" ? "day" : cur === "day" ? "night" : "off";
  if (cur === "off" && n >= MAX) { toast(`Up to ${MAX} shifts per plan`); return; }
  S.week[i] = next; save(); renderDays(); regen();
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

function regen() {
  const c = cfg();
  if (!c.shifts.length) { plan = null; picks = []; renderPlan(); return; }
  plan = buildPlan(c); picks = plan.items.map(it => it.recipe);
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
  $("#grocery").hidden = empty; $(".unit").hidden = empty;
  if (empty) { $("#slots").innerHTML = `<div class="slot empty"><h3>Tap at least one day in Step 1 to build your plan.</h3></div>`; $("#hydro").innerHTML = ""; return; }
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
  renderGrocery();
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
  picks[k] = next; plan = finalizePlan(plan.cfg, picks); renderPlan();
});

/* Recipe popup */
const ingName = (c, q) => c.unit === "ea" ? c.name.replace(/ \(.*\)/, "") : c.name.replace(/ \(.*\)/, "");
function openRecipe(k) {
  const it = plan.items[k], r = it.recipe; if (!r) return;
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
  const g = plan.grocery, done = checks();
  $("#listMeta").textContent = `${g.rows.length} items`;
  const lo = g.leftovers.slice(0, 4);
  $("#waste").innerHTML = `<div class="meter" role="img" aria-label="${g.zeroWaste}% of fresh food used"><i style="width:${g.zeroWaste}%"></i></div>
    <p><b>${g.zeroWaste}% zero-waste.</b> Ingredients are shared across meals so packages get finished, not tossed.</p>
    ${lo.length ? `<ul>${lo.map(l => `<li>Left over: ${esc(l.left)} ${esc(l.name.toLowerCase())} (${esc(l.keeps)})</li>`).join("")}</ul>` : ""}`;
  const by = {};
  g.rows.forEach(r => (by[r.dept] = by[r.dept] || []).push(r));
  $("#list").innerHTML = DEPT_ORDER.filter(d => by[d]).map(d => `<div class="dept"><h3>${d}</h3>${by[d].map(r => `
    <label class="item${done[r.key] ? " done" : ""}"><input type="checkbox" data-key="${r.key}"${done[r.key] ? " checked" : ""}>
      <span class="nm">${esc(r.name)}${r.uses ? `<small>${esc(r.uses)}${r.left ? ` · ${esc(r.left)} left` : ""}</small>` : ""}</span><span class="q">${esc(r.buy)}</span></label>`).join("")}</div>`).join("");
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

/* No API key needed: copy the list, then open the store so it can be pasted into search */
async function copyAndOpen(url, store) {
  const ok = await copy(listText());   // copy first, while the tap still counts as a user action
  const win = window.open(url, "_blank"); if (win) { try { win.opener = null; } catch (e) {} }
  toast(ok ? `List copied. Paste it into ${store} search.` : `Opening ${store}…`);
  if (!win) location.href = url;
}
$("#openInstacart").addEventListener("click", () => copyAndOpen("https://www.instacart.com/store", "Instacart"));
$("#openWalmart").addEventListener("click", () => copyAndOpen("https://www.walmart.com/", "Walmart"));

/* Instacart (enabled when the site has an Instacart Developer Platform key) */
async function checkInstacart() {
  if (PREVIEW) return;
  try { const r = await fetch("/api/instacart"); const j = await r.json(); if (j.enabled) { $("#instacartBtn").hidden = false; $("#openInstacart").hidden = true; $("#exportNote").textContent = "Instacart opens with every item ready to add to your cart at a store you pick. Or copy the list for Walmart."; } } catch (e) {}
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
