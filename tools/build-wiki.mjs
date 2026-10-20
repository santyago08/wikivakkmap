// Собирает вики: articles/*.md + data/cities.json + images/ → wiki-data.js
// Запуск: node tools/build-wiki.mjs   (на GitHub запускается автоматически при каждой правке)
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ART = join(ROOT, "articles");

// --- frontmatter: "key: value", "key: [a, b]", quoted strings, true/false, numbers ---
function parseValue(v) {
  v = v.trim();
  if (v.startsWith("[") && v.endsWith("]")) return v.slice(1, -1).split(",").map(s => parseValue(s)).filter(s => s !== "");
  if (/^".*"$|^'.*'$/.test(v)) return v.slice(1, -1);
  if (v === "true" || v === "да") return true;
  if (v === "false" || v === "нет") return false;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v;
}
function parseArticle(text) {
  text = text.replace(/^﻿/, "").replace(/\r\n/g, "\n");
  const meta = {};
  let body = text;
  const m = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (m) {
    body = text.slice(m[0].length);
    for (const line of m[1].split("\n")) {
      const k = line.match(/^([\wА-Яа-яЁё_-]+):\s*(.*)$/);
      if (k) meta[k[1]] = parseValue(k[2]);
    }
  }
  return { meta, body: body.trim() };
}

// --- last change date: from git history if available, else file time ---
function lastChange(file) {
  try {
    const out = execFileSync("git", ["log", "-1", "--format=%cI|%an", "--", file], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    if (out) { const [date, author] = out.split("|"); return { date, author }; }
  } catch (_) {}
  return { date: statSync(file).mtime.toISOString(), author: "" };
}

const articles = [];
for (const f of readdirSync(ART).filter(f => f.endsWith(".md")).sort()) {
  const file = join(ART, f);
  const { meta, body } = parseArticle(readFileSync(file, "utf8"));
  if (!meta.title) { console.warn(`! ${f}: нет поля title — пропущено`); continue; }
  const links = [...new Set([...body.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g)].map(x => x[1].trim()))];
  const { date, author } = lastChange(file);
  articles.push({ slug: f.slice(0, -3), ...meta, body, links, updated: date, author });
}

const cities = existsSync(join(ROOT, "data", "cities.json")) ? JSON.parse(readFileSync(join(ROOT, "data", "cities.json"), "utf8")) : [];
const IMG = join(ROOT, "images");
const images = existsSync(IMG) ? readdirSync(IMG).filter(f => /\.(png|jpe?g|webp|gif)$/i.test(f)).sort()
  .map(f => ({ file: `images/${f}`, caption: f.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ") })) : [];

const data = { built: new Date().toISOString(), articles, cities, images };
writeFileSync(join(ROOT, "wiki-data.js"),
  "/* Собрано автоматически из папки articles/ — не редактируйте вручную. */\nconst WIKI = " + JSON.stringify(data) + ";\n");
console.log(`вики собрана: ${articles.length} статей, ${cities.length} городов, ${images.length} изображений`);
