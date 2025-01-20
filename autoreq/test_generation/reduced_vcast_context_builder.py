from collections import defaultdict
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
    def __init__(self, environment, reduction_mode=ReductionMode.AST):
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
        with tempfile.NamedTemporaryFile(mode='w', suffix='.cpp', delete=True) as temp_file:
            temp_file.write(context)
            temp_file.flush()

            codebase = Codebase([temp_file.name])
            
            relevant_definitions = codebase.get_definitions_for_function(temp_file.name, function_name, collapse_function_body=True, return_dict=True)


            # If this fails, return the unreduced context?
            if not relevant_definitions:
                return context

            definition_groups = defaultdict(list)

            for symbol, definition in relevant_definitions.items():
                if symbol == function_name:
                    continue
                definition_groups[definition].append(symbol)
                
            reduced_context = []

            reduced_context.append("Definitions of types, called functions and data structures:")
            for definition, symbols in definition_groups.items():
                symbols_list = ", ".join(symbols)
                reduced_context.append(f"\n{definition}")

            reduced_context.append(f"\nCode for {function_name}:\n{codebase.find_definitions_by_name(function_name)[0]}")

            return "\n".join(reduced_context)