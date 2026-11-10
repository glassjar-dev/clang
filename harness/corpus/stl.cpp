#include <algorithm>
#include <iostream>
#include <map>
#include <memory>
#include <numeric>
#include <optional>
#include <ranges>
#include <set>
#include <sstream>
#include <string>
#include <unordered_map>
#include <variant>
#include <vector>

template <typename T> struct Tree {
  T value;
  std::vector<std::unique_ptr<Tree>> children;
  int size() const { int n = 1; for (auto &c : children) n += c->size(); return n; }
};

int main() {
  std::vector<int> v(100);
  std::iota(v.begin(), v.end(), 1);
  auto evens = v | std::views::filter([](int x) { return x % 2 == 0; }) | std::views::transform([](int x) { return x * x; });
  long sum = 0;
  for (int x : evens) sum += x;
  std::map<std::string, int> counts;
  std::istringstream words("a b a c b a");
  for (std::string w; words >> w;) counts[w]++;
  std::unordered_map<int, std::set<int>> graph{{1, {2, 3}}, {2, {3}}};
  std::variant<int, std::string> var = std::string("hi");
  std::optional<int> maybe = counts.contains("a") ? std::optional(counts["a"]) : std::nullopt;
  Tree<int> t{1, {}};
  t.children.push_back(std::make_unique<Tree<int>>(Tree<int>{2, {}}));
  std::cout << sum << ' ' << counts.size() << ' ' << graph[1].size() << ' ' << std::get<std::string>(var) << ' ' << *maybe << ' ' << t.size() << '\n';
}
