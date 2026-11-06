require "rails_helper"

RSpec.describe Course, type: :model do
  it "requires a title" do
    expect(Course.new).not_to be_valid
  end
end
