/* Store hookups. Item numbers were checked on walmart.com and amazon.com (Nov 2026).
   WALMART: catalog key -> [Walmart item id, package size in the catalog's unit]
   The one-tap link is walmart.com/sc/cart/addToCart?items=ID|qty,ID|qty. Out-of-stock items show a "Replace" button in the cart; the rest still go in. */
export const WALMART = {
  avocado: [44390949, 1], banana: [44390948, 1], apple: [44390953, 1], spinach: [34017490, 6], greens: [254834665, 11],
  cucumber: [44390954, 1], tomato: [10451313, 10], pepper: [44391581, 1], carrots: [10451315, 16], snappeas: [13399614, 8],
  berries: [44391666, 6], grapes: [598217565, 32], lemon: [41752773, 1], lime: [44391008, 1], sweetpotato: [44390964, 1],
  yogurt: [26559565, 32], cottage: [10315021, 16], cheddar: [34186946, 8], stringcheese: [364923224, 12], feta: [34729673, 5],
  mozz: [14255252, 8], milk: [10450119, 8], eggs: [145051970, 12], hummus: [128642379, 10], chicken: [906875248, 16],
  turkey: [10315853, 9], groundturkey: [19593628, 16], tofu: [10898817, 14], tuna: [32257670, 1], salsa: [3562572626, 16],
  pesto: [21003400, 6.25], chickpeas: [10534041, 1.5], blackbeans: [10534038, 1.5], tortilla: [339860540, 8], bread: [10804551, 20],
  ricecup: [15077708064, 2], quinoa: [51258806, 5.3], pasta: [10534080, 16], crackers: [534402624, 8.5], ricecakes: [10312599, 14],
  oats: [10314925, 13], granola: [202344615, 3.5], pb: [3716446909, 28], chia: [862748103, 60], trailmix: [39205511, 26],
  almonds: [834401337, 16], protein: [560728503, 27], electrolyte: [825689068, 10], edamame: [328567678, 12], jerky: [912700951, 3.25],
  proteinbar: [2954033353, 4], rtdshake: [45152391, 4], yogurtcup: [49028504, 1], roastchick: [374390339, 8], pumpkin: [5719317812, 5]
};

/* AMAZON: shelf-stable protein snacks as multipacks, shipped (Amazon Fresh doesn't reach most towns, so no perishables).
   Paste your Amazon Associates tag here once approved (looks like "scrubfuel-20") to earn commission. */
export const AMAZON_TAG = "";
export const AMAZON = {
  jerky: { asin: "B0B3BCLMLP", name: "Jack Link's Original Beef Jerky", pack: "8 × 3.25 oz bags" },
  proteinbar: { asin: "B01126O3OY", name: "Pure Protein Bars, variety", pack: "18 bars" },
  rtdshake: { asin: "B07MJL8NXR", name: "Premier Protein Shakes, chocolate", pack: "12 × 11 oz" },
  protein: { asin: "B06Y5ZG66K", name: "Premier Protein Powder, chocolate", pack: "17 servings" },
  roastchick: { asin: "B079DFLWDH", name: "Biena Roasted Chickpeas", pack: "4 bags" },
  pumpkin: { asin: "B08DX7FG29", name: "Roasted & Salted Pumpkin Seeds", pack: "1 lb" },
  tuna: { asin: "B00FWUP0T4", name: "StarKist Tuna Creations pouches", pack: "12 pouches" },
  electrolyte: { asin: "B01IT9NLHW", name: "Liquid I.V. electrolytes", pack: "16 sticks" }
};

export function walmartCartURL(use) {
  const parts = [];
  for (const k in use) { const w = WALMART[k]; if (!w) continue; const q = Math.max(1, Math.ceil(use[k] / w[1] - 1e-9)); parts.push(q > 1 ? `${w[0]}|${q}` : `${w[0]}`); }
  return parts.length ? `https://www.walmart.com/sc/cart/addToCart?items=${parts.join(",")}` : null;
}
export function amazonCartURL(keys) {
  const q = keys.filter(k => AMAZON[k]).map((k, i) => `ASIN.${i + 1}=${AMAZON[k].asin}&Quantity.${i + 1}=1`);
  if (!q.length) return null;
  return `https://www.amazon.com/gp/aws/cart/add.html?${q.join("&")}${AMAZON_TAG ? `&AssociateTag=${encodeURIComponent(AMAZON_TAG)}` : ""}`;
}
