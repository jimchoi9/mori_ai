"""Capability MAC bound to method, path, upload/asset, expiry and required MIME.

A private on-volume random key survives web restarts. Session credentials never
appear in URLs. Authentication and current ownership remain mandatory.
"""
import hashlib
import hmac
import os
import secrets
import tempfile
from urllib.parse import urlencode


class Signer:
    def __init__(self,root):
        root.mkdir(parents=True,exist_ok=True)
        path=root/'.capability-key'
        fd,temporary=tempfile.mkstemp(prefix='.capability-',dir=root)
        try:
            with os.fdopen(fd,'wb') as f:
                f.write(secrets.token_bytes(32)); f.flush(); os.fsync(f.fileno())
            try:
                os.link(temporary,path,follow_symlinks=False)
                directory=os.open(root,os.O_RDONLY|os.O_DIRECTORY)
                try: os.fsync(directory)
                finally: os.close(directory)
            except FileExistsError:
                pass
        finally:
            os.unlink(temporary)
        fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
        with os.fdopen(fd,'rb') as f: self.key=f.read(33)
        if len(self.key)!=32: raise ValueError('invalid capability key')

    def signature(self,method,path,entity,expires,mime):
        value='\n'.join((method,path,str(entity),str(expires),mime)).encode()
        return hmac.new(self.key,value,hashlib.sha256).hexdigest()

    def url(self,method,path,entity,expires,mime):
        return path+'?'+urlencode({'expires':expires,'signature':self.signature(method,path,entity,expires,mime)})

    def verify(self,method,path,entity,expires,mime,signature,now):
        if len(signature)!=64 or any(ch not in '0123456789abcdef' for ch in signature):
            return False
        return now<expires and hmac.compare_digest(signature,self.signature(method,path,entity,expires,mime))
