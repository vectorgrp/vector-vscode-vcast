#include "line.h"

/* functions to determine missing value in 'y = mx + b' */

/* y = mx + b */
float findY ( float x, float m, float b ) {
   return m * x + b;
}

float findX ( float y, float m, float b ) {
   return ( y - b ) / m;
}

float findM ( struct coordT coord, float b ) {
   return ( coord.Y - b ) / coord.X;
}

float findB ( struct coordT coord, float m ) {
   return coord.Y - m * coord.X;
}
