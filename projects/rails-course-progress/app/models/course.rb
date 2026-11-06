class Course < ApplicationRecord
  belongs_to :instructor, class_name: "User"
  has_many :lessons, -> { order(:position) }, dependent: :destroy
  has_many :enrollments, dependent: :destroy
  validates :title, presence: true
  validate :instructor_role

  private
    def instructor_role
      errors.add(:instructor, "must be an instructor") if instructor && instructor.role != "instructor"
    end
end
