# ScrubFuel

Shift meal plans and one zero-waste grocery run for nurses. Live at https://scrubfuel.com

- `public/`: the whole app (static PWA). `planner.js` is the meal/grocery engine, `food.js` the recipes and store catalog.
- `netlify/functions/instacart.mjs`: "Send to Instacart" button. It stays hidden until `INSTACART_API_KEY` is set in Netlify environment variables (Instacart Developer Platform key). Add `INSTACART_ENV=dev` while using a development key.
- Deploy: Netlify → Import from Git → this repo. No build step.
- Release: bump `SHELL` in `public/sw.js`.
