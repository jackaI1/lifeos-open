const form = document.querySelector('[data-upload]');
if (form) form.addEventListener('submit', () => {
  form.querySelector('button').disabled = true;
  form.querySelector('[data-status]').textContent = 'Reviewing your document. This may take a minute.';
});
