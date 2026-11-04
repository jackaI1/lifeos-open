// The Finances (budget) view is built with React + TypeScript in src/frontend/react/finances/
// and bundled to public/react/finances.mjs by `npm run build`. See docs/react-migration.md.
import {mountAssistant} from '../assistant-chat.js';
import {routeQuery} from '../targets.js';
import {mountFinances} from '../react/finances.mjs';
export async function mount(root,ctx){
 if(routeQuery().has('assistant'))return mountAssistant(root,ctx,'finances');
 return mountFinances(root,ctx);
}
