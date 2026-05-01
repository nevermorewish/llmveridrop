(function () {
  const form = document.getElementById('detect-form');
  if (!form) return;
  const submitBtn = document.getElementById('submit-btn');
  const errBox = document.getElementById('form-error');

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    errBox.hidden = true;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting…';

    const fd = new FormData(form);
    try {
      const r = await fetch('/api/detect', {method: 'POST', body: fd});
      if (!r.ok) {
        const j = await r.json().catch(() => ({detail: 'request failed'}));
        throw new Error(j.detail || ('HTTP ' + r.status));
      }
      const j = await r.json();
      // wipe the api_key from the form so it can't be re-sent or peeked at
      form.api_key.value = '';
      location.href = '/r/' + j.job_id;
    } catch (e) {
      errBox.hidden = false;
      errBox.textContent = e.message || 'Submission failed';
      submitBtn.disabled = false;
      submitBtn.textContent = 'Start Detection';
    }
  });
})();
