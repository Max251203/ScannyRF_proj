from rest_framework import viewsets, permissions
from .models import FAQQuestion, LegalPage
from .serializers import FAQSerializer, LegalSerializer

class IsAdminOrReadOnly(permissions.BasePermission):
    def has_permission(self, request, view):
        if request.method in permissions.SAFE_METHODS:
            return True
        return request.user and request.user.is_staff

class FAQViewSet(viewsets.ModelViewSet):
    queryset = FAQQuestion.objects.all()
    serializer_class = FAQSerializer
    permission_classes = [IsAdminOrReadOnly]

class LegalViewSet(viewsets.ModelViewSet):
    queryset = LegalPage.objects.all()
    serializer_class = LegalSerializer
    permission_classes = [IsAdminOrReadOnly]