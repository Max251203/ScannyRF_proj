from django.urls import path
from .views import (
    KeyRateView,
    BillingStatusView, BillingRecordView,
    BillingConfigView, PublicBillingConfigView,
    PromoListCreate, PromoDetail, PromoValidateView,
    UserSignsListCreate, UserSignDetail,
    PaymentCreateView,
    DefaultSignsListCreate, DefaultSignDetail, HideDefaultSignView,
    UploadRecordView, UploadDeleteView,
    DraftGetView, DraftSaveView, DraftPatchView, DraftClearView,
)

urlpatterns = [
    # Утилиты
    path('utils/key-rate/', KeyRateView.as_view()),

    # Биллинг и история
    path('billing/status/', BillingStatusView.as_view()),
    path('billing/record/', BillingRecordView.as_view()),

    # Конфигурация биллинга (админ) + публичные цены
    path('billing/config/', BillingConfigView.as_view()),
    path('billing/public/', PublicBillingConfigView.as_view()),

    # Промокоды (админ) + валидация (public)
    path('billing/promos/', PromoListCreate.as_view()),
    path('billing/promos/<int:pk>/', PromoDetail.as_view()),
    path('billing/promo/validate/', PromoValidateView.as_view()),

    # Библиотека подписей/печати пользователя (+ глобальные дефолтные)
    path('library/signs/', UserSignsListCreate.as_view()),
    path('library/signs/<int:pk>/', UserSignDetail.as_view()),

    # Глобальные подписи/печати (админ)
    path('library/default-signs/', DefaultSignsListCreate.as_view()),
    path('library/default-signs/<int:pk>/', DefaultSignDetail.as_view()),
    path('library/default-signs/hide/', HideDefaultSignView.as_view()),

    # Платежи (заглушка)
    path('payments/create/', PaymentCreateView.as_view()),

    # История загрузок документов
    path('uploads/record/', UploadRecordView.as_view()),
    path('uploads/delete/', UploadDeleteView.as_view()),

    # Серверное хранилище черновика
    path('draft/get/', DraftGetView.as_view()),
    path('draft/save/', DraftSaveView.as_view()),
    path('draft/patch/', DraftPatchView.as_view()),  # Лёгкие патчи к черновику
    path('draft/clear/', DraftClearView.as_view()),
]