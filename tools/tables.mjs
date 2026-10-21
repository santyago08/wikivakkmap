// Общие правила для таблиц Excel: какие разделы вики становятся листами и какие поля — столбцами.
// Всё берётся из настроек редактора (admin/config.yml): новое поле в редакторе само появится в таблице.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import yaml from "./vendor/js-yaml.mjs";

// Sections that are long texts without fields are left out of the tables
const SKIP = new Set(["spravka", "server"]);
// Fields that must not be edited from a table
const SKIP_FIELDS = new Set(["body", "category", "color", "image", "portrait", "info"]);
// Other column names people use for the same field
const SYNONYMS = {
  title: ["название", "имя", "наименование", "имя персонажа", "название государства", "название расы", "название континента", "название города"],
  summary: ["кратко", "кратко о", "краткое описание", "описание"],
  aliases: ["другие названия", "также", "псевдонимы", "прозвища"],
  states: ["государство", "государства", "страна", "страны"],
  race: ["народ", "раса", "народ обозначение"],
  sex: ["пол"],
  role: ["должность", "роль", "титул", "должность или роль"],
  continent: ["континент"],
  capital: ["столица"],
  regime: ["политический строй", "строй", "форма правления", "режим"],
  ideology: ["идеология"],
  leaders: ["правители", "правитель", "лидер", "лидеры", "имя лидера"],
  main_race: ["главный народ", "главная раса", "раса лидера главная раса"],
  other_races: ["другие народы", "прочие расы", "прочие народы", "другие народы и законы о них"],
  gdp: ["ввп", "ввп перед великой войной"],
  war: ["сторона в великой войне", "великая война", "сторона"],
  theme: ["тема", "музыка", "тема музыка"],
  skin: ["скин", "ник", "ник minecraft"],
  slim: ["тонкие руки", "модель алекс"],
  kind: ["особая сущность", "сущность"],
  stub: ["заготовка", "заготовка статья не дописана"],
  when: ["когда", "дата", "год"],
  side: ["союз великой войны", "союз"],
  code: ["обозначение", "код", "сокращение"],
};
const SHEET_SYNONYMS = { "Государство": ["страны", "государства"], "Житель": ["жители", "персонажи", "люди", "герои"], "Раса": ["расы", "народы", "расы и народы"],
  "Континент": ["континенты"], "Город": ["города"], "Организация": ["организации", "организации и религии", "религии"], "Событие": ["события"] };

export const normLabel = s => String(s ?? "").toLowerCase().replace(/ё/g, "е").replace(/\([^)]*\)/g, " ").replace(/[^a-zа-я0-9]+/g, " ").trim();
export const SEP = "; ";

export function loadSections(root) {
  const cfg = yaml.load(readFileSync(join(root, "admin", "config.yml"), "utf8"));
  return cfg.collections.filter(c => c.filter && !SKIP.has(c.name)).map(c => {
    const columns = c.fields.filter(f => !SKIP_FIELDS.has(f.name) && f.widget !== "hidden" && f.widget !== "markdown" && f.widget !== "image")
      .map(f => ({ key: f.name, label: f.label || f.name, widget: f.widget, options: f.options || null, multiple: !!f.multiple,
        collection: f.collection || null, valueField: f.value_field || null, subfields: f.fields || null }));
    const names = new Set([c.label, c.label_singular, c.name, ...(SHEET_SYNONYMS[c.filter.value] || [])].map(normLabel));
    return { name: c.name, category: c.filter.value, sheet: c.label, singular: c.label_singular, columns, names };
  });
}
export const sectionOfSheet = (sections, sheetName) => sections.find(s => s.names.has(normLabel(sheetName))) || null;
// Column header → column of the section (by label, field name or a synonym); null = a new column
export function columnOf(section, header) {
  const n = normLabel(header);
  if (!n) return null;
  return section.columns.find(c => normLabel(c.label) === n || c.key === n) || section.columns.find(c => (SYNONYMS[c.key] || []).includes(n)) || null;
}

/* ---------- article value ⇄ cell text ---------- */
const asList = v => v == null || v === "" ? [] : Array.isArray(v) ? v : [v];
// ctx.raceByCode(code) → title, ctx.raceCode(titleOrCode) → code
export function toCell(article, col, ctx) {
  const v = article[col.key];
  if (col.widget === "boolean") return v === true ? "да" : v === false ? "нет" : "";
  if (col.widget === "relation" && col.collection === "rasy") return v ? ctx.raceByCode(v) || String(v) : "";
  if (col.subfields) return asList(v).map(x => typeof x === "object" && x ? (x[col.subfields[1]?.name] ? `${x[col.subfields[0].name]} (${x[col.subfields[1].name]})` : String(x[col.subfields[0].name] ?? "")) : String(x)).filter(Boolean).join(SEP);
  if (col.widget === "list" || col.multiple) return asList(v).join(SEP);
  return v == null ? "" : String(v);
}
// → { value } or { error }
export function fromCell(text, col, ctx) {
  const t = String(text ?? "").trim();
  const list = () => t.split(/\s*;\s*|\n+/).map(x => x.trim()).filter(Boolean);
  if (col.widget === "boolean") {
    if (!t) return { value: false };
    if (/^(да|yes|true|1|\+|x|х)$/i.test(t)) return { value: true };
    if (/^(нет|no|false|0|-)$/i.test(t)) return { value: false };
    return { error: `«${t}» — нужно «да» или «нет»` };
  }
  if (col.widget === "select" && t && col.options && !col.options.includes(t)) {
    const hit = col.options.find(o => o.toLowerCase() === t.toLowerCase());
    return hit ? { value: hit } : { error: `«${t}» — можно только: ${col.options.join(", ")}` };
  }
  if (col.widget === "relation" && col.collection === "rasy") {
    if (!t) return { value: "" };
    const code = ctx.raceCode(t);
    return code ? { value: code } : { error: `народа «${t}» нет в разделе «Расы и народы»` };
  }
  if (col.subfields) return { value: list().map(x => { const m = x.match(/^(.*?)\s*\(([^()]*)\)$/); return { [col.subfields[0].name]: (m ? m[1] : x).trim(), ...(col.subfields[1] ? { [col.subfields[1].name]: m ? m[2].trim() : "" } : {}) }; }) };
  if (col.widget === "list" || col.multiple) return { value: list() };
  return { value: t };
}
