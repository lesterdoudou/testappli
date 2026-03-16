const form = document.querySelector('#signup-form');
const success = document.querySelector('#signup-success');
const loginLink = document.querySelector('#login-link');
const qrLink = document.querySelector('#qr-link');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(form);
  const payload = Object.fromEntries(formData.entries());

  const response = await fetch('/api/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    alert(data.error || 'Impossible de creer le compte. Verifiez les champs.');
    return;
  }

  const data = await response.json();
  const origin = window.location.origin;

  loginLink.href = `${origin}${data.loginUrl}`;
  loginLink.textContent = `${origin}${data.loginUrl}`;
  qrLink.href = `${origin}${data.qrUrl}`;
  qrLink.textContent = `${origin}${data.qrUrl}`;

  success.classList.remove('hidden');
  success.scrollIntoView({ behavior: 'smooth' });
  form.reset();
});
