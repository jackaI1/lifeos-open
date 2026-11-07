import { getRun } from '@/lib/db';
export async function GET(_request:Request, {params}:{params:Promise<{id:string}>}) {
 try { const result=await getRun(Number((await params).id)); return result?Response.json(result):Response.json({error:'Run not found'},{status:404}); }
 catch { return Response.json({error:'Could not load run'},{status:500}); }
}
