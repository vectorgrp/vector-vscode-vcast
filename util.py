import glob
import os


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