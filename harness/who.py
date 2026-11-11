# who.py <named.wasm> <regex>...: for each function whose name matches, list functions that call it
# (or hold its table index as a constant, i.e. take its address). Byte-pattern scan, so approximate.
import sys,re
d=open(sys.argv[1],'rb').read()
def leb(i):
    r=s=0
    while True:
        b=d[i];i+=1;r|=(b&0x7f)<<s;s+=7
        if b<0x80:return r,i
def uleb(n):
    o=bytearray()
    while True:
        b=n&0x7f;n>>=7
        if n:o.append(b|0x80)
        else:o.append(b);return bytes(o)
def sleb(n):
    o=bytearray()
    while True:
        b=n&0x7f;n>>=7
        if (n==0 and not b&0x40) or (n==-1 and b&0x40):o.append(b);return bytes(o)
        o.append(b|0x80)
i=8;nimp=0;bodies=[];names={};elem={}
while i<len(d):
    sid=d[i];n,j=leb(i+1);end=j+n
    if sid==2:
        c,k=leb(j)
        for _ in range(c):
            l,k=leb(k);k+=l;l,k=leb(k);k+=l;kind=d[k];k+=1
            if kind==0:_,k=leb(k);nimp+=1
            elif kind==1:k+=1;f,k=leb(k);_,k=leb(k);
            elif kind==2:
                f,k=leb(k);_,k=leb(k)
                if f&1:_,k=leb(k)
            elif kind==3:k+=2
    elif sid==9:
        c,k=leb(j)
        for _ in range(c):
            flag,k=leb(k)
            assert flag==0,flag
            assert d[k]==0x41; off,k2=leb(k+1); k=k2+1  # i32.const off; end (offset small positive)
            m,k=leb(k)
            for t in range(m):
                f,k=leb(k); elem[f]=off+t
    elif sid==10:
        c,k=leb(j)
        for _ in range(c):
            l,k2=leb(k);bodies.append((k2,k2+l));k=k2+l
    elif sid==0:
        l,k=leb(j);nm=d[k:k+l].decode();k+=l
        if nm=='name':
            while k<end:
                st=d[k];sl,k=leb(k+1);se=k+sl
                if st==1:
                    c,k=leb(k)
                    for _ in range(c):
                        idx,k=leb(k);l,k=leb(k);names[idx]=d[k:k+l].decode('utf8','replace');k+=l
                k=se
    i=end
for pat in sys.argv[2:]:
    r=re.compile(pat)
    for idx,nm in names.items():
        if not r.search(nm): continue
        pad=lambda n:bytes([(n>>(7*i))&0x7f|(0x80 if i<4 else 0) for i in range(5)])
        pats=[b'\x10'+uleb(idx),b'\x10'+pad(idx)]
        if idx in elem: pats+=[b'\x41'+sleb(elem[idx]),b'\x41'+pad(elem[idx])]
        print(f'== {nm[:100]} (fn {idx}{", table "+str(elem[idx]) if idx in elem else ""})')
        hits=0
        for fi,(a,b) in enumerate(bodies):
            body=d[a:b]
            for p in pats:
                if p in body:
                    print('   ','call' if p[0]==0x10 else 'addr',names.get(nimp+fi,'?')[:120]); hits+=1; break
            if hits>12: print('    ...'); break
