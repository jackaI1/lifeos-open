class Enrollment < ApplicationRecord
  belongs_to :course
  belongs_to :student, class_name: "User"
  has_many :completions, dependent: :destroy
  validates :student_id, uniqueness: { scope: :course_id }
  validate :student_role

  private
    def student_role
      errors.add(:student, "must be a student") if student && student.role != "student"
    end
end
