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