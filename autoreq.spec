# -*- mode: python ; coding: utf-8 -*-

reqs2tests_a = Analysis(
    ['reqs2tests.py'],
    pathex=[],
    binaries=[],
    datas=[
        ('autoreq/resources', 'autoreq/resources'),
        ('monitors4codegen/multilspy/language_servers/ccls_language/runtime_dependencies.json', 'monitors4codegen/multilspy/language_servers/ccls_language'),
        ('monitors4codegen/multilspy/language_servers/ccls_language/initialize_params.json', 'monitors4codegen/multilspy/language_servers/ccls_language'),
        ('monitors4codegen/multilspy/language_servers/clangd_language/runtime_dependencies.json', 'monitors4codegen/multilspy/language_servers/clangd_language'),
        ('monitors4codegen/multilspy/language_servers/clangd_language/initialize_params.json', 'monitors4codegen/multilspy/language_servers/clangd_language')
    ],
    hiddenimports=[],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)

code2reqs_a = Analysis(
    ['code2reqs.py'],
    pathex=[],
    binaries=[],
    datas=[
        ('autoreq/resources', 'autoreq/resources'),
        ('monitors4codegen/multilspy/language_servers/ccls_language/runtime_dependencies.json', 'monitors4codegen/multilspy/language_servers/ccls_language'),
        ('monitors4codegen/multilspy/language_servers/ccls_language/initialize_params.json', 'monitors4codegen/multilspy/language_servers/ccls_language'),
        ('monitors4codegen/multilspy/language_servers/clangd_language/runtime_dependencies.json', 'monitors4codegen/multilspy/language_servers/clangd_language'),
        ('monitors4codegen/multilspy/language_servers/clangd_language/initialize_params.json', 'monitors4codegen/multilspy/language_servers/clangd_language')
    ],
    hiddenimports=[],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)

manage_env_a = Analysis(
    ['manage_env.py'],
    pathex=[],
    binaries=[],
    datas=[],
    hiddenimports=[],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)

reqs2tests_pyz = PYZ(reqs2tests_a.pure)
code2reqs_pyz = PYZ(code2reqs_a.pure)
manage_env_pyz = PYZ(manage_env_a.pure)

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

manage_env_exe = EXE(
    manage_env_pyz,
    manage_env_a.scripts,
    [('u', None, 'OPTION')],
    exclude_binaries=True,
    name='manage_env',
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
    manage_env_exe,
    manage_env_a.binaries,
    manage_env_a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='autoreq',
)
