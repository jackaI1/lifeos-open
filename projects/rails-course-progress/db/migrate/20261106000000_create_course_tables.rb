class CreateCourseTables < ActiveRecord::Migration[8.1]
  def change
    create_table :users do |t|
      t.string :name, null: false
      t.string :email, null: false
      t.string :password_digest, null: false
      t.string :role, null: false
      t.timestamps
    end
    add_index :users, :email, unique: true
    create_table :courses do |t|
      t.string :title, null: false
      t.text :description
      t.boolean :published, null: false, default: false
      t.references :instructor, null: false, foreign_key: { to_table: :users }
      t.timestamps
    end
    create_table :lessons do |t|
      t.references :course, null: false, foreign_key: true
      t.string :title, null: false
      t.text :content, null: false
      t.integer :position, null: false
      t.timestamps
    end
    add_index :lessons, [ :course_id, :position ], unique: true
    create_table :enrollments do |t|
      t.references :course, null: false, foreign_key: true
      t.references :student, null: false, foreign_key: { to_table: :users }
      t.timestamps
    end
    add_index :enrollments, [ :course_id, :student_id ], unique: true
    create_table :completions do |t|
      t.references :enrollment, null: false, foreign_key: true
      t.references :lesson, null: false, foreign_key: true
      t.timestamps
    end
    add_index :completions, [ :enrollment_id, :lesson_id ], unique: true
  end
end
