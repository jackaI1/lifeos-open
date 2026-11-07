import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getRun } from '@/lib/db';
import { Timeline } from '@/components/timeline';
import { StepChart } from '@/components/chart';
export const dynamic='force-dynamic';
export default async function Detail({params}:{params:Promise<{id:string}>}) {
 const result=await getRun(Number((await params).id)); if(!result) notFound(); const {run,steps}=result;
 return <><Link className="back" href="/">← All runs</Link><div className="intro"><div><p className="overline">Run #{run.id} / {run.browser}</p><h1>{run.name}</h1><p>Started {new Date(run.started_at).toISOString().replace('T',' ').slice(0,16)} UTC</p></div><span className={'badge '+run.status}>{run.status}</span></div><div className="stats"><div><span>Duration</span><strong>{(run.duration_ms/1000).toFixed(2)} s</strong></div><div><span>Steps</span><strong>{steps.length}</strong></div><div><span>Failed steps</span><strong>{steps.filter(s=>s.status==='failed').length}</strong></div></div>{steps.length?<><StepChart steps={steps}/><section><h2>Step timeline</h2><p>Follow the run in order. Open a screenshot to see it full size.</p><Timeline steps={steps}/></section></>:<div className="empty"><h2>No steps recorded</h2><p>This run has no trace steps yet.</p></div>}</>;
}
