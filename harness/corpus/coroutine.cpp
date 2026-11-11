// C++20 coroutines: the one feature whose lowering runs LLVM passes even at -O0.
#include <coroutine>
#include <cstdio>
#include <exception>
#include <utility>

template <typename T> struct Generator {
  struct promise_type {
    T current;
    Generator get_return_object() { return Generator{std::coroutine_handle<promise_type>::from_promise(*this)}; }
    std::suspend_always initial_suspend() noexcept { return {}; }
    std::suspend_always final_suspend() noexcept { return {}; }
    std::suspend_always yield_value(T value) { current = std::move(value); return {}; }
    void return_void() {}
    void unhandled_exception() { std::terminate(); }
  };
  explicit Generator(std::coroutine_handle<promise_type> h) : handle(h) {}
  Generator(Generator &&other) noexcept : handle(std::exchange(other.handle, {})) {}
  ~Generator() { if (handle) handle.destroy(); }
  bool next() { handle.resume(); return !handle.done(); }
  T value() const { return handle.promise().current; }
  std::coroutine_handle<promise_type> handle;
};

Generator<int> fibonacci(int count) {
  int a = 0, b = 1;
  for (int i = 0; i < count; ++i) {
    co_yield a;
    a = std::exchange(b, a + b);
  }
}

int main() {
  int sum = 0;
  for (auto g = fibonacci(10); g.next();) sum += g.value();
  std::printf("%d\n", sum);
  return sum == 88 ? 0 : 1;
}
