#include "message.h"

/* get_message_value
 *
 * returns a void pointer to the value contained in the message
 *  (the type of the returned value is based on the type of message
 *   struct which is passed in - it is the caller's responsibility
 *   to specify this type in the_msg_t parameter)
 * returns NULL if the_msg_t specifies an unknown message type.
 */
float get_message_value ( void * the_msg, MESSAGE_STRUCT_TYPE the_msg_t )
{
  /* the generic void * result to be returned */
   float result = 0;

   if ( the_msg_t == VCAST_INT ) {
     /* cast the incoming message to an INT_MESSAGE * */
      INT_MESSAGE * the_typed_msg = (INT_MESSAGE *) the_msg;

      /* extract the address of the value contained in the message */
      result = (float)(the_typed_msg->int_value);

   } else if ( the_msg_t == VCAST_FLOAT ) {
     /* cast the incoming message to a FLOAT_MESSAGE * */
      FLOAT_MESSAGE * the_typed_msg = (FLOAT_MESSAGE *) the_msg;

      /* extract the address of the value contained in the message */
      result = (the_typed_msg->float_value);

   } else {
     /* unknown message type, return NULL */
      result = 0;
   }

   return result;
}
