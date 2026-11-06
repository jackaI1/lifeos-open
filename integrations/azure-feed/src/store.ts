import sql from 'mssql';
import {readFile} from 'node:fs/promises';
import {parseFeed} from '../../../src/shared/today.ts';

export async function connect(): Promise<sql.ConnectionPool> {
  const server = process.env.SQL_SERVER;
  const database = process.env.SQL_DATABASE;
  if (!server || !database) throw new Error('SQL_SERVER and SQL_DATABASE are required');
  const local = Boolean(process.env.SQL_USER);
  return new sql.ConnectionPool({
    server, database, port: Number(process.env.SQL_PORT || 1433),
    ...(local ? {user: process.env.SQL_USER, password: process.env.SQL_PASSWORD} : {authentication: {type: 'azure-active-directory-default' as const, options: {}}}),
    options: {encrypt: true, trustServerCertificate: local && process.env.SQL_TRUST_SERVER_CERTIFICATE === 'true'},
    pool: {max: 5, min: 0, idleTimeoutMillis: 30000},
    connectionTimeout: 10000, requestTimeout: 10000,
  }).connect();
}
export async function migrate(pool: sql.ConnectionPool): Promise<void> {
  const source = await readFile(new URL('../sql/schema.sql', import.meta.url), 'utf8');
  for (const batch of source.split(/^GO\s*$/im).filter(value => value.trim())) await pool.request().batch(batch);
}
export async function publishFeed(pool: sql.ConnectionPool, input: unknown): Promise<void> {
  const document = JSON.stringify(parseFeed(input));
  await pool.request().input('document', sql.NVarChar(sql.MAX), document).query(`
    SET XACT_ABORT ON;
    BEGIN TRANSACTION;
    UPDATE dbo.PublicDemoFeed WITH (UPDLOCK, SERIALIZABLE)
      SET document = @document, publishedAt = SYSUTCDATETIME() WHERE id = 'today';
    IF @@ROWCOUNT = 0 INSERT dbo.PublicDemoFeed (id, document) VALUES ('today', @document);
    COMMIT TRANSACTION;
  `);
}
export async function readFeed(pool: sql.ConnectionPool): Promise<unknown> {
  const result = await pool.request().query("SELECT document FROM dbo.PublicDemoFeed WHERE id = 'today'");
  return result.recordset[0] ? JSON.parse(result.recordset[0].document) : null;
}
