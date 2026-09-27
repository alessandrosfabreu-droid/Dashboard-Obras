// Converte o relatório HTML em PDF A4 com Chromium (Playwright).
// Uso: node scripts/gerar_pdf.mjs <entrada.html> <saida.pdf>
import { execSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

let pw;
try { pw = await import("playwright"); }
catch { pw = await import(pathToFileURL(execSync("npm root -g").toString().trim() + "/playwright/index.mjs").href); }

const [entrada, saida] = process.argv.slice(2);
if (!entrada || !saida) { console.error("Uso: node scripts/gerar_pdf.mjs <entrada.html> <saida.pdf>"); process.exit(1); }

const browser = await pw.chromium.launch();
const page = await browser.newPage();
await page.goto(pathToFileURL(resolve(entrada)).href, { waitUntil: "load" });
await page.waitForFunction(() => window.__pronto === true, null, { timeout: 15000 });
await page.pdf({
  path: saida, format: "A4", printBackground: true, preferCSSPageSize: true,
  displayHeaderFooter: true, headerTemplate: "<div></div>",
  footerTemplate: `<div style="width:100%;font:8px Inter,Arial,sans-serif;color:#64748b;padding:0 16mm;display:flex;justify-content:space-between">
    <span>Relatório executivo · Clínica Sensi</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
});
await browser.close();
console.log("OK: " + saida);
