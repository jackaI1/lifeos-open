from django.contrib.auth.decorators import login_required
from django.db import transaction
from django.shortcuts import get_object_or_404, redirect, render
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView
from .forms import UploadForm
from .models import Document, Finding
from .service import ReviewError, review_text

def create_review(user, name, text):
    findings = review_text(text)
    with transaction.atomic():
        document = Document.objects.create(owner=user, name=name, text=text)
        Finding.objects.bulk_create([Finding(document=document, **item) for item in findings])
    return document

@login_required
def index(request):
    form = UploadForm(request.POST or None, request.FILES or None)
    if request.method == 'POST' and form.is_valid():
        name, text = form.cleaned_data['document']
        try:
            return redirect('detail', pk=create_review(request.user, name, text).pk)
        except ReviewError as exc:
            form.add_error(None, str(exc))
    return render(request, 'reviews/index.html', {'form': form, 'documents': request.user.documents.order_by('-created_at')})

@login_required
def detail(request, pk):
    document = get_object_or_404(Document.objects.prefetch_related('findings'), pk=pk, owner=request.user)
    return render(request, 'reviews/detail.html', {'document': document})

class ReviewAPI(APIView):
    permission_classes = [permissions.IsAuthenticated]
    def post(self, request):
        form = UploadForm(request.POST, request.FILES)
        if not form.is_valid():
            return Response(form.errors, status=status.HTTP_400_BAD_REQUEST)
        try:
            document = create_review(request.user, *form.cleaned_data['document'])
        except ReviewError as exc:
            return Response({'error': str(exc)}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        return Response({'id': document.pk, 'name': document.name, 'findings': list(document.findings.values('observation', 'source_quote', 'unsure'))}, status=status.HTTP_201_CREATED)
