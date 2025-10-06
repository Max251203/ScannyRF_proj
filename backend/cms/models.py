from django.db import models

class FAQQuestion(models.Model):
    title = models.CharField(max_length=400)
    body = models.TextField()  # HTML
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['id']

    def __str__(self):
        return self.title

class LegalPage(models.Model):
    slug = models.SlugField(max_length=50, unique=True)  # 'terms', 'privacy'
    title = models.CharField(max_length=200)
    body = models.TextField()  # HTML
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.slug