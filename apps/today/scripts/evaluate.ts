import { search, answer, score, closeDatabase } from "../lib/retrieval";
import questions from "../test/eval-questions.json";
try {
  const results = [];
  for (const q of questions) {
    const passages = await search(q.question);
    let text = "",
      uncertain = false;
    for await (const e of answer(q.question, async () => passages)) {
      if (e.kind === "text") text += e.text;
      if (e.kind === "uncertain") uncertain = true;
    }
    results.push({ ...q, ...score(q.expected, passages, text, uncertain) });
  }
  console.log(
    JSON.stringify(
      {
        count: results.length,
        retrievalHits: results.filter((r) => r.retrievalHit).length,
        grounded: results.filter((r) => r.grounded).length,
        results,
      },
      null,
      2,
    ),
  );
  if (results.some((r) => !r.retrievalHit || !r.grounded)) process.exitCode = 1;
} finally {
  await closeDatabase();
}
