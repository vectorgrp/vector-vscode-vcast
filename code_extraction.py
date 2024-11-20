import re
import os
from typing import List
from pydantic import BaseModel
from dcheck.processing.code_extraction import _parse_next_block_after_signature

class Function(BaseModel):
    signature: str
    body: str
    start_line: int
    end_line: int
    file: str

    @property
    def unit(self) -> str:
        return os.path.basename(self.file).split('.')[0]

class RequirementReference(BaseModel):
    id: str
    line: int
    file: str

    @property
    def unit(self) -> str:
        return os.path.basename(self.file).split('.')[0]

def _match_to_func(code_str, match, file) -> Function:
    sig_start, sig_end = match.span(1)
    body_start, body_end = _parse_next_block_after_signature(code_str[sig_start:], return_as_span=True)

    signature = code_str[sig_start:sig_end]
    body = code_str[sig_end:sig_start+body_end]

    return Function(
        signature=signature,
        body=body,
        start_line=code_str[:sig_start].count('\n'),
        end_line=code_str[:sig_start + body_end].count('\n'),
        file=file
    )

def _match_to_requirement(code_str, match, file) -> RequirementReference:
    _, end = match.span(1)

    return RequirementReference(
        id=match.group(1),
        line=code_str[:end].count('\n'),
        file=file
    )

def extract_functions(code_str: str, file: str) -> List[Function]:
    code_str = code_str.replace('\r', '')
    func_regex = r'\n((?:\w+ )?\w+ +\*? *\w+(?: +/\*.+)?\n? *\((?:.|\n)+?)\{'

    matches = list(re.finditer(func_regex, code_str))

    return [_match_to_func(code_str, m, file) for m in matches]
    
def extract_requirements(code_str: str, file: str) -> List[RequirementReference]:
    code_str = code_str.replace('\r', '')
    # Add space to not catch tsim
    requirement_regex = " im\s*\[([A-Z0-9\.]+)\]"

    matches = list(re.finditer(requirement_regex, code_str))

    return [_match_to_requirement(code_str, m, file) for m in matches]

def extract_all_functions(directory: str) -> List[Function]:
    all_functions = []
    for root, _, files in os.walk(directory):
        for file in files:
            if file.endswith('.c'):
                filepath = os.path.join(root, file)
                with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
                    code_str = f.read()
                    all_functions.extend(extract_functions(code_str, filepath))
    return all_functions

def extract_all_requirement_references(directory: str) -> List[RequirementReference]:
    all_requirements = []
    for root, _, files in os.walk(directory):
        for file in files:
            if file.endswith('.c'):
                filepath = os.path.join(root, file)
                with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
                    code_str = f.read()
                    all_requirements.extend(extract_requirements(code_str, filepath))
    return all_requirements
