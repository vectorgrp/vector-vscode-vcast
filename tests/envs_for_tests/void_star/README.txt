--------------------------------------------------------------------------------

                                  VectorCAST/C
                                      and
                             Void* and Char* parameters 

Goal:

To show how VectorCAST handles void* and char* parameters for testable
functions with user code.

Description of the directory:

VOID_STAR.env        This is the environment script used to construct this
                     example environment. This script contains the usercode to
                     initialize 2 global variables: g_int_message and
                     g_float_message. One is a struct with an integer and the
                     other is a struct with a float. 
                     
VOID_STAR.tst        A test script containing test cases showing usercode
                     examples used to test the void* and char* parameters.

message.h            A header file containing the 2 typedefs for the struct
                     types and the enum variable as well as the prototypes for
                     the message functions.

message.c            This file is the implementation of the functions using the
                     void* and char* parameters that we want to test.
                     
                     The 2 functions in this file are identical, with the
                     exception of the input parameter and return value for the
                     second function is a char* instead of a void*. The
                     functions take in a pointer to a struct and an enum.
                     However, since we want to be able to pass in different
                     types of structs to the same function we use a void* 
                     (char* in the second function) instead of the typedef type
                     defined in the header file. 

                     Once inside the function we check the enum type which is
                     used to identify which type of struct we passed in. Then
                     we typecast the struct parameter with the corresponding
                     type and reference the appropriate value inside. Next, 
                     since we want to be able to return both a float or an int
                     we typecast the address of the value as a void pointer
                     (or char pointer in the second function) so that it can
                     be returned.
                     
Notes:

See the notes associated with each test case for its respective description.
The notes can be accessed either by directly viewing VOID_STAR.tst or through
the GUI in the notes tab of test case.

--------------------------------------------------------------------------------
