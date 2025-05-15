from collections import defaultdict
import asyncio
import logging

from autoreq.util import get_relevant_statement_groups, prune_code  # Add asyncio import
from ..search import SearchEngine


class VcastContextBuilder:
    def __init__(self, environment, reduce_context=True, llm_client=None):
        self.environment = environment
        self.reduce_context = reduce_context
        self.llm_client = llm_client
        self.cache = {}
        self.locks = {}

    async def build_code_context(
        self,
        function_name,
        focus_lines=None,
        include_unit_name=False,
        return_used_fallback=False,
    ):
        context, used_fallback = await self._build_raw_code_context(
            function_name, focus_lines
        )

        if include_unit_name:
            assert len(self.environment.units) == 1
            unit_name = self.environment.units[0]

            context = f'// Unit: {unit_name}\n\n{context}'

        if return_used_fallback:
            return context, used_fallback

        return context

    async def _build_raw_code_context(self, function_name, focus_text):
        cache_key = (function_name, focus_text)
        if cache_key in self.cache:
            return self.cache[cache_key]

        if cache_key not in self.locks:
            self.locks[cache_key] = asyncio.Lock()

        async with self.locks[cache_key]:
            if cache_key in self.cache:
                return self.cache[cache_key]

            ast_context = await self._reduce_context_ast(function_name, focus_text)
            if ast_context:
                self.cache[cache_key] = (ast_context, False)
                return ast_context, False

            llm_context = await self._reduce_context_llm(function_name, focus_text)
            if llm_context:
                self.cache[cache_key] = (llm_context, True)
                return llm_context, True

            return self.environment.get_tu_content(reduction_level='high'), True

    async def _reduce_context_llm(self, function_name):
        context = self.environment.get_tu_content(reduction_level='medium')
        if len(context) > 1000000 or len(context.split('\n')) > 1000:
            context = self.environment.get_tu_content(reduction_level='high')

        search_engine = SearchEngine(context, llm_client=self.llm_client)
        reduced_context = await search_engine.search(
            f'Give me only the relevant code to test this function: {function_name}. '
            'Include all necessary transitive dependencies in terms of type definitions, '
            'called functions, etc. but not anything else. Also include the name of '
            'the file where the code is located.'
        )

        return reduced_context

    async def _reduce_context_ast(self, function_name, focus_lines):
        codebase = self.environment.tu_codebase
        relevant_definitions = codebase.get_definitions_for_symbol(
            function_name, collapse_function_body=False, return_dict=True, depth=3
        )

        if not relevant_definitions:
            return None

        definition_groups = defaultdict(list)
        for symbol, definition in relevant_definitions.items():
            if symbol == function_name:
                continue
            definition_groups[definition].append(symbol)

        reduced_context = []

        reduced_context.append(
            '// Definitions of types, called functions and data structures:'
        )
        for definition, _ in definition_groups.items():
            reduced_context.append(f'\n{definition}')

        func_code = codebase.find_definitions_by_name(function_name)[0]

        if focus_lines:
            if len(focus_lines) == 0:
                logging.warning(
                    f'Warning: No relevant lines found for {function_name} with focus text: {focus_lines}'
                )
            else:
                # focus_lines = list(range(max(focus_lines) + 1)) # improves performance
                func_code = prune_code(func_code, focus_lines)

        reduced_context.append(f'\n// Code for {function_name}:\n{func_code}')

        return '\n'.join(reduced_context)
