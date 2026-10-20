// Просмотр сайта на своём компьютере: node tools/serve.mjs → http://localhost:8080/
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT) || 8080;
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".yml": "text/yaml; charset=utf-8", ".md": "text/markdown; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".svg": "image/svg+xml", ".ico": "image/x-icon" };

createServer(async (req, res) => {
  try {
    const parts = decodeURIComponent(new URL(req.url, "http://x").pathname).split("/").filter(Boolean);
    if (parts.some(p => p === ".." || p.includes("\\"))) throw 0;
    let file = join(ROOT, ...parts);
    if ((await stat(file).catch(() => null))?.isDirectory()) file = join(file, "index.html");
    const body = await readFile(file);
    res.writeHead(200, { "Content-Type": TYPES[extname(file).toLowerCase()] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
    res.end(await readFile(join(ROOT, "404.html")).catch(() => "Не найдено"));
  }
}).listen(PORT, "127.0.0.1", () => console.log(`Сайт открыт: http://localhost:${PORT}/   (закройте окно, чтобы остановить)`));
