class User < ApplicationRecord
  has_secure_password
  has_many :courses, foreign_key: :instructor_id, dependent: :restrict_with_error
  has_many :enrollments, foreign_key: :student_id, dependent: :restrict_with_error
  validates :name, :email, presence: true
  validates :email, uniqueness: true
  validates :role, inclusion: { in: %w[instructor student] }
  before_validation { self.email = email.to_s.strip.downcase }
end
