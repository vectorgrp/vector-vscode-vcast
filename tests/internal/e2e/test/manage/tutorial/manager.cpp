#include "cpptypes.h"
#include "database.h"
#include "manager.h"





Manager::Manager(){
  WaitingListSize = 0;
  WaitingListIndex = 0; 
}


/* This function will add a free dessert to specific orders based on the
   entree, salad, and beverage choice */
void Manager::AddIncludedDessert(OrderType* Order)
{
  if(!Order)
    return;
     
  if(Order->Entree == Steak &&
     Order->Salad == Caesar &&
     Order->Beverage == MixedDrink) {
    
    Order->Dessert = Pies;
  
  } else if(Order->Entree == Lobster &&
            Order->Salad == Green &&
            Order->Beverage == Wine) {
    
    Order->Dessert = Cake;
  }
}

void Manager::PlaceOrder(unsigned int Table, unsigned int Seat, OrderType Order)
{
  TableDataType TableData;
  Data.DeleteTableRecord(&TableData);
  Data.GetTableRecord(Table, &TableData);

  TableData.IsOccupied = true;
  TableData.NumberInParty++;
  TableData.Order[Seat] = Order;
 
  /* Add a free dessert in some case */ 
  AddIncludedDessert(&TableData.Order[Seat]);

  switch(Order.Entree) {
    case Steak :
      TableData.CheckTotal += 14;
      break;
    case Chicken :
      TableData.CheckTotal += 10;
      break;
    case Lobster :
      TableData.CheckTotal += 18;
      break;
    case Pasta :
      TableData.CheckTotal += 12;
      break;
    default :
      break;
  }
  Data.UpdateTableRecord(Table, &TableData);
}

void Manager::ClearTable(unsigned int Table)
{
  Data.DeleteRecord(Table);
}

int Manager::GetCheckTotal(unsigned int Table)
{
  TableDataType TableData;
  Data.DeleteTableRecord(&TableData);
  Data.GetTableRecord(Table, &TableData);
  return TableData.CheckTotal;
}

void Manager::AddPartyToWaitingList(char* Name)
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

char* Manager::GetNextPartyToBeSeated() 
{
  if(WaitingListIndex > 9)
    WaitingListIndex = 0;
  return WaitingList[WaitingListIndex++];
}

