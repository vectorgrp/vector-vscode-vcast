const vscode = acquireVsCodeApi();
const projectMap = new Map(window.projectData || []);
const initialSourceFiles = window.initialSourceFiles || [];

// receive envFileSelected?  (not used here but pattern in other scripts)

function addSourceRow(filePath = '') {
  const container = document.getElementById('sourceFilesContainer');
  const row = document.createElement('div');
  row.className = 'single-input-container';
  const input = document.createElement('input');
  input.type = 'text'; input.value = filePath; input.placeholder = 'Enter Source File';
  const rm = document.createElement('button');
  rm.className = 'remove-button'; rm.textContent = '✖';
  rm.addEventListener('click', () => row.remove());
  row.append(input, rm);
  container.appendChild(row);
}

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
  rm.className = 'remove-button'; rm.textContent = '✖';
  rm.addEventListener('click', () => row.remove());
  row.append(comp, ts, rm);
  document.getElementById('compilerContainer').appendChild(row);
}

function submitForm() {
  const projectPath = document.getElementById('projectPath').value;
  const sourceFiles = Array.from(
    document.querySelectorAll('#sourceFilesContainer input')
  ).map(i => i.value);
  const testsuiteArgs = Array.from(
    document.querySelectorAll('#compilerContainer .double-input-container')
  ).map(r => {
    const [c, t] = r.querySelectorAll('select');
    return `${c.value}/${t.value}`;
  });
  if (!projectPath || testsuiteArgs.length === 0) {
    vscode.postMessage({ command: 'error', message: 'Project Path and Testsuite are required.' });
    return;
  }
  vscode.postMessage({ command: 'submit', projectPath, sourceFiles, testsuiteArgs });
}

function cancel() {
  vscode.postMessage({ command: 'cancel' });
}

window.addEventListener('DOMContentLoaded', () => {
  const ps = document.getElementById('projectPath');
  for (const [key] of projectMap.entries()) {
    const opt = document.createElement('option');
    opt.value = key; opt.text = key; ps.append(opt);
  }
  initialSourceFiles.forEach(f => addSourceRow(f));
  if (initialSourceFiles.length === 0) addSourceRow();
  addCompilerRow();
  ps.addEventListener('change', () => {
    document.querySelectorAll('.double-input-container').forEach(r => r.remove());
    addCompilerRow();
  });
  document.getElementById('btnAddSource').addEventListener('click', () => addSourceRow());
  document.getElementById('btnAddCompiler').addEventListener('click', addCompilerRow);
  document.getElementById('btnSubmit').addEventListener('click', submitForm);
  document.getElementById('btnCancel').addEventListener('click', cancel);
});
