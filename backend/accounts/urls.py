from django.urls import path

from .views import (
    ApiRootView,
    RegisterView, LoginView, MeView, ProfileUpdateView,
    RequestResetCodeView, ConfirmResetCodeView,
    GoogleAuthView, FacebookAuthView, VkAuthView,
    AdminUsersListCreate, AdminUserDetail, PasswordChangeView,
    SafeTokenRefreshView,  # <— заменили refresh на безопасный
)

urlpatterns = [
    path('', ApiRootView.as_view()),
    path('auth/register/', RegisterView.as_view()),
    path('auth/login/', LoginView.as_view()),
    path('auth/me/', MeView.as_view()),
    path('auth/profile/', ProfileUpdateView.as_view()),
    path('auth/password/change/', PasswordChangeView.as_view()),
    path('auth/password/request-code/', RequestResetCodeView.as_view()),
    path('auth/password/confirm/', ConfirmResetCodeView.as_view()),
    path('auth/google/', GoogleAuthView.as_view()),
    path('auth/facebook/', FacebookAuthView.as_view()),
    path('auth/vk/', VkAuthView.as_view()),
    # автообновление access-токена
    path('auth/token/refresh/', SafeTokenRefreshView.as_view(), name='token_refresh'),

    # админ CRUD
    path('admin/users/', AdminUsersListCreate.as_view()),
    path('admin/users/<int:pk>/', AdminUserDetail.as_view()),
]