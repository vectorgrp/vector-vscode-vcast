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
    { "identifier": "unit.subprogram.parameter", "value": "42" }
    { "identifier": "unit.subprogram.parameter", "value": "84" }

#### Structure Types
- Use the standard C syntax to refer to fields within structures.
  - Example:
    { "identifier": "unit.subprogram.struct_param.field", "value": "CAESAR" }
    { "identifier": "unit.subprogram.struct_param.field", "value": "STEAK" }
- In case you are accessing the field of a structure pointer, dereference it using `*`. The `->` operator is NEVER valid syntax.
  - Example:
    { "identifier": "unit.subprogram.*struct_pointer.field", "value": "'b'" }
    instead of
    { "identifier": "unit.subprogram.struct_pointer->field", "value": "'b'" }

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
    { "identifier": "unit.subprogram.array_param[2]", "value": "42" }
- For unconstrained arrays, use `<<malloc [amount as integer]>>` to allocate memory.
  - Example:
    { "identifier": "unit.subprogram.array_param[]", "value": "<<malloc 2>>" }
    { "identifier": "unit.subprogram.array_param[1]", "value": "3" }
- For pointers, use index 0 to access it
  - Example:
    { "identifier": "unit.subprogram.ptr_param[0]", "value": "12" }
- If you want to make something null then use `<<null>>`.
  - Example:
    { "identifier": "unit.subprogram.pointer_param[0]", "value": "<<null>>" }

#### Function Return Parameters
- Use the keyword `return` for function return values.
  - Example:
    { "identifier": "unit.subprogram.return", "value": "23.0" }

#### Global Objects
- Use the syntax `UNIT.<<GLOBAL>>.OBJECT` to set values for global objects.
  - Example:
    { "identifier": "unit.<<GLOBAL>>.global_object.field", "value": "VALUE" }
- Note: `UNIT.OBJECT` is NEVER valid syntax

##### Classes
- To set and expect values of methods in a class (unlike standalone subprograms), it is necessary to first instantiate a base object using a constructor
- Use the syntax `UNIT.<<GLOBAL>>.(cl).CLASS_NAME.SUBCLASS_NAME.<<constructor>>.<<call>>` to call the constructor of `SUBCLASS` to instantiate a `CLASS` object
  - Example:
    { "identifier": "unit.<<GLOBAL>>.(cl).class_name.class_name.<<constructor>>.<<call>>", "value": "0" }
  - Note: The value in this case is irrelevant and always set to 0.
- To set and expect member variables of a constructed object use the syntax `UNIT.<<GLOBAL>>.(cl).CLASS_NAME.SUBCLASS_NAME.MEMBER_NAME`
  - Example:
    { "identifier": "unit.<<GLOBAL>>.(cl).class_name.class_name.member", "value": "test" }
  - Note: If the member is a structured entity like a struct or a class instance you can access the subfields like described in the `Structure Types` section.
- To set and expect arguments and return values of methods in a class use the name do so like you would for regular subprograms except that you prefix the name with the class name and `::`
  - Example:
    { "identifier": "unit.class_name::member_method.parameter", "value": "2" }
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
    { "identifier": "unit.subprogram(int).parameter", "value": "3" }
    { "identifier": "unit.subprogram(char).parameter", "value": "'d'" }

#### Boolean Values
- Use `1` for `true` and `0` for `false`.
  - Example:
    { "identifier": "unit.subprogram.boolean_param", "value": "1" }
    { "identifier": "unit.subprogram.boolean_param", "value": "0" }

#### Accessing Subprograms Outside the Unit
- Use `uut_prototype_stubs` as the unit for subprograms defined outside of the unit of the test case.
  - Example:
    { "identifier": "uut_prototype_stubs.name_of_external_subprogram.parameter", "value": "42" }

#### Emulating stubbed pointer manipulating functions
- Normally it is easy to emulate a stubbed function returning some value (by setting the return value of the stubbed function)
- This is not possible if the stubbed function works with pointers as only values can be specified (so only ever the contents of a pointer), e.g., functions like memcpy
- Therefore, in these cases you can emulate the stubbed function setting the contents of the pointer using <<pointer value_to_set>>
  - For example assume we have a pointer input variable *float x that is modified by a stubbed called to foo(*float pointer_to_modify), i.e., foo(x). Then you can change the value, i.e., *x to 10 like so:
    { "identifier": "uut_prototype_stubs.foo.pointer_to_modify", "value": "<<pointer 10>>" }
  - The other input values of the function of course do not need to be specified explicitly (unless you also want to see the values of those input pointers)
- You can only set one variable like this per test case due to technical reasons so choose wisely (if you use this feature)

#### Emulating multiple function calls
- Use the multiple value syntax, one value will be read everytime the stubbed function is called
  - Example (foo is called twice, and should return 2 the first time and 3 the second):
    { "identifier": "uut_prototype_stubs.foo.return", "value": "2,3" }

## Test Case Execution
1. The test framework will call the specified subprogram/function
2. When a value of a variable would be read, if it is specified as a test value, it is set to that value instead
3. After the subprogram finishes, the expected values are checked against the actual values at that point

- All tests are executed in isolation. The execution of one test does not influence the execution of others.
- Unless a function is called inside the checked subprogram their identifiers are not updated and should not be used as expected values.
- All function calls from external files, i.e, those referenced with `uut_prototype_stubs` are stubbed and do not implement any behaviour. Setting their input values has no effect on their output values (instead default values are output unless you specify values for them).
- If the return value of a called function is set as an input, the function will be stubbed during execution and not implement any behaviour. In this case it is forbidden to also expect the return value to equal something (it won't as the function will be stubbed). If necessary for pointer-related work: Look for global variables to access what you need instead
- In general any value not set (input of course), will fall back to a default value. However this should be avoided to prevent undefined behaviour. This means all input variables (and outputs of stubbed values) should be exhaustively described.
- In particular, to access methods of a class and set values it is imperative to first instantiate the class using a constructor. For all classes a default object is ready to be initialized if needed using the respective constructor.
- Do not set an identifier multiple times, it just results in overriding of the previous value
- It is currently hard/impossible to test values written to pointers. If you encounter them, fall back to testing simpler partial things like return values (or just specifying no expected values)

## Examples

Let's consider a more complex C++ code snippet in a file named `data_processor.cpp`:

```cpp
// File: data_processor.cpp
// Unit: data_processor

typedef struct {
    int id;
    float value;
    char status;
} DataRecord;

typedef enum {
    MODE_NORMAL = 0,
    MODE_DEBUG = 1,
    MODE_ERROR = 2
} ProcessingMode;

// External function declarations
extern int validate_record(DataRecord* record);
extern void log_error(const char* message);
extern DataRecord* allocate_buffer(int size);

ProcessingMode current_mode = MODE_NORMAL;

int process_data_array(DataRecord* input_array, int array_size, DataRecord** output_array) {
    if (input_array == NULL || array_size <= 0) {
        if (current_mode == MODE_DEBUG) {
            log_error("Invalid input parameters");
        }
        return -1;
    }
    
    // Allocate output buffer
    *output_array = allocate_buffer(array_size);
    if (*output_array == NULL) {
        log_error("Memory allocation failed");
        return -2;
    }
    
    int processed_count = 0;
    for (int i = 0; i < array_size; i++) {
        // Validate each record using external function
        int validation_result = validate_record(&input_array[i]);
        
        if (validation_result > 0) {
            // Copy valid record to output with modified value
            (*output_array)[processed_count].id = input_array[i].id;
            (*output_array)[processed_count].value = input_array[i].value * 1.5f;
            (*output_array)[processed_count].status = 'V'; // Valid
            processed_count++;
        } else if (current_mode == MODE_ERROR) {
            // In error mode, stop processing on first invalid record
            log_error("Invalid record encountered in error mode");
            return processed_count;
        }
        // In normal mode, skip invalid records and continue
    }
    
    return processed_count;
}
```

### Example 1: Testing Null Input Handling with Branching

**Requirement REQ-DP-001:** The `process_data_array` function shall return -1 when input_array is NULL and log an error message if in DEBUG mode.

```json
{
  "test_name": "Test_Null_Input_Debug_Mode",
  "test_description": "Tests process_data_array with NULL input in DEBUG mode to ensure it returns -1 and calls log_error.",
  "requirement_id": "REQ-DP-001",
  "unit_name": "data_processor",
  "subprogram_name": "process_data_array",
  "input_values": [
    { "identifier": "data_processor.<<GLOBAL>>.current_mode", "value": "MODE_DEBUG" },
    { "identifier": "data_processor.process_data_array.input_array", "value": "<<null>>" },
    { "identifier": "data_processor.process_data_array.array_size", "value": "5" },
  ],
  "expected_values": [
    { "identifier": "uut_prototype_stubs.log_error.message", "value": "\"Invalid input parameters\"" },
    { "identifier": "data_processor.process_data_array.return", "value": "-1" }
  ]
}
```

### Example 2: Testing Memory Allocation with Stubbing

**Requirement REQ-DP-002:** The `process_data_array` function shall return -2 and log an error when memory allocation fails.

```json
{
  "test_name": "Test_Memory_Allocation_Failure",
  "test_description": "Tests process_data_array when allocate_buffer returns NULL to ensure proper error handling.",
  "requirement_id": "REQ-DP-002",
  "unit_name": "data_processor",
  "subprogram_name": "process_data_array",
  "input_values": [
    { "identifier": "data_processor.<<GLOBAL>>.current_mode", "value": "MODE_NORMAL" },
    { "identifier": "data_processor.process_data_array.input_array", "value": "<<malloc 1>>" },
    { "identifier": "data_processor.process_data_array.input_array[0].id", "value": "1" },
    { "identifier": "data_processor.process_data_array.input_array[0].value", "value": "10.5" },
    { "identifier": "data_processor.process_data_array.input_array[0].status", "value": "'A'" },
    { "identifier": "data_processor.process_data_array.array_size", "value": "2" },
    { "identifier": "uut_prototype_stubs.allocate_buffer.return", "value": "<<null>>" },
  ],
  "expected_values": [
    { "identifier": "uut_prototype_stubs.log_error.message", "value": "\"Memory allocation failed\"" },
    { "identifier": "data_processor.process_data_array.return", "value": "-2" }
  ]
}
```

### Example 3: Testing Complex Processing with Multiple Stubs

**Requirement REQ-DP-003:** The `process_data_array` function shall process valid records by multiplying their values by 1.5 and setting status to 'V'.

```json
{
  "test_name": "Test_Valid_Record_Processing",
  "test_description": "Tests process_data_array with mixed valid/invalid records to ensure proper processing and output.",
  "requirement_id": "REQ-DP-003",
  "unit_name": "data_processor",
  "subprogram_name": "process_data_array",
  "input_values": [
    { "identifier": "data_processor.<<GLOBAL>>.current_mode", "value": "MODE_NORMAL" },
    { "identifier": "data_processor.process_data_array.input_array", "value": "<<malloc 3>>" },
    { "identifier": "data_processor.process_data_array.input_array[0].id", "value": "100" },
    { "identifier": "data_processor.process_data_array.input_array[0].value", "value": "20.0" },
    { "identifier": "data_processor.process_data_array.input_array[0].status", "value": "'A'" },
    { "identifier": "data_processor.process_data_array.input_array[1].id", "value": "200" },
    { "identifier": "data_processor.process_data_array.input_array[1].value", "value": "30.0" },
    { "identifier": "data_processor.process_data_array.input_array[1].status", "value": "'B'" },
    { "identifier": "data_processor.process_data_array.input_array[2].id", "value": "300" },
    { "identifier": "data_processor.process_data_array.input_array[2].value", "value": "40.0" },
    { "identifier": "data_processor.process_data_array.input_array[2].status", "value": "'C'" },
    { "identifier": "data_processor.process_data_array.array_size", "value": "3" },
    { "identifier": "data_processor.process_data_array.output_array[0]", "value": "<<malloc 3>>" },
    { "identifier": "uut_prototype_stubs.validate_record.return", "value": "1,0,1" }
  ],
  "expected_values": [
    { "identifier": "data_processor.process_data_array.return", "value": "2" },
    { "identifier": "data_processor.process_data_array.output_array[0][0].id", "value": "100" },
    { "identifier": "data_processor.process_data_array.output_array[0][0].value", "value": "30.0" },
    { "identifier": "data_processor.process_data_array.output_array[0][0].status", "value": "'V'" },
    { "identifier": "data_processor.process_data_array.output_array[0][1].id", "value": "300" },
    { "identifier": "data_processor.process_data_array.output_array[0][1].value", "value": "60.0" },
    { "identifier": "data_processor.process_data_array.output_array[0][1].status", "value": "'V'" }
  ]
}
```

### Example 4: Testing Error Mode with Early Termination

**Requirement REQ-DP-004:** The `process_data_array` function shall stop processing and return the current count when an invalid record is encountered in ERROR mode.

```json
{
  "test_name": "Test_Error_Mode_Early_Termination",
  "test_description": "Tests process_data_array in ERROR mode to ensure it stops processing on first invalid record.",
  "requirement_id": "REQ-DP-004",
  "unit_name": "data_processor",
  "subprogram_name": "process_data_array",
  "input_values": [
    { "identifier": "data_processor.<<GLOBAL>>.current_mode", "value": "MODE_ERROR" },
    { "identifier": "data_processor.process_data_array.input_array", "value": "<<malloc 3>>" },
    { "identifier": "data_processor.process_data_array.input_array[0].id", "value": "100" },
    { "identifier": "data_processor.process_data_array.input_array[0].value", "value": "20.0" },
    { "identifier": "data_processor.process_data_array.input_array[1].id", "value": "200" },
    { "identifier": "data_processor.process_data_array.input_array[1].value", "value": "30.0" },
    { "identifier": "data_processor.process_data_array.array_size", "value": "3" },
    { "identifier": "data_processor.process_data_array.output_array[0]", "value": "<<malloc 3>>" },
    { "identifier": "uut_prototype_stubs.allocate_buffer.size", "value": "3" },
    { "identifier": "uut_prototype_stubs.validate_record.return", "value": "1,-1" },
  ],
  "expected_values": [
    { "identifier": "uut_prototype_stubs.log_error.message", "value": "\"Invalid record encountered in error mode\"" },
    { "identifier": "data_processor.process_data_array.return", "value": "1" },
    { "identifier": "data_processor.process_data_array.output_array[0][0].id", "value": "100" },
    { "identifier": "data_processor.process_data_array.output_array[0][0].value", "value": "30.0" },
    { "identifier": "data_processor.process_data_array.output_array[0][0].status", "value": "'V'" }
  ]
}
```