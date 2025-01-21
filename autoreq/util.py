import re
import glob
import os
import tempfile
import shutil
from typing import Callable, Optional


def paths_to_files(paths, file_extensions=['c']):
    """
    Recursively identifies all file paths in the given directory and file paths.

    Parameters:
        paths (list of str): List of directory paths to search for files.
        file_extensions (list of str, optional): List of file extensions to consider when recursively finding files in directories. Defaults to ['c'].

    Returns:
        set: A set of file paths expanded from the given directory or direct file paths.
    """
    full_paths = [os.path.abspath(path) for path in paths]
    files = set()
    for path in full_paths:
        if os.path.isfile(path):
            files.add(path)
        else:
            files |= set(p for ext in file_extensions for p in glob.glob(os.path.join(path, '**', '*') + '.' + ext, recursive=True))

    return files


class TempCopy:
    def __init__(self, source_path: str, transform: Optional[Callable[[str], str]] = None):
        """
        Context manager that creates a temporary copy of a file with optional content transformation.
        
        Args:
            source_path (str): Path to the source file to copy
            transform (Callable[[str], str], optional): Function to transform the file contents
        """
        self.source_path = source_path
        self.transform = transform
        self.temp_path = None

    def __enter__(self) -> str:
        # Create temporary file in same directory with unique name
        source_dir = os.path.dirname(self.source_path)
        source_name = os.path.basename(self.source_path)
        base, ext = os.path.splitext(source_name)
        
        # Find a unique filename by appending numbers
        counter = 1
        while True:
            temp_name = f"{base}_temp_{counter}{ext}"
            self.temp_path = os.path.join(source_dir, temp_name)
            if not os.path.exists(self.temp_path):
                break
            counter += 1

        # Copy content with optional transformation
        with open(self.source_path, 'r') as src:
            content = src.read()
            if self.transform:
                content = self.transform(content)
            with open(self.temp_path, 'w') as dst:
                dst.write(content)

        return self.temp_path

    def __exit__(self, exc_type, exc_val, exc_tb):
        if self.temp_path and os.path.exists(self.temp_path):
            os.unlink(self.temp_path)


def replace_func_and_var(code: str):
    FUNC_REGEX = re.compile(r'FUNC\((\w+?), ?\w+?\)')
    VAR_REGEX = re.compile(r'VAR\((\w+?), ?\w+?\)')
    
    def replace(match):
        return match.group(1)
    
    code = FUNC_REGEX.sub(replace, code)
    code = VAR_REGEX.sub(replace, code)
    
    return code