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

    
import os
import json
from typing import Callable, Dict, Optional
from functools import lru_cache
from pathlib import Path
from autoreq.constants import APP_NAME
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
import base64
from appdirs import user_cache_dir

def ensure_env(
    required_keys,
    fallback,
    force_fallback = False
):
    global ENV_STORE
    
    result = {}
    for key in required_keys:
        result[key] = ENV_STORE.load(
            key,
            (lambda k=key: fallback(k)) if fallback else None,
            force_fallback
        )

    for key, value in result.items():
        os.environ[key] = value
    
    return result

class EnvStore:
    def __init__(self):
        self._cache_dir = Path(user_cache_dir(APP_NAME))
        self._cache_file = self._cache_dir / "env_cache.enc"
        self._cache: Dict[str, str] = {}
        self._fernet = self._setup_encryption()
        self._load_cache()

    def _setup_encryption(self) -> Fernet:
        kdf = PBKDF2HMAC(
            algorithm=hashes.SHA256(),
            length=32,
            salt=b"secure_env_manager_salt",
            iterations=100000,
        )
        key = base64.urlsafe_b64encode(kdf.derive(APP_NAME.encode()))
        return Fernet(key)

    def _load_cache(self) -> None:
        if self._cache_file.exists():
            encrypted = self._cache_file.read_bytes()
            try:
                decrypted = self._fernet.decrypt(encrypted)
                self._cache = json.loads(decrypted)
            except:
                self._cache = {}

    def _save_cache(self) -> None:
        self._cache_dir.mkdir(parents=True, exist_ok=True)
        encrypted = self._fernet.encrypt(json.dumps(self._cache).encode())
        self._cache_file.write_bytes(encrypted)

    def load(
        self, 
        key: str, 
        fallback: Optional[Callable[[], str]] = None,
        force_fallback: bool = False,
        allow_from_env: bool = True
    ) -> str:
        if not force_fallback:
            # Check actual environment first
            value = os.environ.get(key)
            if value is not None and allow_from_env:
                return value

            # Check cache
            if key in self._cache:
                return self._cache[key]

        # Use fallback if provided
        if fallback is not None:
            value = fallback()
            self._cache[key] = value
            self._save_cache()
            return value

        raise KeyError(f"Environment variable '{key}' not found")

    def store(self, key: str, value: str) -> None:
        self._cache[key] = value
        self._save_cache()

    def clear(self) -> None:
        self._cache = {}
        if self._cache_file.exists():
            self._cache_file.unlink()

ENV_STORE = EnvStore()


def parse_code(code):
    from tree_sitter import Language, Parser
    import tree_sitter_cpp as ts_cpp

    parser = Parser()
    CPP_LANGUAGE = Language(ts_cpp.language(), 'cpp')
    parser.set_language(CPP_LANGUAGE)

    tree = parser.parse(bytes(code, 'utf-8'))
    root_node = tree.root_node
    
    return root_node