"use client";
import { useState } from "react";
import { createTRPCClient, httpBatchStreamLink } from "@trpc/client";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import type { AppRouter } from "../lib/router";
import type { AnswerEvent } from "../lib/retrieval";
const rpc = createTRPCClient<AppRouter>({
  links: [httpBatchStreamLink({ url: "/api/trpc" })],
});
export function Questions() {
  const [client] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={client}>
      <QuestionForm />
    </QueryClientProvider>
  );
}
export function QuestionForm() {
  const [draft, setDraft] = useState("When does the LifeOS day start?"),
    [question, setQuestion] = useState(""),
    [progress, setProgress] = useState<AnswerEvent[]>([]);
  const result = useQuery({
    queryKey: ["answer", question],
    enabled: !!question,
    retry: false,
    staleTime: 60000,
    queryFn: async () => {
      setProgress([]);
      const events: AnswerEvent[] = [];
      for await (const event of await rpc.answer.query({ question })) {
        events.push(event);
        setProgress([...events]);
      }
      return events;
    },
  });
  const events = result.data ?? progress;
  const sources = events.find((e) => e.kind === "sources");
  return (
    <main>
      <h1>Ask the public guide</h1>
      <p>
        Search a small set of public LifeOS instructions. Answers quote their
        sources. This does not read my private notes.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (question === draft.trim()) void result.refetch();
          else setQuestion(draft.trim());
        }}
      >
        <label>
          Question
          <input
            required
            minLength={3}
            maxLength={500}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
        </label>
        <button disabled={result.isFetching}>Ask question</button>
      </form>
      {!question && (
        <p>Ask about the day, backups, privacy or planning a report.</p>
      )}
      {result.isFetching && (
        <p role="status">Looking up passages and checking the answer…</p>
      )}
      {result.isError && (
        <p role="alert">
          The document service is unavailable. Start Postgres and run the seed
          command, then ask again.
        </p>
      )}
      <div aria-live="polite">
        {events.map((event, i) =>
          event.kind === "text" ? (
            <p key={i} className="quote">
              {event.text}
            </p>
          ) : event.kind === "uncertain" ? (
            <p key={i} role="status">
              {event.text}
            </p>
          ) : null,
        )}
      </div>
      {sources?.kind === "sources" && sources.passages.length > 0 && (
        <ol aria-label="Sources">
          {sources.passages.map((p) => (
            <li key={p.id}>
              <a href={"/api/passages?id=" + encodeURIComponent(p.id)}>
                {p.title}
              </a>
              <p>{p.source}</p>
            </li>
          ))}
        </ol>
      )}
      <p className="muted">
        The default answer is an exact quotation. An optional language model can
        select shorter quotes; unsupported lines are withheld. Word-based
        vectors can miss differently worded questions.
      </p>
    </main>
  );
}
