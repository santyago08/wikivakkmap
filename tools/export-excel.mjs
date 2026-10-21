// Собирает таблицу Excel со всеми данными вики: один лист на раздел, одна строка на статью.
// Запуск: node tools/export-excel.mjs   → tables/wiki-kanyalo.xlsx (на сайте: …/tables/wiki-kanyalo.xlsx)
// На GitHub запускается автоматически при каждой публикации, поэтому скачанная таблица всегда совпадает с сайтом.
//
// В файле есть скрытые листы «_<раздел>» — копия данных на момент скачивания. При загрузке таблицы обратно
// импорт сравнивает с ними и переносит только то, что человек изменил сам. Так два редактора,
// скачавшие таблицу в разное время, не затирают правки друг друга.
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "./vendor/js-yaml.mjs";
import { writeXlsx } from "./xlsx.mjs";
import { loadSections, toCell } from "./tables.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const EXPORT_FILE = join(ROOT, "tables", "wiki-kanyalo.xlsx");
export const HELP_SHEET = "Как пользоваться";

export function readArticles(root) {
  return readdirSync(join(root, "articles")).filter(f => f.endsWith(".md")).map(f => {
    const text = readFileSync(join(root, "articles", f), "utf8").replace(/^﻿/, "").replace(/\r\n/g, "\n");
    const m = text.match(/^---\n([\s\S]*?)\n---\n?/);
    let meta = {};
    try { meta = m ? yaml.load(m[1]) || {} : {}; } catch (_) {}
    return { file: f, meta, body: m ? text.slice(m[0].length).replace(/^\n+/, "") : text, original: text };
  });
}

export function buildWorkbook(root) {
  const articles = readArticles(root).map(a => a.meta).filter(m => m.title);
  const sections = loadSections(root);
  const races = articles.filter(a => a.category === "Раса");
  const ctx = { raceByCode: code => (races.find(r => r.code === code) || {}).title };
  const cities = existsSync(join(root, "data", "cities.json")) ? JSON.parse(readFileSync(join(root, "data", "cities.json"), "utf8")) : [];
  const visible = [], hidden = [];
  for (const s of sections) {
    const list = articles.filter(a => a.category === s.category).sort((x, y) => String(x.title).localeCompare(String(y.title), "ru"));
    // Cities from the map that have no article yet: fill in a row, and an article will be created
    if (s.category === "Город") for (const c of cities) if (!list.some(a => String(a.title).toLowerCase() === c.name.toLowerCase())) list.push({ title: c.name });
    if (s.category === "Город") list.sort((x, y) => String(x.title).localeCompare(String(y.title), "ru"));
    const extra = [...new Set(list.flatMap(a => [].concat(a.info || []).map(i => i && i.name).filter(Boolean)))];
    const head = [...s.columns.map(c => c.label), ...extra];
    const rows = list.map(a => [...s.columns.map(c => toCell(a, c, ctx)), ...extra.map(n => { const i = [].concat(a.info || []).find(x => x && x.name === n); return i ? String(i.value ?? "") : ""; })]);
    const all = [head, ...rows];
    const widths = head.map((_, i) => Math.min(50, Math.max(12, ...all.map(r => Math.min(50, String(r[i] ?? "").length + 2)))));
    visible.push({ name: s.sheet, rows: all, widths });
    hidden.push({ name: "_" + s.sheet, rows: all, hidden: true });
  }
  const help = [
    ["Таблица вики Канъяло"],
    [""],
    ["Один лист — один раздел вики, одна строка — одна статья. Первый столбец — название."],
    ["Изменяйте ячейки, добавляйте строки (новые статьи) и столбцы (новые сведения) — всё перенесётся на сайт."],
    ["Новый столбец появится на странице статьи в блоке «Сведения»."],
    ["Несколько значений в одной ячейке разделяйте точкой с запятой: Лиресёрц; Мальха-Садд"],
    ["Правители: Имя (Титул); Имя (Титул). Пол: М или Ж. Да/нет: «да» или «нет»."],
    ["Переименовывать статьи и удалять их — в редакторе вики, а не в таблице."],
    [""],
    ["Готовую таблицу загрузите в папку excel/ на GitHub: https://github.com/santyago08/wikivakkmap/tree/main/excel"],
    ["Add file → Upload files → Commit changes. Через 1–2 минуты данные появятся на сайте, отчёт — в excel/ОТЧЁТ.md."],
    ["Переносятся только ячейки, которые вы изменили, поэтому правки других редакторов не пропадут."],
    ["Скачивайте свежую таблицу перед каждой правкой: старая копия не знает о том, что изменилось после её скачивания."],
  ];
  return writeXlsx([...visible, { name: HELP_SHEET, rows: help, widths: [110], plain: true }, ...hidden]);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  mkdirSync(dirname(EXPORT_FILE), { recursive: true });
  writeFileSync(EXPORT_FILE, buildWorkbook(ROOT));
  console.log(`таблица Excel: ${EXPORT_FILE}`);
}
