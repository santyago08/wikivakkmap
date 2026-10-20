// Собирает вики: articles/*.md + data/cities.json + images/ → wiki-data.js и страницы в папке wiki/
// Запуск: node tools/build-wiki.mjs   (на GitHub запускается автоматически при каждой правке)
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "./vendor/js-yaml.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ART = join(ROOT, "articles");

const TR = {а:"a",б:"b",в:"v",г:"g",д:"d",е:"e",ё:"e",ж:"zh",з:"z",и:"i",й:"y",к:"k",л:"l",м:"m",н:"n",о:"o",п:"p",р:"r",с:"s",т:"t",у:"u",ф:"f",х:"h",ц:"ts",ч:"ch",ш:"sh",щ:"sch",ъ:"",ы:"y",ь:"",э:"e",ю:"yu",я:"ya"};
const slug = s => String(s).toLowerCase().split("").map(c => TR[c] ?? c).join("").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function parseArticle(text, name) {
  text = text.replace(/^﻿/, "").replace(/\r\n/g, "\n");
  const m = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { meta: {}, body: text.trim() };
  let meta = {};
  try { meta = yaml.load(m[1]) || {}; } catch (e) { console.warn(`! ${name}: ошибка в полях статьи — ${e.reason || e.message}`); }
  for (const k of Object.keys(meta)) if (meta[k] instanceof Date) meta[k] = meta[k].toISOString().slice(0, 10);
  return { meta, body: text.slice(m[0].length).trim() };
}
function lastChange(file) {
  try {
    const out = execFileSync("git", ["log", "-1", "--format=%cI|%an", "--", file], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    if (out) { const [date, author] = out.split("|"); return { date, author }; }
  } catch (_) {}
  return { date: statSync(file).mtime.toISOString(), author: "" };
}

// ---------- articles ----------
const RESERVED = new Set(["razdel", "gorod", "vse-stati", "pravki", "nuzhno-napisat", "sluchaynaya"]);
const used = new Set(RESERVED);
const articles = [];
for (const f of readdirSync(ART).filter(f => f.endsWith(".md")).sort()) {
  const file = join(ART, f);
  const { meta, body } = parseArticle(readFileSync(file, "utf8"), f);
  if (!meta.title) { console.warn(`! ${f}: нет поля title — пропущено`); continue; }
  meta.title = String(meta.title).trim();
  let s = slug(meta.title) || "statya";
  for (let i = 2; used.has(s); i++) s = `${slug(meta.title) || "statya"}-${i}`;
  used.add(s);
  const links = [...new Set([...body.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g)].map(x => x[1].trim()))];
  const { date, author } = lastChange(file);
  articles.push({ ...meta, slug: s, file: f, body, links, updated: date, author });
}
const cities = existsSync(join(ROOT, "data", "cities.json")) ? JSON.parse(readFileSync(join(ROOT, "data", "cities.json"), "utf8")) : [];
const IMG = join(ROOT, "images");
const images = existsSync(IMG) ? readdirSync(IMG).filter(f => /\.(png|jpe?g|webp|gif)$/i.test(f)).sort()
  .map(f => ({ file: `images/${f}`, caption: f.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ") })) : [];
writeFileSync(join(ROOT, "wiki-data.js"),
  "/* Собрано автоматически из папки articles/ — не редактируйте вручную. */\nconst WIKI = " +
  JSON.stringify({ built: new Date().toISOString(), articles, cities, images }) + ";\n");

// ---------- pages ----------
const TPL = readFileSync(join(ROOT, "tools", "wiki-template.html"), "utf8");
const OUT = join(ROOT, "wiki");
rmSync(OUT, { recursive: true, force: true });
let pages = 0;
function page(path, key, title, desc) {
  const depth = path.split("/").filter(Boolean).length;
  const dir = join(OUT, ...path.split("/").filter(Boolean));
  mkdirSync(dir, { recursive: true });
  const html = TPL.replace("__BASE__", "../".repeat(depth + 1))
    .replace("__PAGE__", JSON.stringify(key).slice(1, -1))
    .replace(/__TITLE__/g, esc(title)).replace(/__DESC__/g, esc(desc || ""));
  writeFileSync(join(dir, "index.html"), html);
  pages++;
}
const CATS = { "Государство": "Государства", "Житель": "Жители", "Континент": "Континенты", "Раса": "Расы и народы", "Организация": "Организации",
  "Событие": "События", "Город": "Города", "Справка": "Справка", "Сервер": "Сервер" };
page("", "home", "Вики Канъяло", "Летопись мира ролевого сервера: государства, жители, города и история.");
for (const a of articles) page(a.slug, "a/" + a.slug, `${a.title} — Вики Канъяло`, a.summary || "");
for (const [cat, pl] of Object.entries(CATS)) page(`razdel/${slug(pl)}`, "k/" + cat, `${pl} — Вики Канъяло`, `Раздел «${pl}» вики Канъяло.`);
for (const c of cities) page(`gorod/${slug(c.name)}`, "city/" + c.name, `${c.name} — Вики Канъяло`, `Город ${c.name} на карте мира Канъяло.`);
for (const [p, k, t] of [["vse-stati", "all", "Все статьи"], ["pravki", "changes", "Недавние правки"], ["nuzhno-napisat", "stubs", "Нужно написать"], ["sluchaynaya", "random", "Случайная статья"]])
  page(p, k, `${t} — Вики Канъяло`, "");
// ---------- cache busting (only on GitHub, so local files stay unchanged) ----------
// Adds ?v=<version> to our own scripts and styles, so browsers never mix an old cached script with a new page.
if (process.env.CI) {
  let v = Date.now().toString(36);
  try { v = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(); } catch (_) {}
  v = v.slice(0, 8);
  const stamp = html => html.replace(/(\b(?:src|href)=")((?:map\/states|wiki-data|wiki\.config|wiki-core)\.js|site\.css)(")/g, `$1$2?v=${v}$3`);
  const files = [join(ROOT, "index.html"), join(ROOT, "residents", "index.html")];
  const walk = d => readdirSync(d, { withFileTypes: true }).forEach(e => e.isDirectory() ? walk(join(d, e.name)) : e.name === "index.html" && files.push(join(d, e.name)));
  walk(OUT);
  files.forEach(f => writeFileSync(f, stamp(readFileSync(f, "utf8"))));
  console.log(`версия файлов: ${v} (${files.length} страниц)`);
}
console.log(`вики собрана: ${articles.length} статей, ${cities.length} городов, ${images.length} изображений, ${pages} страниц`);
