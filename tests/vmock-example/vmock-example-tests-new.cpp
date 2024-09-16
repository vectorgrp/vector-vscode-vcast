
#include "vmock_examples.h"
#include <vunit/vunit.h>

VTEST(vmockExamples, simpleTest) {
  VASSERT(true);
}


// ---------------------------------------------------------------------------------------
// Simple Example - new
// vmock vmock_examples simpleFunction 
int vmock_vmock_examples_simpleFunction(::vunit::CallCtx<> vunit_ctx, char param1, float param2) {
  // Enable Stub: vmock_vmock_examples_simpleFunction_enable_disable(vmock_session);
  // Disable Stub: vmock_vmock_examples_simpleFunction_enable_disable(vmock_session, false);

  return 100;
}
void vmock_vmock_examples_simpleFunction_enable_disable(vunit::MockSession &vmock_session, bool enable = true) {
    using vcast_mock_rtype = int ;
    vcast_mock_rtype (*vcast_fn_ptr)(char param1, float param2)  = &simpleFunction;
    vmock_session.mock <vcast_mock_rtype (*)(char param1, float param2)> ((vcast_mock_rtype (*)(char param1, float param2))vcast_fn_ptr).assign (enable ? &vmock_vmock_examples_simpleFunction : nullptr);
}

VTEST(vmockExamples, simpleTest2) {

  auto vmock_session = ::vunit::MockSession();
  vmock_vmock_examples_simpleFunction_enable_disable(vmock_session);
  VASSERT_EQ (100, simpleFunction ('a', 1.0));

  // disable the stub, which means the real code will return param1 'a' or 97
  vmock_vmock_examples_simpleFunction_enable_disable(vmock_session, false);
  VASSERT_EQ (97, simpleFunction ('a', 1.0));

}


// ---------------------------------------------------------------------------------------
// Const Reference Parameter - New
// vmock vmock_examples constCharReference 
char vmock_vmock_examples_constCharReference(::vunit::CallCtx<> vunit_ctx, const char &param1) {
  // Enable Stub: vmock_vmock_examples_constCharReference_enable_disable(vmock_session);
  // Disable Stub: vmock_vmock_examples_constCharReference_enable_disable(vmock_session, false);

  VASSERT_EQ (param1, 'A');
  return 'Z';
}
void vmock_vmock_examples_constCharReference_enable_disable(vunit::MockSession &vmock_session, bool enable = true) {
    using vcast_mock_rtype = char ;
    vcast_mock_rtype (*vcast_fn_ptr)(const char &param1)  = &constCharReference;
    vmock_session.mock <vcast_mock_rtype (*)(const char &param1)> ((vcast_mock_rtype (*)(const char &param1))vcast_fn_ptr).assign (enable ? &vmock_vmock_examples_constCharReference : nullptr);
}

VTEST(vmockTests, constCharReference) {

  auto vmock_session = ::vunit::MockSession();
  vmock_vmock_examples_constCharReference_enable_disable(vmock_session);

  char testValue = 'A';
  // stub is called and controls return value
  VASSERT_EQ ('Z', constCharReference (testValue));

}


// ---------------------------------------------------------------------------------------
// Typedefs and Macros - New
// vmock vmock_examples typedefExample  
int vmock_vmock_examples_typedefExample(::vunit::CallCtx<> vunit_ctx, int *param1) {
  // Enable Stub: vmock_vmock_examples_typedefExample_enable_disable(vmock_session);
  // Disable Stub: vmock_vmock_examples_typedefExample_enable_disable(vmock_session, false);

  // Insert mock logic here!
  return 123;
}
void vmock_vmock_examples_typedefExample_enable_disable(vunit::MockSession &vmock_session, bool enable = true) {
    using vcast_mock_rtype = int ;
    vcast_mock_rtype (*vcast_fn_ptr)(int *)  = &typedefExample;
    vmock_session.mock <vcast_mock_rtype (*)(int *)> ((vcast_mock_rtype (*)(int *))vcast_fn_ptr).assign (enable ? &vmock_vmock_examples_typedefExample : nullptr);
}



// vmock vmock_examples macroExample  
int vmock_vmock_examples_macroExample(::vunit::CallCtx<> vunit_ctx, int *param1) {
  // Enable Stub: vmock_vmock_examples_macroExample_enable_disable(vmock_session);
  // Disable Stub: vmock_vmock_examples_macroExample_enable_disable(vmock_session, false);

  // Insert mock logic here!
  return 234;
}
void vmock_vmock_examples_macroExample_enable_disable(vunit::MockSession &vmock_session, bool enable = true) {
    using vcast_mock_rtype = int ;
    vcast_mock_rtype (*vcast_fn_ptr)(int *)  = &macroExample;
    vmock_session.mock <vcast_mock_rtype (*)(int *)> ((vcast_mock_rtype (*)(int *))vcast_fn_ptr).assign (enable ? &vmock_vmock_examples_macroExample : nullptr);
}


VTEST(vmockExamples, typedefAndMacros) {

  auto vmock_session = ::vunit::MockSession();
  vmock_vmock_examples_typedefExample_enable_disable(vmock_session);
  vmock_vmock_examples_macroExample_enable_disable(vmock_session);

  int testValue = 0;
  // stub is called and controls return value
  VASSERT_EQ (123, typedefExample (&testValue));
  // stub is called and controls return value
  VASSERT_EQ (234, macroExample (&testValue));

}


// ---------------------------------------------------------------------------------------
// Array paramter example - New
#include <string.h>
// vmock vmock_examples staticCharArray 
const char * vmock_vmock_examples_staticCharArray(::vunit::CallCtx<> vunit_ctx, const char param1[5]) {
  // Enable Stub: vmock_vmock_examples_staticCharArray_enable_disable(vmock_session);
  // Disable Stub: vmock_vmock_examples_staticCharArray_enable_disable(vmock_session, false);

   VASSERT (strcmp(param1, "hmmm" ) == 0);
}
void vmock_vmock_examples_staticCharArray_enable_disable(vunit::MockSession &vmock_session, bool enable = true) {
    using vcast_mock_rtype = const char * ;
    vcast_mock_rtype (*vcast_fn_ptr)(const char param1[5])  = &staticCharArray;
    vmock_session.mock <vcast_mock_rtype (*)(const char param1[5])> ((vcast_mock_rtype (*)(const char param1[5]))vcast_fn_ptr).assign (enable ? &vmock_vmock_examples_staticCharArray : nullptr);
}

VTEST(vmockTests, staticCharArray) {

  auto vmock_session = ::vunit::MockSession();
  vmock_vmock_examples_staticCharArray_enable_disable(vmock_session);

  char testValue[5] = "hmmm";
  staticCharArray (testValue);
}


// ---------------------------------------------------------------------------------------
// overloaded functions - New
// vmock vmock_examples overLoadedFreeFunction(int)int 
int vmock_vmock_examples_overLoadedFreeFunction(::vunit::CallCtx<> vunit_ctx, int param) {
  // Enable Stub: vmock_vmock_examples_overLoadedFreeFunction_enable_disable(vmock_session);
  // Disable Stub: vmock_vmock_examples_overLoadedFreeFunction_enable_disable(vmock_session, false);

  return 200;
}
void vmock_vmock_examples_overLoadedFreeFunction_enable_disable(vunit::MockSession &vmock_session, bool enable = true) {
    using vcast_mock_rtype = int ;
    vcast_mock_rtype (*vcast_fn_ptr)(int param)  = &overLoadedFreeFunction;
    vmock_session.mock <vcast_mock_rtype (*)(int param)> ((vcast_mock_rtype (*)(int param))vcast_fn_ptr).assign (enable ? &vmock_vmock_examples_overLoadedFreeFunction : nullptr);
}

// vmock vmock_examples overLoadedFreeFunction(char)int 
int vmock_vmock_examples_overLoadedFreeFunction_char(::vunit::CallCtx<> vunit_ctx, char param) {
  // Enable Stub: vmock_vmock_examples_overLoadedFreeFunction_char_enable_disable(vmock_session);
  // Disable Stub: vmock_vmock_examples_overLoadedFreeFunction_char_enable_disable(vmock_session, false);

  return 300;
}
void vmock_vmock_examples_overLoadedFreeFunction_char_enable_disable(vunit::MockSession &vmock_session, bool enable = true) {
    using vcast_mock_rtype = int ;
    vcast_mock_rtype (*vcast_fn_ptr)(char param)  = &overLoadedFreeFunction;
    vmock_session.mock <vcast_mock_rtype (*)(char param)> ((vcast_mock_rtype (*)(char param))vcast_fn_ptr).assign (enable ? &vmock_vmock_examples_overLoadedFreeFunction_char : nullptr);
}

VTEST(vmockTests, overloadedTest) {

  auto vmock_session = ::vunit::MockSession();

  // calling a stubbed function for the int version
  vmock_vmock_examples_overLoadedFreeFunction_enable_disable(vmock_session);
  VASSERT_EQ (200, overLoadedFreeFunction (0));

  // calling the real function for the char version
  VASSERT_EQ (97, overLoadedFreeFunction ('a'));

  // calling a stubbed function for the char version
  vmock_vmock_examples_overLoadedFreeFunction_char_enable_disable(vmock_session);
  VASSERT_EQ (300, overLoadedFreeFunction ('a'));

}


// ---------------------------------------------------------------------------------------
// Overloaded Methods - New
// vmock vmock_examples myClass::myMethod(int)int 
int vmock_vmock_examples_myClass_myMethod(::vunit::CallCtx<myClass> vunit_ctx, int param1) {
  // Enable Stub: vmock_vmock_examples_myClass_myMethod_enable_disable(vmock_session);
  // Disable Stub: vmock_vmock_examples_myClass_myMethod_enable_disable(vmock_session, false);

  return 100;
}
void vmock_vmock_examples_myClass_myMethod_enable_disable(vunit::MockSession &vmock_session, bool enable = true) {
    using vcast_mock_rtype = int ;
    vcast_mock_rtype (myClass::*vcast_fn_ptr)(int param1)  = &myClass::myMethod;
    vmock_session.mock <vcast_mock_rtype (myClass::*)(int param1)> ((vcast_mock_rtype (myClass::*)(int param1))vcast_fn_ptr).assign (enable ? &vmock_vmock_examples_myClass_myMethod : nullptr);
}

// vmock vmock_examples myClass::myMethod(char)char 
char vmock_vmock_examples_myClass_myMethod_char(::vunit::CallCtx<myClass> vunit_ctx, char param1) {
  // Enable Stub: vmock_vmock_examples_myClass_myMethod_char_enable_disable(vmock_session);
  // Disable Stub: vmock_vmock_examples_myClass_myMethod_char_enable_disable(vmock_session, false);

  return 'X';
}
void vmock_vmock_examples_myClass_myMethod_char_enable_disable(vunit::MockSession &vmock_session, bool enable = true) {
    using vcast_mock_rtype = char ;
    vcast_mock_rtype (myClass::*vcast_fn_ptr)(char param1)  = &myClass::myMethod;
    vmock_session.mock <vcast_mock_rtype (myClass::*)(char param1)> ((vcast_mock_rtype (myClass::*)(char param1))vcast_fn_ptr).assign (enable ? &vmock_vmock_examples_myClass_myMethod_char : nullptr);
}

VTEST(vmockTests, overloadedMethodTest) {

  auto vmock_session = ::vunit::MockSession();

  vmock_vmock_examples_myClass_myMethod_enable_disable(vmock_session);
  vmock_vmock_examples_myClass_myMethod_char_enable_disable(vmock_session);

  myClass myClassInstance;
  // stub is called and controls return value
  VASSERT_EQ (100, myClassInstance.myMethod (0));
  // stub is called and controls return value
  VASSERT_EQ ('X', myClassInstance.myMethod ('a'));
} 



// ---------------------------------------------------------------------------------------
// Overloaded Operator - New
// vmock vmock_examples myClass::operator== 
bool vmock_vmock_examples_myClass_operator(::vunit::CallCtx<myClass> vunit_ctx, class myClass &param1) {
  // Enable Stub: vmock_vmock_examples_myClass_operator_enable_disable(vmock_session);
  // Disable Stub: vmock_vmock_examples_myClass_operator_enable_disable(vmock_session, false);

  return false;
}
void vmock_vmock_examples_myClass_operator_enable_disable(vunit::MockSession &vmock_session, bool enable = true) {
    using vcast_mock_rtype = bool ;
    vcast_mock_rtype (myClass::*vcast_fn_ptr)(class ::myClass &param1)  = &myClass::operator==;
    vmock_session.mock <vcast_mock_rtype (myClass::*)(class ::myClass &param1)> ((vcast_mock_rtype (myClass::*)(class ::myClass &param1))vcast_fn_ptr).assign (enable ? &vmock_vmock_examples_myClass_operator : nullptr);
}

VTEST(vmockTests, special) {
    auto vmock_session = ::vunit::MockSession();
    vmock_vmock_examples_myClass_operator_enable_disable(vmock_session);  

    myClass myClassInstance;
    // stub is called and controls return value
    VASSERT_EQ (false, myClassInstance == myClassInstance);
  }


// ---------------------------------------------------------------------------------------
// Class Pointer Paramters
// vmock vmock_examples classPointerParam 
int vmock_vmock_examples_classPointerParam(::vunit::CallCtx<> vunit_ctx, class myClass *param1, int param2) {
  // Enable Stub: vmock_vmock_examples_classPointerParam_enable_disable(vmock_session);
  // Disable Stub: vmock_vmock_examples_classPointerParam_enable_disable(vmock_session, false);

  VASSERT_EQ (param1->myInt, 123);
  return param2*2;
}
void vmock_vmock_examples_classPointerParam_enable_disable(vunit::MockSession &vmock_session, bool enable = true) {
    using vcast_mock_rtype = int ;
    vcast_mock_rtype (*vcast_fn_ptr)(class ::myClass *param1, int param2)  = &classPointerParam;
    vmock_session.mock <vcast_mock_rtype (*)(class ::myClass *param1, int param2)> ((vcast_mock_rtype (*)(class ::myClass *param1, int param2))vcast_fn_ptr).assign (enable ? &vmock_vmock_examples_classPointerParam : nullptr);
}

VTEST(vmockTests, classParam) {

  auto vmock_session = ::vunit::MockSession();
  vmock_vmock_examples_classPointerParam_enable_disable(vmock_session);

  myClass classInstance = myClass();
  classInstance.myInt = 123;

  // stub is called and controls return value
  int returnValue = classPointerParam (&classInstance, 456);

  VASSERT_EQ (912, returnValue);

}


// ---------------------------------------------------------------------------------------
// Protytpe Stub Example - New
// vmock uut_prototype_stubs prototypeOnlyFunction 
int vmock_uut_prototype_stubs_prototypeOnlyFunction(::vunit::CallCtx<> vunit_ctx, int vcast_param1) {
  // Enable Stub: vmock_uut_prototype_stubs_prototypeOnlyFunction_enable_disable(vmock_session);
  // Disable Stub: vmock_uut_prototype_stubs_prototypeOnlyFunction_enable_disable(vmock_session, false);

  return 100;
}
void vmock_uut_prototype_stubs_prototypeOnlyFunction_enable_disable(vunit::MockSession &vmock_session, bool enable = true) {
    using vcast_mock_rtype = int ;
    vcast_mock_rtype (*vcast_fn_ptr)(int param)  = &prototypeOnlyFunction;
    vmock_session.mock <vcast_mock_rtype (*)(int param)> ((vcast_mock_rtype (*)(int param))vcast_fn_ptr).assign (enable ? &vmock_uut_prototype_stubs_prototypeOnlyFunction : nullptr);
}

// vmock uut_prototype_stubs prototypeOnlyFunctionWithUnnamedParams 
int vmock_uut_prototype_stubs_prototypeOnlyFunctionWithUnnamedParams(::vunit::CallCtx<> vunit_ctx, int vcast_param1, char vcast_param2) {
  // Enable Stub: vmock_uut_prototype_stubs_prototypeOnlyFunctionWithUnnamedParams_enable_disable(vmock_session);
  // Disable Stub: vmock_uut_prototype_stubs_prototypeOnlyFunctionWithUnnamedParams_enable_disable(vmock_session, false);

  return 200;
}
void vmock_uut_prototype_stubs_prototypeOnlyFunctionWithUnnamedParams_enable_disable(vunit::MockSession &vmock_session, bool enable = true) {
    using vcast_mock_rtype = int ;
    vcast_mock_rtype (*vcast_fn_ptr)(int VCAST_PARAM_1, char VCAST_PARAM_2)  = &prototypeOnlyFunctionWithUnnamedParams;
    vmock_session.mock <vcast_mock_rtype (*)(int VCAST_PARAM_1, char VCAST_PARAM_2)> ((vcast_mock_rtype (*)(int VCAST_PARAM_1, char VCAST_PARAM_2))vcast_fn_ptr).assign (enable ? &vmock_uut_prototype_stubs_prototypeOnlyFunctionWithUnnamedParams : nullptr);
}


VTEST(vmockExample, prototypeTest) {

  auto vmock_session = ::vunit::MockSession();
  vmock_uut_prototype_stubs_prototypeOnlyFunction_enable_disable(vmock_session);
  vmock_uut_prototype_stubs_prototypeOnlyFunctionWithUnnamedParams_enable_disable(vmock_session);
  
  VASSERT_EQ (300, usePrototypeOnlyFunction (0));
}

// ---------------------------------------------------------------------------------------
// Constant method 
// vmock vmock_examples myClass::myConstMethod 
int vmock_vmock_examples_myClass_myConstMethod(::vunit::CallCtx<myClass> vunit_ctx, int param1) {
  // Enable Stub: vmock_vmock_examples_myClass_myConstMethod_enable_disable(vmock_session);
  // Disable Stub: vmock_vmock_examples_myClass_myConstMethod_enable_disable(vmock_session, false);

  return 100;
}
void vmock_vmock_examples_myClass_myConstMethod_enable_disable(vunit::MockSession &vmock_session, bool enable = true) {
    using vcast_mock_rtype = int ;
    vcast_mock_rtype (myClass::*vcast_fn_ptr)(int param1) const = &myClass::myConstMethod;
    vmock_session.mock <vcast_mock_rtype (myClass::*)(int param1)> ((vcast_mock_rtype (myClass::*)(int param1))vcast_fn_ptr).assign (enable ? &vmock_vmock_examples_myClass_myConstMethod : nullptr);
}

VTEST(vmockExample, constTest)  {
  auto vmock_session = ::vunit::MockSession();
  vmock_vmock_examples_myClass_myConstMethod_enable_disable(vmock_session);

  myClass myClassInstance;
  VASSERT_EQ (100, myClassInstance.myConstMethod (0));
}

// ---------------------------------------------------------------------------------------
// Free operator function - should always specialize the vmock_session.mock call
// vmock vmock_examples operator== 
bool vmock_vmock_examples_operator(::vunit::CallCtx<> vunit_ctx, class TemplateClass< int>  vcast_param1, class TemplateClass< int>  vcast_param2) {
  // Enable Stub: vmock_vmock_examples_operator_enable_disable(vmock_session);
  // Disable Stub: vmock_vmock_examples_operator_enable_disable(vmock_session, false);

  return false;
}
void vmock_vmock_examples_operator_enable_disable(vunit::MockSession &vmock_session, bool enable = true) {
    using vcast_mock_rtype = bool ;
    vcast_mock_rtype (*vcast_fn_ptr)(class ::TemplateClass< int>  VCAST_PARAM_1, class ::TemplateClass< int>  VCAST_PARAM_2)  = &operator==;
    vmock_session.mock <vcast_mock_rtype (*)(class ::TemplateClass< int>  VCAST_PARAM_1, class ::TemplateClass< int>  VCAST_PARAM_2)> ((vcast_mock_rtype (*)(class ::TemplateClass< int>  VCAST_PARAM_1, class ::TemplateClass< int>  VCAST_PARAM_2))vcast_fn_ptr).assign (enable ? &vmock_vmock_examples_operator : nullptr);
}


VTEST(vmockExample, operatorTest) {

  auto vmock_session = ::vunit::MockSession();
  vmock_vmock_examples_operator_enable_disable(vmock_session);

  TemplateClass<int> templateClassInstance1;
  TemplateClass<int> templateClassInstance2;
  VASSERT_EQ (false, templateClassInstance1 == templateClassInstance2);
  
}



// ---------------------------------------------------------------------------------------
// Template Stuff - Waiting for PCT Bug Fix
// ---------------------------------------------------------------------------------------


// ---------------------------------------------------------------------------------------
// Template Functions
// vmock vmock_examples addNumbersTemplate(int,int)int 
int vmock_vmock_examples_addNumbers_int(::vunit::CallCtx<> vunit_ctx, int a, int b) {
  // Enable Stub:  vmock_session.mock (&addNumbersTemplate<insert-template-param-types>).assign (&vmock_vmock_examples_addNumbersTemplate);
  // Disable Stub: vmock_session.mock (&addNumbersTemplate<insert-template-param-types>).assign (nullptr);
  return 123;
}


// vmock vmock_examples addNumbersTemplate(char,int)int 
int vmock_vmock_examples_addNumbers_char(::vunit::CallCtx<> vunit_ctx, char a, int b) {
   // Enable Stub:  vmock_session.mock (&addNumbersTemplate<insert-template-param-types>).assign (&vmock_vmock_examples_addNumbersTemplate);
   // Disable Stub: vmock_session.mock (&addNumbersTemplate<insert-template-param-types>).assign (nullptr);
   return 456;
}

VTEST(vmockExamples, templateTest) {

  auto vmock_session = ::vunit::MockSession();

  vmock_session.mock (&addNumbersTemplate<int, int>).assign (&vmock_vmock_examples_addNumbers_int);
  vmock_session.mock (&addNumbersTemplate<char, int>).assign (&vmock_vmock_examples_addNumbers_char);
  

  // stub is called and controls return value
  VASSERT_EQ (123, addNumbersTemplate (1, 2));
  // stub is called and controls return value
  VASSERT_EQ (456, addNumbersTemplate ('a', 2));

}

// ---------------------------------------------------------------------------------------
// Single parameter template
// vmock vmock_examples singleParamTemplate
int vmock_vmock_examples_singleParamTemplate(::vunit::CallCtx<> vunit_ctx, char param1, int param2) {  
  // Usage: vmock_session.mock (&singleParamTemplate<insert-template-param-types>).assign (&vmock_vmock_examples_singleParamTemplate);
  return 321;
}

VTEST(vmockExample, singleParamTemplateTest) {

  auto vmock_session = ::vunit::MockSession();
  vmock_session.mock (&singleParamTemplate<char>).assign (&vmock_vmock_examples_singleParamTemplate);
  VASSERT_EQ (321, singleParamTemplate ('a', 2));
}

// vmock vmock_examples myClass::operator== 
bool vmock_vmock_examples_myClass_operator(::vunit::CallCtx<myClass> vunit_ctx, class myClass &param1) {
  // Enable Stub: vmock_vmock_examples_myClass_operator_enable_disable(vmock_session);
  // Disable Stub: vmock_vmock_examples_myClass_operator_enable_disable(vmock_session, false);

  // Insert mock logic here!
}
void vmock_vmock_examples_myClass_operator_enable_disable(vunit::MockSession &vmock_session, bool enable = true) {
    using vcast_mock_rtype = bool ;
    vcast_mock_rtype (myClass::*vcast_fn_ptr)(class ::myClass &)  = &myClass::operator==;
    vmock_session.mock <vcast_mock_rtype (myClass::*)(class ::myClass &)> ((vcast_mock_rtype (myClass::*)(class ::myClass &))vcast_fn_ptr).assign (enable ? &vmock_vmock_examples_myClass_operator : nullptr);
}



// ---------------------------------------------------------------------------------------
