struct PointerType
{
  int DataIndex;
  int DataValue;
};

enum COLOR {RED, GREEN, BLUE};
enum DAY   {MONDAY, TUESDAY, WEDNESDAY, THURSDAY};

static enum COLOR CurrentColor;
static enum DAY  CurrentDay;

static struct PointerType P;

static void InitDay(enum DAY Val)
{
  CurrentDay = Val;
}

static void InitColor(enum COLOR Val)
{
  CurrentColor = Val;
}

void Initialize() 
{
  InitDay(WEDNESDAY);
  InitColor(BLUE);
  P.DataIndex = 1;
  P.DataValue = 12;
}

