// manage/webviewScripts/addTestsuite.js

const vscode = acquireVsCodeApi();

function submitForm() {
  const input = document.getElementById('testsuiteInput');
  const testsuiteName = input && input.value.trim();
  vscode.postMessage({ command: 'submit', testsuiteName });
}

function cancel() {
  vscode.postMessage({ command: 'cancel' });
}

window.addEventListener('DOMContentLoaded', () => {
  document.querySelector('.primary-button')?.addEventListener('click', submitForm);
  document.querySelector('.cancel-button')?.addEventListener('click', cancel);

  document.addEventListener('keydown', e => {
    if (e.key === 'Enter') submitForm();
    if (e.key === 'Escape') cancel();
  });
});
