'use client';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Step } from '@/lib/db';
export function StepChart({steps}:{steps:Step[]}) {
 const data=steps.map(s=>({name:`${s.position}. ${s.name}`,duration:s.duration_ms, failure:s.status==='failed'?100:0}));
 const failed=steps.filter(s=>s.status==='failed').length;
 return <section aria-labelledby="chart-title"><h2 id="chart-title">Step performance</h2><p>Each bar shows a step’s duration. Failure is 100% for a failed step and 0% for a passed step.</p><p className="sr-only">{steps.length} steps, {failed} failed. {steps.map(s=>`${s.name}: ${s.duration_ms} milliseconds, ${s.status}`).join('; ')}.</p><div aria-hidden="true" className="chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={data} margin={{bottom:35}}><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="name" angle={-20} textAnchor="end" interval={0} height={65} fontSize={11}/><YAxis yAxisId="duration" label={{value:'ms',angle:-90,position:'insideLeft'}}/><YAxis yAxisId="failure" orientation="right" domain={[0,100]} unit="%"/><Tooltip/><Legend verticalAlign="top"/><Bar yAxisId="duration" dataKey="duration" name="Duration (ms)" fill="#345b9c"/><Bar yAxisId="failure" dataKey="failure" name="Failure rate (%)" fill="#c34b3f"/></BarChart></ResponsiveContainer></div></section>;
}
