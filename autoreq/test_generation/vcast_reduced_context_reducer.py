import os
from enum import Enum
import tempfile
from ..search import SearchEngine
from .vcast_context_builder import VcastContextBuilder
from ..codebase import Codebase

class ReductionMode(Enum):
    LLM = "ai"
    AST = "ast"

class VcastReducedContextBuilder(VcastContextBuilder):
    def __init__(self, environment, reduction_mode=ReductionMode.LLM):
        super().__init__(environment)
        self.reduction_mode = reduction_mode

    async def build_code_context(self, function_name):
        context = await super().build_code_context(function_name)

        if self.reduction_mode == ReductionMode.LLM:
            return await self._reduce_context_ai(context, function_name)
        else:
            return self._reduce_context_ast(context, function_name)

    async def _reduce_context_ai(self, context, function_name):
        if len(context) > 1000000 or len(context.split("\n")) > 1000:
            context = ""
            unit_contents = []
            for unit_name, unit_path in zip(self.environment.units, self.environment.source_files):
                with open(unit_path, 'r') as f:
                    unit_contents.append(f"Code from {unit_name}.c(pp):\n" + f.read())
                    
            context += "\n".join(unit_contents)

        search_engine = SearchEngine(context)
        reduced_context = await search_engine.search(
            f"Give me only the relevant code to test this function: {function_name}. "
            "Include all necessary transitive dependencies in terms of type definitions, "
            "called functions, etc. but not anything else. Also include the name of "
            "the file where the code is located."
        )
        return reduced_context

    def _reduce_context_ast(self, context, function_name):

        with open("ayy.cpp", "w") as f:
            f.write(context)
        # Use tempfile to safely create and manage temporary file
        with tempfile.NamedTemporaryFile(mode='w', suffix='.cpp', delete=True) as temp_file:
            temp_file.write(context)
            temp_file.flush()

            codebase = Codebase([temp_file.name])
            
            # Find the function definition
            functions = codebase.get_all_functions()
            target_function = next((f for f in functions if f['name'] == function_name), None)

            if not target_function:
                return context

            # Get code window around function
            code_window = codebase.get_code_window(temp_file.name, target_function['line'], window=1)
            
            # Get identifiers in the window
            identifiers = codebase.get_identifiers_in_window(
                temp_file.name, 
                target_function['line'] - 1, 
                target_function['line'] + 1
            )

            # Build reduced context with function and its dependencies
            reduced_context = [code_window]
            
            # Add definitions for referenced identifiers
            for identifier in identifiers:
                definition = codebase.find_definition(identifier, temp_file.name, only_local=True)
                if definition:
                    reduced_context.append(f"\nDefinition of {identifier}:\n{definition}")

            return "\n".join(reduced_context)