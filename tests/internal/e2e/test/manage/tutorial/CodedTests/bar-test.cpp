#include <vunit/vunit.h>
namespace {
class barFixture : public ::vunit::Fixture {
protected:
  void SetUp(void) override {
    // Set up code goes here.
  }

  void TearDown(void) override {
    // Tear down code goes here.
  }
};
} // namespace

VTEST(barTests, ExampleTestCase) {
  VASSERT(true);
}

VTEST_F(barTests, ExampleFixtureTestCase, barFixture) {
  VASSERT_EQ(2, 1+1);
}