import { listRuns } from '@/lib/db';
import { parseFilters } from '@/lib/filters';
export async function GET(request:Request) {
 const filters=parseFilters(new URL(request.url).searchParams);
 try { return Response.json({...await listRuns(filters),filters}); }
 catch { return Response.json({error:'Could not load runs'}, {status:500}); }
}
