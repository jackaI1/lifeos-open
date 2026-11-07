from django import forms

class UploadForm(forms.Form):
    document = forms.FileField(help_text='UTF-8 plain text (.txt), up to 100 KB.')

    def clean_document(self):
        upload = self.cleaned_data['document']
        if not upload.name.lower().endswith('.txt') or upload.size > 100_000:
            raise forms.ValidationError('Choose a .txt file no larger than 100 KB.')
        try:
            text = upload.read().decode('utf-8-sig')
        except UnicodeDecodeError:
            raise forms.ValidationError('The file must be UTF-8 text.')
        if not text.strip():
            raise forms.ValidationError('The file is empty.')
        return (upload.name[:255], text)
