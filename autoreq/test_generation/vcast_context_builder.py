import os
import re
import asyncio  # Add asyncio import

from ..search import SearchEngine

class VcastContextBuilder:
    def __init__(self, environment):
        self.environment = environment
        self.cache = {}
        self.locks = {}  # Add a dictionary to store locks

    async def build_code_context(self, function_name):
        if function_name in self.cache:
            return self.cache[function_name]

        if function_name not in self.locks:
            self.locks[function_name] = asyncio.Lock()

        async with self.locks[function_name]:
            if function_name in self.cache:
                return self.cache[function_name]

            context = ""
            env_dir = os.path.dirname(self.environment.env_file_path)
            env_name = self.environment.env_name

            # Build the environment
            self.environment.build()

            assert len(self.environment.units) == len(self.environment.source_files)
            assert len(self.environment.units) == 1

            for unit_name, unit_path in zip(self.environment.units, self.environment.source_files):
                built_env_dir = os.path.join(env_dir, env_name)
                tu_file_path = os.path.join(built_env_dir, f"{unit_name}.tu.c")

                if not os.path.exists(tu_file_path):
                    tu_file_path = os.path.join(built_env_dir, f"{unit_name}.tu.cpp")

                if os.path.exists(tu_file_path):
                    # Extract the required snippet from the .tu.c file
                    with open(tu_file_path, 'r', errors="ignore") as f:
                        lines = f.readlines()

                    snippet_lines = []
                    in_relevant_context = False
                    marker_pattern = re.compile(r'^#\s+\d+\s+"(.+)"')

                    for line in lines:
                        stripped_line = line.strip()
                        match = marker_pattern.match(stripped_line)
                        if match:
                            file_path_in_marker = os.path.abspath(match.group(1))

                            if file_path_in_marker == unit_path:
                                in_relevant_context = True
                            elif match.group(1).startswith("vcast_preprocess"):
                                in_relevant_context = False
                        elif in_relevant_context:
                            snippet_lines.append(line)

                    if snippet_lines:
                        context += "\n" + "".join(snippet_lines)

            # Add unit name to context
            context = f"// {unit_name}.c(pp)\n" + context

            # Cache the context
            self.cache[function_name] = context

        return context
