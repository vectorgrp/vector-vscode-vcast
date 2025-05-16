#include "whitebox.h"

void WhiteBox::Initialize()
{
  InitDay(MONDAY);
  InitColor(RED);
  P.DataIndex = 1;
  P.DataValue = 12;
}

void WhiteBox::InitDay(int Val)
{
  CurrentDay = Val;
}

void WhiteBox::InitColor(int Val)
{
  CurrentColor = Val;
}
