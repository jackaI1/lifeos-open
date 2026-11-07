require "rails_helper"

RSpec.describe "Student course flow", type: :system do
  before { driven_by(:rack_test) }
  it "lets a student enrol and complete a lesson" do
    teacher = User.create!(name: "Teacher", email: "test-teacher@example.test", role: "instructor", password: "password")
    User.create!(name: "Student", email: "test-student@example.test", role: "student", password: "password")
    course = Course.create!(title: "Garden", instructor: teacher, published: true)
    course.lessons.create!(title: "Plant", content: "Plant seeds", position: 1)
    visit root_path
    fill_in "Email", with: "test-student@example.test"
    fill_in "Password", with: "password"
    click_button "Sign in"
    click_link "Garden"
    click_button "Enrol"
    expect(page).to have_content("Plant seeds")
    click_button "Mark complete"
    expect(page).to have_content("Completed")
  end
end
