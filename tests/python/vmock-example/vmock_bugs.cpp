
#include "vmock_bugs.h"


int three_args(int x, int y, int z) {
  return x;
}

void whatToReturn(int x, int y) {}
void (*fptr(void (*)(int, int)))(int, int) {
  return &whatToReturn;
}

void fptr_2(int, int, void (*)(int, int), void (*)(int, int)) {}


std::array<void (*)(void), 1> templates(std::array<int, 1>, int) {
  return std::array<void (*)(void), 1>();
}


bool operator==(TemplateClass<int>, TemplateClass<int>) {return true;}


