from rest_framework import serializers
from .models import FAQQuestion, LegalPage

class FAQSerializer(serializers.ModelSerializer):
    class Meta:
        model = FAQQuestion
        fields = ('id','title','body','created_at','updated_at')

class LegalSerializer(serializers.ModelSerializer):
    class Meta:
        model = LegalPage
        fields = ('id','slug','title','body','updated_at')