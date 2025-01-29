## Test Case Format
The format of a test case is as follows:
{
    "test_name": <some descriptive test name>,
    "test_description": <more details about the test>
    "requirement_id": <requirement being tested by this test> (optional)
    "unit_name": <unit_name>,
    "subprogram_name": <subprogram_name>,
    "input_values": [
        { "identifier": <identifier>, "value": <value> },
        ...
    ],
    "expected_values": [
        { "identifier": <identifier>, "value": <value> },
        ...
    ]
}

### Identifier and Value Syntax
The following sections describe the syntax for specifying the `identifier` and `value` fields in the test case format. `unit_name` and `subprogram_name` refer to file names of C/C++ files (without extension) and function names in these files respectively (to refer to methods in classes use `<class name>::<method name>`). It is only possible to include identifiers from different units and other subprograms if they are called/used in the subprogram being tested.

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

#### Local Function variables
- It is not possible to set the value of variables locally defined in the function (only its inputs and return value)
- However, it is possible that it is sometimes necessary:
  - If a local variable is supposed to be modified by a function called inside the tested subprogram (by reference), this does not work if the function is stubbed (for instance as is the case for an externally defined subprogram outside the current unit)
  - In this case you should set the value of the stub input variable to implicitly update the local variable along with it
  - Just setting a value directly will not work, instead we need to use a special variable construct only for this purpose called VECTORCAST_INT1
  - For example assume we have a local variable x that is modified by a stubbed called to foo(&x). Then you can change the value of x tp 10 like so:
    { "identifier": "USER_GLOBALS_VCAST.<<GLOBAL>>.VECTORCAST_INT1", "value": 10 }
    { "identifier": "uut_prototype_stubs.foo.x", "value": "VECTORCAST_INT1" }

#### Global Objects
- Use the syntax `UNIT.<<GLOBAL>>.OBJECT` to set values for global objects.
  - Example:
    { "identifier": "unit.<<GLOBAL>>.global_object.field", "value": "VALUE" }
- Note: `UNIT.OBJECT` is NEVER valid syntax

##### Classes
- To set and expect values of methods in a class (unlike standalone subprograms), it is necessary to first instantiate a base object using a constructor
- Use the syntax `UNIT.<<GLOBAL>>.(cl).CLASS_NAME.SUBCLASS_NAME.<<constructor>>.<<call>>` to call the constructor of `SUBCLASS` to instantiate a `CLASS` object
  - Example:
    { "identifier": "unit.<<GLOBAL>>.(cl).class_name.class_name.<<constructor>>.<<call>>", "value": 0 }
  - Note: The value in this case is irrelevant and always set to 0.
- To set and expect member variables of a constructed object use the syntax `UNIT.<<GLOBAL>>.(cl).CLASS_NAME.SUBCLASS_NAME.MEMBER_NAME`
  - Example:
    { "identifier": "unit.<<GLOBAL>>.(cl).class_name.class_name.member", "value": "test" }
  - Note: If the member is a structured entity like a struct or a class instance you can access the subfields like described in the `Structure Types` section.
- To set and expect arguments and return values of methods in a class use the name do so like you would for regular subprograms except that you prefix the name with the class name and `::`
  - Example:
    { "identifier": "unit.class_name::member_method.parameter", "value": 2 }
  - Note: If you use this ALWAYS first call the class constructor!

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
- Note: This is used in case something needs to be set multiple times (like for a stub return) during one call, NOT to specify values in an array. To do so, use the regular index syntax as outlined above instead.

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

## Test Case Execution
1. The test framework will call the specified subprogram/function
2. When a value of a variable would be read, if it is specified as a test value, it is set to that value instead
3. After the subprogram finishes, the expected values are checked against the actual values at that point

- All tests are executed in isolation. The execution of one test does not influence the execution of others.
- Unless a function is called inside the checked subprogram their identifiers are not updated and should not be used as expected values.
- All function calls from external files, i.e, those referenced with `uut_prototype_stubs` are stubbed and do not implement any behaviour. Setting their input values has no effect on their output values (instead default values are output unless you specify values for them).
- In general any value not set (input of course), will fall back to a default value. However this should be avoided to prevent undefined behaviour. This means all input variables (and outputs of stubbed values) should be exhaustively described.
- If the RETURN value of a called function is set as an input, the function will be stubbed during execution and not implement any behaviour.
- In particular, to access methods of a class and set values it is imperative to first instantiate the class using a constructor. For all classes a default object is ready to be initialized if needed using the respective constructor.

