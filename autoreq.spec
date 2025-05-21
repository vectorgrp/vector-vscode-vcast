# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_dynamic_libs
from autoreq.autoreq_hiddenimports import hiddenimports
import re

excluded_binaries = ['libreadline*']
excluded_modules = [
    'autoreq.test_verification', 
    'autoreq.requirement_verification',
    'autoreq.summary',            
    'autoreq.manage_env',
    'pytest',
    'pytest-mock',
    'pyinstaller',
    'Cython',
    'ruff',
    'pre_commit',
    'pipdeptree',
    'seaborn',
    'markdownify',
    'pandas',
    'matplotlib',
    'pillow',
    'pillow.libs',
    'PIL',
    'numpy',
    'readline'
]

def filter_binaries(binaries):
    filtered = []
    for binary in binaries:
        if not any(re.search(pattern, binary[0]) for pattern in excluded_binaries):
            filtered.append(binary)
    return filtered


reqs2tests_a = Analysis(
    ['reqs2tests.py'],
    binaries=filter_binaries(
        collect_dynamic_libs(
            package='autoreq', search_patterns=['*.dll', '*.dylib', '*.so', '*.pyd']
        )
    ),
    datas=[
        (
            'monitors4codegen/multilspy/language_servers/ccls_language/runtime_dependencies.json',
            'monitors4codegen/multilspy/language_servers/ccls_language',
        ),
        (
            'monitors4codegen/multilspy/language_servers/ccls_language/initialize_params.json',
            'monitors4codegen/multilspy/language_servers/ccls_language',
        ),
        (
            'monitors4codegen/multilspy/language_servers/clangd_language/runtime_dependencies.json',
            'monitors4codegen/multilspy/language_servers/clangd_language',
        ),
        (
            'monitors4codegen/multilspy/language_servers/clangd_language/initialize_params.json',
            'monitors4codegen/multilspy/language_servers/clangd_language',
        ),
    ],
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=['runtime_hook_fix_exit.py'],
    excludes=excluded_modules,
    noarchive=False,
    optimize=0,
)

code2reqs_a = Analysis(
    ['code2reqs.py'],
    binaries=filter_binaries(
        collect_dynamic_libs(
            package='autoreq', search_patterns=['*.dll', '*.dylib', '*.so', '*.pyd']
        )
    ),
    datas=[
        (
            'monitors4codegen/multilspy/language_servers/ccls_language/runtime_dependencies.json',
            'monitors4codegen/multilspy/language_servers/ccls_language',
        ),
        (
            'monitors4codegen/multilspy/language_servers/ccls_language/initialize_params.json',
            'monitors4codegen/multilspy/language_servers/ccls_language',
        ),
        (
            'monitors4codegen/multilspy/language_servers/clangd_language/runtime_dependencies.json',
            'monitors4codegen/multilspy/language_servers/clangd_language',
        ),
        (
            'monitors4codegen/multilspy/language_servers/clangd_language/initialize_params.json',
            'monitors4codegen/multilspy/language_servers/clangd_language',
        ),
    ],
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=['runtime_hook_fix_exit.py'],
    excludes=excluded_modules,
    noarchive=False,
    optimize=0,
)

reqs2excel_a = Analysis(
    ['reqs2excel.py'],
    binaries=filter_binaries(
        collect_dynamic_libs(
            package='autoreq', search_patterns=['*.dll', '*.dylib', '*.so', '*.pyd']
        )
    ),
    datas=[
        ('autoreq/resources', 'autoreq/resources'),
        (
            'monitors4codegen/multilspy/language_servers/ccls_language/runtime_dependencies.json',
            'monitors4codegen/multilspy/language_servers/ccls_language',
        ),
        (
            'monitors4codegen/multilspy/language_servers/ccls_language/initialize_params.json',
            'monitors4codegen/multilspy/language_servers/ccls_language',
        ),
        (
            'monitors4codegen/multilspy/language_servers/clangd_language/runtime_dependencies.json',
            'monitors4codegen/multilspy/language_servers/clangd_language',
        ),
        (
            'monitors4codegen/multilspy/language_servers/clangd_language/initialize_params.json',
            'monitors4codegen/multilspy/language_servers/clangd_language',
        ),
    ],
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=['runtime_hook_fix_exit.py'],
    excludes=excluded_modules,
    noarchive=False,
    optimize=0,
)

reqs2rgw_a = Analysis(
    ['reqs2rgw.py'],
    pathex=[],
    binaries=filter_binaries(
        collect_dynamic_libs(
            package='autoreq', search_patterns=['*.dll', '*.dylib', '*.so', '*.pyd']
        )
    ),
    datas=[
        ('autoreq/resources', 'autoreq/resources'),
        (
            'monitors4codegen/multilspy/language_servers/ccls_language/runtime_dependencies.json',
            'monitors4codegen/multilspy/language_servers/ccls_language',
        ),
        (
            'monitors4codegen/multilspy/language_servers/ccls_language/initialize_params.json',
            'monitors4codegen/multilspy/language_servers/ccls_language',
        ),
        (
            'monitors4codegen/multilspy/language_servers/clangd_language/runtime_dependencies.json',
            'monitors4codegen/multilspy/language_servers/clangd_language',
        ),
        (
            'monitors4codegen/multilspy/language_servers/clangd_language/initialize_params.json',
            'monitors4codegen/multilspy/language_servers/clangd_language',
        ),
    ],
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=['runtime_hook_fix_exit.py'],
    excludes=excluded_modules,
    noarchive=False,
    optimize=0,
)


reqs2tests_pyz = PYZ(reqs2tests_a.pure)
code2reqs_pyz = PYZ(code2reqs_a.pure)
reqs2excel_pyz = PYZ(reqs2excel_a.pure)
reqs2rgw_pyz = PYZ(reqs2rgw_a.pure)

reqs2tests_exe = EXE(
    reqs2tests_pyz,
    reqs2tests_a.scripts,
    [('u', None, 'OPTION')],
    exclude_binaries=True,
    name='reqs2tests',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

code2reqs_exe = EXE(
    code2reqs_pyz,
    code2reqs_a.scripts,
    [('u', None, 'OPTION')],
    exclude_binaries=True,
    name='code2reqs',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

reqs2excel_exe = EXE(
    reqs2excel_pyz,
    reqs2excel_a.scripts,
    [('u', None, 'OPTION')],
    exclude_binaries=True,
    name='reqs2excel',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

reqs2rgw_exe = EXE(
    reqs2rgw_pyz,
    reqs2rgw_a.scripts,
    [('u', None, 'OPTION')],
    exclude_binaries=True,
    name='reqs2rgw',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)


coll = COLLECT(
    reqs2tests_exe,
    reqs2tests_a.binaries,
    reqs2tests_a.datas,
    code2reqs_exe,
    code2reqs_a.binaries,
    code2reqs_a.datas,
    reqs2excel_exe,
    reqs2excel_a.binaries,
    reqs2excel_a.datas,
    reqs2rgw_exe,
    reqs2rgw_a.binaries,
    reqs2rgw_a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='autoreq',
)
