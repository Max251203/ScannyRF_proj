from rest_framework.routers import DefaultRouter
from .views import FAQViewSet, LegalViewSet

router = DefaultRouter()
router.register('cms/faq', FAQViewSet, basename='faq')
router.register('cms/legal', LegalViewSet, basename='legal')

urlpatterns = router.urls