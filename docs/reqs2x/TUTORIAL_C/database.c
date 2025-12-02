#include "ctypes.h"

struct table_data_type Table_Data[NUMBER_OF_TABLES];

struct table_data_type Get_Table_Record(table_index_type Table)
{
  return (Table_Data[Table]);
}

void Update_Table_Record(table_index_type Table, struct table_data_type Data)
{
  Table_Data[Table] = Data;
}
