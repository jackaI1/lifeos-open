import { Today } from "../components/Today";
import { readToday } from "../lib/feed";
export const dynamic = "force-dynamic";
export default async function Page() {
  const initial = await readToday().catch(() => null);
  return <Today initial={initial} />;
}
