#include <array>
#include <vector>

int three_args(int x, int y, int z) {}

void (*fptr(void (*)(int, int)))(int, int) {}

void fptr_2(int, int, void (*)(int, int), void (*)(int, int)) {}

std::array<void (*)(void), 1> templates(std::array<int, 1>, int) {}

class ConstClass {
public:
  std::vector<int> const_template() const {}
  const int const_int() const {}
};

template <typename T> class TemplateClass {
public:
  bool operator==(int other) {}
  bool foo(void) {}
};

namespace nm {
bool operator==(ConstClass, int) {}
} // namespace nm

bool operator==(TemplateClass<int>, TemplateClass<int>) {}
