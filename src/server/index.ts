import { existsSync } from "node:fs";
import { resolve } from "node:path";
import express from "express";
import { openDB, migrate } from "./db.js";
import { seed } from "./seed.js";
import { createApp } from "./app.js";
if (existsSync(".env")) process.loadEnvFile(".env");
const db = await openDB();
await migrate(db);
await seed(db);
const { app } = createApp(db);
let vite:
  Awaited<ReturnType<(typeof import("vite"))["createServer"]>> | undefined;
if (process.env.NODE_ENV === "production") {
  app.use(express.static(resolve("dist")));
  app.get("/{*path}", (_req, res) => res.sendFile(resolve("dist/index.html")));
} else {
  const { createServer } = await import("vite");
  vite = await createServer({
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
}
const port = Number(process.env.PORT || 4317),
  host = process.env.HOST || "127.0.0.1";
const server = app.listen(port, host, () =>
  console.log(`知序 Team Memory → http://${host}:${port}`),
);
async function close() {
  await vite?.close();
  await new Promise<void>((done) => server.close(() => done()));
  await db.close();
  process.exit(0);
}
process.once("SIGINT", close);
process.once("SIGTERM", close);
