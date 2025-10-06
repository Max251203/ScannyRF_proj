from django.urls import path
from .views import (
    KeyRateView,
    BillingStatusView, BillingRecordView,
    PaymentCreateView,
)

urlpatterns = [
    path('utils/key-rate/', KeyRateView.as_view()),
    path('billing/status/', BillingStatusView.as_view()),
    path('billing/record/', BillingRecordView.as_view()),
    path('payments/create/', PaymentCreateView.as_view()),
]