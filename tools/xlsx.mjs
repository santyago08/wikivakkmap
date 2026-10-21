// Чтение и запись файлов Excel (.xlsx) без сторонних библиотек.
// Файл .xlsx — это zip-архив с XML-файлами внутри.
import { inflateRawSync, deflateRawSync } from "node:zlib";

/* ---------- zip ---------- */
function unzip(buf) {
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error("это не файл .xlsx");
  const files = {};
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = buf.readUInt16LE(eocd + 10); i > 0; i--) {
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42), name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + size);
    files[name] = () => (method === 8 ? inflateRawSync(data) : data).toString("utf8");
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}
const CRC = Array.from({ length: 256 }, (_, n) => { for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
const crc32 = b => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function zip(entries) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, text] of entries) {
    const raw = Buffer.from(text, "utf8"), data = deflateRawSync(raw), nm = Buffer.from(name, "utf8"), crc = crc32(raw);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x0800, 6); head.writeUInt16LE(8, 8);
    head.writeUInt32LE(0x00210000, 10); // 1 Jan 1980
    head.writeUInt32LE(crc, 14); head.writeUInt32LE(data.length, 18); head.writeUInt32LE(raw.length, 22); head.writeUInt16LE(nm.length, 26);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x0800, 8); cen.writeUInt16LE(8, 10);
    cen.writeUInt32LE(0x00210000, 12); cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(data.length, 20); cen.writeUInt32LE(raw.length, 24);
    cen.writeUInt16LE(nm.length, 28); cen.writeUInt32LE(offset, 42);
    locals.push(head, nm, data); centrals.push(cen, nm);
    offset += 30 + nm.length + data.length;
  }
  const dir = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}

/* ---------- read ---------- */
const unxml = s => s.replace(/&(lt|gt|quot|apos|amp|#x?[0-9a-f]+);/gi, (_, e) => ({ lt: "<", gt: ">", quot: '"', apos: "'", amp: "&" })[e.toLowerCase()]
  ?? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : +e.slice(1)));
const textOf = xml => [...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "").matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(m => unxml(m[1])).join("");
const colIndex = ref => [...ref.replace(/\d+/g, "")].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
const attr = (tag, name) => { const m = tag.match(new RegExp(`\\b${name}="([^"]*)"`)); return m ? unxml(m[1]) : null; };

// → [{ name, hidden, rows: [[cell, …], …] }] — every cell is a string
export function readXlsx(buf) {
  const z = unzip(buf);
  const shared = z["xl/sharedStrings.xml"] ? [...z["xl/sharedStrings.xml"]().matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => textOf(m[1])) : [];
  const rels = {};
  if (z["xl/_rels/workbook.xml.rels"]) for (const m of z["xl/_rels/workbook.xml.rels"]().matchAll(/<Relationship\b[^>]*>/g))
    rels[attr(m[0], "Id")] = attr(m[0], "Target").replace(/^\/?(xl\/)?/, "xl/");
  const list = z["xl/workbook.xml"] ? [...z["xl/workbook.xml"]().matchAll(/<sheet\b[^>]*>/g)].map(m => ({
    name: attr(m[0], "name"), hidden: !!attr(m[0], "state") && attr(m[0], "state") !== "visible", path: rels[attr(m[0], "r:id")] })) : [];
  if (!list.length) Object.keys(z).filter(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort().forEach((path, i) => list.push({ name: `Лист${i + 1}`, hidden: false, path }));
  return list.filter(s => z[s.path]).map(s => {
    const rows = [];
    for (const r of z[s.path]().matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const row = [];
      let auto = 0;
      for (const c of (r[2] || "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = attr(c[1], "r"), type = attr(c[1], "t"), inner = c[2] || "";
        const v = (inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        const value = type === "s" ? shared[+v] ?? "" : type === "inlineStr" ? textOf(inner) : type === "b" ? (v === "1" ? "да" : "нет") : v != null ? unxml(v) : "";
        const i = ref ? colIndex(ref) : auto;
        row[i] = value; auto = i + 1;
      }
      const n = attr(r[1], "r");
      rows[n ? +n - 1 : rows.length] = Array.from(row, x => x ?? "");
    }
    return { name: s.name, hidden: s.hidden, rows: Array.from(rows, x => x ?? []) };
  });
}

/* ---------- write ---------- */
const xml = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
const colName = i => { let s = ""; for (i++; i; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + (i - 1) % 26) + s; return s; };
const sheetRef = name => `'${name.replace(/'/g, "''")}'`;

// sheets: [{ name, rows: [[…], …], hidden?, widths?: [n, …] }]; the first row of a visible sheet is a header
export function writeXlsx(sheets) {
  const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const files = [];
  const names = [];
  sheets.forEach((s, i) => {
    const width = Math.max(1, ...s.rows.map(r => r.length));
    const rows = s.rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => v == null || v === "" ? "" :
      `<c r="${colName(ci)}${ri + 1}" t="inlineStr" s="${!s.hidden && ri === 0 ? 1 : 2}"><is><t xml:space="preserve">${xml(v)}</t></is></c>`).join("")}</row>`).join("");
    const cols = (s.widths || []).map((w, ci) => `<col min="${ci + 1}" max="${ci + 1}" width="${w}" customWidth="1"/>`).join("");
    const ref = `A1:${colName(width - 1)}${Math.max(1, s.rows.length)}`;
    files.push([`xl/worksheets/sheet${i + 1}.xml`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet ${NS}>` +
      (s.hidden || s.plain ? "" : `<sheetViews><sheetView workbookViewId="0"${i === 0 ? ' tabSelected="1"' : ""}><pane xSplit="1" ySplit="1" topLeftCell="B2" activePane="bottomRight" state="frozen"/></sheetView></sheetViews>`) +
      `<sheetFormatPr defaultRowHeight="15"/>${cols ? `<cols>${cols}</cols>` : ""}<sheetData>${rows}</sheetData>` +
      (s.hidden || s.plain || s.rows.length < 2 ? "" : `<autoFilter ref="${ref}"/>`) + `</worksheet>`]);
    if (!s.hidden && !s.plain && s.rows.length >= 2) names.push(`<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">${xml(sheetRef(s.name))}!$A$1:$${colName(width - 1)}$${s.rows.length}</definedName>`);
  });
  return zip([
    ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`],
    ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ["xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook ${NS}><bookViews><workbookView activeTab="0"/></bookViews><sheets>${sheets.map((s, i) => `<sheet name="${xml(s.name)}" sheetId="${i + 1}"${s.hidden ? ' state="veryHidden"' : ""} r:id="rId${i + 1}"/>`).join("")}</sheets>${names.length ? `<definedNames>${names.join("")}</definedNames>` : ""}</workbook>`],
    ["xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ["xl/styles.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8DFC8"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="49" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`],
    ...files,
  ]);
}
