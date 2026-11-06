# nextjs-run-dashboard

I built a browser run dashboard to learn how the underlying idea works. This is a learning project.

## Try it

You need Node.js 22 or newer and PostgreSQL, a database that stores the runs. Create an empty database named `run_dashboard`, then run:

```sh
npm ci
cp .env.example .env
npm run db:seed
npm run dev
```

Open http://localhost:3000. Change `DATABASE_URL` in `.env` if your PostgreSQL connection is different. The seed command replaces the contents of the runs and steps tables with 36 synthetic runs, so use a database reserved for this project. Screenshots are illustrations, not real browser captures. On the list, use the search box and filters, then open a run. Tab moves between controls and Enter opens a link.

## How it works

Next.js renders the list and detail pages on the server using TypeScript. PostgreSQL holds runs and their ordered steps. Filtering, sorting, counting and pagination happen in SQL, so the app only loads the requested page. The `/api/runs` and `/api/runs/[id]` endpoints also return JSON. Recharts draws the step chart: each step's failure rate is either 0% or 100%, since it describes one attempt, not a historical average.

The seed script creates the tables and sample data in a transaction. The sample screenshots are local SVGs; a real trace collector would need to save its own screenshot URLs and insert runs and steps. This is a read-only explorer, not a browser automation runner.

## Tests and limits

There are 6 test source files in this copy. That source count does not establish an execution result. This is a source snapshot, and running it on a new machine may need environment-specific setup.



The relocated workflow did not complete successfully within the migration batch. Local test sources remain available.

No project-specific GitHub Actions workflow was retained. The local test sources remain in this folder.
