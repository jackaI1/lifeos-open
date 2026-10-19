// A native textarea displays CR and CRLF as LF. Keep a boundary map to
// the complete literal recipe; a displayed excerpt is never found by search.
export function cookingRecipeProjection(recipe) {
 if (typeof recipe !== 'string') throw Error('The current recipe must be text.');
 const characters=[], boundaries=[0];
 for (let at=0;at<recipe.length;) {
  const character=recipe[at++];
  if (character==='\r') {
   if (recipe[at]==='\n') at++;
   characters.push('\n');
  } else characters.push(character);
  boundaries.push(at);
 }
 const text=characters.join('');
 function range(selection) {
  const refuse=()=>{throw Error('Select an excerpt from the current original recipe.');};
  if (!selection || typeof selection!=='object' || Object.getPrototypeOf(selection)!==Object.prototype) return refuse();
  const fields=Object.getOwnPropertyDescriptors(selection), names=Reflect.ownKeys(fields);
  if (names.length!==4 || names.some(name=>typeof name!=='string'||!['recipe','text','start','end'].includes(name))) return refuse();
  for (const name of ['recipe','text','start','end']) {
   const field=fields[name];
   if (!field || !field.enumerable || !Object.hasOwn(field,'value')) return refuse();
  }
  const original=fields.recipe.value, displayed=fields.text.value, start=fields.start.value, end=fields.end.value;
  if (original!==recipe || displayed!==text || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || Object.is(start,-0) || Object.is(end,-0) || start<0 || end<=start || end>text.length) return refuse();
  // Surrogate boundaries remain exact. The shared help contract decides
  // whether the deliberate selection is eligible; never widen it here.
  return {start:boundaries[start],end:boundaries[end]};
 }
 return Object.freeze({text,range});
}
