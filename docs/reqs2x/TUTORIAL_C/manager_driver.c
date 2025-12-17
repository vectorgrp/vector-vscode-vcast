#include <stdio.h>
#include <string.h>
#include "ctypes.h"

extern int Place_Order(table_index_type Table,
                       seat_index_type Seat,
                       struct order_type Order);

extern int Clear_Table(table_index_type Table);

extern FLOAT Get_Check_Total(table_index_type Table);

extern void Add_Included_Dessert(struct order_type* Order);

int main()
{
  struct order_type order;
  int Total;

  char line[10];

#if defined (ORDER)
  line[0] = 'P';
#elif defined (CHECK)
  line[0] = 'G';
#else
  printf("P=Place_Order C=ClearTable G=Get_Check_Total A=AddIncludedDessert : ");
  scanf("%s",line);
#endif

  switch (line[0])
  {
    case 'p': case 'P':
      order.Entree = STEAK;
      Place_Order(1, 1, order);
      break;
    case 'g': case 'G':
      order.Entree = CHICKEN;
      Place_Order(2, 2, order);
      Total = (int)Get_Check_Total(2);
      printf("The Total is %d\n", Total);
      break;
    case 'c': case 'C':
      Clear_Table(1);
      break;
    case 'a': case 'A':
      order.Entree = STEAK;
      order.Salad = CAESAR;
      order.Beverage = MIXED_DRINK;
      Add_Included_Dessert(&order);
      break;
  }

  return 0;
}
