#ifndef OS1_SYSTEM_H
#define OS1_SYSTEM_H

// C ABI wrapper avoids Swift SDK name collisions between struct flock and
// the flock function. It preserves the OS function's return value and errno.
int os1_flock(int descriptor, int operation);

#endif
