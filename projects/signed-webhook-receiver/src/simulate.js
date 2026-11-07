import {sign} from './signature.js'; import {randomUUID} from 'node:crypto';
const secret=process.env.WEBHOOK_SECRET; if(!secret) throw new Error('Set WEBHOOK_SECRET');
const id=randomUUID(), rep_id='11111111-1111-4111-8111-111111111111';
async function send(event, key=secret) {const body=JSON.stringify(event); const r=await fetch(process.env.WEBHOOK_URL || 'http://localhost:3000/webhooks',{method:'POST',headers:{'stripe-signature':sign(body,key),'content-type':'application/json'},body}); console.log(event.id,r.status,await r.text());}
const event={id,type:'order.created',data:{order_id:id,rep_id,amount_cents:2500}};
await send(event,'wrong-secret'); await send(event); await send(event); await send({id:randomUUID(),type:'order.created',data:{...event.data,simulate_failure:true}});
