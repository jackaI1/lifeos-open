/** Narrow runtime interfaces used by this adapter; implementation is supplied by Workers. */
declare module 'cloudflare:workers' {
 export class DurableObject<Env=unknown> {ctx:{storage:any};env:Env;constructor(ctx:any,env:Env);}
}
declare module '*.sql' {const value:string;export default value;}
declare module '*.wav' {const value:Uint8Array;export default value;}
declare module '*.pdf' {const value:Uint8Array;export default value;}
declare module '*.jpg' {const value:Uint8Array;export default value;}
