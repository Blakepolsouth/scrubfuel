// Turns a ScrubFuel grocery list into an Instacart shopping-list link (Instacart Developer Platform).
// Set INSTACART_API_KEY in Netlify → Site configuration → Environment variables.
// Optional: INSTACART_ENV=dev to use the development server while your key is a test key.
export default async (req) => {
  const key = process.env.INSTACART_API_KEY;
  const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  if (req.method === "GET") return json({ enabled: !!key });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  if (!key) return json({ error: "not configured" }, 501);
  let body; try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }
  const items = Array.isArray(body.items) ? body.items.slice(0, 80) : [];
  if (!items.length) return json({ error: "empty list" }, 400);
  const clean = s => String(s || "").slice(0, 120);
  const line_items = items.map(i => ({
    name: clean(i.name), display_text: clean(i.display_text || i.name),
    line_item_measurements: (Array.isArray(i.line_item_measurements) ? i.line_item_measurements : []).slice(0, 2)
      .map(m => ({ quantity: Math.max(1, Math.min(50, Number(m.quantity) || 1)), unit: ["each", "package"].includes(m.unit) ? m.unit : "each" }))
  })).filter(i => i.name);
  const link = String(body.linkback || "");
  const host = process.env.INSTACART_ENV === "dev" ? "https://connect.dev.instacart.tools" : "https://connect.instacart.com";
  try {
    const r = await fetch(`${host}/idp/v1/products/products_link`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        title: clean(body.title || "ScrubFuel groceries"), link_type: "shopping_list", line_items,
        landing_page_configuration: { partner_linkback_url: link.startsWith("https://scrubfuel.com/") ? link : "https://scrubfuel.com/", enable_pantry_items: true }
      })
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.products_link_url) return json({ error: "instacart " + r.status }, 502);
    return json({ url: j.products_link_url });
  } catch (e) { return json({ error: "network" }, 502); }
};
export const config = { path: "/api/instacart" };
