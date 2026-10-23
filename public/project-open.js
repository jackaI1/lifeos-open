import {el,button} from './ui.js';
import {githubProjectUrl} from './github-project-url.js';

export function projectOpenControl(record,open){
 const href=githubProjectUrl(record.data.githubUrl);
 return href?el('a',{href,target:'_blank',rel:'noopener noreferrer',class:'quiet'},'Open'):button('Open',()=>open(record),'quiet');
}
