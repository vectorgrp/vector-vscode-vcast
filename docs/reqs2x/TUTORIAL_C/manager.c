#include "ctypes.h"

struct table_data_type Get_Table_Record(table_index_type Table);
void Update_Table_Record(table_index_type Table, struct table_data_type Data);

/* Allow 10 Parties to wait */
static name_type WaitingList[10];
static unsigned int WaitingListSize = 0;
static unsigned int WaitingListIndex = 0;



/* This function will add a free dessert to specific orders based on the 
   entree, salad, and beverage choice */
void Add_Included_Dessert(struct order_type* Order)
{
  if(Order->Entree == STEAK &&
     Order->Salad == CAESAR &&
     Order->Beverage == MIXED_DRINK) {
    
    Order->Dessert = CAKE;
  
  } else if(Order->Entree == LOBSTER &&
            Order->Salad == GREEN &&
            Order->Beverage == WINE) {
    
    Order->Dessert = PIE;  
  }
}

int Place_Order(table_index_type Table,
                seat_index_type Seat,
                struct order_type Order)
{
  struct table_data_type Table_Data;

  Table_Data = Get_Table_Record(Table);

  Table_Data.Is_Occupied = v_true;
  Table_Data.Number_In_Party = Table_Data.Number_In_Party + 1;
  Table_Data.Order[Seat] = Order;

  /* Add a free dessert in some cases */
  Add_Included_Dessert(&Table_Data.Order[Seat]);
 
  switch(Order.Entree)
    {
    case NO_ENTREE : 
       break;
    case STEAK :
       Table_Data.Check_Total = Table_Data.Check_Total + COST_OF_STEAK;
       break;
    case CHICKEN :
       Table_Data.Check_Total = Table_Data.Check_Total + COST_OF_CHICKEN;
       break;
    case LOBSTER :
       Table_Data.Check_Total = Table_Data.Check_Total + COST_OF_LOBSTER;
       break;
    case PASTA :
       Table_Data.Check_Total = Table_Data.Check_Total + COST_OF_PASTA;
       break;
    }
  
  Update_Table_Record(Table, Table_Data);
  return 0;
}

int Clear_Table(table_index_type Table)
{
  struct table_data_type Table_Data;
  seat_index_type Seat;
  Table_Data = Get_Table_Record(Table);
  Table_Data.Is_Occupied = v_false;
  Table_Data.Number_In_Party = 1;

  for (Seat=0; Seat < SEATS_AT_ONE_TABLE; Seat++){
      Table_Data.Order[Seat].Soup     = NO_SOUP;
      Table_Data.Order[Seat].Salad    = NO_SALAD;
      Table_Data.Order[Seat].Entree   = NO_ENTREE;
      Table_Data.Order[Seat].Dessert  = NO_DESSERT;
      Table_Data.Order[Seat].Beverage = NO_BEVERAGE;
	  }
	  
  Table_Data.Check_Total = 0;
 
  Update_Table_Record(Table, Table_Data);
  return 0;
}

FLOAT Get_Check_Total(table_index_type Table)
{
  struct table_data_type Table_Data;
  Table_Data = Get_Table_Record(Table);
  return (Table_Data.Check_Total);
}

void Add_Party_To_Waiting_List(char* Name)
{
  int i = 0;
  if(WaitingListSize > 9)
    WaitingListSize = 0;
  
  while(Name && *Name) {
    WaitingList[WaitingListSize][i++] = *Name;
    Name++;
  }
  WaitingList[WaitingListSize++][i] = 0;
}

char* Get_Next_Party_To_Be_Seated(void)
{
  if(WaitingListIndex > 9)
    WaitingListIndex = 0;
  return WaitingList[WaitingListIndex++];
}
