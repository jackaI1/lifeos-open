import {button,visible,reload,lecture} from './helpers.mjs';
export default async function({page:p,configured}){
 await lecture(p);await button(p,'Lecture Tutor').click();await button(p,'Explain feedback').click();
 await p.locator('.assistant-message.assistant').filter({hasText:'Negative feedback reduces a difference'}).waitFor();await visible(p,'thermostat');
 await reload(p);await button(p,'Lecture Tutor').click();await p.locator('.assistant-message.assistant').filter({hasText:'Negative feedback reduces a difference'}).waitFor();
 await configured('lecture','How does negative feedback relate to my Systems vocabulary notes?',['Systems vocabulary','Feedback loop']);
}
