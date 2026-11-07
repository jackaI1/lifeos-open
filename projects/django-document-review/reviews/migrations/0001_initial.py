from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion

class Migration(migrations.Migration):
    initial = True
    dependencies = [migrations.swappable_dependency(settings.AUTH_USER_MODEL)]
    operations = [
        migrations.CreateModel(name='Document', fields=[('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')), ('name', models.CharField(max_length=255)), ('text', models.TextField()), ('created_at', models.DateTimeField(auto_now_add=True)), ('owner', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='documents', to=settings.AUTH_USER_MODEL))]),
        migrations.CreateModel(name='Finding', fields=[('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')), ('observation', models.TextField()), ('source_quote', models.TextField(blank=True)), ('unsure', models.BooleanField(default=False)), ('document', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='findings', to='reviews.document'))]),
    ]
