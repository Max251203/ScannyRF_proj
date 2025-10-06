from django.contrib import admin
from .models import User, PasswordResetCode

@admin.register(User)
class UserAdmin(admin.ModelAdmin):
    list_display = ('id','username','email')
    search_fields = ('username','email')

@admin.register(PasswordResetCode)
class ResetAdmin(admin.ModelAdmin):
    list_display = ('id','user','code','used','created_at')
    search_fields = ('user__email','code')