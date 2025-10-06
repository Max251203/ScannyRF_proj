from django.contrib.auth.models import AbstractUser
from django.db import models
from django.utils import timezone
from datetime import timedelta

class User(AbstractUser):
    email = models.EmailField(unique=True)
    avatar_bin = models.BinaryField(null=True, blank=True, editable=True)
    avatar_mime = models.CharField(max_length=100, null=True, blank=True)

    def __str__(self):
        return self.username or self.email

class PasswordResetCode(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='reset_codes')
    code = models.CharField(max_length=6)
    created_at = models.DateTimeField(auto_now_add=True)
    used = models.BooleanField(default=False)

    def is_valid(self):
        return (not self.used) and (timezone.now() - self.created_at < timedelta(minutes=15))