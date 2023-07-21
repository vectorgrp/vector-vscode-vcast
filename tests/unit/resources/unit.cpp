typedef struct location {
    int x;            
    int y;
} location_t;
location_t loc = {1,2};

enum Color { red, green, blue };
Color r = red;

int global = 20;
int bar(int z){
    int x = 1;
    int y = 2;
    if (x > loc.x)
        return x;

    if (x + y > z)
        return z;
        
    return x + y + global;
}