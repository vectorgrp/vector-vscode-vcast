-- Copyright Vector Software Inc.
-- Script Features
TEST.SCRIPT_FEATURE:C_DIRECT_ARRAY_INDEXING
TEST.SCRIPT_FEATURE:CPP_CLASS_OBJECT_REVISION
TEST.SCRIPT_FEATURE:MULTIPLE_UUT_SUPPORT
--

-- Test Case: FLOAT_MESSAGE
TEST.UNIT:message
TEST.SUBPROGRAM:get_message_value
TEST.NEW
TEST.NAME:FLOAT_MESSAGE
TEST.NOTES:

In this test case the first thing we do is assign 2.5 to the float_value in
the global g_float_message struct. Next, for the input parameter of the_msg we
choose g_float_message from the drop down box (VectorCAST allows you to select
the address of any of the predefined User Globals for a void * parameter).

Next, because this is g_float_message is an FLOAT_MESSAGE, we select the enum value
FLOAT as the_msg_t input parameter.
TEST.END_NOTES:
TEST.VALUE:USER_GLOBALS_VCAST.<<GLOBAL>>.g_float_message.float_value:2.5
TEST.VALUE:message.get_message_value.the_msg:g_float_message
TEST.VALUE:message.get_message_value.the_msg_t:VCAST_FLOAT
TEST.EXPECTED:message.get_message_value.return:2.5
TEST.END

-- Test Case: INT_MESSAGE
TEST.UNIT:message
TEST.SUBPROGRAM:get_message_value
TEST.NEW
TEST.NAME:INT_MESSAGE
TEST.NOTES:

In this test case the first thing we do is assign 5 to the int_value integer in
the global g_int_message struct. Next, for the input parameter of the_msg we
choose g_int_message from the drop down box (VectorCAST allows you to select
the address of any of the predefined User Globals for a void * parameter).

Next, because this is g_int_message is an INT_MESSAGE, we select the enum value
VCAST_INT as the_msg_t input parameter.

Note: to view or edit the user global variable declarations you can select
"Environment -> User Code -> Edit -> User Globals" Any changges made here
require and Environment -> Rebuild Environment to take effect.
TEST.END_NOTES:
TEST.VALUE:USER_GLOBALS_VCAST.<<GLOBAL>>.g_int_message.int_value:5
TEST.VALUE:message.get_message_value.the_msg:g_int_message
TEST.VALUE:message.get_message_value.the_msg_t:VCAST_INT
TEST.EXPECTED:message.get_message_value.return:5.0
TEST.END

-- Test Case: OUT_OF_RANGE_ENUM
TEST.UNIT:message
TEST.SUBPROGRAM:get_message_value
TEST.NEW
TEST.NAME:OUT_OF_RANGE_ENUM
TEST.NOTES:


In this case, we simply use an out of range enumeral, so that
we can test the case where no casting takes place
and the function returns 0

Also, this gives us complete coverage!
TEST.END_NOTES:
TEST.VALUE:message.get_message_value.the_msg:<<null>>
TEST.VALUE:message.get_message_value.the_msg_t:12
TEST.EXPECTED:message.get_message_value.return:0.0
TEST.END
