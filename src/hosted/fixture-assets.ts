import schema from '../cloud/schema.sql';
import audio from '../../public/demo-lecture.wav';
import slides from '../../public/demo-slides.pdf';
import image from '../../public/demo-landscape.jpg';
const assets:Record<string,string|Uint8Array>={'src/cloud/schema.sql':schema,'public/demo-lecture.wav':audio,'public/demo-slides.pdf':slides,'public/demo-landscape.jpg':image};
export async function readFixture(path:string,encoding?:string){if(!Object.hasOwn(assets,path))throw Error('Unknown fictional fixture');const v=assets[path];return typeof v==='string'?v:encoding?Buffer.from(v).toString('utf8'):Buffer.from(v);}
