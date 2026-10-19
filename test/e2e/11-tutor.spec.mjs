import {assert,button,visible,go,reload,saveNote,lecture,draw,ask} from './helpers.mjs';
export default async function({page:p,configured}){
await lecture(p);await button(p,'Lecture Tutor').click();await ask(p,'How does negative feedback relate to my Systems vocabulary notes?');await p.locator('.assistant-message.assistant').filter({hasText:'Systems vocabulary'}).waitFor();await visible(p,'Negative feedback');await reload(p);await button(p,'Lecture Tutor').click();await p.locator('.assistant-message.assistant').filter({hasText:'Systems vocabulary'}).waitFor();await configured('lecture','How does negative feedback relate to my Systems vocabulary notes?',['Systems vocabulary','Feedback loop']);
}
