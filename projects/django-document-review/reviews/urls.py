from django.urls import path
from . import views
urlpatterns = [path('', views.index, name='index'), path('documents/<int:pk>/', views.detail, name='detail'), path('api/reviews/', views.ReviewAPI.as_view(), name='api-review')]
