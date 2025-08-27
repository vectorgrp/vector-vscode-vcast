import sys
import importlib

# Ensure the identifier_type_gen module is loaded
if getattr(sys, 'frozen', False):
    # Pre-import modules that might cause issues
    try:
        importlib.import_module('autoreq.test_generation.identifier_type_gen')
    except ImportError as e:
        print(f'Error importing identifier_type_gen: {e}')
