import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.argv[2] || 8765);
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".glb": "model/gltf-binary",
  ".png": "image/png",
};

const server = http.createServer((req, res) => {
  const requestPath = decodeURIComponent((req.url || "/").split("?")[0]);
  const relativePath = requestPath === "/" ? "index.html" : requestPath.replace(/^[/\\]+/, "");
  const safePath = path.normalize(relativePath);
  const filePath = path.resolve(root, safePath);
  if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.stat(filePath, (error, stat) => {
    if (error || !stat.isFile()) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": types[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Stage Tower viewer: http://127.0.0.1:${port}/`);
});
