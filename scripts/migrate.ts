import { existsSync } from "node:fs";
import { openDB, migrate } from "../src/server/db.js";
if (existsSync(".env")) process.loadEnvFile(".env");
const db = await openDB();
await migrate(db);
await db.close();
console.log("数据库迁移完成");
