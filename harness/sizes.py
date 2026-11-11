# Where the code size goes, function by function, in a build that kept its names
# (build-tiny/bin/llvm after ./build-glassjar.sh tiny).
#   python3 sizes.py <named.wasm> [regex ...]
# With no regex: the 40 largest functions. With regexes: the total and the largest
# functions for each. harness/who.py then says what keeps a function alive.
import re, sys
d = open(sys.argv[1], 'rb').read()
def leb(i):
    r = s = 0
    while True:
        b = d[i]; i += 1; r |= (b & 0x7f) << s; s += 7
        if b < 0x80: return r, i
i = 8; nimp = 0; sizes = []; names = {}
while i < len(d):
    sid = d[i]; n, j = leb(i + 1); end = j + n
    if sid == 2:
        c, k = leb(j)
        for _ in range(c):
            l, k = leb(k); k += l; l, k = leb(k); k += l; kind = d[k]; k += 1
            if kind == 0: _, k = leb(k); nimp += 1
            elif kind == 1: k += 1; f, k = leb(k); _, k = leb(k)
            elif kind == 2:
                f, k = leb(k); _, k = leb(k)
                if f & 1: _, k = leb(k)
            elif kind == 3: k += 2
    elif sid == 10:
        c, k = leb(j)
        for _ in range(c):
            l, k2 = leb(k); sizes.append(l + (k2 - k)); k = k2 + l
    elif sid == 0:
        l, k = leb(j); nm = d[k:k + l].decode(); k += l
        if nm == 'name':
            while k < end:
                st = d[k]; sl, k = leb(k + 1); se = k + sl
                if st == 1:
                    c, k = leb(k)
                    for _ in range(c):
                        idx, k = leb(k); l, k = leb(k); names[idx] = d[k:k + l].decode('utf8', 'replace'); k += l
                k = se
    i = end
if not names: sys.exit('no name section: link without --strip-all')
fns = sorted(((s, names.get(nimp + x, '?')) for x, s in enumerate(sizes)), reverse=True)
total = sum(sizes)
print(f'{len(sizes)} functions, {total / 1e6:.2f} MB of code')
for pat in sys.argv[2:] or ['']:
    hit = [(s, n) for s, n in fns if re.search(pat, n)]
    sub = sum(s for s, _ in hit)
    if pat: print(f'\n/{pat}/: {len(hit)} functions, {sub / 1e6:.2f} MB ({100 * sub / total:.1f}%)')
    for s, n in hit[:40 if not pat else 12]: print(f'  {s:8d}  {n[:130]}')
