"""
Unit tests for get_executable_statement_groups function.
Tests various edge cases and code structures systematically.
"""

from autoreq.util import get_executable_statement_groups


class TestGetExecutableStatementGroups:
    """Test class for get_executable_statement_groups function."""

    def test_simple_expression_statement(self):
        """Test with a single expression statement."""
        code = """
        int main() {
            x = 5;
        }
        """
        groups = get_executable_statement_groups(code)

        assert len(groups) == 1
        assert len(groups[0].line_numbers) == 1
        assert "x" in groups[0].symbols
        assert groups[0].path == []

    def test_multiple_expression_statements(self):
        """Test with multiple expression statements in sequence."""
        code = """
        int main() {
            x = 5;
            y = 10;
            z = x + y;
        }
        """
        groups = get_executable_statement_groups(code)

        assert len(groups) == 1  # Should be grouped together as same path
        assert len(groups[0].line_numbers) == 3
        assert all(symbol in groups[0].symbols for symbol in ["x", "y", "z"])
        assert groups[0].path == []

    def test_return_statement(self):
        """Test with return statement."""
        code = """
        int main() {
            return 42;
        }
        """
        groups = get_executable_statement_groups(code)

        assert len(groups) == 1
        assert len(groups[0].line_numbers) == 1
        assert groups[0].path == []

    def test_throw_statement(self):
        """Test with throw statement."""
        code = """
        void func() {
            throw std::exception();
        }
        """
        groups = get_executable_statement_groups(code)

        assert len(groups) == 1
        assert len(groups[0].line_numbers) == 1
        assert groups[0].path == []

    def test_simple_if_statement(self):
        """Test with simple if statement."""
        code = """
        int main() {
            if (x > 0) {
                printf("positive");
            }
        }
        """
        groups = get_executable_statement_groups(code)

        assert len(groups) == 1
        assert "IF (x > 0) ==> TRUE" in groups[0].path[0]
        assert "printf" in groups[0].symbols

    def test_if_else_statement(self):
        """Test with if-else statement."""
        code = """
        int main() {
            if (x > 0) {
                printf("positive");
            } else {
                printf("not positive");
            }
        }
        """
        groups = get_executable_statement_groups(code)

        assert len(groups) == 2

        # Check that one group is for the if branch and one for the else branch
        paths = [group.path[0] for group in groups]
        assert any("TRUE" in path for path in paths)
        assert any("FALSE" in path for path in paths)

    def test_nested_if_statements(self):
        """Test with nested if statements."""
        code = """
        int main() {
            if (x > 0) {
                if (y > 0) {
                    printf("both positive");
                }
            }
        }
        """
        groups = get_executable_statement_groups(code)

        assert len(groups) == 1
        assert len(groups[0].path) == 2  # Two levels of nesting
        assert "TRUE" in groups[0].path[0]
        assert "TRUE" in groups[0].path[1]

    def test_while_loop(self):
        """Test with while loop."""
        code = """
        int main() {
            while (i < 10) {
                i++;
            }
        }
        """
        groups = get_executable_statement_groups(code)

        assert len(groups) == 1
        assert "WHILE (i < 10) ==> TRUE" in groups[0].path[0]
        assert "i" in groups[0].symbols

    def test_for_loop(self):
        """Test with for loop."""
        code = """
        int main() {
            for (int i = 0; i < 10; i++) {
                printf("%d", i);
            }
        }
        """
        groups = get_executable_statement_groups(code)

        assert len(groups) == 1
        assert "FOR" in groups[0].path[0] and "TRUE" in groups[0].path[0]
        assert "i" in groups[0].symbols

    def test_do_while_loop(self):
        """Test with do-while loop."""
        code = """
        int main() {
            do {
                i++;
            } while (i < 10);
        }
        """
        groups = get_executable_statement_groups(code)

        assert len(groups) == 1
        assert "DO-WHILE (i < 10) ==> TRUE" in groups[0].path[0]
        assert "i" in groups[0].symbols

    def test_switch_statement(self):
        """Test with switch statement."""
        code = """
        int main() {
            switch (x) {
                case 1:
                    printf("one");
                    break;
                case 2:
                    printf("two");
                    break;
            }
        }
        """
        groups = get_executable_statement_groups(code)

        assert len(groups) == 2

        # Check that we have case-specific paths
        paths = [" ".join(group.path) for group in groups]
        assert any("CASE 1" in path for path in paths)
        assert any("CASE 2" in path for path in paths)

    def test_switch_with_default(self):
        """Test with switch statement including default case."""
        code = """
        int main() {
            switch (x) {
                case 1:
                    printf("one");
                    break;
                default:
                    printf("other");
                    break;
            }
        }
        """
        groups = get_executable_statement_groups(code)

        assert len(groups) == 2

        paths = [" ".join(group.path) for group in groups]
        assert any("CASE 1" in path for path in paths)
        assert any("DEFAULT" in path for path in paths)

    def test_empty_if_block(self):
        """Test with empty if block."""
        code = """
        int main() {
            if (x > 0) {
                // empty block
            }
        }
        """
        groups = get_executable_statement_groups(code)

        assert len(groups) == 0  # No executable statements

    def test_empty_if_block_with_virtual_groups(self):
        """Test with empty if block when virtual groups are enabled."""
        code = """
        int main() {
            if (x > 0) {
                // empty block
            }
        }
        """
        groups = get_executable_statement_groups(code, include_virtual_groups=True)

        assert len(groups) == 2  # Should have virtual groups for empty path and else

    def test_complex_nested_structure(self):
        """Test with complex nested control structures."""
        code = """
        int main() {
            if (x > 0) {
                for (int i = 0; i < x; i++) {
                    if (i % 2 == 0) {
                        printf("even: %d", i);
                    } else {
                        printf("odd: %d", i);
                    }
                }
            } else {
                printf("x is not positive");
            }
        }
        """
        groups = get_executable_statement_groups(code)

        assert len(groups) == 3  # Multiple execution paths

        # Check for various path combinations
        paths = [" ".join(group.path) for group in groups]
        assert any(
            "TRUE" in path and "FOR" in path and "TRUE" in path for path in paths
        )

    def test_complex_nested_structure_with_virtual_groups(self):
        """Test with complex nested control structures and virtual groups."""
        code = """
        int main() {
            if (x > 0) {
                for (int i = 0; i < x; i++) {
                    if (i % 2 == 0) {
                        printf("even: %d", i);
                    } else {
                        printf("odd: %d", i);
                    }
                }
            } else {
                printf("x is not positive");
            }
        }
        """
        groups = get_executable_statement_groups(code, include_virtual_groups=True)

        assert len(groups) == 4

    def test_multiline_statements(self):
        """Test with statements spanning multiple lines."""
        code = """
        int main() {
            printf("This is a very long string that spans "
                   "multiple lines for testing purposes");
        }
        """
        groups = get_executable_statement_groups(code)

        assert len(groups) == 1
        assert len(groups[0].line_numbers) == 2  # Should include multiple lines

    def test_mixed_statement_types(self):
        """Test with mixed statement types in sequence."""
        code = """
        int main() {
            x = 5;
            if (x > 0) {
                printf("positive");
                return x;
            }
            throw std::exception();
        }
        """
        groups = get_executable_statement_groups(code)

        assert len(groups) == 3  # Different paths should be separate groups

    def test_virtual_groups_if_without_else(self):
        """Test virtual groups for if statement without else."""
        code = """
        int main() {
            if (x > 0) {
                printf("positive");
            }
        }
        """
        groups = get_executable_statement_groups(code, include_virtual_groups=True)

        # Should have groups for both TRUE and FALSE paths
        assert len(groups) == 2
        paths = [" ".join(group.path) for group in groups]
        assert any("TRUE" in path for path in paths)
        assert any("FALSE" in path for path in paths)

    def test_virtual_groups_while_loop(self):
        """Test virtual groups for while loop."""
        code = """
        int main() {
            while (i < 10) {
                i++;
            }
        }
        """
        groups = get_executable_statement_groups(code, include_virtual_groups=True)

        # Should have groups for both loop entry and non-entry
        assert len(groups) == 2
        paths = [" ".join(group.path) for group in groups]
        assert any("TRUE" in path for path in paths)
        assert any("FALSE" in path for path in paths)

    def test_virtual_groups_for_loop(self):
        """Test virtual groups for for loop."""
        code = """
        int main() {
            for (int i = 0; i < 10; i++) {
                printf("%d", i);
            }
        }
        """
        groups = get_executable_statement_groups(code, include_virtual_groups=True)

        assert len(groups) == 2
        paths = [" ".join(group.path) for group in groups]
        assert any("TRUE" in path for path in paths)
        assert any("FALSE" in path for path in paths)

    def test_virtual_groups_switch_without_default(self):
        """Test virtual groups for switch without default case."""
        code = """
        int main() {
            switch (x) {
                case 1:
                    printf("one");
                    break;
                case 2:
                    break;
            }
        }
        """
        groups = get_executable_statement_groups(code, include_virtual_groups=True)

        assert len(groups) == 3
        paths = [" ".join(group.path) for group in groups]
        assert any("CASE 1" in path for path in paths)
        assert any("NO_MATCH" in path for path in paths)

    def test_symbol_extraction_identifiers(self):
        """Test that symbols are correctly extracted from statements."""
        code = """
        int main() {
            a = b + c.field;
            obj->method();
        }
        """
        groups = get_executable_statement_groups(code)

        assert len(groups) == 1

        # Check that various types of symbols are extracted
        symbols = groups[0].symbols
        assert "a" in symbols
        assert "b" in symbols
        assert "c" in symbols
        assert "field" in symbols
        assert "obj" in symbols
        assert "method" in symbols

    def test_symbol_extraction_complex_expressions(self):
        """Test symbol extraction from complex expressions."""
        code = """
        int main() {
            result = func(param1, param2) + array[index] * variable;
        }
        """
        groups = get_executable_statement_groups(code)

        assert len(groups) == 1

        symbols = groups[0].symbols
        expected_symbols = [
            "result",
            "func",
            "param1",
            "param2",
            "array",
            "index",
            "variable",
        ]
        for symbol in expected_symbols:
            assert symbol in symbols

    def test_condition_with_newlines(self):
        """Test conditions that span multiple lines."""
        code = """
        int main() {
            if (very_long_variable_name > 0 &&
                another_long_variable < 100) {
                printf("condition met");
            }
        }
        """
        groups = get_executable_statement_groups(code)

        assert len(groups) == 1

        # Condition should have newlines removed in path
        path_str = " ".join(groups[0].path)
        assert "\n" not in path_str

    def test_case_statement_default_handling(self):
        """Test handling of default case in switch statements."""
        code = """
        int main() {
            switch (x) {
                default:
                    printf("default case");
                    break;
            }
        }
        """
        groups = get_executable_statement_groups(code)

        assert len(groups) == 1
        path_str = " ".join(groups[0].path)
        assert "DEFAULT" in path_str

    def test_invalid_c_code(self):
        """Test with syntactically invalid C code."""
        code = """
        int main() {
            if (x > 0 {  // Missing closing parenthesis
                printf("test");
        """
        # Should not crash, even with invalid syntax
        groups = get_executable_statement_groups(code)
        # The function should handle this gracefully, though results may vary
        assert isinstance(
            groups, list
        )  # Just verify it returns a list without crashing

    def test_very_deeply_nested_structure(self):
        """Test with very deeply nested control structures."""
        code = """
        int main() {
            if (a) {
                if (b) {
                    if (c) {
                        if (d) {
                            if (e) {
                                printf("deeply nested");
                            }
                        }
                    }
                }
            }
        }
        """
        groups = get_executable_statement_groups(code)

        assert len(groups) == 1
        assert len(groups[0].path) == 5  # Five levels of nesting

    def test_multiple_functions(self):
        """Test with multiple function definitions."""
        code = """
        void func1() {
            x = 1;
        }
        
        void func2() {
            y = 2;
        }
        """
        groups = get_executable_statement_groups(code)

        assert len(groups) == 2  # Should have separate groups for each function

        # Each group should have its own statements
        all_symbols = []
        for group in groups:
            all_symbols.extend(group.symbols)
        assert "x" in all_symbols
        assert "y" in all_symbols

    def test_statements_before_and_after_control_structure(self):
        """Test statements before and after control structures."""
        code = """
        int main() {
            x = 1;
            if (condition) {
                y = 2;
            }
            z = 3;
        }
        """
        groups = get_executable_statement_groups(code)

        # Should have multiple groups due to different paths
        assert len(groups) == 3

        # Check that all variables are captured somewhere
        all_symbols = []
        for group in groups:
            all_symbols.extend(group.symbols)
        assert "x" in all_symbols
        assert "y" in all_symbols
        assert "z" in all_symbols

    def test_empty_function(self):
        """Test with empty function body."""
        code = """
        void empty_func() {
        }
        """
        groups = get_executable_statement_groups(code)
        assert groups == []

    def test_function_with_only_declarations(self):
        """Test with function containing only variable declarations."""
        code = """
        int main() {
            int x;
            char buffer[100];
            struct point p;
        }
        """
        groups = get_executable_statement_groups(code)

        assert len(groups) == 0

    def test_line_numbers_ordering(self):
        """Test that line numbers are correctly captured and ordered."""
        code = """
        int main() {
            first_statement();
            second_statement();
            third_statement();
        }
        """
        groups = get_executable_statement_groups(code)
        assert len(groups) == 1

        # Line numbers should be in ascending order
        line_numbers = groups[0].line_numbers
        assert line_numbers == sorted(line_numbers)
        assert len(line_numbers) == 3

    def test_statement_group_string_representation(self):
        """Test the string representation of statement groups."""
        code = """
        int main() {
            if (x > 0) {
                printf("test");
            }
        }
        """
        groups = get_executable_statement_groups(code)

        assert len(groups) == 1

        # Test that string representation works without crashing
        str_repr = str(groups[0])
        assert "Path:" in str_repr
        assert "Lines:" in str_repr
        assert "printf" in str_repr

    def test_statement_group_lines_property(self):
        """Test the lines property of statement groups."""
        code = """
        int main() {
            printf("hello world");
        }
        """
        groups = get_executable_statement_groups(code)

        assert len(groups) == 1

        lines = groups[0].lines
        assert len(lines) == 1
        assert "printf" in lines[0]
        assert "hello world" in lines[0]
