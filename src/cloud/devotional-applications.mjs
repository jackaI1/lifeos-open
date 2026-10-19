// Keep explicit entry-day filtering in D1; never substitute the upload/completion day.
export async function devotionalApplications(store,date){
 return (await store.sql("SELECT id,json_extract(data,'$.points[4]') answer,json_extract(data,'$.points[5]') peopleAnswer,json_extract(data,'$.passage') passage FROM records WHERE kind='devotional' AND json_extract(data,'$.date')=? AND json_extract(data,'$.complete')=1 ORDER BY updated_at DESC LIMIT 5",date).all()).results;
}
