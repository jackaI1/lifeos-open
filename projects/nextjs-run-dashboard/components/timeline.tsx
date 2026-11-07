import type { Step } from '@/lib/db';
export function Timeline({steps}:{steps:Step[]}) {
 return <ol className="timeline">{steps.map(step=><li key={step.id}><span className={'marker '+step.status}>{step.position}</span><div className="step"><div className="step-head"><h3>{step.name}</h3><span className={'badge '+step.status}>{step.status}</span><span>{step.duration_ms} ms</span></div>{step.error&&<p className="error">{step.error}</p>}{step.screenshot_url&&<a href={step.screenshot_url} target="_blank" rel="noreferrer"><img src={step.screenshot_url} alt={`Screenshot for ${step.name}`} /></a>}</div></li>)}</ol>;
}
