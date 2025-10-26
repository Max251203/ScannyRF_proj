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


# Глобальная конфигурация биллинга (одна запись)
class BillingConfig(models.Model):
    free_daily_quota = models.PositiveIntegerField(default=3)  # бесплатные страницы в сутки

    def __str__(self) -> str:
        return f'BillingConfig(free_daily_quota={self.free_daily_quota})'


# Промокоды
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


# Библиотека подписей/печати пользователя
class SignImage(models.Model):
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


# Глобальная библиотека подписей/печати (для всех пользователей)
class GlobalSignImage(models.Model):
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


# Скрытые пользователем элементы из глобальной библиотеки
class HiddenDefaultSign(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='hidden_defaults')
    sign = models.ForeignKey(GlobalSignImage, on_delete=models.CASCADE, related_name='hidden_by')

    class Meta:
        unique_together = ('user', 'sign')

    def __str__(self) -> str:
        return f'hidden:{self.user_id}:{self.sign_id}'