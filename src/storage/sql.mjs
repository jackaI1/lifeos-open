/** Compile the application's SQLite/D1 SQL subset. Values never enter SQL text. */
export function postgresSQL(sql,values=[]){
 const tokens=sql.match(/'(?:''|[^'])*'|"(?:""|[^"])*"|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/|\?|[A-Za-z_][\w.]*|\d+(?:\.\d+)?|<=|>=|<>|!=|\|\||\S/g)??[];
 let position=0,parameter=0;
 function group(end){
  const nodes=[];
  while(position<tokens.length){
   const token=tokens[position++];if(token===end)break;
   if(token==='('){nodes.push({children:group(')')});continue;}
   if(token==='?'){
    const value=values[parameter++];nodes.push({text:`$${parameter}${value===null&&tokens[position]?.toUpperCase()!=='IS'?'':'::'+(typeof value==='number'?(Number.isInteger(value)?'bigint':'numeric'):value instanceof Uint8Array?'bytea':'text')}`,numeric:typeof value==='number'});
   }else nodes.push({text:token,numeric:/^\d/.test(token)});
  }
  return nodes;
 }
 const tree=group();
 if(parameter!==values.length)throw Error('SQL parameter count differs from bound values.');
 const comparisons=new Set(['<','>','<=','>=','=','!=','<>']);
 function numericFunction(name,children){return ['greatest','least','round'].includes(name?.toLowerCase())||(name?.toLowerCase()==='coalesce'&&children.some(n=>n.numeric))||(name?.toLowerCase()==='cast'&&children.some(n=>/^integer|bigint|numeric$/i.test(n.text)));}
 function render(nodes,numeric=false){
  const out=[];
  for(let i=0;i<nodes.length;i++){
   const node=nodes[i],next=nodes[i+1];
   if(node.children){out.push('('+render(node.children,numeric)+')');continue;}
   const name=node.text.toLowerCase();
   if(next?.children){
    const children=next.children;
    let fn=name,body;
    const numericContext=numeric||(comparisons.has(nodes[i+2]?.text)&&(nodes[i+3]?.numeric||nodes[i+4]?.children&&numericFunction(nodes[i+3]?.text,nodes[i+4].children)))||(comparisons.has(nodes[i-1]?.text)&&(nodes[i-2]?.numeric||nodes[i-2]?.children&&numericFunction(nodes[i-3]?.text,nodes[i-2].children)));
    const jsonComparison=comparisons.has(nodes[i+2]?.text)&&nodes[i+3]?.text?.toLowerCase()==='json_extract'||comparisons.has(nodes[i-1]?.text)&&nodes[i-3]?.text?.toLowerCase()==='json_extract';
    if(name==='json_extract'){
     body=`${jsonComparison?'lifeos_json_value':'lifeos_json_extract'}(${render(children)})`;
     if(numericContext)body=`CAST(${body} AS NUMERIC)`;
    }else if(name==='json_type')body=`lifeos_json_type(${render(children)})`;
    else if(name==='json_each')body=`jsonb_array_elements_text((${render(children)})::jsonb) AS lifeos_each(value)`;
    else if(name==='json_object')body=`json_build_object(${render(children)})::text`;
    else if(name==='json_group_array')body=`COALESCE(array_to_json(array_agg(${render(children)}))::text,'[]')`;
    else {
     if(name==='max'&&children.some(n=>n.text===','))fn='greatest';
     if(name==='min'&&children.some(n=>n.text===','))fn='least';
     const numberArgs=['greatest','least','round'].includes(fn)||(fn==='coalesce'&&children.some(n=>n.numeric));
     body=`${fn}(${render(children,numberArgs)})`;
    }
    out.push(body);i++;continue;
   }
   if(name==='integer'&&nodes[i-1]?.text?.toLowerCase()==='as'){out.push('BIGINT');continue;}
   out.push(name==='blob'?'BYTEA':/[a-z][A-Z]/.test(node.text)&&/^[A-Za-z_]+$/.test(node.text)?'"'+node.text+'"':node.text);
  }
  return out.join(' ');
 }
 let result=render(tree);
 result=result.replace(/CAST\s*\(\s*ROUND\s*\(\s*\(\s*julianday\s*\(\s*'now'\s*\)\s*-\s*2440587\.5\s*\)\s*\*\s*86400000\s*\)\s*AS BIGINT\s*\)/gi,'CAST(EXTRACT(EPOCH FROM clock_timestamp())*1000 AS BIGINT)');
 // SQLite permits booleans in its integer assertion table; PostgreSQL needs a cast.
 if(/^INSERT\s+INTO\s+assertions\b/i.test(result)){
  result=result.replace(/(VALUES\s*\([^,]+,)([\s\S]*)(\)\s*;?\s*)$/i,'$1CAST($2 AS INTEGER)$3');
 }
 if(/^INSERT OR IGNORE /i.test(result))result=result.replace(/^INSERT OR IGNORE /i,'INSERT ')+' ON CONFLICT DO NOTHING';
 if(/^INSERT OR REPLACE INTO meta /i.test(result))result=result.replace(/^INSERT OR REPLACE /i,'INSERT ')+' ON CONFLICT(key) DO UPDATE SET value=excluded.value';
 if(/^INSERT INTO kind_revisions\b/i.test(result))result=result.replace(/SET version = version \+ 1/i,'SET version = kind_revisions.version + 1');
 return result;
}
