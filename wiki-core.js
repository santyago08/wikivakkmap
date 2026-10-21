/* Канъяло — общая логика всех страниц. Данные: map/states.js (границы) + wiki-data.js (статьи). */

/* ---------- helpers ---------- */
const TRANSLIT = {а:"a",б:"b",в:"v",г:"g",д:"d",е:"e",ё:"e",ж:"zh",з:"z",и:"i",й:"y",к:"k",л:"l",м:"m",н:"n",о:"o",п:"p",р:"r",с:"s",т:"t",у:"u",ф:"f",х:"h",ц:"ts",ч:"ch",ш:"sh",щ:"sch",ъ:"",ы:"y",ь:"",э:"e",ю:"yu",я:"ya"};
const slug = s => String(s).toLowerCase().split("").map(c => TRANSLIT[c] ?? c).join("").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const plural = (n, [one, few, many]) => { const a = Math.abs(n) % 100, b = a % 10; return a > 10 && a < 20 ? many : b === 1 ? one : b > 1 && b < 5 ? few : many; };
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const asList = v => v == null || v === "" ? [] : Array.isArray(v) ? v : [v];

/* ---------- admin mode ----------
   Editing tools are shown only to people logged into the editor (admin/) in this browser.
   The editor remembers the login in localStorage under "sveltia-cms.user".
   This only hides buttons: actual editing rights are checked by GitHub. */
const IS_ADMIN = (() => { try { return !!localStorage.getItem("sveltia-cms.user"); } catch (_) { return false; } })();
document.documentElement.classList.toggle("is-admin", IS_ADMIN);

/* ---------- articles ---------- */
// Articles marked "admin: true" (instructions for editors) are hidden from visitors
const ARTICLES = WIKI.articles.filter(a => IS_ADMIN || !a.admin);
const ART = {}, ART_BY_NAME = {};
ARTICLES.forEach(a => { ART[a.slug] = a; [a.title, ...asList(a.aliases)].forEach(t => ART_BY_NAME[String(t).toLowerCase()] = a); });
// «Айзис / Аббас Юнус» is also found as «Айзис» and «Аббас Юнус»
ARTICLES.forEach(a => String(a.title).split(" / ").forEach(t => ART_BY_NAME[t.trim().toLowerCase()] ||= a));
const findArticle = name => ART_BY_NAME[String(name).trim().toLowerCase()] || ART[slug(name)] || null;
const CATEGORIES = [
  { name: "Государство", plural: "Государства" }, { name: "Житель", plural: "Жители" }, { name: "Континент", plural: "Континенты" },
  { name: "Раса", plural: "Расы и народы" }, { name: "Организация", plural: "Организации" }, { name: "Событие", plural: "События" },
  { name: "Город", plural: "Города" }, { name: "Справка", plural: "Справка" }, { name: "Сервер", plural: "Сервер" },
];
const byCategory = c => ARTICLES.filter(a => a.category === c).sort((x, y) => x.title.localeCompare(y.title, "ru"));
const BACKLINKS = {};
ARTICLES.forEach(a => a.links.forEach(t => { const to = findArticle(t); if (to && to !== a) (BACKLINKS[to.slug] ||= []).push(a); }));

/* ---------- cities ---------- */
const CITIES = WIKI.cities;
const CITY_BY_NAME = {};
CITIES.forEach(c => CITY_BY_NAME[c.name.toLowerCase()] = c);

/* ---------- war sides ---------- */
const WAR_SIDES = {
  "Конгломерат": { color: "#D2AE5A", note: "" },
  "Акрецис":     { color: "#B5503F", note: "" },
  "против всех": { color: "#8E7BA6", note: "" },
  "отсутствует": { color: "#8FA7A2", note: "Не участвует в войне" },
};

/* ---------- states: map shapes + articles ---------- */
const STATES = GEO.states;
const STATE_BY_ID = {}, STATE_BY_COLOR = {};
const CONTINENTS = Object.keys(GEO.continents);
STATES.forEach(s => {
  const a = ARTICLES.find(x => x.category === "Государство" && String(x.color).toLowerCase() === s.color) || findArticle(s.name);
  s.article = a || null;
  if (a) { s.name = a.title; if (a.continent) s.continent = a.continent; }
  s.lore = a && (a.capital || a.war || a.regime) ? { title: asList(a.aliases)[0] || "", capital: a.capital || "—", regime: a.regime || "—", war: WAR_SIDES[a.war] ? a.war : "отсутствует", theme: a.theme || "—" } : null;
  STATE_BY_ID[s.id] = s; STATE_BY_COLOR[s.color] = s;
});
const stateOfName = name => { const a = findArticle(name); return a ? STATES.find(s => s.article === a) : STATES.find(s => s.name === name); };
CITIES.forEach(c => { c.stateObj = c.state ? STATE_BY_COLOR[c.state] || null : null; });

/* ---------- residents ---------- */
const RESIDENTS = byCategory("Житель").map(a => ({
  id: a.slug, name: a.title, race: a.race || null, sex: a.sex || null, kind: a.kind || null,
  states: asList(a.states).map(n => stateOfName(n)).filter(Boolean).map(s => s.id),
  skin: a.skin || null, slim: a.slim, role: a.role || null, article: a,
})).filter(r => r.states.length);
const RES_BY_ID = {};
RESIDENTS.forEach(r => RES_BY_ID[r.id] = r);
STATES.forEach(s => { s.residents = RESIDENTS.filter(r => r.states.includes(s.id)); if (s.lore) s.lore.people = s.residents; });
const raceTitle = code => { const a = ARTICLES.find(x => x.category === "Раса" && x.code === code); return a ? a.title : code; };
const sexWord = r => r.sex === "Ж" ? "женщина" : r.sex === "М" ? "мужчина" : "";
const residentLine = r => [r.role, r.kind ? r.kind : [r.race ? raceTitle(r.race) : "", sexWord(r)].filter(Boolean).join(", ")].filter(Boolean).join(" · ");

/* ---------- skins & faces ---------- */
function skinOf(r) {
  if (r.kind && !r.skin) return null;
  const custom = r.skin ? (/\.png($|\?)/i.test(r.skin) ? r.skin : `https://mc-heads.net/skin/${encodeURIComponent(r.skin)}`) : null;
  return { url: custom || (r.sex === "Ж" ? "https://mc-heads.net/skin/MHF_Alex" : "https://mc-heads.net/skin/MHF_Steve"),
           slim: r.slim ?? (!custom && r.sex === "Ж"), custom: !!custom };
}
const skinCache = {};
function loadSkin(url) {
  return skinCache[url] || (skinCache[url] = new Promise((ok, fail) => { const im = new Image(); im.crossOrigin = "anonymous"; im.onload = () => ok(im); im.onerror = fail; im.src = url; }));
}
function paintFaces(root = document) {
  root.querySelectorAll("canvas.face[data-r]").forEach(cv => {
    const r = RES_BY_ID[cv.dataset.r], sk = r && skinOf(r);
    if (!sk) { const g = cv.getContext("2d"); g.fillStyle = "#3C3346"; g.fillRect(0, 0, 8, 8); g.fillStyle = "#C9B6E4"; g.fillRect(3, 2, 2, 4); return; }
    loadSkin(sk.url).then(im => { const g = cv.getContext("2d"); g.imageSmoothingEnabled = false; g.clearRect(0, 0, 8, 8);
      g.drawImage(im, 8, 8, 8, 8, 0, 0, 8, 8); g.drawImage(im, 40, 8, 8, 8, 0, 0, 8, 8); }).catch(() => {});
  });
}
const faceHTML = (r, size = 32) => `<canvas class="face" width="8" height="8" data-r="${r.id}" style="--s:${size}px" aria-hidden="true"></canvas>`;

/* ---------- links ---------- */
const articleURL = a => `wiki/${a.slug}/`;
const cityURL = c => `wiki/gorod/${slug(c.name)}/`;
// GitHub repository: from wiki.config.js, or guessed from a *.github.io address
function repoInfo() {
  const cfg = (typeof WIKI_CONFIG !== "undefined" && WIKI_CONFIG) || {};
  let repo = cfg.repo || "";
  if (!repo && /\.github\.io$/.test(location.hostname)) {
    const owner = location.hostname.split(".")[0], first = location.pathname.split("/").filter(Boolean)[0];
    repo = first && !/\.html$/.test(first) ? `${owner}/${first}` : `${owner}/${location.hostname}`;
  }
  return repo ? { repo, branch: cfg.branch || "main" } : null;
}
// Editor (admin/) collection for each section
const COLLECTION = { "Государство": "gosudarstva", "Житель": "zhiteli", "Город": "goroda", "Континент": "kontinenty", "Раса": "rasy",
  "Организация": "organizatsii", "Событие": "sobytiya", "Справка": "spravka", "Сервер": "server" };
const editURL = a => `admin/#/collections/${COLLECTION[a.category] || "spravka"}/entries/${encodeURIComponent(a.file.replace(/\.md$/, ""))}`;
const historyURL = a => { const r = repoInfo(); return r && `https://github.com/${r.repo}/commits/${r.branch}/articles/${encodeURIComponent(a.file)}`; };
const newArticleURL = (title, category = "Справка") => `admin/#/collections/${COLLECTION[category] || "spravka"}/new?title=${encodeURIComponent(title)}`;

/* ---------- markdown with [[wikilinks]] and {{blocks}} ---------- */
function linkFor(target, text) {
  const t = target.trim(), label = esc(text ?? t);
  const a = findArticle(t);
  if (a) return `<a class="wl" href="${articleURL(a)}" data-tip="${esc(a.slug)}">${label}</a>`;
  const c = CITY_BY_NAME[t.toLowerCase()];
  if (c) return `<a class="wl city" href="${cityURL(c)}">${label}</a>`;
  if (!IS_ADMIN) return `<span class="wl-missing">${label}</span>`;
  return `<a class="wl new" href="${newArticleURL(t)}" title="Статьи «${esc(t)}» ещё нет — нажмите, чтобы создать">${label}</a>`;
}
// "Кивин, Аларанец (подземные), Механат" → links where an article or city exists, plain text elsewhere (no red links)
function softLinks(text, cities = true) {
  const parts = []; let cur = "", depth = 0;
  for (const ch of String(text ?? "")) { if (ch === "(") depth++; if (ch === ")") depth--; if (ch === "," && !depth) { parts.push(cur); cur = ""; } else cur += ch; }
  parts.push(cur);
  return parts.map(p => p.trim()).filter(Boolean).map(p => {
    const name = p.replace(/\s*\(.*$/, ""), rest = p.slice(name.length);
    return findArticle(name) || (cities && CITY_BY_NAME[name.toLowerCase()]) ? linkFor(name) + esc(rest) : esc(p);
  }).join(", ");
}
function blockHTML(name, arg) {
  if (name === "категория") {
    const list = byCategory(arg);
    return `<ul class="cat-list">${list.map(a => `<li><a class="wl" href="${articleURL(a)}">${esc(a.title)}</a>${a.summary ? `<span> — ${esc(a.summary)}</span>` : ""}${a.category === "Раса" ? `<small>${RESIDENTS.filter(r => r.race === a.code).length} в записях</small>` : ""}</li>`).join("")}</ul>`;
  }
  if (name === "стороны" || name === "союз") {
    const sides = {};
    STATES.filter(s => s.lore).forEach(s => (sides[s.lore.war] ||= []).push(s));
    const keys = name === "союз" ? [arg] : Object.keys(WAR_SIDES);
    return `<div class="sides">${keys.filter(k => sides[k]).map(k => `<div class="side-box" style="--c:${WAR_SIDES[k].color}"><b>${esc(k[0].toUpperCase() + k.slice(1))}</b><ul>${sides[k].map(s => `<li>${linkFor(s.name)}</li>`).join("")}</ul></div>`).join("") || "<p class='blank'>Пока никого.</p>"}</div>`;
  }
  if (name === "города") {
    const groups = {};
    CITIES.forEach(c => (groups[c.stateObj ? c.stateObj.name : "Вне государств"] ||= []).push(c));
    return `<div class="city-groups">${Object.keys(groups).sort((a, b) => a.localeCompare(b, "ru")).map(g => `<section><h4>${g === "Вне государств" ? g : linkFor(g)}</h4><p>${groups[g].map(c => { const a = findArticle(c.name); const t = c.major ? `<b>${esc(c.name)}</b>` : esc(c.name); return a ? `<a class="wl" href="${articleURL(a)}">${t}</a>` : `<a class="wl city" href="${cityURL(c)}">${t}</a>`; }).join(", ")}</p></section>`).join("")}</div>`;
  }
  if (name === "галерея") {
    if (!WIKI.images.length) return `<p class="blank">В папке images пока нет картинок.</p>`;
    return `<div class="gallery">${WIKI.images.map(im => `<figure><a href="${esc(im.file)}" data-lightbox><img src="${esc(im.file)}" alt="${esc(im.caption)}" loading="lazy"></a><figcaption>${esc(im.caption)}</figcaption></figure>`).join("")}</div>`;
  }
  return "";
}
function renderMarkdown(md) {
  const blocks = [];
  let src = md.replace(/\{\{\s*([^:}]+?)\s*(?::\s*([^}]+?))?\s*\}\}/g, (_, n, arg) => { blocks.push(blockHTML(n.trim(), arg)); return `\n\nWIKIBLOCK${blocks.length - 1}\n\n`; });
  src = src.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, t, label) => linkFor(t, label));
  let html = marked.parse(src);
  html = html.replace(/<p>WIKIBLOCK(\d+)<\/p>/g, (_, i) => blocks[+i]);
  return DOMPurify.sanitize(html, { ADD_ATTR: ["target", "data-tip", "data-lightbox"] });
}

/* ---------- header search (all pages) ---------- */
function initSearch({ onState, onResident, onArticle, onCity } = {}) {
  const q = document.getElementById("q"), box = document.getElementById("found");
  const go = {
    article: onArticle || (a => location.href = articleURL(a)),
    state: onState || (id => location.href = articleURL(STATE_BY_ID[id].article || { slug: id })),
    resident: onResident || (id => location.href = "residents/#" + id),
    city: onCity || (c => location.href = cityURL(c)),
  };
  const INDEX = [
    ...ARTICLES.map(a => {
      const st = a.category === "Государство" && STATES.find(s => s.article === a), r = a.category === "Житель" && RES_BY_ID[a.slug];
      return { t: a.title, sub: a.category + (a.summary ? ", " + a.summary : ""), c: st ? st.color : "#8FA7A2", k: [a.title, ...asList(a.aliases)],
        go: st ? () => go.state(st.id) : r ? () => go.resident(r.id) : () => go.article(a) };
    }),
    ...CITIES.filter(c => !findArticle(c.name)).map(c => ({ t: c.name, sub: "Город" + (c.stateObj ? ", " + c.stateObj.name : ""), c: c.stateObj ? c.stateObj.color : "#8FA7A2", k: [c.name], go: () => go.city(c) })),
  ];
  let items = [], active = -1;
  const draw = () => {
    const v = q.value.trim().toLowerCase();
    items = v ? INDEX.filter(i => i.k.some(k => String(k).toLowerCase().includes(v)))
      .sort((a, b) => +!a.k.some(k => String(k).toLowerCase().startsWith(v)) - +!b.k.some(k => String(k).toLowerCase().startsWith(v))).slice(0, 9) : [];
    active = items.length ? 0 : -1;
    box.innerHTML = !v ? "" : items.length ? items.map((it, i) => `<li><button type="button" data-i="${i}" aria-selected="${i === active}"><span class="sw" style="--c:${it.c}"></span><span>${esc(it.t)}<small>${esc(it.sub.length > 70 ? it.sub.slice(0, 68) + "…" : it.sub)}</small></span></button></li>`).join("")
      : `<li class="none">Ничего не найдено по запросу «${esc(q.value.trim())}».</li>`;
    box.classList.toggle("show", !!v); q.setAttribute("aria-expanded", String(!!v));
  };
  const pick = i => { const it = items[i]; if (!it) return; q.value = ""; draw(); q.blur(); it.go(); };
  q.addEventListener("input", draw);
  q.addEventListener("keydown", e => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); if (!items.length) return; active = (active + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      box.querySelectorAll("button").forEach((b, i) => b.setAttribute("aria-selected", String(i === active))); }
    if (e.key === "Enter") { e.preventDefault(); pick(active); }
    if (e.key === "Escape") { q.value = ""; draw(); q.blur(); }
  });
  box.addEventListener("mousedown", e => { const b = e.target.closest("[data-i]"); if (b) { e.preventDefault(); pick(+b.dataset.i); } });
  q.addEventListener("blur", () => setTimeout(() => box.classList.remove("show"), 150));
  addEventListener("keydown", e => { if (e.key === "/" && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { e.preventDefault(); q.focus(); } });
}
