from django.contrib import admin
from .models import Subscription, Operation


@admin.register(Subscription)
class SubscriptionAdmin(admin.ModelAdmin):
    list_display = ('id', 'user', 'plan', 'started_at', 'expires_at')
    list_filter = ('plan',)
    search_fields = ('user__email', 'user__username')


@admin.register(Operation)
class OperationAdmin(admin.ModelAdmin):
    list_display = ('id', 'user', 'kind', 'pages', 'free', 'doc_name', 'created_at')
    list_filter = ('kind', 'free')
    search_fields = ('user__email', 'user__username', 'doc_name')