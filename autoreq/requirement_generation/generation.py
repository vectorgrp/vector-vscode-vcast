from typing import List, Dict, Any, Set, Tuple
from pydantic import BaseModel, create_model

from ..llm_client import LLMClient
from ..test_generation.vcast_context_builder import VcastContextBuilder

class DesignDecompositionResult(BaseModel):
    requirements: List[str]

    @property
    def with_requirement_indices(self):
        return DesignDecompositionResult(
            requirements=[f"Requirement {i + 1}: {req}" for i, req in enumerate(self.without_requirement_indices.requirements)]
        )

    @property
    def without_requirement_indices(self):
        return DesignDecompositionResult(
            requirements=[req.split(":", 1)[1].strip() if ":" in req else req for req in self.requirements]
        )

class DesignDecompositionResultWithTestcases(BaseModel):
    test_cases: List[str]
    requirements: List[str]

    @property
    def without_tests(self):
        return DesignDecompositionResult(
            requirements=self.requirements
        )

class SemanticPart(BaseModel):
    line_numbers: List[int]

class SemanticPartsResponse(BaseModel):
    semantic_parts: List[SemanticPart]

def _derive_requirement_schema(num_parts):
    """Creates a dynamic schema that forces exactly one requirement per semantic part."""
    
    class TestCase(BaseModel):
        description: str

    class Requirement(BaseModel):
        statement: str

    # Create fields for each semantic part
    result_keys = {
        f"test_case_for_part_{i+1}": (TestCase, ...) for i in range(num_parts)
    }
    result_keys.update({
        f"requirement_for_part_{i+1}": (Requirement, ...) for i in range(num_parts)
    })

    return create_model('RequirementGenerationResult', **result_keys)

def _batch_items(items, batch_size=50):
    for i in range(0, len(items), batch_size):
        yield items[i:i+batch_size]

class RequirementsGenerator:
    def __init__(self, environment, code_independence: bool = False, extended_reasoning: bool = False):
        self.llm_client = LLMClient()
        self.environment = environment
        self.code_independence = code_independence
        self.extended_reasoning = extended_reasoning
        self.context_builder = VcastContextBuilder(environment)

    def _post_process_semantic_parts(self, function_name: str, semantic_parts: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Post-process semantic parts to ensure they follow control flow structure rules."""
        # Get function body as bytes for tree-sitter
        function_body = self.environment.tu_codebase.find_definitions_by_name(function_name)[0]
        function_bytes = function_body.encode('utf-8')
        
        # Get executable statement groups from AST
        executable_groups = self._get_executable_statement_groups(function_bytes)
        
        # Print control flow information
        """
        print("\n======== CONTROL FLOW INFORMATION ========")
        print(f"\nExecutable statement groups:")
        for i, group in enumerate(executable_groups):
            print(f"  Group {i+1}: {sorted(group)}")
        """
        
        # Create a set of all lines in executable groups for easy lookup
        executable_lines = set()
        for group in executable_groups:
            executable_lines.update(group)
        
        processed_parts = []
        
        # Process each semantic part
        for part in semantic_parts:
            line_numbers = part["line_numbers"]
            
            # Filter out lines that aren't in any executable group
            line_numbers = [ln for ln in line_numbers if ln in executable_lines]
            if not line_numbers:
                continue  # Skip empty parts
                
            # Distribute lines into their respective executable groups
            result_parts = []
            for group in executable_groups:
                # Find lines that belong to this group
                group_lines = [ln for ln in line_numbers if ln in group]
                if group_lines:
                    result_parts.append(sorted(group_lines))
            
            # Add each group as a separate semantic part
            for group_lines in result_parts:
                # Get the corresponding code lines
                code_lines = function_body.split('\n')
                part_lines = [code_lines[ln-1] for ln in group_lines if 0 < ln <= len(code_lines)]
                
                if part_lines:  # Only add non-empty parts
                    processed_parts.append({
                        "line_numbers": group_lines,
                        "lines": part_lines
                    })
        
        return processed_parts

    def _get_executable_statement_groups(self, code_bytes: bytes) -> List[List[int]]:
        """
        Extract executable statement groups from code using tree-sitter.
        Returns a list of lists, where each inner list contains line numbers of statements
        that belong to the same execution path.
        """
        ts_parser = self.environment.tu_codebase.ts_parser
        tree = ts_parser.parse(code_bytes)
        root_node = tree.root_node
        
        # Function to collect statements by execution path
        def collect_statements(node):
            if node.type in ('comment', 'preprocessor_directive', 'string_literal'):
                return None

            # Check if this is a statement that should be collected
            if node.type in ('expression_statement', 'declaration', 'return_statement',
                           'break_statement', 'continue_statement', 'assignment_expression'):
                # Add the line number to the current group
                line_number = node.start_point[0] + 1  # Convert to 1-based indexing
                return line_number
                
            # Check if this is a control flow node that creates new execution paths
            if node.type in ('if_statement', 'for_statement', 'while_statement', 'switch_statement',
                           'do_statement', 'case_statement'):
                
                # Find the condition part to skip it
                condition = None
                if node.type in ('if_statement', 'for_statement', 'while_statement', 'switch_statement'):
                    condition = next((child for child in node.children 
                                    if child.type in ('condition', 'for_condition')), None)
                
                groups = []
                # Process each branch/body as a separate execution path
                for child in node.children:
                    # Skip conditions
                    if child == condition:
                        continue
                        
                    # Handle compound statements (blocks)
                    if child.type in ('compound_statement', 'statement_block', 'else_clause'):
                        # Process contents of the block
                        for block_child in child.children:
                            if block_child.type != '{' and block_child.type != '}':
                                groups.append(collect_statements(block_child))
                    # Handle individual statements (non-block branches)
                    elif child.type not in ('(', ')', '{', '}', 'condition', 'for_condition'):
                        # Create a new group for single statement branches
                        groups.append(collect_statements(child))

                return groups
            
            # For case statements in switch
            if node.type == 'case_statement':
                # Create a separate group for each case
                case_group = []
                
                # Process the case body (skip the case label)
                for i, child in enumerate(node.children):
                    # Skip the case label/condition
                    if i == 0:
                        continue
                    case_group.append(collect_statements(child, case_group))

                return case_group
                
            groups = []
            # Recursively process other nodes
            for child in node.children:
                # Check if this child is a condition part
                groups.append(collect_statements(child))

            return groups

        # Start processing from the root
        executable_groups = collect_statements(root_node)

        def to_flat_groups(nested_groups):
            groups = []
            last_was_list = False
            for item in nested_groups:
                if item is None:
                    continue
                elif isinstance(item, list):
                    groups.extend(to_flat_groups(item))
                    last_was_list = True
                else:
                    if len(groups) == 0 or last_was_list:
                        groups.append([])

                    groups[-1].append(item)
                    last_was_list = False

            return groups

        # Return the groups, filtering out empty ones
        return to_flat_groups(executable_groups)

    async def extract_semantic_parts_only_ast(self, function_name: str) -> List[Dict[str, Any]]:
        function_body = self.environment.tu_codebase.find_definitions_by_name(function_name)[0]
        function_bytes = function_body.encode('utf-8')

        code_lines = function_body.split('\n')
        
        # Get executable statement groups from AST
        executable_groups = self._get_executable_statement_groups(function_bytes)

        # Convert line numbers back to actual code lines
        semantic_parts = []
        for part in executable_groups:
            # Subtract 1 from line numbers since we displayed them 1-based but need 0-based indexing
            part_lines = [code_lines[i-1] for i in part if 0 < i <= len(code_lines)]
            semantic_parts.append({
                "line_numbers": part,
                "lines": part_lines
            })

        return semantic_parts

    async def extract_semantic_parts(self, function_name: str) -> List[Dict[str, Any]]:
        """Extract semantic parts from function code."""
        # Get just the function definition, not the full context
        function_body = self.environment.tu_codebase.find_definitions_by_name(function_name)[0]
        
        # Add line numbers to code
        code_lines = function_body.split('\n')
        numbered_code = '\n'.join(f"{i+1}: {line}" for i, line in enumerate(code_lines))
        
        prompt = f"""
Split the contents of the following function body into semantic parts that belong together in terms of functionality.

Return your answer in the following format:
```json
{{
    "semantic_parts": [
        {{ "line_numbers": [1, 2, 3] }},
        {{ "line_numbers": [4] }},
        ...
    ]
}}
```

Follow the following additional rules:
- Reference lines by their line numbers only
- Ignore trivial lines, e.g, just comments, brackets, whitespace or similar
- Ensure that each part is a cohesive set of related behaviors
- All non-trivial lines should be covered

Here is the numbered code:
```c
{numbered_code}
```
"""

        response = await self.llm_client.call_model([{
            "role": "user",
            "content": prompt
        }], SemanticPartsResponse)

        
        # Convert line numbers back to actual code lines
        semantic_parts = []
        for part in response.semantic_parts:
            # Subtract 1 from line numbers since we displayed them 1-based but need 0-based indexing
            part_lines = [code_lines[i-1] for i in part.line_numbers if 0 < i <= len(code_lines)]
            semantic_parts.append({
                "line_numbers": part.line_numbers,
                "lines": part_lines
            })
        
        # Print semantic parts before post-processing
        """
        print("\n======== SEMANTIC PARTS BEFORE POST-PROCESSING ========")
        for i, part in enumerate(semantic_parts):
            print(f"\nPart {i+1}:")
            print(f"  Line numbers: {part['line_numbers']}")
            print(f"  Code:")
            for line in part['lines']:
                print(f"    {line}")
        """
        
        # Post-process semantic parts using AST analysis
        processed_parts = self._post_process_semantic_parts(function_name, semantic_parts)
        
        # Print semantic parts after post-processing
        """
        print("\n======== SEMANTIC PARTS AFTER POST-PROCESSING ========")
        for i, part in enumerate(processed_parts):
            print(f"\nPart {i+1}:")
            print(f"  Line numbers: {part['line_numbers']}")
            print(f"  Code:")
            for line in part['lines']:
                print(f"    {line}")
        """
        
        return processed_parts

    async def generate(self, function_name: str):
        """Generate requirements based on function name."""
        # Get the function body
        function_body = self.environment.tu_codebase.find_definitions_by_name(function_name)[0]
        
        # Get the full context using context builder
        function_context = await self.context_builder.build_code_context(function_name)
        
        # Extract semantic parts using just the function body
        semantic_parts = await self.extract_semantic_parts(function_name)
        
        # Format semantic parts for prompt
        prettified_parts = []
        for i, part in enumerate(semantic_parts):
            index_prefix = f"{i+1}. "
            part_lines = "\n".join(part["lines"])
            part_lines_formatted = part_lines.split("\n")
            indented_part = part_lines_formatted[0] + "".join("\n" + " " * len(index_prefix) + line for line in part_lines_formatted[1:])
            prettified_parts.append(index_prefix + indented_part)

        available_parts = "\n".join(prettified_parts) if prettified_parts else "Only one semantic part was identified in the code."
        num_parts = len(semantic_parts) if semantic_parts else 1

        messages = [
            {
                "role": "system",
                "content": "You are a world-class software engineer that does requirements engineering for a living."
            },
            {
                "role": "user",
                "content": f"""
Derive a complete list of test cases for the given function definition (give them in natural language). These test cases should give us 100% coverage of the code.
After that derive a complete list of requirements for the given function definition. Use completely implementation-independent vocabulary. A requirement is a single, complete, and testable statement of the expected behaviour of a single semantic part of the code.

Here are some examples:

Example 1:
```c
float calculate_discount(float total_amount, bool is_member) {{
    if (total_amount < 0) {{
        return -1.0;  // Error case
    }}
    if (is_member) {{
        return total_amount * 0.9;
    }}
    return total_amount;
}}
```
Test cases:
1. Test with negative total amount
2. Test with member status and positive amount
3. Test with non-member status and positive amount

Requirements:
1. The system shall return an error indicator when the total amount is negative
2. The system shall apply a 10% discount when calculating the final amount for members
3. The system shall return the original amount without modification for non-members

Example 2:
```c
bool validate_password(const char* password) {{
    if (password == NULL) {{
        return false;
    }}
    if (strlen(password) < 8) {{
        return false;
    }}
    bool has_uppercase = false;
    for (int i = 0; password[i] != '\0'; i++) {{
        if (isupper(password[i])) {{
            has_uppercase = true;
            break;
        }}
    }}
    return has_uppercase;
}}
```
Test cases:
1. Test with NULL password pointer
2. Test with password shorter than 8 characters
3. Test with password of 8+ characters but no uppercase letter
4. Test with password of 8+ characters including uppercase letter

Requirements:
1. The system shall reject invalid password pointers
2. The system shall reject passwords that are less than 8 characters in length
3. The system shall reject passwords that do not contain at least one uppercase letter
4. The system shall accept passwords that are at least 8 characters long and contain at least one uppercase letter


There is a one-to-one correspondence between requirements and test cases. Make sure each semantic part of the code is covered by exactly one test case and one requirement.

Requirements should fulfill the following criteria:
— Necessary. The requirement defines an essential capability, characteristic, constraint and/or quality factor. If it is not included in the set of requirements, a deficiency in capability or characteristic will exist, which cannot be fulfilled by implementing other requirements. The requirement is currently applicable and has not been made obsolete by the passage of time. Requirements with planned expiration dates or applicability dates are clearly identified.
— Appropriate. The specific intent and amount of detail of the requirement is appropriate to the level of the entity to which it refers (level of abstraction appropriate to the level of entity). This includes avoiding unnecessary constraints on the architecture or design while allowing implementation independence to the extent possible.
— Unambiguous. The requirement is stated in such a way so that it can be interpreted in only one way.  The requirement is stated simply and is easy to understand.
— Complete. The requirement sufficiently describes the necessary capability, characteristic, constraint or quality factor to meet the entity need without needing other information to understand the requirement. This means it should be possible to implement the function based on the set of requirements without needing additional information.
— Singular. The requirement states a single capability, characteristic, constraint or quality factor.
— Feasible. The requirement can be realized within system constraints (e.g., cost, schedule, technical) with acceptable risk.
— Verifiable. The requirement is structured and worded such that its realization can be proven (verified) to the customer's satisfaction at the level the requirements exists. Verifiability is enhanced when the requirement is measurable.
— Correct. The requirement is an accurate representation of the entity need from which it was transformed.
— Conforming. The individual items conform to an approved standard template and style for writing requirements, when applicable.
{ "- Code independence. The requirements should not mention any code-specific terms like variable names, function names, etc." if self.code_independence else "" }

Return your answer in the following format:
```json
{{
    "test_case_for_part_1": {{ "description": "<test case for first part>" }},
    "requirement_for_part_1": {{ "statement": "<requirement for first part>" }},
    "test_case_for_part_2": {{ "description": "<test case for second part>" }},
    "requirement_for_part_2": {{ "statement": "<requirement for second part>" }},
    ...
}}
```

Code with context:
{function_context}

To assist you, here is a complete list of semantic parts of the code. For each one a test case and a requirement should be derived:
{available_parts}

The success of this task is critical. If you do not generate exactly one test case and requirement for each semantic part of the code, you have failed.
"""
            }
        ]

        if num_parts > 50:
            all_requirements = []
            for batch in _batch_items(semantic_parts):
                current_num_parts = len(batch)
                partial_prettified_parts = []
                for i2, part in enumerate(batch):
                    index_prefix = f"{i2+1}. "
                    part_lines = "\n".join(part["lines"])
                    part_lines_formatted = part_lines.split("\n")
                    indented_part = part_lines_formatted[0] + "".join("\n" + " " * len(index_prefix) + line for line in part_lines_formatted[1:])
                    partial_prettified_parts.append(index_prefix + indented_part)
                partial_available_parts = "\n".join(partial_prettified_parts)

                batch_messages = [msg.copy() for msg in messages]
                batch_messages[1]["content"] = batch_messages[1]["content"].replace(available_parts, partial_available_parts)
                
                partial_result = await self.llm_client.call_model(
                    messages=batch_messages,
                    schema=_derive_requirement_schema(current_num_parts),
                    temperature=0.0,
                    max_tokens=16000,
                    extended_reasoning=self.extended_reasoning
                )
                partial_requirements = [
                    getattr(partial_result, f"requirement_for_part_{i+1}").statement
                    for i in range(current_num_parts)
                ]
                all_requirements.extend(partial_requirements)
            requirements = all_requirements
        else:
            result = await self.llm_client.call_model(
                messages=messages,
                schema=_derive_requirement_schema(num_parts),
                temperature=0.0,
                max_tokens=16000,
                extended_reasoning=self.extended_reasoning
            )
            requirements = [
                getattr(result, f"requirement_for_part_{i+1}").statement
                for i in range(num_parts)
            ]

        return requirements

# TODO: Properly deal with removing for statements
# TODO: Switch to ast-only and include a "splitting step" where multisemantic requirements are split
# TODO: Similarly, filter out "trivial" requirements, e.g., describing only breaks
# TODO: Potentially  do not split groups at lists
# TODO: Add ... between non-adjacent lines