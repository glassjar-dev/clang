#include <iostream>
#include <stdexcept>
#include <string>
struct Guard { std::string name; ~Guard() { std::cout << "unwind " << name << '\n'; } };
int depth(int n) { Guard g{std::to_string(n)}; if (n == 0) throw std::runtime_error("bottom"); return depth(n - 1) + 1; }
int main() {
  try { depth(3); } catch (const std::exception &e) { std::cout << "caught " << e.what() << '\n'; }
  try { throw 42; } catch (int x) { std::cout << x << '\n'; }
}
