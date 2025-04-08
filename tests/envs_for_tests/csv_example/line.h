#ifndef LINE_H
#define LINE_H

struct coordT {
   float X;
   float Y;
   };

/* functions to determine missing value in 'y = mx + b' */

float findY ( float x, float m, float b );
float findX ( float y, float m, float b );
float findM ( struct coordT coord, float b );
float findB ( struct coordT coord, float m );

#endif
