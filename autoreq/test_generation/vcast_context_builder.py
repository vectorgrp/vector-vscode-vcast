from collections import defaultdict
import asyncio
import logging
from async_lru import alru_cache

from autoreq.util import prune_code
from ..search import SearchEngine


class VcastContextBuilder:
    def __init__(self, environment, reduce_context=True, llm_client=None):
        self.environment = environment
        self.reduce_context = reduce_context
        self.llm_client = llm_client
        self.cache = {}
        self.locks = defaultdict(asyncio.Lock)

    async def build_code_context(
        self,
        function_name,
        focus_lines=None,
        include_unit_name=False,
        return_used_fallback=False,
        blackbox=False,
    ):
        unit_name = self._get_function_unit(function_name)

        if unit_name is None:
            raise ValueError(f"Function '{function_name}' not found in any unit.")

        if blackbox:
            if focus_lines is not None:
                logging.warning("Warning: Pruning will be ignored in blackbox mode.")
            focus_lines = None

        context, used_fallback = await self._build_raw_code_context(
            function_name, unit_name, focus_lines, blackbox
        )

        if include_unit_name:
            context = f"// Unit: {unit_name}\n\n{context}"

        if return_used_fallback:
            return context, used_fallback

        return context

    @alru_cache(maxsize=None)
    async def _build_raw_code_context(
        self, function_name, unit_name, focus_lines=None, collapse_function_body=False
    ):
        ast_context = await self._reduce_context_ast(
            function_name, unit_name, focus_lines, collapse_function_body
        )
        if ast_context:
            return ast_context, False

        llm_context = await self._reduce_context_llm(
            function_name, unit_name, focus_lines, collapse_function_body
        )
        if llm_context:
            return llm_context, True

        fallback_content = self.environment.get_tu_content(
            unit_name=unit_name, reduction_level="high"
        )
        return fallback_content, True

    async def _reduce_context_llm(
        self, function_name, unit_name, focus_lines, collapse_function_body
    ):  # Added unit_name
        if collapse_function_body:
            raise ValueError(
                "LLM context reduction does not support collapsing function bodies."
            )

        context = self.environment.get_tu_content(
            unit_name=unit_name, reduction_level="medium"
        )  # Pass unit_name
        max_context = 1000000
        max_context_lines = 1000
        if len(context) > max_context or len(context.split("\n")) > max_context_lines:
            context = self.environment.get_tu_content(
                unit_name=unit_name, reduction_level="high"
            )  # Pass unit_name

        search_engine = SearchEngine(context, llm_client=self.llm_client)
        reduced_context = await search_engine.search(
            f"Give me only the relevant code to test this function: {function_name} (in unit {unit_name}). "
            "Include all necessary transitive dependencies in terms of type definitions, "
            "called functions, etc. but not anything else. Also include the name of "
            "the file where the code is located."
        )

        return reduced_context

    async def _reduce_context_ast(
        self, function_name, unit_name, focus_lines, collapse_function_body
    ):
        codebase = self.environment.tu_codebase

        temp_tu_path = self._get_unit_temp_tu_path(unit_name)
        if temp_tu_path is None:
            return None

        relevant_definitions = codebase.get_definitions_for_symbol(
            function_name,
            filepath=temp_tu_path,
            collapse_function_body=collapse_function_body,
            return_dict=True,
            depth=3,
        )
        if not relevant_definitions:
            return None

        definition_groups = defaultdict(list)
        for symbol, definition_text in relevant_definitions.items():
            if symbol.split("::")[-1] == function_name.split("::")[-1]:
                continue
            definition_groups[definition_text].append(symbol)

        reduced_context = [
            "// Definitions of types, called functions and data structures:"
        ]
        for definition_text in definition_groups:  # Iterate over keys directly
            reduced_context.append(f"\n{definition_text}")

        func_code = codebase.find_definitions_by_name(
            function_name,
            filepath=temp_tu_path,
            collapse_function_body=collapse_function_body,
        )[0]

        if focus_lines:
            if len(focus_lines) == 0:
                logging.warning(
                    f"Warning: No relevant lines found for {function_name} with focus text: {focus_lines}"
                )
            else:
                # focus_lines = list(range(max(focus_lines) + 1)) # improves performance
                func_code = prune_code(func_code, focus_lines)

        reduced_context.append(f"\n// Code for {function_name}:\n{func_code}")

        return "\n".join(reduced_context)

    def _get_function_unit(self, function_name):
        all_testable_functions = self.environment.testable_functions

        return next(
            (
                info["unit_name"]
                for info in all_testable_functions
                if info["name"] == function_name
            ),
            None,
        )

    def _get_unit_temp_tu_path(self, unit_name):
        if unit_name not in self.environment.units:
            return None

        unit_index = self.environment.units.index(unit_name)

        tu_codebase_paths = self.environment.tu_codebase_paths
        if not isinstance(tu_codebase_paths, list) or unit_index >= len(
            tu_codebase_paths
        ):
            return None

        return tu_codebase_paths[unit_index]
