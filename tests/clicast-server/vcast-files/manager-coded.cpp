#include <vunit/vunit.h>

VTEST(managerTests, pass) {
  VASSERT_EQ(2, 1+1);
}

VTEST(managerTests, fail) {
  VASSERT_EQ(3, 1+1);
}
