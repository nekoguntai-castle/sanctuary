#include <stdio.h>
#include <stdlib.h>
#include <sys/types.h>
#include <unistd.h>

int main(void) {
  pid_t child = fork();
  if (child < 0) return 1;
  if (child == 0) {
    sleep(2);
    _exit(0);
  }
  printf("%ld\n", (long)child);
  fflush(stdout);
  sleep(30);
  return 0;
}
