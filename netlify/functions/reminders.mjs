// /api/reminders: shift reminders.
//   GET  -> { publicKey }
//   POST { action: "sync", subscription, events: [{ at, title, body, tag }], confirm }  saves this phone's schedule
//   POST { action: "off", subscription }                                                 stops reminders
// The phone works out the times (it knows its own time zone); this just stores them. reminders-send delivers them.
import { getStore } from "@netlify/blobs";
import webpush from "web-push";
import { vapidKeys, subId, SITE } from "../lib/push.mjs";

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const validSub = s => s && typeof s.endpoint === "string" && /^https:\/\//.test(s.endpoint) && s.endpoint.length < 1000 && s.keys && typeof s.keys.p256dh === "string" && typeof s.keys.auth === "string";
const clean = (v, n) => String(v || "").replace(/[\u0000-\u001f<>]/g, " ").trim().slice(0, n);

export default async (req) => {
  const keys = await vapidKeys();
  if (req.method === "GET") return json({ publicKey: keys.publicKey });
  if (req.method !== "POST") return json({ error: "Use GET or POST" }, 405);
  let body; try { body = await req.json(); } catch { return json({ error: "Send JSON" }, 400); }
  const { action, subscription } = body || {};
  if (!validSub(subscription)) return json({ error: "Missing subscription" }, 400);
  const store = getStore({ name: "scrubfuel-reminders", consistency: "strong" });
  const id = subId(subscription.endpoint);
  if (action === "off") { await store.delete(id); return json({ ok: true }); }
  if (action !== "sync") return json({ error: "Unknown action" }, 400);

  const now = Date.now();
  const events = (Array.isArray(body.events) ? body.events : []).slice(0, 60)
    .map(e => ({ at: +e.at, title: clean(e.title, 80), body: clean(e.body, 220), tag: clean(e.tag, 60) || "scrubfuel" }))
    .filter(e => isFinite(e.at) && e.at > now - 10 * 60e3 && e.at < now + 12 * 864e5 && e.title)
    .sort((a, b) => a.at - b.at);
  const record = { subscription: { endpoint: subscription.endpoint, keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth } }, events, updated: now };
  await store.setJSON(id, record);

  if (body.confirm) {   // proves the phone can receive them
    webpush.setVapidDetails(SITE, keys.publicKey, keys.privateKey);
    const next = events[0];
    try {
      await webpush.sendNotification(record.subscription, JSON.stringify({
        title: "🔔 Shift reminders are on",
        body: next ? `We've got your back. First one: "${next.title.replace(/^\W+\s*/, "")}" at ${clean(body.firstLabel, 40) || "the right time"}.` : "We've got your back. We'll nudge you once your next shifts are planned.",
        tag: "scrubfuel-confirm", url: "/"
      }), { TTL: 3600 });
    } catch (e) {
      if (e && (e.statusCode === 404 || e.statusCode === 410)) { await store.delete(id); return json({ error: "expired" }, 410); }
    }
  }
  return json({ ok: true, count: events.length });
};
export const config = { path: "/api/reminders" };
