const clamp=(n,lo,hi)=>Math.max(lo,Math.min(hi,n));
export function imagePlacement(dimensions,top=0,visibleHeight=800){
 const ratio=dimensions.height/dimensions.width;let width=Math.min(600,Math.max(120,dimensions.width)),height=width*ratio;
 if(height>visibleHeight*.7){height=visibleHeight*.7;width=height/ratio;}
 return {x:(1000-width)/2,y:Math.max(30,top+40),width,height};
}
export function moveImage(image,dx,dy){return {...image,x:clamp(image.x+dx,0,1000-image.width),y:clamp(image.y+dy,0,1000000-image.height)};}
export function resizeImage(image,edge,dx,dy){
 const {x,y,width:w,height:h}=image,right=x+w,bottom=y+h;
 const requested=edge==='e'?1+dx/w:edge==='w'?1-dx/w:edge==='s'?1+dy/h:1-dy/h;
 const maxWidth=edge==='e'?(1000-x)/w:edge==='w'?right/w:1000/w;
 const maxHeight=edge==='n'?bottom/h:edge==='s'?(1000000-y)/h:1000000/h;
 const factor=clamp(requested,Math.min(1,Math.max(24/w,24/h)),Math.min(maxWidth,maxHeight));
 const width=w*factor,height=h*factor;
 return {...image,width,height,x:clamp(edge==='e'?x:edge==='w'?right-width:x+(w-width)/2,0,1000-width),y:clamp(edge==='n'?bottom-height:edge==='s'?y:y+(h-height)/2,0,1000000-height)};
}
export function cropImage(image,corner,dx,dy){
 const [cx,cy,cw,ch]=image.crop??[0,0,1,1],w=image.width/cw,h=image.height/ch,x=image.x-cx*w,y=image.y-cy*h;
 let left=image.x,top=image.y,right=left+image.width,bottom=top+image.height;
 const minimum=Math.min(24,image.width/2,image.height/2);
 if(corner.includes('w'))left=clamp(left+dx,Math.max(0,x),right-minimum);
 if(corner.includes('e'))right=clamp(right+dx,left+minimum,Math.min(1000,x+w));
 if(corner.includes('n'))top=clamp(top+dy,Math.max(0,y),bottom-minimum);
 if(corner.includes('s'))bottom=clamp(bottom+dy,top+minimum,Math.min(1000000,y+h));
 return {...image,x:left,y:top,width:right-left,height:bottom-top,crop:[(left-x)/w,(top-y)/h,(right-left)/w,(bottom-top)/h]};
}
export function resetImageCrop(image){const [x,y,w,h]=image.crop??[0,0,1,1],fullWidth=image.width/w,ratio=Math.min(1,1000/fullWidth);return {...image,x:clamp(image.x-x*fullWidth,0,1000-fullWidth*ratio),y:Math.max(0,image.y-y*image.height/h),width:fullWidth*ratio,height:image.height/h*ratio,crop:[0,0,1,1]};}
export function straightenTransform(a){const [x,y,w,h]=a.crop??[0,0,1,1],width=a.width/w,height=a.height/h,angle=(a.rotation??0)*Math.PI/180,c=Math.abs(Math.cos(angle)),s=Math.abs(Math.sin(angle));return {angle,scale:Math.max(c+height/width*s,c+width/height*s),width,height,x:a.x-x*width,y:a.y-y*height};}
export function imageSourcePoint(a,p){const t=straightenTransform(a),dx=p.x-t.x-t.width/2,dy=p.y-t.y-t.height/2;return {x:(dx*Math.cos(t.angle)+dy*Math.sin(t.angle))/t.scale/t.width+.5,y:(-dx*Math.sin(t.angle)+dy*Math.cos(t.angle))/t.scale/t.height+.5};}
export function drawNoteImage(context,image,attachment){const [x,y,w,h]=attachment.crop??[0,0,1,1],iw=image.naturalWidth||image.width,ih=image.naturalHeight||image.height,a=attachment;
 if(!a.rotation){context.drawImage(image,x*iw,y*ih,w*iw,h*ih,a.x,a.y,a.width,a.height);return;}
 const t=straightenTransform(a);context.save();context.beginPath();context.rect(a.x,a.y,a.width,a.height);context.clip();context.translate(t.x+t.width/2,t.y+t.height/2);context.rotate(t.angle);context.scale(t.scale,t.scale);context.drawImage(image,0,0,iw,ih,-t.width/2,-t.height/2,t.width,t.height);context.restore();}
export const containsImage=(image,p)=>p.x>=image.x&&p.x<=image.x+image.width&&p.y>=image.y&&p.y<=image.y+image.height;
