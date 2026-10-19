// Explicit operator configuration; defaults are fictional, never personal accounts.
export function serviceEnvironment(){return globalThis.process?.env??{};}
const endpoint=value=>{const url=new URL(value);if(url.protocol!=='https:'||url.username||url.password||url.port||url.search||url.hash)throw new TypeError('School endpoints require an HTTPS URL without credentials, port or query.');return url;};
export function schoolConfiguration(input={}){
 const env=serviceEnvironment(),setting=(upper,camel,fallback)=>input[upper]??input[camel]??env[upper]??fallback;
 const home=endpoint(setting('SCHOOL_HOME_URL','schoolHomeUrl','https://learn.example.invalid/d2l/home'));
 const careers=endpoint(setting('SCHOOL_CAREERS_URL','schoolCareersUrl','https://careers.example.invalid/myAccount/dashboard.htm'));
 const outline=endpoint(setting('SCHOOL_OUTLINE_URL','schoolOutlineUrl','https://outline.example.invalid'));
 const additional=setting('SCHOOL_ADDITIONAL_HOSTS','schoolAdditionalHosts',[]);
 const hosts=(Array.isArray(additional)?additional:String(additional).split(',')).filter(Boolean).map(value=>{if(typeof value!=='string'||!/^[a-z0-9.-]+$/i.test(value.trim()))throw new TypeError('Additional school hosts must be hostnames only.');return endpoint('https://'+value.trim()).hostname;});
 return {home:home.href,origin:home.origin,host:home.hostname,careers:careers.href,careersHost:careers.hostname,outlineHost:outline.hostname,hosts:[...new Set([home.hostname,careers.hostname,'outlook.office.com','outlook.office365.com','outlook.cloud.microsoft',...hosts])]};
}
export function schoolEnvironmentConfig(input={}){const c=schoolConfiguration(input);return {schoolHomeUrl:c.home,schoolCareersUrl:c.careers,schoolOutlineUrl:'https://'+c.outlineHost,schoolAdditionalHosts:c.hosts};}
export function schoolPath(value,path,input={}){try{const url=new URL(value);return url.origin===schoolConfiguration(input).origin&&!url.username&&!url.password&&path.test(url.pathname);}catch{return false;}}
export function schoolUrl(path,input={}){return new URL(path,schoolConfiguration(input).home).href;}

/** Canonical operator-selected origin; never a credential-bearing URL or route. */
export function httpsOrigin(value){
 if(typeof value!=='string'||value.length>2048)throw new TypeError('Configured HTTPS origin is invalid');
 const url=new URL(value);
 if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.port||url.search||url.hash)throw new TypeError('Configured HTTPS origin is invalid');
 return url.origin;
}
