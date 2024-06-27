#ifndef BUGS_H
#define BUGS_H

#include <array>
#include <vector>

int three_args(int x, int y, int z);

void whatToReturn(int x, int y);
void (*fptr(void (*)(int, int)))(int, int);

void fptr_2(int, int, void (*)(int, int), void (*)(int, int));


std::array<void (*)(void), 1> templates(std::array<int, 1>, int);

class ConstClass {
public:
  std::vector<int> const_template() const {
    return std::vector<int>();
  }
  const int const_int() const {return 1;}
};

template <typename T> class TemplateClass {
public:
  bool operator==(int other) {return true;}
  bool foo(void) {return true;}
};

namespace nm {
bool operator==(ConstClass, int) {return true;}
} // namespace nm

#endif