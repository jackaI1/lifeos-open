class LessonsController < ApplicationController
  before_action { @course = Course.find(params[:course_id]) }
  def create
    return head :forbidden unless current_user.role == "instructor" && @course.instructor_id == current_user.id
    lesson = @course.lessons.build(params.require(:lesson).permit(:title, :content, :position))
    if lesson.save
      redirect_to @course, notice: "Lesson added."
    else
      redirect_to @course, alert: lesson.errors.full_messages.to_sentence
    end
  end

  def complete
    return head :forbidden unless current_user.role == "student" && @course.published?
    enrollment = @course.enrollments.find_by(student: current_user)
    return head :forbidden unless enrollment
    lesson = @course.lessons.find(params[:id])
    enrollment.completions.find_or_create_by!(lesson: lesson)
    redirect_to @course, notice: "Lesson completed."
  rescue ActiveRecord::RecordNotUnique
    redirect_to @course
  end
end
