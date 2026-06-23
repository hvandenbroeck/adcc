cat > /usr/local/bin/pipelined-fixup-proxy.py <<'PYEOF'
#!/usr/bin/env python3
# Fix-up forward proxy for the Adobe Campaign pipelined CONNECT-on-reconnect bug.
# pipelined points at THIS (localhost:8888). We chain upstream to McAfee, which
# does all DNS resolution -- the relay never resolves external names itself.
#   - proper CONNECT  -> forwarded verbatim to McAfee (passthrough)
#   - raw TLS (bug)   -> reconstruct CONNECT <sni>:443 to McAfee, replay ClientHello
# TLS is spliced, never decrypted. Hostname is preserved for McAfee's rules.
import socket, threading, select, time, base64

LISTEN_PORT = 8888                 # port pipelined's serverConf.xml proxy points to
PARENT_HOST = 'X'      # PROXY
PARENT_PORT = 8080
PARENT_USER = ''                   # set if proxy requires Basic  auth
PARENT_PASS = ''
LOGFILE     = '/var/log/pipelined-fixup.log'

def log(msg):
    line = '%s  %s' % (time.strftime('%Y-%m-%d %H:%M:%S'), msg)
    print(line, flush=True)
    try:
        with open(LOGFILE, 'a') as f: f.write(line + '\n')
    except Exception:
        pass

def parse_sni(data):
    try:
        if len(data) < 43 or data[0] != 0x16 or data[5] != 0x01: return None
        p = 5 + 4 + 2 + 32
        p += 1 + data[p]                                       # session id
        p += 2 + int.from_bytes(data[p:p+2], 'big')           # cipher suites
        p += 1 + data[p]                                       # compression
        end = p + 2 + int.from_bytes(data[p:p+2], 'big'); p += 2
        while p + 4 <= end:
            etype = int.from_bytes(data[p:p+2], 'big')
            elen  = int.from_bytes(data[p+2:p+4], 'big'); p += 4
            if etype == 0x0000:
                q = p + 5
                return data[q:q + int.from_bytes(data[p+3:p+5], 'big')].decode(errors='replace')
            p += elen
    except Exception:
        return None

def read_full_clienthello(sock, buf):
    while len(buf) < 5:
        d = sock.recv(4096)
        if not d: return buf
        buf += d
    if buf[0] != 0x16: return buf
    need = 5 + int.from_bytes(buf[3:5], 'big')
    while len(buf) < need:
        d = sock.recv(4096)
        if not d: break
        buf += d
    return buf

def recv_headers(sock, buf=b''):
    while b'\r\n\r\n' not in buf:
        d = sock.recv(4096)
        if not d: break
        buf += d
    return buf

def is_200(resp):
    try: return resp.split(b'\r\n', 1)[0].split()[1] == b'200'
    except Exception: return False

def connect_parent():
    return socket.create_connection((PARENT_HOST, PARENT_PORT), timeout=10)

def parent_connect(parent, host, port):
    req  = 'CONNECT %s:%d HTTP/1.1\r\nHost: %s:%d\r\n' % (host, port, host, port)
    if PARENT_USER:
        tok = base64.b64encode(('%s:%s' % (PARENT_USER, PARENT_PASS)).encode()).decode()
        req += 'Proxy-Authorization: Basic %s\r\n' % tok
    req += '\r\n'
    parent.sendall(req.encode())
    return recv_headers(parent)

def splice(a, b):
    a.setblocking(False); b.setblocking(False)
    socks = [a, b]
    while True:
        r, _, x = select.select(socks, [], socks, 300)
        if x: return
        if not r: continue
        for s in r:
            other = b if s is a else a
            try: data = s.recv(65535)
            except Exception: return
            if not data: return
            try: other.sendall(data)
            except Exception: return

def handle(client, addr):
    client.settimeout(30)
    parent = None
    try:
        first = client.recv(4096)
        if not first: return

        if first.startswith(b'CONNECT'):
            # ---------- healthy passthrough ----------
            req = recv_headers(client, first)
            hostport = req.split(b'\r\n', 1)[0].split()[1].decode(errors='replace')
            parent = connect_parent()
            parent.sendall(req)                       # verbatim (keeps pipelined's auth headers)
            resp = recv_headers(parent)
            client.sendall(resp)
            if not is_200(resp):
                log('CONNECT %s -> parent REFUSED: %s' % (hostport, resp.split(b"\r\n",1)[0].decode(errors="replace")))
                return
            splice(client, parent)
        else:
            # ---------- bug path: raw TLS, reconstruct the CONNECT ----------
            buf = read_full_clienthello(client, first)
            host = parse_sni(buf)
            if not host:
                log('FIXUP: raw TLS but no SNI; first16=%s -> dropping' % buf[:16].hex())
                return
            parent = connect_parent()
            resp = parent_connect(parent, host, 443)
            if not is_200(resp):
                log('FIXUP %s:443 -> parent REFUSED: %s' % (host, resp.split(b"\r\n",1)[0].decode(errors="replace")))
                return
            log('FIXUP healed missing CONNECT for %s:443' % host)
            parent.sendall(buf)                       # replay ClientHello; no 200 to client
            splice(client, parent)
    except Exception as e:
        log('error from %s: %r' % (addr[0] if addr else '?', e))
    finally:
        for s in (client, parent):
            try:
                if s: s.close()
            except Exception:
                pass

def main():
    srv = socket.socket(socket.AF_INET6, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)   # IPv4 + IPv6 ([::1])
    srv.bind(('::', LISTEN_PORT))
    srv.listen(128)
    log('pipelined fix-up proxy on [::]:%d -> parent %s:%d' % (LISTEN_PORT, PARENT_HOST, PARENT_PORT))
    while True:
        c, a = srv.accept()
        threading.Thread(target=handle, args=(c, a), daemon=True).start()

if __name__ == '__main__':
    main()
PYEOF
chmod +x /usr/local/bin/pipelined-fixup-proxy.py
