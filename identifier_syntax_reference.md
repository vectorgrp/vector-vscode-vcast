## Test Case Format
The format of a test case is as follows:
{
    "unit_name": <unit_name>,
    "subprogram_name": <subprogram_name>,
    "input_values": [
        { "identifier": <identifier>, "value": <value> },
        ...
    ],
    "input_references": [
        { "identifier": <identifier>, "reference": <identifier> },
        ...
    ],
    "expected_values": [
        { "identifier": <identifier>, "value": <value> },
        ...
    ],
    "expected_references": [
        { "identifier": <identifier>, "reference": <identifier> },
        ...
    ]
}

### Identifier and Value Syntax
The following sections describe the syntax for specifying the `identifier` and `value` (or `reference`) fields in the test case format. `unit` and `subprogram` refer to file names of C files (without extension) and function names in these files respectively. Of course it is possible to include identifiers from different units and subprograms in the same test.

#### Numeric Types
- Assign the number directly.
  - Example:
    { "identifier": "unit.subprogram.parameter", "value": 42 }
    { "identifier": "unit.subprogram.parameter", "value": 84 }

#### Structure Types
- Use the standard C syntax to refer to fields within structures.
  - Example:
    { "identifier": "unit.subprogram.struct_param.field", "value": "CAESAR" }
    { "identifier": "unit.subprogram.struct_param.field", "value": "STEAK" }
- In case you are accessing the field of a structure pointer, dereference it using `*`. The `->` operator is NEVER valid syntax.
  - Example:
    { "identifier": "unit.subprogram.*struct_pointer.field", "value": 'b' }
    instead of
    { "identifier": "unit.subprogram.struct_pointer->field", "value": 'b' }

#### Enumeration Types
- Use the enumeral value directly.
  - Example:
    { "identifier": "unit.subprogram.enum_param", "value": "ENUM_VALUE" }

#### Character and String Types
- Use standard C delimiters for characters and strings.
  - Example:
    { "identifier": "unit.subprogram.char_param", "value": "'a'" }
    { "identifier": "unit.subprogram.string_param", "value": "\"Hello, World\"" }

#### Pointer and Array Types
- For constrained arrays, specify the index and value.
  - Example:
    { "identifier": "unit.subprogram.array_param[2]", "value": 42 }
- For unconstrained arrays, use `<<malloc [amount as integer]>>` to allocate memory.
  - Example:
    { "identifier": "unit.subprogram.array_param[]", "value": "<<malloc 2>>" }
    { "identifier": "unit.subprogram.array_param[1]", "value": 3 }
- For pointers, use the dereference operator.
  - Example:
    { "identifier": "unit.subprogram.*ptr_param[0]", "value": 12 }
- If you want to make something null then use `<<null>>`.
  - Example:
    { "identifier": "unit.subprogram.pointer_param", "value": "<<null>>" }

#### Function Return Parameters
- Use the keyword `RETURN` for function return values.
  - Example:
    { "identifier": "unit.subprogram.RETURN", "value": 23.0 }

#### Global Objects
- Use the syntax `UNIT.<<GLOBAL>>.OBJECT` to set values for global objects.
  - Example:
    { "identifier": "unit.<<GLOBAL>>.global_object.field", "value": "VALUE" }
- Note: `UNIT.OBJECT` is NEVER valid syntax

#### Range of Values for Input Data
- Use range expressions to test a range of values.
  - Example:
    { "identifier": "unit.subprogram.parameter", "value": "vary from: 0.0 to: 90.0 by: 0.1" }

#### Range of Values for Expected Results
- Use the syntax `<min> .. <max>` for expected value ranges.
  - Example:
    { "identifier": "unit.subprogram.parameter", "value": "257.1 .. 259.9" }

#### List of Values
- Use a comma-separated list for multiple values.
  - Example:
    { "identifier": "unit.subprogram.parameter", "value": "1,2,4" }
- Use parentheses for repeated values.
  - Example:
    { "identifier": "unit.subprogram.parameter", "value": "1,(4)2,4" }

#### Test Values Spanning Multiple Lines
- Use the continuation character `\` to span values across multiple lines.
  - Example:
    { "identifier": "unit.subprogram.parameter", "value": "Value1,Value2,\\\nValue3,Value4" }

#### Working with Overloaded Subprograms
- Append the parameter type list to the subprogram name.
  - Example:
    { "identifier": "unit.subprogram(int).parameter", "value": 3 }
    { "identifier": "unit.subprogram(char).parameter", "value": "'d'" }

#### Boolean Values
- Use `1` for `true` and `0` for `false`.
  - Example:
    { "identifier": "unit.subprogram.boolean_param", "value": 1 }
    { "identifier": "unit.subprogram.boolean_param", "value": 0 }

#### Accessing Subprograms Outside the Unit
- Use `uut_prototype_stubs` as the unit for subprograms defined outside of the unit of the test case.
  - Example:
    { "identifier": "uut_prototype_stubs.name_of_external_subprogram.parameter", "value": 42 }

#### References to Other Identifiers
- Use the `reference` field to reference another identifier's value instead of setting a value directly
  - Example:
    { "identifier": "unit.subprogram.parameter", "reference": "unit.other_subprogram.other_parameter" }
- This is useful in test cases consisting of multiple parts to set the input values of the next test part based on output values of the previous ones
- In case you want to set the value of an identifier to that of another identifier you MUST use a reference. It is not possible to refer to variables in the `value` field
  - Example:
    { "identifier": "unit.subprogram.parameter", "reference": "unit.other_subprogram.other_parameter" }
    instead of
    { "identifier": "unit.subprogram.parameter", "value": "unit.other_subprogram.other_parameter" }
- In case you want to set the value of an identifier to a computation involving an identifier, you cannot do so.