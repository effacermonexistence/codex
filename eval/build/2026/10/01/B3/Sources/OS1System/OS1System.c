#include "OS1System.h"
#include <sys/file.h>

int os1_flock(int descriptor, int operation) {
    return flock(descriptor, operation);
}
