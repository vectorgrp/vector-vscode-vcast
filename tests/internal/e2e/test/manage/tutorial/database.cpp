#include "database.h"

TableDataType TableData[NumberOfTables];

DataBase::DataBase(){}

DataBase::~DataBase(){}

void DataBase::GetTableRecord(unsigned int Table, TableDataType* Data)
{
  *Data = TableData[Table];
}

void DataBase::UpdateTableRecord(unsigned int Table, TableDataType* Data)
{
  TableData[Table] = *Data;
}

void DataBase::DeleteRecord(unsigned int Table)
{
  DeleteOneRecord(Table, TableData);
}
