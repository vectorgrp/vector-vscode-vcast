#include <stdlib.h>

enum STATUS {
   FAIL,
   SUCCESS
};

/*
 *  A string duplication function that duplicates N characters of a string
 *  and returns an error code
 *
 *  \param src
 *  The source string
 *
 *  \param dst
 *  Will be set to the resultant string upon successful execution
 *
 *  \param len
 *  The number of characters to duplicate
 *
 *  @return
 *
 */
enum STATUS my_string_dupe( const char *src, char **dst, unsigned len ) {
   int i;
   *dst = (char*)malloc( (len * sizeof(int)) + 1 );

   if( *dst == 0 ) return FAIL;
   
   for( i=0; i<len; ++i ) {
      (*dst)[i] = src[i];
   }

   (*dst)[len] = '\0';
   
   return SUCCESS;
}
