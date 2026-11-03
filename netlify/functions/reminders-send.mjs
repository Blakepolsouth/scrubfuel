// Runs every 5 minutes and sends any shift reminder that is due. Late ones (over 40 min) are skipped, not sent stale.
import { getStore } from "@netlify/blobs";
import webpush from "web-push";
import { vapidKeys, SITE } from "../lib/push.mjs";

async function mapLimit(items, limit, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const k = i++; try { await fn(items[k]); } catch (e) { /* keep going */ } }
  }));
}

export default async () => {
  const store = getStore({ name: "scrubfuel-reminders", consistency: "strong" });
  const keys = await vapidKeys();
  webpush.setVapidDetails(SITE, keys.publicKey, keys.privateKey);
  const now = Date.now(), { blobs } = await store.list();
  let sent = 0, removed = 0;
  await mapLimit(blobs, 12, async b => {
    const rec = await store.get(b.key, { type: "json" }); if (!rec) return;
    const due = (rec.events || []).filter(e => e.at <= now), rest = (rec.events || []).filter(e => e.at > now);
    if (!due.length) { if (!rest.length && now - (rec.updated || 0) > 21 * 864e5) { await store.delete(b.key); removed++; } return; }
    const fresh = due.filter(e => now - e.at < 40 * 60e3).slice(-2);   // never a pile of stale ones
    for (const e of fresh) {
      try { await webpush.sendNotification(rec.subscription, JSON.stringify({ title: e.title, body: e.body, tag: e.tag, url: "/" }), { TTL: 1800, urgency: "high" }); sent++; }
      catch (err) { if (err && (err.statusCode === 404 || err.statusCode === 410)) { await store.delete(b.key); removed++; return; } }
    }
    await store.setJSON(b.key, { ...rec, events: rest });
  });
  console.log(`Reminders: ${blobs.length} phones, ${sent} sent, ${removed} removed`);
};
export const config = { schedule: "*/5 * * * *" };
