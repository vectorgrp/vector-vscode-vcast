from setuptools import setup, find_packages

setup( 
  name ='autoreq', 
  version='0.0.1',
  packages = find_packages(), 
  entry_points ={ 
    'console_scripts': [ 
      'code2reqs = autoreq.code2reqs:cli',
      'reqs2tests = autoreq.reqs2tests:cli',
      'reqs2tests-eval = autoreq.evaluate:cli'
    ] 
  }, 
  install_requires = [
    'openai>=1.54.0',
    'pydantic>=2.9.2',
    'python-dotenv==1.0.0',
    'tqdm==4.66.1',
    'tree-sitter==0.23.2',
    'tree-sitter-c==0.23.1',
    'tree-sitter-cpp==0.23.4',
    'backoff==2.2.1',
    'aiostream==0.6.4',
    'structured-logprobs==0.1.5'
  ],
  include_package_data=True
)