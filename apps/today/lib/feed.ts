import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  parseFeed,
  resolveDemoFeed,
  selectToday,
  type TodayFeed,
} from "../../../src/shared/today";

export type TodayView = ReturnType<typeof selectToday> & { timeZone: string };
export async function readToday(now = Date.now()): Promise<TodayView> {
  const raw: unknown = JSON.parse(
    await readFile(
      path.join(process.cwd(), "../../public/demo/today.json"),
      "utf8",
    ),
  );
  const feed: TodayFeed = resolveDemoFeed(parseFeed(raw), now);
  return { ...selectToday(feed, now), timeZone: feed.timeZone };
}
