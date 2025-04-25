# This is a helper module that will NOT be cythonized
from enum import Enum


def create_identifier_type(allowed_identifiers=None):
    """
    Create a custom type for identifiers in order to constrain test generation to valid identifiers.
    """
    if allowed_identifiers:

        class TempEnum(str, Enum):
            pass

        return TempEnum("Identifier", [(ident, ident) for ident in allowed_identifiers])
    return str
