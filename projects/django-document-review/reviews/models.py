from django.conf import settings
from django.db import models

class Document(models.Model):
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='documents')
    name = models.CharField(max_length=255)
    text = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

class Finding(models.Model):
    document = models.ForeignKey(Document, on_delete=models.CASCADE, related_name='findings')
    observation = models.TextField()
    source_quote = models.TextField(blank=True)
    unsure = models.BooleanField(default=False)
