instructor = User.find_or_create_by!(email: "instructor@example.test") do |u|
  u.name = "Morgan Reed"; u.role = "instructor"; u.password = "demo-password"
end
student = User.find_or_create_by!(email: "student@example.test") do |u|
  u.name = "Alex Chen"; u.role = "student"; u.password = "demo-password"
end
course = Course.find_or_create_by!(title: "Starting a community garden", instructor: instructor) do |c|
  c.description = "A practical introduction to planning a shared garden."; c.published = true
end
[ [ "Choose a site", "Look for sunlight and access to water." ], [ "Plan the beds", "Sketch paths and beds that everyone can reach." ], [ "Plant together", "Choose plants suited to the season." ] ].each_with_index do |(title, content), i|
  course.lessons.find_or_create_by!(position: i + 1) { |lesson| lesson.title = title; lesson.content = content }
end
course.enrollments.find_or_create_by!(student: student)
