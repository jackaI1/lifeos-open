import { database } from "../../../lib/retrieval";
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id || id.length > 240)
    return Response.json(
      { error: "A passage ID is required." },
      { status: 400 },
    );
  try {
    const { rows } = await database().query(
      "SELECT id,title,body,source FROM console_passages WHERE id=$1",
      [id],
    );
    return rows[0]
      ? Response.json(rows[0])
      : Response.json({ error: "Passage not found" }, { status: 404 });
  } catch {
    return Response.json(
      { error: "Start the document database and seed it." },
      { status: 503 },
    );
  }
}
