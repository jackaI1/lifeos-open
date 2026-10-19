// Start clipboard access within the tap. Safari can reject it after a network await.
export async function confirmAndCopy({text,approved,save,writeText}){
 let copied;try{copied=Promise.resolve(writeText(text)).then(()=>true,()=>false);}catch{copied=Promise.resolve(false);}
 const saved=approved||await save();
 return {approved:!!saved,copied:await copied};
}
