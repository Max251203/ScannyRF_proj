from django.contrib import admin
from .models import (
    Subscription,
    Operation,
    BillingConfig,
    PromoCode,
    SignImage,
    GlobalSignImage,
    HiddenDefaultSign,
    Upload,
    DocumentDraft,
    DraftEvent,  # <- добавили
)


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


@admin.register(BillingConfig)
class BillingConfigAdmin(admin.ModelAdmin):
    list_display = (
        'id',
        'free_daily_quota',
        'draft_ttl_hours',
        'price_single',
        'price_month',
        'price_year',
    )
    actions = ['make_default']

    def has_add_permission(self, request):
        return not BillingConfig.objects.exists()

    @admin.action(description='Сделать дефолтными значениями (quota=3, TTL=24ч, цены 99/399/3999)')
    def make_default(self, request, queryset):
        for obj in queryset:
            obj.free_daily_quota = 3
            obj.draft_ttl_hours = 24
            obj.price_single = 99
            obj.price_month = 399
            obj.price_year = 3999
            obj.save()


@admin.register(PromoCode)
class PromoCodeAdmin(admin.ModelAdmin):
    list_display = ('id', 'code', 'discount_percent', 'active', 'created_at', 'note')
    list_filter = ('active',)
    search_fields = ('code', 'note')


@admin.register(SignImage)
class SignImageAdmin(admin.ModelAdmin):
    list_display = ('id', 'user', 'kind', 'mime', 'created_at')
    list_filter = ('kind',)
    search_fields = ('user__email', 'user__username')


@admin.register(GlobalSignImage)
class GlobalSignImageAdmin(admin.ModelAdmin):
    list_display = ('id', 'kind', 'mime', 'created_at')
    list_filter = ('kind',)


@admin.register(HiddenDefaultSign)
class HiddenDefaultSignAdmin(admin.ModelAdmin):
    list_display = ('id', 'user', 'sign')
    search_fields = ('user__email', 'user__username')


@admin.register(Upload)
class UploadAdmin(admin.ModelAdmin):
    list_display = ('id', 'user', 'doc_name', 'pages', 'client_id', 'created_at', 'auto_delete_at', 'deleted')
    list_filter = ('deleted',)
    search_fields = ('user__email', 'user__username', 'doc_name', 'client_id')


@admin.register(DocumentDraft)
class DocumentDraftAdmin(admin.ModelAdmin):
    list_display = ('id', 'user', 'updated_at', 'expires_at', 'is_expired_display')
    search_fields = ('user__email', 'user__username')

    def is_expired_display(self, obj):
        return obj.is_expired()
    is_expired_display.boolean = True
    is_expired_display.short_description = 'Просрочен'


@admin.register(DraftEvent)
class DraftEventAdmin(admin.ModelAdmin):
    list_display = ('id', 'user', 'client_id', 'kind', 'created_at')
    list_filter = ('kind',)
    search_fields = ('user__email', 'user__username', 'client_id', 'kind')
    ordering = ('-created_at',)