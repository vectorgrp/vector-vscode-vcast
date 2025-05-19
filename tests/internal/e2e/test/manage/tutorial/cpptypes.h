#ifndef _TYPES_
#define _TYPES_

#if defined (__HC08__) || (defined (__HC12__) && defined (__PRODUCT_HICROSS_PLUS__))
typedef int bool;
#define false 0
#define true 1
#endif

const int SeatsAtOneTable = 4;
const int NumberOfTables = 6;

enum Soups     {NoSoup, Onion, Chowder};
enum Salads    {NoSalad, Caesar, Green};
enum Entrees   {NoEntree, Steak, Chicken, Lobster, Pasta};
enum Desserts  {NoDessert, Cake, Pies, Fruit};
enum Beverages {NoBeverage, Wine, Beer, MixedDrink, Soda};

struct OrderType 
{
  enum Soups     Soup;
  enum Salads    Salad;
  enum Entrees   Entree;
  enum Desserts  Dessert;
  enum Beverages Beverage;
};

struct TableDataType
{
  bool      IsOccupied;
  int       NumberInParty;
  char      Designator;
  char      WaitPerson[10];
  OrderType Order[SeatsAtOneTable];
  int       CheckTotal;
};

typedef char name_type[32];

#endif
