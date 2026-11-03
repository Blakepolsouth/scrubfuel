// Push signing keys, created once and kept in Netlify Blobs (no setup needed).
import { getStore } from "@netlify/blobs";
import webpush from "web-push";
import { createHash } from "node:crypto";

export async function vapidKeys() {
  const cfg = getStore({ name: "scrubfuel-config", consistency: "strong" });
  let keys = await cfg.get("vapid", { type: "json" });
  if (!keys || !keys.publicKey || !keys.privateKey) {
    const fresh = webpush.generateVAPIDKeys();
    await cfg.setJSON("vapid", fresh);
    keys = (await cfg.get("vapid", { type: "json" })) || fresh; // re-read so two first visitors agree
  }
  return keys;
}
export const subId = endpoint => createHash("sha256").update(endpoint).digest("hex").slice(0, 32);
export const SITE = "https://scrubfuel.com";
