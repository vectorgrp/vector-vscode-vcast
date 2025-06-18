typedef struct location {
    int x;            
    int y;
} location_t;
location_t loc = {1,2};

enum Color { red, green, blue };
Color r = red;

int global = 20;

int external_add(int, int);
void log_result(int);

int bar(int z){
    int x = 1;
    int y = 2;

    if (x > loc.x)
        return x;

    if (x + y > z)
        return external_add(x, y);

    log_result(z);

    return x + y + global;
}