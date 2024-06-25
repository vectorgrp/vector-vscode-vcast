
#include "vmock_examples.h"
#include <vunit/vunit.h>


VTEST(vmockTests, ExampleTestCase) {
  VASSERT(true);
}


// ----------------------------------------------------------------
// Simple Example
// vmock vmock_examples simpleFunction 
int vmock_vmock_examples_simpleFunction(::vunit::CallCtx<> vunit_ctx, char param1, float param2) {
   // Enable Stub:  vmock_session.mock (&simpleFunction).assign (&vmock_vmock_examples_simpleFunction);
   // Disable Stub: vmock_session.mock (&simpleFunction).assign (nullptr);
   return 100;
}

VTEST(vmockExamples, simpleTest2) {

  auto vmock_session = ::vunit::MockSession();
  vmock_session.mock (&simpleFunction).assign (&vmock_vmock_examples_simpleFunction);
  VASSERT_EQ (100, simpleFunction ('a', 1.0));

  // disable the stub, which means the real code will return param1 'a' or 97
  vmock_session.mock (&simpleFunction).assign (nullptr);
  VASSERT_EQ (97, simpleFunction ('a', 1.0));

}


// ----------------------------------------------------------------
// Const Reference Parameter
// vmock vmock_examples constCharReference 
char vmock_vmock_examples_constCharReference(::vunit::CallCtx<> vunit_ctx, const char& param1) { 
  VASSERT_EQ (param1, 'A');
  return 'Z';
}


VTEST(vmockTests, constCharReference) {

  auto vmock_session = ::vunit::MockSession();
  vmock_session.mock (&constCharReference).assign (&vmock_vmock_examples_constCharReference);

  char testValue = 'A';
  // stub is called and controls return value
  VASSERT_EQ ('Z', constCharReference (testValue));

}


// ----------------------------------------------------------------
// Typedefs and Macros
// vmock vmock_examples typedefExample 
headerIntType vmock_vmock_examples_typedefExample(::vunit::CallCtx<> vunit_ctx, headerIntType* param1) {  
  return 123;
}
// vmock vmock_examples macroExample 
int vmock_vmock_examples_macroExample(::vunit::CallCtx<> vunit_ctx, int* param1) {  
  return 234;
}

VTEST(vmockExamples, typedefAndMacros) {

  auto vmock_session = ::vunit::MockSession();
  vmock_session.mock (&typedefExample).assign (&vmock_vmock_examples_typedefExample);
  vmock_session.mock (&macroExample).assign (&vmock_vmock_examples_macroExample);

  int testValue = 0;
  // stub is called and controls return value
  VASSERT_EQ (123, typedefExample (&testValue));
  // stub is called and controls return value
  VASSERT_EQ (234, macroExample (&testValue));

}



// ----------------------------------------------------------------
// Array paramter example
// vmock vmock_examples staticCharArray 
#include <string.h>
const char* vmock_vmock_examples_staticCharArray(::vunit::CallCtx<> vunit_ctx, const char param1[5]) {  
   VASSERT (strcmp(param1, "hmmm" ) == 0);
}


VTEST(vmockTests, staticCharArray) {

  auto vmock_session = ::vunit::MockSession();
  vmock_session.mock (&staticCharArray).assign (&vmock_vmock_examples_staticCharArray);

  char testValue[5] = "hmmm";
  staticCharArray (testValue);

}


// ----------------------------------------------------------------
// overloaded functions -> all done with auto-complete
// vmock vmock_examples overLoadedFreeFunction(int)int 
int vmock_vmock_examples_overLoadedFreeFunction(::vunit::CallCtx<> vunit_ctx, int param) {  
  // Usage: vmock_session.mock <int(*)(int)> (&overLoadedFreeFunction).assign (&vmock_vmock_examples_overLoadedFreeFunction);
  return 200;
}

// vmock vmock_examples overLoadedFreeFunction(char)int 
int vmock_vmock_examples_overLoadedFreeFunction_char(::vunit::CallCtx<> vunit_ctx, char param) {  
  // Usage: vmock_session.mock <int(*)(char)> (&overLoadedFreeFunction).assign (&vmock_vmock_examples_overLoadedFreeFunction);
  return 300;
}



VTEST(vmockTests, overloadedTest) {

  auto vmock_session = ::vunit::MockSession();

  // calling a stubbed function
  vmock_session.mock <int(*)(int)> (&overLoadedFreeFunction).assign (&vmock_vmock_examples_overLoadedFreeFunction);
  VASSERT_EQ (200, overLoadedFreeFunction (0));

  // calling the real function
  VASSERT_EQ (97, overLoadedFreeFunction ('a'));

  // calling the same function now stubbed
  vmock_session.mock <int(*)(char)> (&overLoadedFreeFunction).assign (&vmock_vmock_examples_overLoadedFreeFunction_char);
  VASSERT_EQ (300, overLoadedFreeFunction ('a'));

}



// ----------------------------------------------------------------
// Overloaded Methods
// vmock vmock_examples myClass::myMethod(int)int 
// TBD: manually added the _int to the name ... seems ok for the user to do this
int vmock_vmock_examples_myClass_myMethod_int(::vunit::CallCtx<myClass> vunit_ctx, int param1) {  
  return 100;
}


// vmock vmock_examples myClass::myMethod(char)char 
char vmock_vmock_examples_myClass_myMethod_char(::vunit::CallCtx<myClass> vunit_ctx, char param1) {
  // Usage: vmock_session.mock <char(myClass::*)(char)> (&myClass::myMethod).assign (&vmock_vmock_examples_myClass_myMethod);
  return 'X';
}

// ----------------------------------------------------------------
// Overloaded Operator
// vmock vmock_examples myClass::operator== 
bool vmock_vmock_examples_myClass_operator_symbol(::vunit::CallCtx<myClass> vunit_ctx, myClass& param1) {
  // Enable Stub:  vmock_session.mock (&myClass::operator==).assign (&vmock_vmock_examples_myClass_operator_symbol);
  // Disable Stub: vmock_session.mock (&myClass::operator==).assign (nullptr);
  return false;
}



VTEST(vmockTests, special) {
    auto vmock_session = ::vunit::MockSession();
    vmock_session.mock (&myClass::operator==).assign (&vmock_vmock_examples_myClass_operator_symbol);
  
    myClass myClassInstance;
    // stub is called and controls return value
    VASSERT_EQ (false, myClassInstance == myClassInstance);
  
  }



VTEST(vmockTests, classTest) {

  auto vmock_session = ::vunit::MockSession();

  vmock_session.mock <int(myClass::*)(int)> (&myClass::myMethod).assign (&vmock_vmock_examples_myClass_myMethod_int);
  vmock_session.mock <char(myClass::*)(char)> (&myClass::myMethod).assign (&vmock_vmock_examples_myClass_myMethod_char);

  myClass myClassInstance;
  // stub is called and controls return value
  VASSERT_EQ (100, myClassInstance.myMethod (5));
  // TBD vcast shows 88 in the report ...
  VASSERT_EQ ('X', myClassInstance.myMethod ('a'));

}

// ----------------------------------------------------------------
// Class Pointer Paramters
// vmock vmock_examples classPointerParam 
int vmock_vmock_examples_classPointerParam(::vunit::CallCtx<> vunit_ctx, myClass* param1, int param2) {  
  VASSERT_EQ (param1->myInt, 123);
  return param2*2;
}


VTEST(vmockTests, classParam) {

  auto vmock_session = ::vunit::MockSession();
  vmock_session.mock (&classPointerParam).assign (&vmock_vmock_examples_classPointerParam);

  myClass classInstance = myClass();
  classInstance.myInt = 123;

  // stub is called and controls return value
  int returnValue = classPointerParam (&classInstance, 456);

  VASSERT_EQ (912, returnValue);

}

// ----------------------------------------------------------------
// Template Functions
// vmock vmock_examples addNumbersTemplate(int,int)int 

int vmock_vmock_examples_addNumbers_int(::vunit::CallCtx<> vunit_ctx, int a, int b) {
  // Enable Stub:  vmock_session.mock (&addNumbersTemplate<insert-template-param-types>).assign (&vmock_vmock_examples_addNumbersTemplate);
  // Disable Stub: vmock_session.mock (&addNumbersTemplate<insert-template-param-types>).assign (nullptr);
  return 123;
}

// vmock vmock_examples addNumbersTemplate(char,int)int 




// vmock vmock_examples addNumbersTemplate(char,int)int 
// TBD have to manually update the function name
int vmock_vmock_examples_addNumbers_char(::vunit::CallCtx<> vunit_ctx, char a, int b) {
   // Enable Stub:  vmock_session.mock (&addNumbersTemplate<insert-template-param-types>).assign (&vmock_vmock_examples_addNumbersTemplate);
   // Disable Stub: vmock_session.mock (&addNumbersTemplate<insert-template-param-types>).assign (nullptr);
   return 456;
}

VTEST(vmockExamples, templateTest) {

  auto vmock_session = ::vunit::MockSession();

  // TBD have to manually insert the template pareamters here
  vmock_session.mock (&addNumbersTemplate<int, int>).assign (&vmock_vmock_examples_addNumbers_int);
  vmock_session.mock (&addNumbersTemplate<char, int>).assign (&vmock_vmock_examples_addNumbers_char);
  

  // stub is called and controls return value
  VASSERT_EQ (123, addNumbersTemplate (1, 2));
  // stub is called and controls return value
  // TBD vcast shows 99 ('c') in the report ... is the stub called?
  VASSERT_EQ (456, addNumbersTemplate ('a', 2));

}

// ----------------------------------------------------------------
// Single parameter template
// vmock vmock_examples singleParamTemplate 
int vmock_vmock_examples_singleParamTemplate(::vunit::CallCtx<> vunit_ctx, char param1, int param2) {  
  // Usage: vmock_session.mock (&singleParamTemplate<insert-template-param-types>).assign (&vmock_vmock_examples_singleParamTemplate);
  return 321;
}

VTEST(vmockExample, singleParamTemplateTest) {

  auto vmock_session = ::vunit::MockSession();
  // TBD manually inserted the instance type
  vmock_session.mock (&singleParamTemplate<char>).assign (&vmock_vmock_examples_singleParamTemplate);

  VASSERT_EQ (321, singleParamTemplate ('a', 2));
}

// ----------------------------------------------------------------
// Protytpe Stub Example
// vmock uut_prototype_stubs prototypeStub 
int vmock_uut_prototype_stubs_prototypeStub(::vunit::CallCtx<> vunit_ctx, int param) {
   //Usage: vmock_session.mock (&prototypeStub).assign (&vmock_uut_prototype_stubs_prototypeStub);

}

// vmock uut_prototype_stubs prototypeOnlyFunction 
int vmock_uut_prototype_stubs_prototypeOnlyFunction(::vunit::CallCtx<> vunit_ctx, int param) {
   // Enable Stub:  vmock_session.mock (&prototypeOnlyFunction).assign (&vmock_uut_prototype_stubs_prototypeOnlyFunction);
   // Disable Stub: vmock_session.mock (&prototypeOnlyFunction).assign (nullptr);
  return 100;
}

VTEST(vmockExample, prototypeTest) {
  auto vmock_session = ::vunit::MockSession();
  vmock_session.mock (&prototypeOnlyFunction).assign (&vmock_uut_prototype_stubs_prototypeOnlyFunction);

  VASSERT_EQ (100, usePrototypeOnlyFunction (0));

}

// ----------------------------------------------------------------
// Constant method 
// vmock vmock_examples myClass::myConstMethod 
int vmock_vmock_examples_myClass_myConstMethod(::vunit::CallCtx<myClass> vunit_ctx, int param1) {
  // Enable Stub:  vmock_session.mock ((int (myClass::*)(int))&myClass::myConstMethod).assign (&vmock_vmock_examples_myClass_myConstMethod);
  // Disable Stub: vmock_session.mock ((int (myClass::*)(int))&myClass::myConstMethod).assign (nullptr);
  return 100;
}

VTEST(vmockExample, constTest)  {
  auto vmock_session = ::vunit::MockSession();
  vmock_session.mock ((int (myClass::*)(int))&myClass::myConstMethod).assign (&vmock_vmock_examples_myClass_myConstMethod);

  myClass myClassInstance;
  VASSERT_EQ (100, myClassInstance.myConstMethod (0));
}

