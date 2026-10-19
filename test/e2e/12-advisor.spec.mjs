import {assert,button,visible,go,reload,saveNote,lecture,draw,ask} from './helpers.mjs';
export default async function({page:p,configured}){
await go(p,'school?assistant=new');await ask(p,'Lab in 10 minutes, what do I need?');await visible(p,'Room S-204');await visible(p,'safety goggles');await visible(p,'pre-lab');await reload(p);await visible(p,'Room S-204');await configured('academics','Lab in 10 minutes, what do I need?',['Room S-204','safety goggles','pre-lab']);
}
