const base=new URL(process.env.DEMO_URL);
if(base.protocol!=='https:')throw Error('Smoke check requires HTTPS');
let health;
for(let attempt=0;attempt<12;attempt++){const response=await fetch(new URL('/healthz',base),{signal:AbortSignal.timeout(10000),cache:'no-store'});if(response.ok){health=await response.json();if(health.ok&&health.commit===process.env.GITHUB_SHA)break;}await new Promise(resolve=>setTimeout(resolve,5000));}
if(!health?.ok||health.commit!==process.env.GITHUB_SHA)throw Error('Deployed commit was not visible before timeout');
const page=await fetch(base,{signal:AbortSignal.timeout(10000)});if(!page.ok||!(await page.text()).includes('demo-bootstrap.js'))throw Error('Demo shell missing');
const privateRoute=await fetch(new URL('/api/records',base));if(privateRoute.status!==403&&privateRoute.status!==404)throw Error('Unexpected server API on static host');
console.log('Deployed fictional demo and exact commit verified.');
