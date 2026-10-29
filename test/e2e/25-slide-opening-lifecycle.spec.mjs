import {assert,go,lecture} from './helpers.mjs';

export default async function({page}){
 let release,entered;const hold=new Promise(r=>release=r),started=new Promise(r=>entered=r);
 await page.route(/\/api\/lectures\/[^/]+\/sources\/[^/]+\/0$/,async route=>{entered();await hold;await route.continue();});
 try{
  await lecture(page);const slides=page.getByRole('button',{name:'Slides',exact:true});if(!await slides.isVisible())await page.getByRole('button',{name:'More',exact:true}).click();await slides.click();await Promise.race([started,new Promise((_,reject)=>setTimeout(()=>reject(Error('Synthetic deck request not reached')),5000))]);
  await page.evaluate(()=>{location.hash='#today';});await page.locator('#main h1').filter({hasText:'Today'}).waitFor();
  release();await page.waitForLoadState('networkidle');
  await page.waitForFunction(()=>[...document.querySelectorAll('canvas.lecture-crop-canvas')].some(c=>c.width>300));
  assert.equal(await page.locator('.lecture-slide-dock:visible').count(),0,'late slide rendering must respect the suspended notebook');
  await go(page,'school?lectures=demo-course-design');await page.getByText('Introduction to feedback loops',{exact:true}).click();await page.locator('canvas.lecture-canvas').waitFor();
  await page.locator('.lecture-slide-dock:visible').waitFor();assert.equal(await page.locator('.lecture-slide-dock:visible').count(),1,'returning reuses exactly one slide dock');
 }finally{release();}
}
