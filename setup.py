from setuptools import setup, find_packages
try:
    from Cython.Build import cythonize
    use_cython = True
except ImportError:
    use_cython = False

base_requirements = [
    'openai>=1.54.0',
    'pydantic>=2.9.2',
    'python-dotenv==1.0.0',
    'tqdm==4.66.1',
    'tree-sitter==0.21.3',
    'tree-sitter-c==0.21.4',
    'tree-sitter-cpp==0.22.3',
    'backoff==2.2.1',
    'aiostream==0.6.3',
    'aiolimiter==1.2.1',
    'requests==2.32.3',
    'cryptography==44.0.1',
    'appdirs==1.4.4',
    'seaborn==0.13.2',
    'markdownify==1.1.0',
    'PyYAML==6.0.2',
    'openpyxl==3.1.5',
]

dev_requirements = [
    'pytest==8.3.5',
    'pytest-mock==3.14.0',
    'pyinstaller==6.12.0',
    'Cython==3.0.12'
]


ext_modules = cythonize(
    [
        "autoreq/llm_client.py",
    ],
    compiler_directives={
        'language_level': '3',
    },
) if use_cython else []

setup(
    name='autoreq',
    version='0.0.1',
    packages=find_packages(
        exclude=[
            'autoreq/test_verification', 'autoreq/requirement_verification', 'autoreq/evaluate_*'
        ]
    ),
    ext_modules=ext_modules,
    entry_points={
        'console_scripts': [
            'code2reqs = autoreq.code2reqs:cli',
            'reqs2tests = autoreq.reqs2tests:cli',
            'reqs2tests_eval = autoreq.evaluate_reqs2tests:cli',
            'code2reqs_eval = autoreq.evaluate_code2reqs:cli',
            'manage_env = autoreq.manage_env:cli',
            'reqs2excel = autoreq.reqs2excel:cli',
            'reqs2rgw = autoreq.reqs2rgw:cli',
        ]
    },
    install_requires=base_requirements,
    extras_require={
        'dev': dev_requirements,
    },
    include_package_data=True,
)
