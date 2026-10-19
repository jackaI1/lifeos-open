import assert from 'node:assert/strict';
export {assert};
export const button=(p,name)=>p.getByRole('button',{name,exact:true});
export const visible=async(p,text)=>p.getByText(text,{exact:false}).filter({visible:true}).first().waitFor();
export async function go(p,route){await p.goto(p.origin+'/#'+route,{waitUntil:'networkidle'});await p.waitForTimeout(50);await p.waitForLoadState('networkidle');await p.locator('#main h1').waitFor();}
export async function reload(p){await p.reload({waitUntil:'networkidle'});}
export async function saveNote(p){await button(p,'Note options').click();await button(p,'Save now').click();await p.waitForTimeout(250);}
export async function lecture(p){await go(p,'school?lectures=demo-course-design');await p.getByText('Introduction to feedback loops',{exact:true}).click();await p.locator('canvas.lecture-canvas').waitFor();await p.waitForFunction(()=>{const c=document.querySelector('canvas.lecture-canvas'),d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let ink=0;for(let i=0;i<d.length;i+=4)if(d[i+3]>200&&d[i]<80&&d[i+1]<100&&d[i+2]<130)ink++;return ink>100&&ink<c.width*c.height*.15;});}
export async function draw(p,x=180,y=160,dx=120,dy=55){const c=p.locator('canvas.lecture-canvas'),b=await c.boundingBox();await p.mouse.move(b.x+x,b.y+y);await p.mouse.down();for(let i=1;i<=12;i++)await p.mouse.move(b.x+x+dx*i/12,b.y+y+dy*i/12);await p.mouse.up();}
export async function ask(p,text){await p.locator('textarea:visible').last().fill(text);await p.getByRole('button',{name:/^Send/}).last().click();await p.waitForTimeout(800);}

export async function saved(p){await p.locator('#dialog').waitFor({state:'hidden'});await p.waitForLoadState('networkidle');}
export async function ink(p,pageId='0001'){
 const id=(await p.evaluate(async()=>{const r=await fetch('/api/lectures?course=demo-course-design');return (await r.json()).items[0].id;}));
 const data=await p.evaluate(async({id,pageId})=>{const base='/api/lectures/'+id+'/pages/'+pageId+'/ink',head=await(await fetch(base)).json(),page=head.base?await(await fetch(base+'/base')).json():{schemaVersion:1,width:1000,height:1400,strokes:[],attachments:[]},patches=[];for(const row of head.chunks)patches.push(await(await fetch(base+'/chunks/'+row.data.sequence)).json());return {page,patches,id};},{id,pageId});const {applyInkPatches}=await import('../../public/lecture-ink-patch.js');return {...applyInkPatches(data.page,data.patches),lectureId:id};
}
export async function syncInk(p){await button(p,'Saved on this device').click();await button(p,'Save notes now').click();await p.keyboard.press('Escape');}
export async function waitInk(p,predicate){await syncInk(p);const deadline=Date.now()+8000;let value;do{value=await ink(p);if(predicate(value))return value;await p.waitForTimeout(150);}while(Date.now()<deadline);assert.ok(predicate(value),'Saved ink did not reach the expected state');}

export async function darkInk(p){return p.locator('canvas.lecture-canvas').evaluate(c=>{const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let count=0;for(let i=0;i<d.length;i+=4)if(d[i]<80&&d[i+1]<100&&d[i+2]<130)count++;return count;});}
