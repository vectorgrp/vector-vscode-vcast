-- VectorCAST 24 revision a2b590e (07/23/24)
-- Test Case Script
--
-- Environment    : DEMO1
-- Unit(s) Under Test: database manager
--
-- Script Features
TEST.SCRIPT_FEATURE:C_DIRECT_ARRAY_INDEXING
TEST.SCRIPT_FEATURE:CPP_CLASS_OBJECT_REVISION
TEST.SCRIPT_FEATURE:MULTIPLE_UUT_SUPPORT
TEST.SCRIPT_FEATURE:REMOVED_CL_PREFIX
TEST.SCRIPT_FEATURE:MIXED_CASE_NAMES
TEST.SCRIPT_FEATURE:STANDARD_SPACING_R2
TEST.SCRIPT_FEATURE:OVERLOADED_CONST_SUPPORT
TEST.SCRIPT_FEATURE:UNDERSCORE_NULLPTR
TEST.SCRIPT_FEATURE:FULL_PARAMETER_TYPES
TEST.SCRIPT_FEATURE:STRUCT_DTOR_ADDS_POINTER
TEST.SCRIPT_FEATURE:STRUCT_FIELD_CTOR_ADDS_POINTER
TEST.SCRIPT_FEATURE:STRUCT_BASE_CTOR_ADDS_POINTER
TEST.SCRIPT_FEATURE:STATIC_HEADER_FUNCS_IN_UUTS
TEST.SCRIPT_FEATURE:VCAST_MAIN_NOT_RENAMED
--

-- Unit: manager

-- Subprogram: Manager::PlaceOrder

-- Test Case: Test1
TEST.UNIT:manager
TEST.SUBPROGRAM:Manager::PlaceOrder
TEST.NEW
TEST.NAME:Test1
TEST.STUB:database.DataBase::GetTableRecord
TEST.STUB:database.DataBase::UpdateTableRecord
TEST.VALUE:database.DataBase::GetTableRecord.Data[0].IsOccupied:false
TEST.VALUE:database.DataBase::GetTableRecord.Data[0].NumberInParty:1
TEST.VALUE:database.DataBase::GetTableRecord.Data[0].CheckTotal:20
TEST.VALUE:manager.Manager::PlaceOrder.Table:1
TEST.VALUE:manager.Manager::PlaceOrder.Seat:2
TEST.VALUE:manager.Manager::PlaceOrder.Order.Entree:Chicken
TEST.EXPECTED:database.DataBase::UpdateTableRecord.Data[0].IsOccupied:true
TEST.EXPECTED:database.DataBase::UpdateTableRecord.Data[0].NumberInParty:2
TEST.EXPECTED:database.DataBase::UpdateTableRecord.Data[0].CheckTotal:30
TEST.END
