import {lifeosDay} from './lifeos-day.js';
// Entry date is the owner's assignment. Completion/upload timestamps are separate evidence.
export function devotionalDay(entry,timeZone='America/Toronto'){
 const value=entry?.data??entry??{};
 if(/^\d{4}-\d{2}-\d{2}$/.test(value.date??''))return value.date;
 return Number.isFinite(Date.parse(value.completedAt))?lifeosDay(value.completedAt,timeZone):null;
}
export function practiceDay(state,kind=state?.practice??state?.kind,timeZone='America/Toronto'){
 return kind==='devotional'?devotionalDay(state,timeZone):state?.completedAt?lifeosDay(state.completedAt,timeZone):state?.date;
}
