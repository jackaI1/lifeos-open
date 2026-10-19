import {assert,button,visible,go,reload,saveNote,lecture,draw,ask} from './helpers.mjs';
export default async function({page:p,configured}){
await go(p,'school');await visible(p,'Map the feedback loop');await visible(p,'Due');await visible(p,'1h');await visible(p,'Difficulty');await reload(p);await visible(p,'Difficulty');
}
