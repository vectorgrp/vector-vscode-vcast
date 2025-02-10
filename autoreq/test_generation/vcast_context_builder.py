from collections import defaultdict
import asyncio  # Add asyncio import
from ..search import SearchEngine


class VcastContextBuilder:
    def __init__(self, environment, reduce_context=True):
        self.environment = environment
        self.reduce_context = reduce_context
        self.cache = {}
        self.locks = {}

    async def build_code_context(self, function_name, include_unit_name=False):
        context = await self._build_raw_code_context(function_name)

        if include_unit_name:
            assert len(self.environment.units) == 1
            unit_name = self.environment.units[0]

            context = f"// Unit: {unit_name}\n\n{context}"

        return context

    async def _build_raw_code_context(self, function_name):
        if function_name in self.cache:
            return self.cache[function_name]

        if function_name not in self.locks:
            self.locks[function_name] = asyncio.Lock()

        async with self.locks[function_name]:
            if function_name in self.cache:
                return self.cache[function_name]

            ast_context = self._reduce_context_ast(function_name)
            if ast_context:
                self.cache[function_name] = ast_context
                return ast_context

            llm_context = await self._reduce_context_llm(function_name)
            if llm_context:
                self.cache[function_name] = llm_context
                return llm_context

            return self.environment.get_tu_content(reduction_level='high')

    async def _reduce_context_llm(self, function_name):
        context = self.environment.get_tu_content(reduction_level='medium') 
        if len(context) > 1000000 or len(context.split("\n")) > 1000:
            context = self.environment.get_tu_content(reduction_level='high') 

        search_engine = SearchEngine(context)
        reduced_context = await search_engine.search(
            f"Give me only the relevant code to test this function: {function_name}. "
            "Include all necessary transitive dependencies in terms of type definitions, "
            "called functions, etc. but not anything else. Also include the name of "
            "the file where the code is located."
        )

        return reduced_context

    def _reduce_context_ast(self, function_name):
        codebase = self.environment.tu_codebase
        relevant_definitions = codebase.get_definitions_for_symbol(function_name, collapse_function_body=True, return_dict=True, depth=3)

        if not relevant_definitions:
            return None

        definition_groups = defaultdict(list)
        for symbol, definition in relevant_definitions.items():
            if symbol == function_name:
                continue
            definition_groups[definition].append(symbol)
            
        reduced_context = []

        reduced_context.append("// Definitions of types, called functions and data structures:")
        for definition, _ in definition_groups.items():
            reduced_context.append(f"\n{definition}")

        reduced_context.append(f"\n// Code for {function_name}:\n{codebase.find_definitions_by_name(function_name)[0]}")

        return "\n".join(reduced_context)