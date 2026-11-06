import { NextResponse } from "next/server";
import { readToday } from "../../../lib/feed";

export async function GET() {
  try {
    return NextResponse.json(await readToday(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      { error: "The demo feed is unavailable." },
      { status: 503 },
    );
  }
}
