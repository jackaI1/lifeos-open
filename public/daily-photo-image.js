// Keep the phone original untouched; upload a bounded display copy and thumbnail.
export async function prepareDailyPhoto(file){
 if(!file||!/^image\//.test(file.type)||file.size>32*1024*1024)throw Error('Choose a photo smaller than 32 MB.');
 const source=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(Error('The photo could not be read.'));r.readAsDataURL(file);});
 const img=new Image();img.src=source;try{await img.decode();}catch{throw Error('This browser cannot open that image. Choose a JPEG or a photo from your library.');}
 const draw=(edge,quality)=>{const scale=Math.min(1,edge/Math.max(img.naturalWidth,img.naturalHeight)),c=document.createElement('canvas');c.width=Math.max(1,Math.round(img.naturalWidth*scale));c.height=Math.max(1,Math.round(img.naturalHeight*scale));const g=c.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,c.width,c.height);g.drawImage(img,0,0,c.width,c.height);return {image:c.toDataURL('image/jpeg',quality),width:c.width,height:c.height};};
 let photo;for(let i=0;i<5;i++){photo=draw(2400*Math.pow(.8,i),.85-i*.06);if(photo.image.length<=720000)break;}if(photo.image.length>720000)throw Error('This photo is too large to save. Choose a smaller copy.');
 const thumb=draw(360,.65).image;if(thumb.length>70000)throw Error('This photo preview is too large. Choose a smaller copy.');return {...photo,thumbnail:thumb};
}
