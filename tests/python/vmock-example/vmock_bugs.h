#ifndef BUGS_H
#define BUGS_H

/* Here is the list of bugs in this file

These dataAPI bugs
- Duplicate paramter names for the template class operator
- fptr and fptr2 should not be mockable
- Duplicate parameter names for the templates and file scope operator

These are extension bugs
- Waiting for a reliable way to determine is_mockable 
  Must manually delete function pointer mock for now.
*/

#include <array>
#include <vector>

int three_args(int x, int y, int z);

void whatToReturn(int x, int y);

// BUG: These two should not be mockable, as soon as I have
// a reliable way to determine is_mockable these will not be generated
void (*fptr(void (*)(int, int)))(int, int);

void fptr_2(int, int, void (*)(int, int), void (*)(int, int));

// BUG: array of function pointers is returned here
std::array<void (*)(void), 1> getArrayOfFPtrs(std::array<int, 1>, int);

class ConstClass {
public:
  std::vector<int> const_template() const {
    return std::vector<int>();
  }
  const int const_int() const {return 1;}
};


namespace nm {
bool operator==(ConstClass, int) {return true;}
} // namespace nm

template <typename T> class TemplateClass {
public:
  bool operator==(int other) {return true;}
  bool foo(void) {return true;}
};

bool operator==(TemplateClass<int>, TemplateClass<int>);

typedef char ClassReturnRefArrayType[242];

class ClassReturnRefArray {
public:
  /*
   * functionObject.parameterization is going to be:
   *     `()const char[242]const`
   *
   * Notice: no space before the training `const`
   */
  ClassReturnRefArrayType const &get() const;
};

#endif
