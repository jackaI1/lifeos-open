const pages={
 '/privacy':{title:'LifeOS privacy',paragraphs:[
 'LifeOS is a self-hosted personal workspace. The standalone demo uses fictional data and requires no connected accounts.',
 'Records, uploaded files and recordings are stored in the local workspace database. Browser drafts and queued changes may remain on this device for recovery. Use a secured device and keep verified backups.',
 'Demo AI works offline. If you enable a real AI provider, your messages and relevant saved context are sent to the endpoint you configure through LLM settings. Review that provider’s privacy policy.',
 'Google sign-in, hosted gateways, remote files and other integrations are optional. When configured, those providers handle the requests and metadata needed for their services. Their own policies apply.',
 'LifeOS does not sell personal data or use advertising trackers. You control connected accounts, local records, retained audio and exports. Revoke connected account permissions through the provider and stop the local server when finished.'
 ]},
 '/terms':{title:'LifeOS personal use',paragraphs:[
 'LifeOS is software you run for personal planning and recordkeeping. You are responsible for access controls, configuration and backups for your installation.',
 'Review plans, source conflicts and generated answers before relying on them. Generated output may be incomplete or wrong. LifeOS does not replace professional advice or authorize submissions, outgoing messages or purchases.',
 'Availability depends on your computer and any services you choose to configure. Browser drafts and queued changes support recovery; export verified backups for a separate recovery copy.',
 'Optional connected services remain governed by their own terms and permissions. Respect copyright and applicable course policies.'
 ]}
};
export function publicNotice(path){const p=pages[path];if(!p)return null;return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+p.title+'</title><style>body{margin:0;background:#071523;color:#e8f0f6;font:17px/1.6 system-ui}main{max-width:45rem;margin:4rem auto;padding:0 1.5rem}a{color:#bddbf4}</style><main><h1>'+p.title+'</h1>'+p.paragraphs.map(t=>'<p>'+t+'</p>').join('')+'<p><a href="/">Open LifeOS</a></p></main></html>';}
