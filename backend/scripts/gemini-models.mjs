// Lists the Gemini models your API key can use for generateContent, Flash models first, so you can
// pick a current one for GEMINI_MODEL in backend/.env. Google retires model names often.
//
//   node backend\scripts\gemini-models.mjs
//
// Needs GEMINI_API_KEY in backend/.env. The key is never printed.
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const envFile = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".env");
dotenv.config({ path: envFile });
const { config } = await import("../src/config.js");

if (!config.gemini.apiKey) {
  console.error(`\nGEMINI_API_KEY is not set. Add it to:\n  ${path.resolve(envFile)}\n`);
  process.exitCode = 1;
} else {
  const found = [];
  let pageToken = "";
  try {
    for (let page = 0; page < 10; page++) {
      const url = `${config.gemini.baseUrl}/models?pageSize=100${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`;
      const res = await fetch(url, { headers: { "x-goog-api-key": config.gemini.apiKey } });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).replace(/\s+/g, " ").slice(0, 200)}`);
      const data = await res.json();
      for (const m of data.models || []) {
        if ((m.supportedGenerationMethods || []).includes("generateContent")) found.push(m.name.replace(/^models\//, ""));
      }
      pageToken = data.nextPageToken || "";
      if (!pageToken) break;
    }
    const rank = (n) => (/flash-lite/.test(n) ? 1 : /flash/.test(n) ? 0 : 2);
    found.sort((a, b) => rank(a) - rank(b) || b.localeCompare(a));
    console.log(`Currently configured GEMINI_MODEL: ${config.gemini.model}`);
    console.log(`Models your key can use with generateContent (${found.length}), Flash first:\n`);
    for (const n of found.slice(0, 25)) console.log(`  ${n}${n === config.gemini.model ? "   <- configured" : ""}`);
    if (found.length && !found.includes(config.gemini.model)) {
      console.log(`\nYour configured model is NOT in this list. Put one of the names above in backend/.env as:\n  GEMINI_MODEL=<name>`);
    }
  } catch (e) {
    console.error(`Could not list models: ${e.message}`);
    process.exitCode = 1;
  }
}
