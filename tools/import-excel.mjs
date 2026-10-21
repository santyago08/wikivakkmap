// Переносит данные из таблиц Excel (папка excel/) в статьи вики (папка articles/).
// Запуск: node tools/import-excel.mjs          — только таблицы, изменившиеся с прошлого импорта
//         node tools/import-excel.mjs --all    — все таблицы заново
//         node tools/import-excel.mjs --dry    — только показать, что изменится
// На GitHub запускается автоматически перед каждой публикацией.
//
// Таблицы двух видов:
// 1. Таблица, скачанная с сайта (tools/export-excel.mjs), и любая таблица по тем же правилам: лист — раздел вики
//    (по названию листа), строка или столбец — статья, заголовки — поля как в редакторе. Неизвестные заголовки
//    становятся «Дополнительными сведениями». Если в файле есть скрытая копия данных (лист «_<раздел>»),
//    переносятся только ячейки, изменённые после скачивания; иначе — все непустые ячейки.
// 2. Первые таблицы мира (узнаются по содержимому): государства — строка «Название государства…»,
//    расы — столбец «Название расы», континенты — строка с названиями континентов. Их поля заменяют поля статей.
// Текст статей, написанный редакторами, не трогается: обновляются только автоматические вводные фразы.
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "./vendor/js-yaml.mjs";
import { readXlsx } from "./xlsx.mjs";
import { loadSections, sectionOfSheet, columnOf, fromCell, normLabel } from "./tables.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ART = join(ROOT, "articles"), XL = join(ROOT, "excel");
const STATE_FILE = join(XL, ".imported.json"), REPORT_FILE = join(XL, "ОТЧЁТ.md");
const ALL = process.argv.includes("--all"), DRY = process.argv.includes("--dry");

/* ---------- text helpers ---------- */
const TR = {а:"a",б:"b",в:"v",г:"g",д:"d",е:"e",ё:"e",ж:"zh",з:"z",и:"i",й:"y",к:"k",л:"l",м:"m",н:"n",о:"o",п:"p",р:"r",с:"s",т:"t",у:"u",ф:"f",х:"h",ц:"ts",ч:"ch",ш:"sh",щ:"sch",ъ:"",ы:"y",ь:"",э:"e",ю:"yu",я:"ya"};
const slug = s => String(s).toLowerCase().split("").map(c => TR[c] ?? c).join("").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const clean = s => String(s ?? "").replace(/\r/g, "").replace(/[ \t ]+\n/g, "\n").replace(/[ \t ]{3,}/g, "\n").replace(/[ \t ]+/g, " ").replace(/\n{2,}/g, "\n").trim();
const isEmpty = s => !s || /^[_\-—–]+$/.test(s.trim());
const val = s => isEmpty(clean(s)) ? "" : clean(s);
const oneLine = s => val(s).replace(/\n/g, "; ");
// "a, b (c, d), e" → ["a", "b (c, d)", "e"]
function splitList(s) {
  const out = []; let cur = "", depth = 0;
  for (const ch of val(s)) {
    if (ch === "(") depth++; if (ch === ")") depth = Math.max(0, depth - 1);
    if ((ch === "," || ch === "\n") && !depth) { if (cur.trim()) out.push(cur.trim()); cur = ""; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.filter(x => !isEmpty(x));
}
// "> Афанцы (…)   > Мистайцы (…)" → ["Афанцы (…)", "Мистайцы (…)"]
const bullets = s => val(s).split(/\s*>\s*/).map(x => x.replace(/\s+/g, " ").trim()).filter(Boolean);
const norm = s => String(s).toLowerCase().replace(/ё/g, "е").replace(/э/g, "е").replace(/щ/g, "ш").replace(/[^a-zа-я0-9]+/g, "");
function lev(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 9;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
// Finds an article by title or other names; tolerates small spelling differences (е/э/ё, ш/щ, one or two letters)
function findIn(list, name) {
  const n = norm(name); if (!n) return null;
  const names = a => [a.meta.title, ...[].concat(a.meta.aliases || []), ...String(a.meta.title).split(" / ")].map(norm);
  const exact = list.filter(a => names(a).includes(n));
  if (exact.length) return exact[0];
  const max = n.length < 12 ? 1 : 2;
  const close = list.map(a => ({ a, d: Math.min(...names(a).map(x => lev(x, n))) })).filter(x => x.d <= max).sort((x, y) => x.d - y.d);
  return close.length && (close.length === 1 || close[0].d < close[1].d) ? close[0].a : null;
}

/* ---------- articles ---------- */
const articles = readdirSync(ART).filter(f => f.endsWith(".md")).map(f => {
  const text = readFileSync(join(ART, f), "utf8").replace(/^﻿/, "").replace(/\r\n/g, "\n");
  const m = text.match(/^---\n([\s\S]*?)\n---\n?/);
  return { file: f, meta: m ? yaml.load(m[1]) || {} : {}, body: m ? text.slice(m[0].length).replace(/^\n+/, "") : text, original: text, isNew: false };
});
const ofCategory = c => articles.filter(a => a.meta.category === c);
function newArticle(meta, body) {
  let f = slug(meta.title) || "statya";
  for (let i = 2; articles.some(a => a.file === f + ".md"); i++) f = `${slug(meta.title)}-${i}`;
  const a = { file: f + ".md", meta, body, original: "", isNew: true };
  articles.push(a);
  return a;
}
const changes = new Map(); // article → list of changed fields
const before = new Map();  // article → its fields before this import
function set(a, key, value) {
  const empty = v => v == null || v === "" || (Array.isArray(v) && !v.length);
  if (empty(value) && empty(a.meta[key])) return;
  if (JSON.stringify(a.meta[key] ?? "") === JSON.stringify(value ?? "")) return;
  if (!before.has(a)) before.set(a, { ...a.meta });
  a.meta[key] = value;
  (changes.get(a) || changes.set(a, []).get(a)).push(key);
}
function setBody(a, body) { if (body !== a.body) { a.body = body; (changes.get(a) || changes.set(a, []).get(a)).push("текст"); } }
// Replaces the automatic first sentence of an article (written when the article was created) but keeps everything editors wrote
function replaceIntro(a, test, intro) {
  const parts = a.body.split(/\n\n/);
  if (parts.length && test.test(parts[0])) { parts[0] = intro; setBody(a, parts.join("\n\n")); }
}
const lower1 = s => s ? s[0].toLowerCase() + s.slice(1) : s;
const report = [], warn = msg => { report.push("- " + msg); console.warn("! " + msg); };

/* ---------- races & codes ---------- */
// Characters' race in the tables: (Пол, Раса, Должность) with these abbreviations → race codes used on the site
const PERSON_RACE = { "Ч": "Ч", "К": "Э", "Э": "Э", "А": "А", "Ф": "Ф", "М": "М", "Г": "Г", "Мут": "Мут", "Е": "Е", "Д": "Д", "О": "О", "Р": "Р", "ИЛ": "ИЛ" };
const raceCode = name => { const r = findIn(ofCategory("Раса"), String(name).replace(/\s*\(.*$/, "")); return r ? r.meta.code : null; };
const characterRace = {}; // name (normalized) → race code, from the races table

/* ---------- people ---------- */
// "Эрвин Роланд (М, Президент)   Лиза Эрлайт (Ж, Президент)" → [{ name, args: ["М", "Президент"] }]
function people(s) {
  const out = [];
  for (const m of val(s).replace(/\n/g, " ").matchAll(/([^()]+?)\s*\(((?:[^()]|\([^()]*\))*)\)/g)) {
    // «"Гаярдос" Сватцкор Ла Сиеста» → «Сватцкор Ла Сиеста» (the nickname in quotes is dropped)
    const name = m[1].replace(/^[\s,;]+/, "").replace(/^["«][^"»]*["»]\s*/, "").replace(/\s+/g, " ").trim();
    if (name && !isEmpty(name)) out.push({ name, args: m[2].split(",").map(x => x.trim()) });
  }
  return out;
}
const residents = {}; // normalized name → { name, states:Set, roles:[], sex, race }
function addPerson(name, state, { sex, race, role }) {
  const key = norm(name);
  const p = residents[key] ||= { name, states: new Set(), roles: [], sex: "", race: "" };
  p.states.add(state);
  if (role && !p.roles.includes(role)) p.roles.push(role);
  if (/^[МЖ]$/.test(sex || "") && !p.sex) p.sex = sex;
  if (race && !p.race) p.race = race;
}
function raceOfCharacter(name) {
  const n = norm(name);
  if (characterRace[n]) return characterRace[n];
  const close = Object.keys(characterRace).filter(k => lev(k, n) <= (n.length < 12 ? 1 : 2));
  return close.length === 1 ? characterRace[close[0]] : "";
}
function writeResidents() {
  const list = ofCategory("Житель"), byArticle = new Map();
  // The same person can be listed under several names («Айзис / Аббас Юнус» and «Аббас Юнус»): merge them by article
  for (const p of Object.values(residents)) {
    let a = findIn(list, p.name);
    if (!a) {
      a = newArticle({ title: p.name, category: "Житель", summary: "", states: [], race: "", sex: "", role: "", kind: "", skin: "", slim: false, portrait: "", stub: true },
        `**${p.name}** — житель государства [[${[...p.states][0]}]].\n\n## Биография\n\n*Раздел ещё не написан.*`);
      list.push(a);
    }
    const m = byArticle.get(a) || byArticle.set(a, { states: new Set(), roles: [], sex: "", race: "" }).get(a);
    p.states.forEach(s => m.states.add(s));
    p.roles.forEach(r => m.roles.includes(r) || m.roles.push(r));
    m.sex ||= p.sex;
    m.race ||= raceOfCharacter(p.name) || p.race;
  }
  for (const [a, p] of byArticle) {
    const race = p.race;
    const states = [...new Set([...[].concat(a.meta.states || []), ...p.states])];
    set(a, "states", states);
    if (p.sex) set(a, "sex", p.sex);
    if (race && !a.meta.kind) set(a, "race", race);
    if (p.roles.length) set(a, "role", p.roles.join("; "));
    refreshResident(a);
  }
}
// Automatic summary and first sentence of a resident, from the fields
const residentSummary = m => ([m.role, [].concat(m.states || []).join(", ")].filter(Boolean).join(" — ").replace(/^./, c => c.toUpperCase()) || "Житель") + ".";
function refreshResident(a) {
  const states = [].concat(a.meta.states || []), role = a.meta.role || "";
  // The summary is rewritten only if nobody wrote their own (it is empty or still the automatic one)
  if (!a.meta.summary || /^Житель[:.]/.test(a.meta.summary) || a.meta.summary === residentSummary(before.get(a) || a.meta)) set(a, "summary", residentSummary(a.meta));
  if (states.length) replaceIntro(a, /^\*\*[^*]+\*\* — (.*, )?(житель|жительница) (государств|мира)/, `**${a.meta.title}** — ${role ? lower1(role) + ", " : ""}${a.meta.sex === "Ж" ? "жительница" : "житель"} ${states.length > 1 ? "государств" : "государства"} ${states.map(s => `[[${s}]]`).join(", ")}.`);
}

/* ---------- sheet: states ---------- */
// Automatic summary and first sentence of a state, from the fields
function refreshState(a) {
  if (!a.meta.summary || /^Государство на континенте/.test(a.meta.summary))
    set(a, "summary", `Государство на континенте ${a.meta.continent || "—"}.${a.meta.capital ? ` Столица — ${a.meta.capital}.` : ""}${a.meta.regime ? ` ${a.meta.regime}.` : ""}`);
  const capital = a.meta.capital ? ` Столица — [[${a.meta.capital.replace(/\s*\(.*$/, "").split(",")[0].trim()}]].` : "";
  replaceIntro(a, /^\*\*[^*]+\*\*( \([^)]*\))? — государство/, `**${a.meta.title}**${[].concat(a.meta.aliases || []).length ? ` (${[].concat(a.meta.aliases)[0]})` : ""} — государство на континенте [[${a.meta.continent}]].${capital}${a.meta.regime ? ` Политический строй — ${lower1(a.meta.regime)}.` : ""}${a.meta.war && a.meta.war !== "отсутствует" && a.meta.war !== "против всех" ? ` В [[Великая война|Великой войне]] выступает на стороне [[${a.meta.war}|${a.meta.war === "Конгломерат" ? "Конгломерата" : "Акрециса"}]].` : ""}`);
}
const STATE_COLS = [
  [/^Название государства/i, "title"], [/^Континент/i, "continent"], [/Политический строй/i, "regime"], [/^Идеология/i, "ideology"],
  [/^Столица/i, "capital"], [/Другие города/i, "cities"], [/Имя лидера/i, "leaders"], [/Раса лидера|Главная раса/i, "main_race"],
  [/Прочие.*расы/i, "other_races"], [/Важные персонажи/i, "people"], [/ВВП/i, "gdp"],
];
const CONTINENTS = ["Афана", "Гайва", "Дзайвелл", "Заккервад", "Зинсейда", "Мирам", "Равейя", "Ревен", "Цакерей"];
function importStates(rows, h) {
  const col = {};
  rows[h].forEach((t, i) => { const c = STATE_COLS.find(([re]) => re.test(clean(t))); if (c && col[c[1]] == null) col[c[1]] = i; });
  const list = ofCategory("Государство");
  let n = 0;
  for (const row of rows.slice(h + 1)) {
    const g = k => col[k] == null ? "" : row[col[k]] ?? "";
    const title = oneLine(g("title"));
    if (!title) continue;
    n++;
    let a = findIn(list, title);
    if (!a) {
      a = newArticle({ title, category: "Государство", summary: "", stub: true }, `**${title}** — государство мира [[Канъяло]].\n\n## История\n\n*Раздел ещё не написан.*`);
      list.push(a);
      warn(`Новое государство «${title}»: его нет на карте, поэтому оно появится только в вики. Чтобы подсветить его на карте, впишите в поле «Цвет на карте» цвет с карты.`);
    } else if (norm(a.meta.title) !== norm(title) && ![].concat(a.meta.aliases || []).some(x => norm(x) === norm(title))) {
      set(a, "aliases", [...[].concat(a.meta.aliases || []), title]);
      warn(`«${title}» из таблицы найдено как «${a.meta.title}» на сайте. Название на сайте не менялось, вариант из таблицы добавлен в «Другие названия».`);
    }
    const conts = splitList(g("continent")).filter(c => CONTINENTS.includes(c));
    if (conts.length) set(a, "continent", conts[0]);
    if (splitList(g("continent")).length > 1) set(a, "continents", splitList(g("continent")));
    for (const k of ["regime", "ideology", "capital", "main_race", "other_races", "gdp"]) if (col[k] != null) set(a, k, oneLine(g(k)));
    if (col.leaders != null) {
      const leaders = people(g("leaders")).map(p => ({ name: p.name, title: p.args.slice(1).join(", ") }));
      set(a, "leaders", leaders.length ? leaders : oneLine(g("leaders")) ? [{ name: oneLine(g("leaders")), title: "" }] : []);
      // «Ацари / Кивин» = race of the leader / main race. Leaders not listed in the races table get the main race
      const races = oneLine(g("main_race")).split("/").map(x => x.trim());
      const leaderRace = raceCode(races[races.length - 1]);
      for (const p of people(g("leaders"))) addPerson(p.name, a.meta.title, { sex: p.args[0], race: leaderRace, role: p.args.slice(1).join(", ") });
    }
    for (const p of people(g("people"))) {
      if (!/^[МЖ](\/[МЖ])?$/.test(p.args[0])) { addPerson(p.name, a.meta.title, { role: p.args.join(", ") }); continue; }
      const [sex, r, ...role] = p.args;
      const known = PERSON_RACE[r];
      addPerson(p.name, a.meta.title, known ? { sex, race: known, role: role.join(", ") } : { sex, role: [r, ...role].filter(Boolean).join(", ") });
    }
    refreshState(a);
  }
  return `государства: ${n}`;
}

/* ---------- sheet: races ---------- */
const RACE_ROWS = [
  [/^Название расы/i, "title"], [/^Названи[яе] для/i, "analog"], [/^Черты/i, "traits"], [/Средний рост/i, "height"], [/продолжительность жизни/i, "lifespan"],
  [/^Виды/i, "subspecies"], [/Исходные континенты|Родина/i, "homeland"], [/Сильнейшие государства/i, "strongest"], [/Главные персонажи/i, "characters"],
  [/Главные взгляды/i, "views"], [/Прочая информация/i, "extra"], [/^Бог/i, "god"],
];
function importRaces(rows, h) {
  const row = {};
  rows.forEach((r, i) => { const c = RACE_ROWS.find(([re]) => re.test(clean(r[0]))); if (c && row[c[1]] == null) row[c[1]] = i; });
  const groupRow = h > 0 ? rows[h - 1] : [];
  const list = ofCategory("Раса"), others = articles.filter(a => a.meta.category !== "Раса");
  let n = 0, group = "";
  const width = Math.max(...rows.map(r => r.length));
  for (let c = 1; c < width; c++) {
    if (val(groupRow[c])) group = val(groupRow[c]).replace(/^["«]|["»]$/g, "").replace(/^"Раса"/, "Раса").replace(/"/g, "");
    const g = k => row[k] == null ? "" : (rows[row[k]] || [])[c] ?? "";
    const head = oneLine(g("title"));
    if (!head) continue;
    n++;
    const [, title, code] = head.match(/^(.+?)\s*(?:\(([^)]+)\))?$/);
    let a = findIn(list, title);
    if (!a) {
      const taken = findIn(others, title);
      if (taken) { warn(`Раса «${title}» не создана: уже есть статья «${taken.meta.title}» (${taken.meta.category}). Данные о ней из таблицы не перенесены.`); continue; }
      let newCode = code || title;
      if (list.some(r => r.meta.code === newCode)) newCode = title;
      a = newArticle({ title, code: newCode, category: "Раса", summary: "", image: "", stub: true }, `**${title}** — народ мира [[Канъяло]].`);
      list.push(a);
    }
    if (a.meta.code) for (const ch of splitList(g("characters"))) characterRace[norm(ch.replace(/\s*\(.*$/, "").replace(/^["«][^"»]*["»]\s*/, ""))] = a.meta.code;
    set(a, "group", group);
    for (const k of ["analog", "height", "lifespan", "homeland", "god"]) set(a, k, oneLine(g(k)));
    for (const k of ["traits", "views", "extra"]) set(a, k, val(g(k)).replace(/\n/g, " "));
    set(a, "subspecies", bullets(g("subspecies")).filter(x => !/^нет$/i.test(x)));
    set(a, "strongest", oneLine(g("strongest")));
    set(a, "characters", oneLine(g("characters")));
    if (!a.meta.summary) set(a, "summary", (a.meta.traits || "").split(/(?<=\.)\s/)[0]);
    replaceIntro(a, /^\*\*[^*]+\*\* — обозначение народа/, `**${a.meta.title}** — ${group && !/вне/.test(group) ? "народ" : "раса"} мира [[Канъяло]].`);
  }
  return `расы: ${n}`;
}

/* ---------- sheet: continents ---------- */
const CONT_ROWS = [[/Расположение/i, "location"], [/Главные расы/i, "main_races"], [/Прочие расы/i, "other_races"], [/Важные (страны|государства)/i, "key_states"], [/Климат/i, "climate"]];
function importContinents(rows, h) {
  const list = ofCategory("Континент");
  let n = 0;
  rows[h].forEach((name, c) => {
    const title = oneLine(name); if (!c || !title) return;
    let a = findIn(list, title);
    if (!a) { a = newArticle({ title, category: "Континент", summary: "", stub: true }, `**${title}** — континент мира [[Канъяло]].`); list.push(a); }
    n++;
    for (const r of rows.slice(h + 1)) {
      const k = (CONT_ROWS.find(([re]) => re.test(clean(r[0]))) || [])[1];
      if (k) set(a, k, k === "climate" ? val(r[c]).replace(/\n/g, " ") : oneLine(r[c]));
    }
  });
  return `континенты: ${n}`;
}

/* ---------- universal sheets (the table downloaded from the site, or any table made by the same rules) ---------- */
const SECTIONS = loadSections(ROOT);
const HELP_SHEET = "Как пользоваться";
const races = () => ofCategory("Раса");
const cellCtx = {
  raceCode: t => { const r = races().find(x => String(x.meta.code ?? "").toLowerCase() === t.toLowerCase()) || findIn(races(), t); return r ? r.meta.code : null; },
  raceByCode: c => (races().find(r => r.meta.code === c) || { meta: {} }).meta.title,
};
const STARTER = {
  "Государство": t => `**${t}** — государство мира [[Канъяло]].\n\n## История\n\n*Раздел ещё не написан.*`,
  "Житель": t => `**${t}** — житель мира [[Канъяло]].\n\n## Биография\n\n*Раздел ещё не написан.*`,
  "Раса": t => `**${t}** — народ мира [[Канъяло]].`,
  "Континент": t => `**${t}** — континент мира [[Канъяло]].`,
  "Город": t => `**${t}** — город мира [[Канъяло]].`,
  "Организация": t => `**${t}** — организация мира [[Канъяло]].`,
  "Событие": t => `**${t}** — событие в истории мира [[Канъяло]].`,
};
// Extra facts from columns the site has no field for: shown on the page in «Сведения»
function setInfo(a, name, value) {
  const info = [].concat(a.meta.info || []).filter(Boolean).map(x => ({ ...x }));
  const i = info.findIndex(x => normLabel(x.name) === normLabel(name));
  if (!value) { if (i >= 0) info.splice(i, 1); } else if (i >= 0) info[i].value = value; else info.push({ name, value });
  set(a, "info", info);
}
// Sheet → articles. Articles can be rows (names in the first column) or columns (names in the first row):
// whichever direction has more headers that match the editor's fields
function records(section, rows) {
  const h = rows.findIndex(r => r.some(x => clean(x)));
  if (h < 0) return null;
  let grid = rows.slice(h);
  const across = grid[0].filter(x => columnOf(section, x)).length, down = grid.filter(r => columnOf(section, r[0])).length;
  if (down > across) { const w = Math.max(...grid.map(r => r.length)); grid = Array.from({ length: w }, (_, c) => grid.map(r => r[c] ?? "")); }
  const head = grid[0].map(x => clean(x).replace(/\n/g, " "));
  let tc = head.findIndex(x => columnOf(section, x)?.key === "title");
  if (tc < 0) tc = 0;
  const out = [];
  for (const r of grid.slice(1)) {
    const title = oneLine(r[tc]);
    if (!title) continue;
    const cells = {};
    head.forEach((x, i) => { if (i !== tc && x) cells[x] = clean(r[i]); });
    out.push({ title, cells });
  }
  return out;
}
function importSheet(f, section, sheet, baseSheet) {
  const recs = records(section, sheet.rows) || [];
  // The hidden copy made when the table was downloaded: only cells that differ from it were changed by the person
  const base = baseSheet ? new Map((records(section, baseSheet.rows) || []).map(r => [norm(r.title), r.cells])) : null;
  const list = ofCategory(section.category);
  const knownInfo = new Set(list.flatMap(a => [].concat(a.meta.info || []).map(x => x && normLabel(x.name))));
  const newColumns = new Set();
  let edited = 0;
  for (const rec of recs) {
    const old = base && base.get(norm(rec.title));
    const edits = Object.entries(rec.cells).filter(([h, v]) => old ? (old[h] ?? "") !== v : v !== "");
    if (!edits.length) continue;
    edited++;
    let a = findIn(list, rec.title);
    if (!a) {
      a = newArticle({ title: rec.title, category: section.category, summary: "", stub: true }, (STARTER[section.category] || (t => `**${t}**.`))(rec.title));
      list.push(a);
      if (section.category === "Государство") warn(`Новое государство «${rec.title}»: его нет на карте, поэтому оно появится только в вики. Чтобы подсветить его на карте, впишите в поле «Цвет на карте» цвет с карты.`);
    } else if (norm(a.meta.title) !== norm(rec.title) && !String(a.meta.title).split(" / ").some(x => norm(x) === norm(rec.title)) && ![].concat(a.meta.aliases || []).some(x => norm(x) === norm(rec.title)))
      warn(`«${rec.title}» (лист «${sheet.name}») найдено как «${a.meta.title}» — данные записаны туда. Если это другая статья, напишите название точнее.`);
    for (const [h, v] of edits) {
      const col = columnOf(section, h);
      if (col?.key === "title") continue;
      if (!col) { if (!knownInfo.has(normLabel(h))) newColumns.add(h); setInfo(a, h, v); continue; }
      const r = fromCell(v, col, cellCtx);
      if (r.error) { warn(`«${rec.title}» (лист «${sheet.name}»), столбец «${h}»: ${r.error}. Ячейка не перенесена.`); continue; }
      let value = r.value;
      if (col.collection === "gosudarstva") value = [].concat(value).map(n => {
        const st = findIn(ofCategory("Государство"), n);
        if (!st) warn(`«${rec.title}» (лист «${sheet.name}»): государства «${n}» нет в вики. Проверьте название.`);
        return st ? st.meta.title : n;
      });
      set(a, col.key, value);
      // A new ruler with no article yet becomes a resident; existing residents are left as they are
      if (col.key === "leaders" && section.category === "Государство")
        for (const l of value) if (l.name && !findIn(ofCategory("Житель"), l.name)) addPerson(l.name, a.meta.title, { role: l.title });
    }
    if (section.category === "Государство") refreshState(a);
    if (section.category === "Житель") {
      if (![].concat(a.meta.states || []).length) warn(`Житель «${a.meta.title}»: не указано государство — без него житель не появится на странице «Жители» и на карте.`);
      refreshResident(a);
    }
  }
  if (newColumns.size) warn(`Лист «${sheet.name}»: новые столбцы ${[...newColumns].map(x => `«${x}»`).join(", ")} — показаны на страницах в блоке «Сведения». Если это поле, которое уже есть в редакторе, назовите столбец так же, как в редакторе.`);
  return `лист «${sheet.name}»: строк ${recs.length}, ${base ? "изменено" : "перенесено"} ${edited}`;
}

/* ---------- run ---------- */
if (!existsSync(XL)) { console.log("папки excel/ нет — импорт пропущен"); process.exit(0); }
const done = existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, "utf8")) : {};
const files = readdirSync(XL).filter(f => /\.xlsx$/i.test(f) && !f.startsWith("~$"));
const hash = f => createHash("sha256").update(readFileSync(join(XL, f))).digest("hex").slice(0, 16);
const todo = files.filter(f => ALL || done[f] !== hash(f));
if (!todo.length) { console.log("таблицы Excel не изменились — импорт не нужен"); process.exit(0); }
const book = f => readXlsx(readFileSync(join(XL, f)));
// Races go first: they tell which race each named character belongs to
const kinds = [];
for (const f of todo) {
  let sheets;
  try { sheets = book(f); } catch (e) { warn(`${f}: не удалось прочитать (${e.message}). Сохраните файл в Excel как «Книга Excel (.xlsx)».`); continue; }
  for (const sheet of sheets.filter(s => !s.hidden)) {
    const rows = sheet.rows;
    if (!rows.some(r => r.some(x => clean(x))) || normLabel(sheet.name) === normLabel(HELP_SHEET)) continue;
    const section = sectionOfSheet(SECTIONS, sheet.name);
    if (section) { kinds.push({ f, order: section.category === "Раса" ? 0 : 3, run: () => importSheet(f, section, sheet, sheets.find(s => s.hidden && s.name === "_" + sheet.name)) }); continue; }
    const first = rows.findIndex(r => /^Название государства/i.test(clean(r[0])));
    const race = rows.findIndex(r => /^Название расы/i.test(clean(r[0])));
    const cont = rows.findIndex(r => !clean(r[0]) && r.filter(x => CONTINENTS.includes(clean(x))).length >= 2);
    if (race >= 0) kinds.push({ f, order: 0, legacyRaces: true, run: () => importRaces(rows, race) });
    else if (first >= 0) kinds.push({ f, order: 1, run: () => importStates(rows, first) });
    else if (cont >= 0) kinds.push({ f, order: 2, run: () => importContinents(rows, cont) });
    else warn(`${f}, лист «${sheet.name}»: не понятно, в какой раздел вики его перенести. Назовите лист как раздел: ${SECTIONS.map(s => `«${s.sheet}»`).join(", ")}.`);
  }
}
// The first races table also tells characters' races, so read it even if only the first states table changed
if (kinds.some(k => k.order === 1) && !kinds.some(k => k.legacyRaces)) for (const f of files) {
  try { book(f).filter(s => !s.hidden && !sectionOfSheet(SECTIONS, s.name)).forEach(s => { const h = s.rows.findIndex(r => /^Название расы/i.test(clean(r[0]))); if (h >= 0) kinds.push({ f, order: 0, legacyRaces: true, run: () => importRaces(s.rows, h) }); }); } catch (_) {}
}
const summary = kinds.sort((a, b) => a.order - b.order).map(k => `${k.f}, ${k.run()}`);
writeResidents();

let written = 0, created = 0;
const lines = [];
for (const a of articles) {
  if (!changes.has(a)) continue;
  const text = `---\n${yaml.dump(a.meta, { lineWidth: -1, quotingType: "'" }).trimEnd()}\n---\n\n${a.body.trim()}\n`;
  if (text === a.original) continue;
  lines.push(`- ${a.isNew ? "**новая** " : ""}${a.meta.category}: ${a.meta.title} — ${a.isNew ? "создана" : changes.get(a).join(", ")}`);
  a.isNew ? created++ : written++;
  if (!DRY) writeFileSync(join(ART, a.file), text);
}
const out = [`# Последний импорт из Excel`, ``, `Таблицы: ${todo.join(", ")}`, ``, ...summary.map(s => `- ${s}`), ``,
  `Создано статей: ${created}, изменено: ${written}.`, ``,
  ...(report.length ? [`## На что обратить внимание`, ``, ...report, ``] : []),
  ...(lines.length ? [`## Что изменилось`, ``, ...lines.sort((x, y) => x.localeCompare(y, "ru")), ``] : [])].join("\n");
if (!DRY) {
  for (const f of todo) done[f] = hash(f);
  for (const f of Object.keys(done)) if (!files.includes(f)) delete done[f];
  writeFileSync(STATE_FILE, JSON.stringify(done, null, 2) + "\n");
  writeFileSync(REPORT_FILE, out);
}
console.log(out);
