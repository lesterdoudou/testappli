const form = document.querySelector('#owner-login');
const errorEl = document.querySelector('#owner-error');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  errorEl.textContent = '';
  const formData = new FormData(form);
  const payload = Object.fromEntries(formData.entries());

  const response = await fetch('/api/owner/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    errorEl.textContent = data.error || 'Mot de passe invalide.';
    return;
  }

  window.location.href = '/owner';
});
