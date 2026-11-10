import sys
for path in sys.argv[1:]:
    d=open(path,'rb').read()
    def leb(i):
        r=s=0
        while True:
            b=d[i];i+=1;r|=(b&0x7f)<<s;s+=7
            if b<0x80:return r,i
    i=8;names={0:'custom',1:'type',2:'import',3:'function',5:'memory',6:'global',7:'export',9:'element',10:'code',11:'data',12:'datacount'}
    out=[]
    while i<len(d):
        sid=d[i];n,j=leb(i+1);label=names.get(sid,str(sid))
        if sid==0:
            l,k=leb(j);label+=':'+d[k:k+l].decode()
        if sid in(10,3,11):
            c,_=leb(j);label+=f'[{c}]'
        out.append(f'{label} {n/1048576:.2f}MB')
        i=j+n
    print(f'{len(d)/1048576:.1f}MB', path.split('/')[-2:], '|', ', '.join(out))
