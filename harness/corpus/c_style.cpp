#include <cstdio>
#include <cstdlib>
#include <cstring>
struct Node { int v; Node *next; };
int main(int argc, char **argv) {
  Node *head = nullptr;
  for (int i = 0; i < 5; i++) { Node *n = (Node *)malloc(sizeof(Node)); n->v = i * i; n->next = head; head = n; }
  char buf[64]; snprintf(buf, sizeof buf, "argc=%d", argc);
  for (Node *n = head; n; n = n->next) printf("%d ", n->v);
  printf("%s %zu\n", buf, strlen(buf));
}
