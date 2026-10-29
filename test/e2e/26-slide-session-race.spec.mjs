import {assert,go} from './helpers.mjs';

export default async function({page}){
 await go(page,'school?lectures=demo-course-design');
 const id=await page.evaluate(async()=>{const response=await fetch('/api/lectures?course=demo-course-design');return (await response.json()).items[0].id;});
 const route='school?lectures=demo-course-design&lecture='+id;
 let release,entered;const hold=new Promise(r=>release=r),started=new Promise(r=>entered=r);
 let mounts=0;
 await page.route(new RegExp('/api/lectures/'+id+'$'),async request=>{if(request.request().method()==='GET'){mounts++;entered();await hold;}await request.continue();});
 try{
  await page.evaluate(route=>{location.hash=route;},route);
  await Promise.race([started,new Promise((_,reject)=>setTimeout(()=>reject(Error('Lecture mount request not reached')),5000))]);
  const previous=await page.locator('#main').elementHandle();
  // Retire the first route while its persistent workspace is still mounting.
  await page.evaluate(route=>{location.hash=route;},route+'&source='+id+'-s-slides&slide=1');
  await page.waitForFunction(root=>!root.isConnected,previous);
  await page.locator('#main .live-note-host').waitFor({state:'attached'});
  release();await page.waitForLoadState('networkidle');
  await page.locator('canvas.lecture-canvas').waitFor();
  await page.waitForFunction(()=>[...document.querySelectorAll('canvas.lecture-crop-canvas')].some(c=>c.width>300));
  assert.equal(await page.locator('.lecture-slide-dock').count(),1,'concurrent routes must share one lecture slide dock');
  assert.equal(await page.locator('.lecture-slide-dock:visible').count(),1,'the current lecture owns its dock');
  assert.equal(mounts,1,'only one workspace may mount for a lecture');
  await go(page,'today');assert.equal(await page.locator('.lecture-slide-dock:visible').count(),0);
  await page.evaluate(route=>{location.hash=route;},route);
  await page.locator('canvas.lecture-canvas').waitFor();await page.locator('.lecture-slide-dock:visible').waitFor();
  assert.equal(await page.locator('.lecture-slide-dock').count(),1,'returning reuses the suspended dock');
 }finally{release();await page.unrouteAll({behavior:'wait'});}
}
