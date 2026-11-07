class Completion < ApplicationRecord
  belongs_to :enrollment
  belongs_to :lesson
  validates :lesson_id, uniqueness: { scope: :enrollment_id }
  validate :lesson_in_course
  after_create_commit :broadcast_progress

  private
    def lesson_in_course
      errors.add(:lesson, "must belong to the enrolled course") if lesson && enrollment && lesson.course_id != enrollment.course_id
    end

    def broadcast_progress
      course = enrollment.course
      broadcast_replace_to [ course, :progress ], target: "progress", partial: "progress/table", locals: { course: course }
    end
end
