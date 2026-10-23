// Restrict portfolio links to plain GitHub profile or repository destinations.
export function githubProjectUrl(value){
 if(typeof value!=='string'||!/^https:\/\/github\.com\/[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?(?:\/[a-z\d._-]+)?\/?$/i.test(value))return null;
 const parsed=new URL(value),parts=parsed.pathname.split('/').filter(Boolean);
 if(parts.some(part=>part==='.'||part==='..')||parsed.pathname!==value.slice('https://github.com'.length))return null;
 return value.replace(/\/$/,'');
}
