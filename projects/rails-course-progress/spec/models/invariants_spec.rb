require "rails_helper"

RSpec.describe "Course invariants", type: :model do
  let(:teacher) { User.create!(name: "Teacher", email: "test-teacher@example.test", role: "instructor", password: "password") }
  let(:student) { User.create!(name: "Student", email: "test-student@example.test", role: "student", password: "password") }
  let(:course) { Course.create!(title: "Course", instructor: teacher) }
  let(:lesson) { course.lessons.create!(title: "First", content: "Read", position: 1) }
  let(:enrollment) { course.enrollments.create!(student: student) }

  it "rejects duplicate enrollments and completions" do
    enrollment
    expect(course.enrollments.build(student: student)).not_to be_valid
    enrollment.completions.create!(lesson: lesson)
    expect(enrollment.completions.build(lesson: lesson)).not_to be_valid
  end

  it "rejects a completion for a lesson in another course" do
    other = Course.create!(title: "Other", instructor: teacher)
    other_lesson = other.lessons.create!(title: "Other", content: "Read", position: 1)
    expect(enrollment.completions.build(lesson: other_lesson)).not_to be_valid
  end

  it "broadcasts updated progress after a completion commits" do
    enrollment; lesson
    expect { enrollment.completions.create!(lesson: lesson) }.to have_broadcasted_to(Turbo::StreamsChannel.send(:stream_name_from, [ course, :progress ]))
  end
end
