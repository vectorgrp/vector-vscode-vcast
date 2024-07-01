#ifndef SIMPLE_H
#define SIMPLE_H

#include <vector>
#include <list>

void noParams ();

int simpleFunction (char param1, float param2);

typedef int headerIntType;
#define HDR_INT int

headerIntType typedefExample (headerIntType* param1);

HDR_INT macroExample (HDR_INT* param1);

const char* charStar (const char* param1);
   
const char* charArray (const char param1[] );

const char* staticCharArray (const char param1[5] );

char charReference (char& param1);

char constCharReference (const char& param1);


int overLoadedFreeFunction (int param);
int overLoadedFreeFunction (char param);

// we are not providing an defintion for this one
// to check if dataAPI sets is_overloaded
int overloadedFreeFunction2 (int param);
int overloadedFreeFunction2 (char param);


class myClass {
    public:
        int myInt;
        myClass ();
        ~myClass ();
        int myMethod (int param1);
        char myMethod (char param1);
        int myConstMethod (int param1) const;
        bool operator== (myClass& param1);
};

int classPointerParam (myClass* param1, int param2);

std::vector<int> vectorExample (std::vector<int> param1);

std::list<int> listExample (std::list<int> param1);


template <class leftType, class rightType>
int addNumbersTemplate (leftType a, rightType b) {
 return a + b;
}

int useTemplateForAddIntegers (int param1, int param2);
int useTemplateForAddIntAndChar (char param1, int param2);


template <class type>
int singleParamTemplate (type param1, int param2) {
 return param1+param2;
}
int useTemplateWithSingleParameter (int param1);


int prototypeOnlyFunction (int param);
int prototypeOnlyFunctionWithUnnamedParams (int, char);
int usePrototypeOnlyFunction (int param);


template <typename T> class TemplateClass {
public:
  // BUG: orig_declaration uses the same parameter name 
  // for both parameters: __T68210752
  bool operator==(int other) {return true;}
  bool foo(void) {return true;}
};


#endif