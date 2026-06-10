import { defineConfig } from "drizzle-kit";
import path from "path";

const dbUrl = process.env.DATABASE_URL ?? "file:./data/app.db";
const dbPath = dbUrl.replace(/^file:/, "");
const resolvedPath = path.isAbsolute(dbPath)
  ? dbPath
  : path.resolve(process.cwd(), dbPath);

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  dialect: "sqlite",
  dbCredentials: {
    url: resolvedPath,
  },
});
