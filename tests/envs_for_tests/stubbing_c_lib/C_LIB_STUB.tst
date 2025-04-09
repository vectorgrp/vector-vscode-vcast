-- VectorCAST 3.3 (%H%)
-- Test Case Script
-- 
-- Environment    : ENV_C_LIB_STUB
-- Unit Under Test: c_lib_stub
-- 
-- Script Features
TEST.SCRIPT_FEATURE:CPP_CLASS_OBJECT_REVISION
--
-- 
TEST.UNIT:c_lib_stub
TEST.SUBPROGRAM:my_string_dupe
TEST.NEW
TEST.NAME:STUBBED_MALLOC
TEST.NOTES:

VectorCAST will make the translation unit of the source file call
the stubbed version of malloc while leaving all other calls
untouched (e.g. from a library or from the VectorCAST test harness).
In this case my_string_dupe checks to make sure that malloc returns a
non-NULL address before proceding with the string duplication.
If malloc returns NULL, the function will return an error status.
Since we are able to make malloc return NULL, we can achieve full
code coverage.


TEST.END_NOTES:
TEST.VALUE:c_lib_stub.my_string_dupe.src:<<malloc 12>>
TEST.VALUE:c_lib_stub.my_string_dupe.src:"Hello World"
TEST.VALUE:c_lib_stub.my_string_dupe.dst:<<malloc 1>>
TEST.VALUE:uut_prototype_stubs.malloc.return:<<null>>
TEST.EXPECTED:c_lib_stub.my_string_dupe.return:FAIL
TEST.END
--
-- Test Case: MY_string_dupe.002
-- 
TEST.UNIT:c_lib_stub
TEST.SUBPROGRAM:my_string_dupe
TEST.NEW
TEST.NAME:REAL_MALLOC
TEST.NOTES:

It may not be desirable to have malloc stubbed for every test case
for an environment.  This test case shows how to use the C library
version of malloc on a case-by-case basis.

TEST.END_NOTES:
TEST.VALUE:c_lib_stub.my_string_dupe.src:<<malloc 12>>
TEST.VALUE:c_lib_stub.my_string_dupe.src:"Hello World"
TEST.VALUE:c_lib_stub.my_string_dupe.dst:<<malloc 1>>
TEST.VALUE:c_lib_stub.my_string_dupe.len:5
TEST.EXPECTED:c_lib_stub.my_string_dupe.dst[0]:"Hello"
TEST.EXPECTED:c_lib_stub.my_string_dupe.return:SUCCESS
TEST.END
--
