class CoursesController < ApplicationController
  before_action :find_course, only: [ :show, :publish, :progress, :enroll ]
  def index
    @courses = current_user.role == "instructor" ? current_user.courses : Course.where(published: true)
  end

  def show
    return head :forbidden unless visible?
    @enrollment = @course.enrollments.find_by(student: current_user)
  end

  def new
    return head :forbidden unless instructor?
    @course = Course.new
  end

  def create
    return head :forbidden unless instructor?
    @course = current_user.courses.build(params.require(:course).permit(:title, :description))
    if @course.save
      redirect_to @course
    else
      render :new, status: :unprocessable_entity
    end
  end

  def publish
    return head :forbidden unless owner?
    @course.update!(published: true)
    redirect_to @course, notice: "Course published."
  end

  def enroll
    return head :forbidden unless current_user.role == "student" && @course.published?
    @course.enrollments.find_or_create_by!(student: current_user)
    redirect_to @course
  rescue ActiveRecord::RecordNotUnique
    redirect_to @course
  end

  def progress
    head :forbidden unless owner?
  end

  private
    def find_course
      @course = Course.find(params[:id])
    end
    def instructor? = current_user.role == "instructor"
    def owner? = instructor? && @course.instructor_id == current_user.id
    def visible? = owner? || (current_user.role == "student" && @course.published?)
end
