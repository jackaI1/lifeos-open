/** Shared D1-shaped contract for self-hosted, hosted and browser storage. */
export type Row=Record<string,any>;
export interface WorkspaceStatement {bind(...args:any[]):WorkspaceStatement;all():Promise<{results:Row[];[key:string]:any}>;first(column?:string):Promise<any>;run():Promise<any>;raw():Promise<any[]>}
export interface WorkspaceDatabase {dialect?:string;migrate?():Promise<void>;tableNames?():Promise<string[]>;transaction?<T>(fn:(db:WorkspaceDatabase)=>Promise<T>):Promise<T>;close?():void|Promise<void>;prepare(query:string):WorkspaceStatement;exec(sql:string):any;batch(statements:any[]):Promise<any[]>}
