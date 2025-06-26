// Acquire the VS Code API for communication with the extension backend
const vscode = acquireVsCodeApi();

// Initialize project mapping and source files from the window's global data
const projectMap = new Map(window.projectData || []);
const initialSourceFiles = window.initialSourceFiles || [];

// ---------------------------------------
// UI Helper Functions
// ---------------------------------------

/**
 * Adds a new source file row to the "Source Files" container.
 * @param {string} filePath - Optional initial file path to populate.
 */
function addSourceRow(filePath = '') {
  const container = document.getElementById('sourceFilesContainer');

  const row = document.createElement('div');
  row.className = 'single-input-container';

  const input = document.createElement('input');
  input.type = 'text';
  input.value = filePath;
  input.placeholder = 'Enter Source File';

  const removeButton = document.createElement('button');
  removeButton.className = 'remove-button';
  removeButton.textContent = '✖';
  removeButton.addEventListener('click', () => row.remove());

  row.append(input, removeButton);
  container.appendChild(row);
}

/**
 * Adds a new compiler/testsuites row based on the selected project path.
 */
function addCompilerRow() {
  const projectSelect = document.getElementById('projectPath');
  const projectInfo = projectMap.get(projectSelect.value);

  if (!projectInfo) return; // No project info available

  const row = document.createElement('div');
  row.className = 'double-input-container';

  const compilerSelect = document.createElement('select');
  compilerSelect.innerHTML = projectInfo.compilers.map(c => `<option>${c}</option>`).join('');

  const testsuiteSelect = document.createElement('select');
  testsuiteSelect.innerHTML = projectInfo.testsuites.map(t => `<option>${t}</option>`).join('');

  const removeButton = document.createElement('button');
  removeButton.className = 'remove-button';
  removeButton.textContent = '✖';
  removeButton.addEventListener('click', () => row.remove());

  row.append(compilerSelect, testsuiteSelect, removeButton);
  document.getElementById('compilerContainer').appendChild(row);
}

/**
 * Gathers form data and sends a 'submit' message to the extension.
 */
function submitForm() {
  const projectPath = document.getElementById('projectPath').value;

  // Collect all source file input values
  const sourceFiles = Array.from(
    document.querySelectorAll('#sourceFilesContainer input')
  ).map(input => input.value);

  // Collect compiler/testsuites selections
  const testsuiteArgs = Array.from(
    document.querySelectorAll('#compilerContainer .double-input-container')
  ).map(row => {
    const [compilerSelect, testsuiteSelect] = row.querySelectorAll('select');
    return `${compilerSelect.value}/${testsuiteSelect.value}`;
  });

  // Validate form
  if (!projectPath || testsuiteArgs.length === 0) {
    vscode.postMessage({
      command: 'error',
      message: 'Project Path and at least one Testsuite are required.'
    });
    return;
  }

  // Submit collected data
  vscode.postMessage({
    command: 'submit',
    projectPath,
    sourceFiles,
    testsuiteArgs
  });
}

/**
 * Cancels the operation and informs the extension.
 */
function cancel() {
  vscode.postMessage({ command: 'cancel' });
}

// ---------------------------------------
// Initialization
// ---------------------------------------

/**
 * Initializes the form when the DOM content is fully loaded.
 */
window.addEventListener('DOMContentLoaded', () => {
  const projectSelect = document.getElementById('projectPath');

  // Populate the project path dropdown
  for (const [key] of projectMap.entries()) {
    const option = document.createElement('option');
    option.value = key;
    option.text = key;
    projectSelect.append(option);
  }

  // Populate initial source files, or add an empty one if none exist
  initialSourceFiles.forEach(filePath => addSourceRow(filePath));
  if (initialSourceFiles.length === 0) {
    addSourceRow();
  }

  // Add an initial compiler/testsuites row
  addCompilerRow();

  // Update compiler/testsuites when the project changes
  projectSelect.addEventListener('change', () => {
    document.querySelectorAll('.double-input-container').forEach(row => row.remove());
    addCompilerRow();
  });

  // Hook up button event listeners
  document.getElementById('btnAddSource').addEventListener('click', () => addSourceRow());
  document.getElementById('btnAddCompiler').addEventListener('click', addCompilerRow);
  document.getElementById('btnSubmit').addEventListener('click', submitForm);
  document.getElementById('btnCancel').addEventListener('click', cancel);
});
