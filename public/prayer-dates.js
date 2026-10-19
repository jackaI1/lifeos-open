import {lifeosDay} from './lifeos-day.js';
export function prayerJournalDay(session){const d=session.data??session;return d.journalDay??(d.startedAt?lifeosDay(d.startedAt):d.date);}
export function withPrayerDates(sessions,corrections){const byId=new Map(corrections.map(r=>[r.id,r]));return sessions.map(r=>{const c=byId.get(r.id);return {...r,data:{...r.data,journalDay:c?.data.day},dateCorrectionVersion:c?.version??0};});}
