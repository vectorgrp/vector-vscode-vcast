
#include "vmock_bugs.h"


int three_args(int x, int y, int z) {
  return x;
}

void whatToReturn(int x, int y) {}
void (*fptr(void (*)(int, int)))(int, int) {
  return &whatToReturn;
}

void fptr_2(int, int, void (*)(int, int), void (*)(int, int)) {}


std::array<void (*)(void), 1> getArrayOfFPtrs(std::array<int, 1>, int) {
  return std::array<void (*)(void), 1>();
}


bool operator==(TemplateClass<int>, TemplateClass<int>) {return true;}

ClassReturnRefArrayType const &ClassReturnRefArray::get() const {
  /*
   * Do not make `local` be a member of the class!
   *
   * If you do that, the parameterisation changes to:
   *
   *     ()const ClassReturnRefArrayType const
   *
   * which then does not reproduce the bug.
   */
  ClassReturnRefArrayType local;
  return local;
}
