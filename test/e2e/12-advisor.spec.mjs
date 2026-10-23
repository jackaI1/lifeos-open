import {button,visible,go,reload} from './helpers.mjs';
export default async function({page:p,configured}){
 await go(p,'school?assistant=new');await button(p,'Prepare for the lab').click();await visible(p,'Room S-204');await visible(p,'safety goggles');await visible(p,'pre-lab');
 await reload(p);await visible(p,'Room S-204');await configured('academics','Lab in 10 minutes, what do I need?',['Room S-204','safety goggles','pre-lab']);
}
