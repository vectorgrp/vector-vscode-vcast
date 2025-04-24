// src/manage/webviews/webviewScripts/importEnvProject.js

const vscode = acquireVsCodeApi();
const projectMap = new Map(window.projectData || []);
const initialEnvFile = window.initialEnvFile || '';

/**
 * Listen for messages from the extension (e.g. envFileSelected)
 */
window.addEventListener('message', event => {
  const msg = event.data;
  if (msg.command === 'envFileSelected') {
    const input = document.getElementById('envFileInput');
    if (input) {
      input.value = msg.envFile;
    }
  }
});

/** Ask the extension to pick an .env file */
function importEnvFile() {
  vscode.postMessage({ command: 'importEnvFile' });
}

/** Add a new compiler/tests row */
function addCompilerRow() {
  const ps = document.getElementById('projectPath');
  const info = projectMap.get(ps.value);
  if (!info) return;

  const row = document.createElement('div');
  row.className = 'double-input-container';

  const comp = document.createElement('select');
  comp.innerHTML = info.compilers.map(c => `<option>${c}</option>`).join('');

  const ts = document.createElement('select');
  ts.innerHTML = info.testsuites.map(t => `<option>${t}</option>`).join('');

  const rm = document.createElement('button');
  rm.className = 'remove-button';
  rm.textContent = '✖';
  rm.addEventListener('click', () => row.remove());

  row.append(comp, ts, rm);
  document.getElementById('compilerContainer').appendChild(row);
}

/** Submit the form */
function submitForm() {
  const projectPath = document.getElementById('projectPath').value;
  const envFile = document.getElementById('envFileInput').value;
  const rows = document.querySelectorAll('.double-input-container');
  const testsuiteArgs = Array.from(rows).map(r => {
    const [c, t] = r.querySelectorAll('select');
    return `${c.value}/${t.value}`;
  });

  if (!projectPath || !envFile || testsuiteArgs.length === 0) {
    vscode.postMessage({ command: 'error', message: 'All fields required.' });
    return;
  }

  vscode.postMessage({
    command: 'submit',
    projectPath,
    envFiles: [envFile],
    testsuiteArgs
  });
}

/** Cancel/close */
function cancel() {
  vscode.postMessage({ command: 'cancel' });
}

/** Setup on load */
window.addEventListener('DOMContentLoaded', () => {
  // Populate project dropdown
  const ps = document.getElementById('projectPath');
  for (const [key] of projectMap.entries()) {
    const opt = document.createElement('option');
    opt.value = key;
    opt.text = key;
    ps.appendChild(opt);
  }

  // Prefill env input if provided
  if (initialEnvFile) {
    document.getElementById('envFileInput').value = initialEnvFile;
  }

  // Add initial compiler/tests row
  addCompilerRow();

  // Reset rows on project change
  ps.addEventListener('change', () => {
    document.querySelectorAll('.double-input-container').forEach(r => r.remove());
    addCompilerRow();
  });

  // Wire up buttons
  document.getElementById('btnSelectEnv').addEventListener('click', importEnvFile);
  document.getElementById('btnAddRow').addEventListener('click', addCompilerRow);
  document.getElementById('btnSubmit').addEventListener('click', submitForm);
  document.getElementById('btnCancel').addEventListener('click', cancel);
});
