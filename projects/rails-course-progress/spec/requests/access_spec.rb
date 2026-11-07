require "rails_helper"

RSpec.describe "Course access", type: :request do
  let!(:teacher) { User.create!(name: "Teacher", email: "test-teacher@example.test", role: "instructor", password: "password") }
  let!(:student) { User.create!(name: "Student", email: "test-student@example.test", role: "student", password: "password") }
  let!(:course) { Course.create!(title: "Course", instructor: teacher, published: true) }
  let!(:lesson) { course.lessons.create!(title: "First", content: "Read", position: 1) }
  def login(user)
    post login_path, params: { email: user.email, password: "password" }
  end

  it "requires login and restricts progress to the owner" do
    get progress_course_path(course)
    expect(response).to redirect_to(login_path)
    login(student)
    get progress_course_path(course)
    expect(response).to have_http_status(:forbidden)
    post publish_course_path(course)
    expect(response).to have_http_status(:forbidden)
  end

  it "requires enrollment before completion and prevents duplicates" do
    login(student)
    post complete_course_lesson_path(course, lesson)
    expect(response).to have_http_status(:forbidden)
    2.times { post enroll_course_path(course) }
    2.times { post complete_course_lesson_path(course, lesson) }
    expect(course.enrollments.count).to eq(1)
    expect(Completion.count).to eq(1)
  end

  it "prevents students from viewing draft courses" do
    course.update!(published: false)
    login(student)
    get course_path(course)
    expect(response).to have_http_status(:forbidden)
  end
end
