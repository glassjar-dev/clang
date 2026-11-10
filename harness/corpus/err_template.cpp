#include <map>
#include <string>
struct Key { int a; };
int main() { std::map<Key, std::string> m; m[Key{1}] = "x"; }
