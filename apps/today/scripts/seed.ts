import { readdir, readFile } from "node:fs/promises";
import { database, embedding, closeDatabase } from "../lib/retrieval";
try {
  if (!process.env.CONSOLE_DATABASE_URL)
    throw Error("Set CONSOLE_DATABASE_URL first");
  const client = await database().connect();
  try {
    await client.query("BEGIN");
    await client.query("CREATE EXTENSION IF NOT EXISTS vector");
    await client.query(
      "CREATE TABLE IF NOT EXISTS console_passages (id text PRIMARY KEY,title text NOT NULL,body text NOT NULL,source text NOT NULL,embedding vector(128) NOT NULL)",
    );
    await client.query("DELETE FROM console_passages");
    for (const file of (await readdir("../../docs/public-guide"))
      .filter((f) => f.endsWith(".md"))
      .sort()) {
      const raw = await readFile("../../docs/public-guide/" + file, "utf8");
      const title = raw.match(/^title: (.+)$/m)![1];
      const paragraphs = raw
        .replace(/^---[\s\S]*?---\s*/, "")
        .split(/\n\s*\n/)
        .map((s) => s.trim())
        .filter((s) => s && !s.startsWith("#"));
      for (const [i, text] of paragraphs.entries())
        await client.query(
          "INSERT INTO console_passages VALUES ($1,$2,$3,$4,$5::vector)",
          [
            file + "#p" + (i + 1),
            title,
            text,
            "docs/public-guide/" + file,
            JSON.stringify(embedding(text)),
          ],
        );
    }
    await client.query("COMMIT");
    console.log("Seeded eight public passages.");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
} finally {
  await closeDatabase();
}
