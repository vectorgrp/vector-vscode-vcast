import hashlib
import json
import os
from pathlib import Path


class JSONCache:
    """A general-purpose JSON-based file cache system."""

    def __init__(self, cache_dir: str, cache_name: str = 'cache'):
        """
        Initialize the cache.

        Args:
            cache_dir: Directory to store cache files.
            cache_name: Name prefix for cache files
        """
        self.cache_dir = Path(cache_dir)
        self.cache_name = cache_name
        os.makedirs(self.cache_dir, exist_ok=True)

    def input_hash(self, inputs):
        return hashlib.sha256(str(inputs).encode()).hexdigest()

    def save(self, inputs, cache_data):
        """Save a result to cache."""
        cache_key = self.input_hash(inputs)
        cache_file = self.cache_dir / f'{self.cache_name}_{cache_key}.json'

        with open(cache_file, 'w') as f:
            json.dump(cache_data, f, indent=4)

    def load(self, inputs):
        """Load a result from cache. Returns None if not found."""
        cache_key = self.input_hash(inputs)
        cache_file = self.cache_dir / f'{self.cache_name}_{cache_key}.json'

        if not cache_file.exists():
            return None

        try:
            with open(cache_file, 'r') as f:
                cache_data = json.load(f)
            return cache_data
        except (json.JSONDecodeError, IOError):
            return None
