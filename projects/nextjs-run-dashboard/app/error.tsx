'use client';
export default function ErrorPage({reset}:{error:Error;reset:()=>void}) {return <div className="empty"><h1>Could not load runs</h1><p>Check that PostgreSQL is running and the database has been seeded.</p><button onClick={reset}>Try again</button></div>}
