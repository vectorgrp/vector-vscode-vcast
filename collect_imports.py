import os
import importlib
import sys
import inspect
import ast
import importlib.util
from pathlib import Path


def find_project_modules(base_package_name):
    """Find all modules in the given package recursively by walking directories."""
    modules = set()
    base_dir = None

    # First try to import the base package to get its path
    try:
        base_package = importlib.import_module(base_package_name)
        modules.add(base_package_name)

        if hasattr(base_package, '__path__'):
            base_dir = base_package.__path__[0]
    except Exception as e:
        print(f'Warning: Could not import {base_package_name}: {e}')
        # Try to find the package directory manually
        for path in sys.path:
            potential_dir = os.path.join(path, base_package_name)
            if os.path.isdir(potential_dir) and os.path.exists(
                os.path.join(potential_dir, '__init__.py')
            ):
                base_dir = potential_dir
                break

    if not base_dir:
        print(f'Could not find directory for package {base_package_name}')
        return modules

    # Walk the directory structure to find all Python files
    for root, dirs, files in os.walk(base_dir):
        # Skip __pycache__ directories
        if '__pycache__' in root:
            continue

        # Process Python files
        for file in files:
            if file.endswith('.py'):
                # Convert file path to module path
                rel_path = os.path.relpath(
                    os.path.join(root, file), os.path.dirname(base_dir)
                )
                if file == '__init__.py':
                    # For __init__.py files, use directory name
                    module_path = os.path.dirname(rel_path).replace(os.sep, '.')
                else:
                    # For regular files, remove .py extension
                    module_path = rel_path.replace(os.sep, '.').replace('.py', '')

                # Ensure it starts with the base package name
                if not module_path.startswith(base_package_name):
                    module_path = f'{base_package_name}.{module_path}'

                # Remove any empty package references
                module_path = module_path.replace('..', '.')
                while '..' in module_path:
                    module_path = module_path.replace('..', '.')

                modules.add(module_path)

                # Try to import the module to ensure it's valid
                try:
                    importlib.import_module(module_path)
                except Exception as e:
                    print(f'Warning: Could not import {module_path}: {e}')

    return modules


def collect_imports_from_source(file_path):
    """Extract imports from Python source code using AST."""
    # Track both direct imports and from-imports separately
    direct_imports = set()
    from_imports = set()
    from_import_bases = set()  # Base modules of from-imports
    specific_imports = set()  # Specific imports like module.Class

    try:
        with open(file_path, 'r', encoding='utf-8') as file:
            source = file.read()

        tree = ast.parse(source)

        for node in ast.walk(tree):
            # Handle regular imports
            if isinstance(node, ast.Import):
                for name in node.names:
                    direct_imports.add(name.name)

            # Handle from X import Y
            elif isinstance(node, ast.ImportFrom):
                if node.module is not None:
                    # Add the base module - this is always important
                    module_name = node.module

                    from_import_bases.add(module_name)

                    # Also add top-level module for third-party packages
                    if '.' in module_name:
                        # Add top module
                        top_module = module_name.split('.')[0]
                        from_import_bases.add(top_module)

                        # Add each part of the module hierarchy
                        parts = module_name.split('.')
                        for i in range(1, len(parts)):
                            intermediate_module = '.'.join(parts[: i + 1])
                            from_imports.add(intermediate_module)

                    # Add the specific imports
                    for name in node.names:
                        # Add specific class/function imports (module.Class)

                        specific_import = f'{module_name}.{name.name}'
                        specific_imports.add(specific_import)
                        from_imports.add(specific_import)
                    if 'llm_client' in file_path:
                        print(node.names)
    except Exception as e:
        print(f'Error parsing {file_path}: {e}')

    return direct_imports, from_imports, from_import_bases, specific_imports


def collect_runtime_imports(modules):
    """Collect all imports at runtime by examining modules."""
    direct_imports = set()
    from_imports = set()
    base_modules = set()
    specific_imports = set()

    for module_name in modules:
        try:
            module = importlib.import_module(module_name)

            # Get the source file
            if (
                hasattr(module, '__file__')
                and module.__file__
                and module.__file__.endswith('.py')
            ):
                print(module.__file__)
                # Get imports from AST analysis of source code
                direct, from_imps, bases, specifics = collect_imports_from_source(
                    module.__file__
                )
                direct_imports.update(direct)
                from_imports.update(from_imps)
                base_modules.update(bases)
                specific_imports.update(specifics)

            # Get all objects in the module
            for name, obj in inspect.getmembers(module):
                # Look for imported modules
                if inspect.ismodule(obj):
                    if hasattr(obj, '__name__'):
                        mod_name = obj.__name__
                        direct_imports.add(mod_name)

                        # For modules with dot notation, also add the base module
                        if '.' in mod_name:
                            parts = mod_name.split('.')
                            base_modules.add(parts[0])

        except Exception as e:
            print(f'Warning: Error processing imports for {module_name}: {e}')

    return direct_imports, from_imports, base_modules, specific_imports


def collect_all_imports(source_dirs=None, base_package_name=None):
    """Collect imports from both package modules and additional source directories."""
    direct_imports = set()
    from_imports = set()
    base_modules = set()
    specific_imports = set()

    # Process package modules if specified
    if base_package_name:
        modules = find_project_modules(base_package_name)
        print(f'Found {len(modules)} modules in {base_package_name} package')

        d_imp, f_imp, b_mod, s_imp = collect_runtime_imports(modules)
        direct_imports.update(d_imp)
        from_imports.update(f_imp)
        base_modules.update(b_mod)
        specific_imports.update(s_imp)

    # Process additional source directories if provided
    if source_dirs:
        for directory in source_dirs:
            directory_path = Path(directory)
            if directory_path.exists() and directory_path.is_dir():
                print(f'Processing directory: {directory}')
                for file_path in directory_path.glob('**/*.py'):
                    if '__pycache__' not in str(file_path):
                        print(f'Analyzing: {file_path}')
                        d_imp, f_imp, b_mod, s_imp = collect_imports_from_source(
                            str(file_path)
                        )
                        direct_imports.update(d_imp)
                        from_imports.update(f_imp)
                        base_modules.update(b_mod)
                        specific_imports.update(s_imp)

    return direct_imports, from_imports, base_modules, specific_imports


def main():
    # Ensure autoreq is in the path
    project_root = Path(__file__).parent
    sys.path.insert(0, str(project_root))

    # Find all modules in autoreq package and additional source files
    print('Scanning for modules and imports...')

    # You can specify both package and directories to scan
    direct_imports, from_imports, base_modules, specific_imports = collect_all_imports(
        base_package_name='autoreq',
        source_dirs=[project_root / 'autoreq'],  # Add any extra directories to scan
    )

    all_imports = (
        direct_imports.union(from_imports).union(base_modules).union(specific_imports)
    )

    all_imports = [
        imp
        for imp in all_imports
        if not any(
            [
                module_to_skip in imp
                for module_to_skip in [
                    'autoreq',
                    'llm_client',
                    'mlflow',
                    'code2reqs',
                    'test_generation',
                    'requirement_generation',
                    'verification',
                    'summary',
                    'trace_reqs2code',
                    'vector',  # cause it's vpython only
                ]
            ]
        )
    ]

    # this is the one that's not getting cythonated
    known_missing_imports = [
        'autoreq.test_generation.identifier_type_gen',
    ]
    all_imports.extend(known_missing_imports)
    # Sort for readability
    sorted_imports = sorted(all_imports)

    print(f'\nCollected {len(sorted_imports)} imports and submodules')
    print(f'  - {len(direct_imports)} direct imports')
    print(f'  - {len(from_imports)} from-imports (submodules)')
    print(f'  - {len(base_modules)} base modules')
    print(f'  - {len(specific_imports)} specific class/function imports')

    print('\nHiddenimports for PyInstaller:')
    print('hiddenimports = [')
    for imp in sorted_imports:
        print(f"    '{imp}',")
    print(']')
    output_path = Path('autoreq/autoreq_hiddenimports.py')
    with open(output_path, 'w') as f:
        f.write('hiddenimports = [\n')
        for imp in sorted_imports:
            f.write(f"    '{imp}',\n")
        f.write(']\n')

    print('\nImports saved to autoreq_hiddenimports.py')


if __name__ == '__main__':
    main()
