from setuptools import setup, find_packages

setup( 
  name ='autoreq', 
  version='0.0.1',
  packages = find_packages(), 
  entry_points ={ 
    'console_scripts': [ 
      'code2reqs = autoreq.code2reqs:cli',
      'reqs2tests = autoreq.reqs2tests:cli',
      'reqs2tests_eval = autoreq.evaluate:cli',
      'manage_env = autoreq.manage_env:cli'
    ] 
  }, 
  install_requires = [
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
    'truststore==0.10.1'
  ],
  include_package_data=True
)