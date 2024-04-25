#include <vunit/vunit.h>
#include "manager.h"
#include "cpptypes.h"

namespace
{
class managerFixture : public ::vunit::Fixture
{
protected:
  void SetUp(void) override {
    // Setup code goes here.
  }

  void TearDown(void) override {
    // Cleanup code goes here.
  }
};
} // namespace

VTEST(managerTests, ExampleTestCase) {
  VASSERT(true);
}

VTEST_F(managerTests, ExampleFixtureTestCase, managerFixture) {
  VASSERT_EQ(1+1, 2);
}


VTEST(managerTests, realTest) {
    int localSeat = 1;
    int localTable = 1;
    OrderType localOrder;

    localOrder.Entree = Lobster;

    Manager manager;
    manager.PlaceOrder(localTable, localSeat, localOrder);

    VASSERT_EQ(10, manager.GetCheckTotal(localTable));
}

VTEST(managerTests, fakeTest) {

}

VTEST(managerTests, compileErrorTest) {

      VASSERT_EQ(10, 20);
      VASSERT_EQ(10, 10);

      compile-error-here

}
