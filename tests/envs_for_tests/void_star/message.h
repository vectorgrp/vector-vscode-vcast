#ifndef __MESSAGE_H__
#define __MESSAGE_H__

typedef struct {
   char* title;
   int int_value;
} INT_MESSAGE;

typedef struct {
   char* title;
   float float_value;
} FLOAT_MESSAGE;

typedef enum {
   VCAST_INT,
   VCAST_FLOAT
} MESSAGE_STRUCT_TYPE;

float get_message_value ( void * the_msg, MESSAGE_STRUCT_TYPE the_msg_t );

#endif
