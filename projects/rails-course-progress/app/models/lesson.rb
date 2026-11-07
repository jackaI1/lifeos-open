class Lesson < ApplicationRecord
  belongs_to :course
  has_many :completions, dependent: :destroy
  validates :title, :content, presence: true
  validates :position, numericality: { only_integer: true, greater_than: 0 }, uniqueness: { scope: :course_id }
end
