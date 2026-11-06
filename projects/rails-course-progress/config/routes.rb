Rails.application.routes.draw do
  root "courses#index"
  get "login", to: "sessions#new"
  post "login", to: "sessions#create"
  delete "logout", to: "sessions#destroy"
  resources :courses, only: [ :index, :show, :new, :create ] do
    post :publish, on: :member
    get :progress, on: :member
    resources :lessons, only: [ :create ] do
      post :complete, on: :member
    end
    post :enroll, on: :member
  end
end
