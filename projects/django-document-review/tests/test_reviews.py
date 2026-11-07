import io
import json
from unittest.mock import patch
import pytest
from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.urls import reverse
from reviews.models import Document, Finding
from reviews.service import ReviewError, review_text

pytestmark = pytest.mark.django_db

@pytest.fixture
def user():
    return get_user_model().objects.create_user(username='reader', password='password')

@pytest.fixture
def logged_in(client, user):
    client.force_login(user)
    return client

def upload(content=b'The deadline is unclear.', name='notes.txt'):
    return SimpleUploadedFile(name, content, content_type='text/plain')

def model_response(items):
    return io.BytesIO(json.dumps({'response': json.dumps({'findings': items})}).encode())

def test_models_link_owner_and_findings(user):
    doc = Document.objects.create(owner=user, name='notes.txt', text='Some text')
    Finding.objects.create(document=doc, observation='Clarify', source_quote='Some text')
    assert user.documents.get() == doc
    assert doc.findings.get().source_quote == 'Some text'

def test_login_required(client):
    assert client.get('/').status_code == 302
    assert client.post('/api/reviews/').status_code == 403

def test_upload_and_detail(logged_in):
    with patch('reviews.views.review_text', return_value=[{'observation': 'Clarify the deadline', 'source_quote': 'deadline', 'unsure': False}]):
        response = logged_in.post('/', {'document': upload()})
    assert response.status_code == 302
    page = logged_in.get(response.url)
    assert b'Clarify the deadline' in page.content and b'deadline' in page.content
    assert Document.objects.count() == 1

def test_other_users_cannot_read_document(logged_in):
    other = get_user_model().objects.create_user(username='other')
    doc = Document.objects.create(owner=other, name='private.txt', text='private')
    assert logged_in.get(reverse('detail', args=[doc.pk])).status_code == 404
    assert b'private.txt' not in logged_in.get('/').content

def test_api_returns_findings(logged_in):
    with patch('reviews.views.review_text', return_value=[{'observation': 'Check', 'source_quote': 'deadline', 'unsure': True}]):
        response = logged_in.post('/api/reviews/', {'document': upload()})
    assert response.status_code == 201
    assert response.json()['findings'][0]['unsure'] is True

def test_invalid_uploads(logged_in):
    for file in [upload(name='bad.pdf'), upload(b'\xff'), upload(b' '), upload(b'x' * 100001)]:
        assert logged_in.post('/api/reviews/', {'document': file}).status_code == 400
    assert Document.objects.count() == 0

def test_service_failure_does_not_save(logged_in):
    with patch('reviews.views.review_text', side_effect=ReviewError('Unavailable')):
        assert logged_in.post('/api/reviews/', {'document': upload()}).status_code == 503
    assert Document.objects.count() == 0

def test_grounding_and_abstention():
    items = [{'observation': 'A', 'source_quote': 'exact words', 'unsure': False}, {'observation': 'B', 'source_quote': 'invented', 'unsure': False}, {'observation': 'C', 'source_quote': 'exact words'}, {'observation': 'D', 'source_quote': 'exact words', 'unsure': True}]
    with patch('reviews.service.urlopen', return_value=model_response(items)):
        result = review_text('Here are exact words.')
    assert [x['unsure'] for x in result] == [False, True, True, True]
    assert result[1]['source_quote'] == ''

def test_bad_model_response():
    with patch('reviews.service.urlopen', return_value=io.BytesIO(b'not json')):
        with pytest.raises(ReviewError):
            review_text('text')
