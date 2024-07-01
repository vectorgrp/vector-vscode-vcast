
#include <iostream>
using namespace std;

#include "vmock_examples.h"


void noParams () {
}

int simpleFunction (char param1, float param2) {
    return param1;
}

headerIntType typedefExample (headerIntType* param1) {
    return *param1;
}

HDR_INT macroExample (HDR_INT* param1) {
    return *param1;
}


const char* charStar (const char* param1) {

    if (param1==0)
        return 0;
    else
        return param1;
}

const char* charArray (const char param1[] ) {

    if (param1==0)
        return 0;
    else
        return param1;
}

// TBD is this s pointer of a static array of characters?
const char* staticCharArray (const char param1[5] ) {
     return param1;
}


char charReference (char& param1) {
    return param1;
}

char constCharReference (const char& param1) {
    return param1;
}


int overLoadedFreeFunction (int param) {
    return param;
}

int overLoadedFreeFunction (char param) {
    return param;
}

int overloadedFreeFunction2 (char param) {
    return param;
}

myClass::myClass () {}
myClass::~myClass () {}

int myClass::myMethod (int param1) {
    return param1;
}

char myClass::myMethod (char param1) {
    return param1;
}

int myClass::myConstMethod (int param1) const {
    return param1;
}

bool myClass::operator== (myClass& param1) {
    return false;
};



int classPointerParam (myClass* param1, int param2) {
    return param1->myMethod (param2);
}

std::vector<int> vectorExample (std::vector<int> param1) {
    return param1;
}


std::list<int> listExample (std::list<int> param1) {
    return param1;
}

int useTemplateForAddIntegers (int param1, int param2) {
    return addNumbersTemplate (param1, param2);
}

int useTemplateForAddIntAndChar (char param1, int param2) {
    return addNumbersTemplate (param1, param2);
}


int useTemplateWithSingleParameter (int param1) {
    return singleParamTemplate ('a', param1);
}


int usePrototypeOnlyFunction (int param1) {
    return prototypeOnlyFunction (param1);
    prototypeOnlyFunctionWithUnnamedParams (param1, 'a');
}

