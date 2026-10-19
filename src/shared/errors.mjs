export class AppError extends Error {
 constructor(message,status=400,code='invalid',current){super(message);Object.assign(this,{status,code,current});}
}
