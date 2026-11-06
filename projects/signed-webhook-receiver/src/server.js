import {pool} from './db.js'; import {createApp} from './app.js';
if (!process.env.WEBHOOK_SECRET || !process.env.DATABASE_URL) throw new Error('Set WEBHOOK_SECRET and DATABASE_URL');
const server=createApp(pool,process.env.WEBHOOK_SECRET).listen(process.env.PORT || 3000);
for (const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>server.close(()=>pool.end()));
