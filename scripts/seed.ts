import { existsSync } from "node:fs";
import { openDB, migrate } from "../src/server/db.js";
import { seed } from "../src/server/seed.js";
if (existsSync(".env")) process.loadEnvFile(".env");
const db = await openDB();
await migrate(db);
await seed(db);
await db.close();
