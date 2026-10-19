// Browsing the source and inserting this lesson are deliberately separate.
export function slidePageSelection(total,range,initialPage){
 const browsePages=Array.from({length:total},(_,i)=>i+1);
 if(range&&(!Number.isInteger(range.from)||!Number.isInteger(range.through)||range.from<1||range.through<range.from||range.through>total))throw Error('This lesson page range no longer matches the source.');
 const lessonPages=range?browsePages.filter(n=>n>=range.from&&n<=range.through):browsePages;
 return {browsePages,lessonPages,initialPage:browsePages.includes(initialPage)?initialPage:lessonPages[0]};
}
