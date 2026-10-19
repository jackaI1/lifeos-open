// Candidate source lines only. The owner chooses what is actually a rubric requirement.
export function rubricRequirements(text){return [...new Set(String(text??'').split(/\r?\n/).map(s=>s.trim()).filter(s=>s.length>=8&&s.length<=1000&&/^(?:\d+[.)]|[-•])\s|\b(?:include|explain|demonstrate|justify|criteria|marks|points)\b/i.test(s)))].slice(0,40);}
