from django.urls import path
from .views import (
    KeyRateView,
    BillingStatusView, BillingRecordView,
    BillingConfigView, PromoListCreate, PromoDetail, PromoValidateView,
    UserSignsListCreate, UserSignDetail,
    PaymentCreateView,
)

urlpatterns = [
    path('utils/key-rate/', KeyRateView.as_view()),

    # Биллинг и история
    path('billing/status/', BillingStatusView.as_view()),
    path('billing/record/', BillingRecordView.as_view()),

    # Конфигурация биллинга и промокоды (для админов)
    path('billing/config/', BillingConfigView.as_view()),
    path('billing/promos/', PromoListCreate.as_view()),
    path('billing/promos/<int:pk>/', PromoDetail.as_view()),
    path('billing/promo/validate/', PromoValidateView.as_view()),

    # Библиотека подписей/печати пользователя
    path('library/signs/', UserSignsListCreate.as_view()),
    path('library/signs/<int:pk>/', UserSignDetail.as_view()),

    # Платежи (заглушка)
    path('payments/create/', PaymentCreateView.as_view()),
]