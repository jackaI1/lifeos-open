import {readFile} from 'node:fs/promises'; import {pool} from './db.js';
try {await pool.query(await readFile(new URL('../db/001_schema.sql',import.meta.url),'utf8')); console.log('Schema applied');} finally {await pool.end();}
