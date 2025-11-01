from django.conf import settings
from django.db import models
from django.utils import timezone


class Subscription(models.Model):
    PLAN_CHOICES = [
        ('month', 'month'),
        ('year', 'year'),
    ]
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='subs')
    plan = models.CharField(max_length=16, choices=PLAN_CHOICES)
    started_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()

    def is_active(self) -> bool:
        return self.expires_at > timezone.now()

    def __str__(self) -> str:
        return f'{self.user_id}:{self.plan}:{self.expires_at.date()}'


class Operation(models.Model):
    KIND_CHOICES = [
        ('download_jpg', 'download_jpg'),
        ('download_pdf', 'download_pdf'),
    ]
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='ops')
    kind = models.CharField(max_length=32, choices=KIND_CHOICES)
    pages = models.PositiveIntegerField(default=1)
    doc_name = models.CharField(max_length=200, blank=True, default='')
    free = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self) -> str:
        return f'{self.user_id}:{self.kind}:{self.pages}:{self.created_at:%Y-%m-%d %H:%M}'


class BillingConfig(models.Model):
    """
    Глобальная конфигурация биллинга (одна запись).
    """
    # бесплатные страницы в сутки
    free_daily_quota = models.PositiveIntegerField(default=3)
    # Кол-во часов до автоудаления документа из временного хранилища
    draft_ttl_hours = models.PositiveIntegerField(default=24)

    # Цены тарифов (в рублях) — для динамического отображения на сайте
    price_single = models.PositiveIntegerField(default=99)
    price_month = models.PositiveIntegerField(default=399)
    price_year = models.PositiveIntegerField(default=3999)

    def __str__(self) -> str:
        return (
            f'BillingConfig('
            f'free_daily_quota={self.free_daily_quota}, '
            f'draft_ttl_hours={self.draft_ttl_hours}, '
            f'price_single={self.price_single}, '
            f'price_month={self.price_month}, '
            f'price_year={self.price_year}'
            f')'
        )


class PromoCode(models.Model):
    code = models.CharField(max_length=64, unique=True)
    discount_percent = models.PositiveSmallIntegerField(default=0)  # 0..100
    active = models.BooleanField(default=True)
    note = models.CharField(max_length=200, blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self) -> str:
        state = 'active' if self.active else 'inactive'
        return f'{self.code} ({self.discount_percent}% {state})'


class SignImage(models.Model):
    """
    Библиотека подписей/печати пользователя
    """
    TYPE_CHOICES = [
        ('signature', 'signature'),
        ('sig_seal', 'sig_seal'),
        ('round_seal', 'round_seal'),
    ]
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='signs')
    kind = models.CharField(max_length=16, choices=TYPE_CHOICES, default='signature')
    mime = models.CharField(max_length=100, default='image/png')
    data = models.BinaryField()  # PNG/JPEG
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self) -> str:
        return f'{self.user_id}:{self.kind}:{self.mime}:{self.created_at:%Y-%m-%d}'


class GlobalSignImage(models.Model):
    """
    Глобальная библиотека подписей/печати (для всех пользователей)
    """
    TYPE_CHOICES = [
        ('signature', 'signature'),
        ('sig_seal', 'sig_seal'),
        ('round_seal', 'round_seal'),
    ]
    kind = models.CharField(max_length=16, choices=TYPE_CHOICES, default='signature')
    mime = models.CharField(max_length=100, default='image/png')
    data = models.BinaryField()  # PNG/JPEG
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self) -> str:
        return f'global:{self.kind}:{self.mime}:{self.created_at:%Y-%m-%d}'


class HiddenDefaultSign(models.Model):
    """
    Скрытые пользователем элементы из глобальной библиотеки
    """
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='hidden_defaults')
    sign = models.ForeignKey(GlobalSignImage, on_delete=models.CASCADE, related_name='hidden_by')

    class Meta:
        unique_together = ('user', 'sign')

    def __str__(self) -> str:
        return f'hidden:{self.user_id}:{self.sign_id}'


class Upload(models.Model):
    """
    История загрузок документов (для вкладки "История")
    """
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='uploads')
    client_id = models.CharField(max_length=64, db_index=True)  # id клиента (Editor.docId)
    doc_name = models.CharField(max_length=200, blank=True, default='')
    pages = models.PositiveIntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)
    auto_delete_at = models.DateTimeField()
    deleted = models.BooleanField(default=False)  # удалил пользователь вручную
    deleted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-created_at']

    def is_expired(self) -> bool:
        return timezone.now() >= self.auto_delete_at

    def __str__(self) -> str:
        state = 'deleted' if self.deleted else ('expired' if self.is_expired() else 'active')
        return f'upload:{self.user_id}:{self.doc_name}:{self.pages}:{state}'


class DocumentDraft(models.Model):
    """
    Черновик последнего документа пользователя (для восстановления на любом устройстве).
    Хранит сериализованные данные из фронтенда (serializeDocument).
    """
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='document_draft')
    data = models.JSONField()
    updated_at = models.DateTimeField(auto_now=True)
    # время истечения рассчитываем из BillingConfig.draft_ttl_hours
    expires_at = models.DateTimeField()

    class Meta:
        ordering = ['-updated_at']

    def is_expired(self) -> bool:
        return timezone.now() >= self.expires_at

    def __str__(self) -> str:
        return f'draft:{self.user_id}:{self.updated_at:%Y-%m-%d %H:%M}'