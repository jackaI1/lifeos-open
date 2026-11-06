# django-document-review

I built a document review app to learn how the underlying idea works. This is a learning project.

## Try it

You need Python 3.9 or newer and [Ollama](https://ollama.com/) installed and running. Download a model separately using Ollama; its size can be significant. For example, `ollama pull llama3.2` and `ollama serve` make the default model available. The app does not download a model itself.

```sh
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python manage.py migrate
python manage.py createsuperuser
python manage.py runserver
```

Open http://127.0.0.1:8000/, sign in with the account you just created, and upload a UTF-8 `.txt` file up to 100 KB. Choose a previous review to see its findings and original text. Sign out when finished. Set `OLLAMA_MODEL` to choose another installed model or `OLLAMA_URL` to point to another Ollama server before starting the app.

## How it works

Django handles sign-in, pages, and the SQLite database, a file stored on the computer. Each document belongs to its uploader; other accounts cannot open it. The app sends the text to Ollama and asks for structured findings. It checks that each quoted passage appears exactly in the document. Missing or invented quotations are removed and marked unsure, as are findings the model itself calls uncertain. A valid quote does not prove an interpretation is correct, and a blank result does not prove a document is error-free.

The authenticated `/api/reviews/` endpoint accepts a multipart POST with a `document` file and returns the saved review and findings as JSON. Browser clients use their session and a CSRF token. If Ollama fails or returns malformed data, the app reports an error and does not save a partial review. Reviews run synchronously, so a slow model can make the request take time.

This is a local development setup, not a hardened public deployment. For deployment, set a strong `DJANGO_SECRET_KEY`, `DJANGO_DEBUG=0`, and `DJANGO_ALLOWED_HOSTS`, and configure HTTPS and appropriate access controls. The database contains uploaded text, so protect or remove `db.sqlite3` when appropriate.

## Tests and limits

There are 1 test source files in this copy. No test pass count is claimed here: I have not re-run the project suite as part of this move. This is a source snapshot, and running it on a new machine may need environment-specific setup.


Project checks run from this directory through the path-filtered hub workflows: `django-document-review-tests.yml`.
