const form = document.querySelector('#login-form');
const errorEl = document.querySelector('#login-error');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  errorEl.textContent = '';
  const formData = new FormData(form);
  const payload = Object.fromEntries(formData.entries());

  const response = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    errorEl.textContent = data.error || 'Identifiants invalides.';
    return;
  }

  const data = await response.json();
  window.location.href = data.adminUrl;
});
