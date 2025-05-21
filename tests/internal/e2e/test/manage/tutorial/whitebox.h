#ifndef _WHITEBOX_
#define _WHITEBOX_

struct PointerType
{
  int DataIndex;
  int DataValue;
};


class WhiteBox
{
  public:
    WhiteBox() {}
    void Initialize();

  private:
    enum { RED, GREEN, BLUE };
    enum { MONDAY, TUESDAY, WEDNESDAY, THURSDAY };
    int CurrentColor;
    int CurrentDay;
    PointerType P;
    void InitDay(int Val);
    void InitColor(int Val);
};

#endif
