# rails-course-progress

I built a small course app to learn how the underlying idea works. This is a learning project.

## Try it

You need Ruby 4.0.9 and PostgreSQL installed and running. In a terminal, clone this repository, open its folder, and run:

```sh
bundle install
bin/rails db:prepare
bin/rails db:seed
bin/rails server
```

Open http://localhost:3000. Sign in as `instructor@example.test` or `student@example.test`, using `demo-password` for either. These accounts and the garden course are fictional and are intended only for local practice. Sign out to switch roles. On the instructor account, create a course, add numbered lessons, and publish it. On the student account, enrol in a published course and mark a lesson complete. Open the instructor's progress page in another browser session to see the update.

The sample accounts are created by the seed script. This demonstration does not include sign-up or password reset; use it locally rather than exposing the demo accounts on the internet.

## How it works

Rails handles the pages and forms. PostgreSQL stores the courses, lessons, enrolments, and completions. Each course belongs to an instructor, and a student can only complete lessons in a course they have joined. Database indexes prevent duplicate enrolments, completions, and lesson order numbers even if requests arrive together. Passwords are stored as hashes, not plain text. Server-side checks restrict course editing and progress pages to their instructor.

When a completion is saved, Hotwire Turbo Streams sends a replacement progress table over Action Cable, Rails' live connection to the browser. The development setup uses an in-process connection, so run one app server for the live demo. A multi-process deployment would need a shared Action Cable adapter such as Redis and a production authentication setup.

## Tests and limits

I kept 6 files of test code and supporting test helpers in this copy. That source count does not establish an execution result. This is a source snapshot, and running it on a new machine may need environment-specific setup.





The hub workflow `rails-course-progress-ci.yml` keeps the Ruby setup and Bundler cache in this project directory, then runs the project checks here. The authored `bin/` entry points are included.
