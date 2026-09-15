/* 桃白簪花 · 纯 JS 解密后备实现（零依赖）
 *
 * 为什么需要它：
 *   WebCrypto（crypto.subtle）只在「安全上下文」里存在 ——
 *   https、http://localhost、http://127.0.0.1 都算，但
 *   http://某域名、http://局域网IP 不算，此时 crypto.subtle 是 undefined。
 *   站点如果只有 HTTP（自建服务器没配证书、域名证书没签下来），加密板块会整个不可用。
 *
 *   这个文件用纯 JS 复刻同一套算法：PBKDF2-HMAC-SHA256 → AES-256-GCM，
 *   密文格式与 WebCrypto 逐字节一致（ciphertext || 16 字节 authTag），
 *   所以两边可以互换，已发布的密文不用重新加密。
 *
 * 只在 crypto.subtle 缺失时按需加载（选择逻辑见 vault.js）。
 * 安全上下文下的访客永远不会下载这个文件。
 *
 * 代价：纯 JS 没有硬件加速，60 万次 PBKDF2 大约几秒（视设备而定），
 * 因此解锁时分片让出主线程，避免页面假死。
 */
(function (global) {
  'use strict';

  /* ==================== 工具 ==================== */

  const yieldToUI = () => new Promise((resolve) => setTimeout(resolve, 0));

  function xorInto(dst, src) {
    for (let i = 0; i < dst.length; i += 1) dst[i] ^= src[i];
  }

  function writeU64(a, off, v) {
    const hi = Math.floor(v / 4294967296);
    const lo = v - hi * 4294967296;
    a[off] = (hi >>> 24) & 0xff;
    a[off + 1] = (hi >>> 16) & 0xff;
    a[off + 2] = (hi >>> 8) & 0xff;
    a[off + 3] = hi & 0xff;
    a[off + 4] = (lo >>> 24) & 0xff;
    a[off + 5] = (lo >>> 16) & 0xff;
    a[off + 6] = (lo >>> 8) & 0xff;
    a[off + 7] = lo & 0xff;
  }

  /* ==================== SHA-256 ==================== */

  const K256 = new Int32Array([
    0x428a2f98 | 0, 0x71374491 | 0, 0xb5c0fbcf | 0, 0xe9b5dba5 | 0,
    0x3956c25b | 0, 0x59f111f1 | 0, 0x923f82a4 | 0, 0xab1c5ed5 | 0,
    0xd807aa98 | 0, 0x12835b01 | 0, 0x243185be | 0, 0x550c7dc3 | 0,
    0x72be5d74 | 0, 0x80deb1fe | 0, 0x9bdc06a7 | 0, 0xc19bf174 | 0,
    0xe49b69c1 | 0, 0xefbe4786 | 0, 0x0fc19dc6 | 0, 0x240ca1cc | 0,
    0x2de92c6f | 0, 0x4a7484aa | 0, 0x5cb0a9dc | 0, 0x76f988da | 0,
    0x983e5152 | 0, 0xa831c66d | 0, 0xb00327c8 | 0, 0xbf597fc7 | 0,
    0xc6e00bf3 | 0, 0xd5a79147 | 0, 0x06ca6351 | 0, 0x14292967 | 0,
    0x27b70a85 | 0, 0x2e1b2138 | 0, 0x4d2c6dfc | 0, 0x53380d13 | 0,
    0x650a7354 | 0, 0x766a0abb | 0, 0x81c2c92e | 0, 0x92722c85 | 0,
    0xa2bfe8a1 | 0, 0xa81a664b | 0, 0xc24b8b70 | 0, 0xc76c51a3 | 0,
    0xd192e819 | 0, 0xd6990624 | 0, 0xf40e3585 | 0, 0x106aa070 | 0,
    0x19a4c116 | 0, 0x1e376c08 | 0, 0x2748774c | 0, 0x34b0bcb5 | 0,
    0x391c0cb3 | 0, 0x4ed8aa4a | 0, 0x5b9cca4f | 0, 0x682e6ff3 | 0,
    0x748f82ee | 0, 0x78a5636f | 0, 0x84c87814 | 0, 0x8cc70208 | 0,
    0x90befffa | 0, 0xa4506ceb | 0, 0xbef9a3f7 | 0, 0xc67178f2 | 0
  ]);

  const IV256 = new Int32Array([
    0x6a09e667 | 0, 0xbb67ae85 | 0, 0x3c6ef372 | 0, 0xa54ff53a | 0,
    0x510e527f | 0, 0x9b05688c | 0, 0x1f83d9ab | 0, 0x5be0cd19 | 0
  ]);

  /* 处理一个 64 字节块，就地更新 8 个 32 位状态字 */
  function compress(h, block, offset, W) {
    for (let i = 0; i < 16; i += 1) {
      const p = offset + i * 4;
      W[i] = (block[p] << 24) | (block[p + 1] << 16) | (block[p + 2] << 8) | block[p + 3];
    }
    for (let i = 16; i < 64; i += 1) {
      const x = W[i - 15];
      const y = W[i - 2];
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
    }

    let a = h[0]; let b = h[1]; let c = h[2]; let d = h[3];
    let e = h[4]; let f = h[5]; let g = h[6]; let hh = h[7];

    for (let i = 0; i < 64; i += 1) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K256[i] + W[i]) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      hh = g; g = f; f = e; e = (d + t1) | 0;
      d = c; c = b; b = a; a = (t1 + t2) | 0;
    }

    h[0] = (h[0] + a) | 0; h[1] = (h[1] + b) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0;
    h[4] = (h[4] + e) | 0; h[5] = (h[5] + f) | 0; h[6] = (h[6] + g) | 0; h[7] = (h[7] + hh) | 0;
  }

  function stateToBytes(h, out, outOff) {
    for (let i = 0; i < 8; i += 1) {
      const v = h[i];
      out[outOff + i * 4] = (v >>> 24) & 0xff;
      out[outOff + i * 4 + 1] = (v >>> 16) & 0xff;
      out[outOff + i * 4 + 2] = (v >>> 8) & 0xff;
      out[outOff + i * 4 + 3] = v & 0xff;
    }
  }

  function sha256Bytes(msg) {
    const h = Int32Array.from(IV256);
    const W = new Int32Array(64);
    const len = msg.length;
    const blocks = Math.ceil((len + 9) / 64);
    const padded = new Uint8Array(blocks * 64);
    padded.set(msg, 0);
    padded[len] = 0x80;
    writeU64(padded, padded.length - 8, len * 8);
    for (let i = 0; i < blocks; i += 1) compress(h, padded, i * 64, W);
    const out = new Uint8Array(32);
    stateToBytes(h, out, 0);
    return out;
  }

  /* ---------- HMAC-SHA256 ----------
   * PBKDF2 每次迭代要跑一次 HMAC。keyPad 那 64 字节是固定的，
   * 所以把它压缩后的状态预先算好，每轮只剩 2 次压缩（内层 1 次 + 外层 1 次），
   * 比裸实现快一倍。消息长度限定 ≤ 55 字节（PBKDF2 这里只会是 20 或 32）。
   */
  function makeHmac(keyBytes) {
    let key = keyBytes;
    if (key.length > 64) key = sha256Bytes(key);
    const pad = new Uint8Array(64);
    pad.set(key, 0);

    const ipad = new Uint8Array(64);
    const opad = new Uint8Array(64);
    for (let i = 0; i < 64; i += 1) {
      ipad[i] = pad[i] ^ 0x36;
      opad[i] = pad[i] ^ 0x5c;
    }

    const W = new Int32Array(64);
    const inBase = Int32Array.from(IV256);
    const outBase = Int32Array.from(IV256);
    compress(inBase, ipad, 0, W);
    compress(outBase, opad, 0, W);

    const blk = new Uint8Array(64);
    const mid = new Int32Array(8);
    const fin = new Int32Array(8);

    return function hmac(msg, out32) {
      const mlen = msg.length;

      /* 内层：iPad(已压缩) + msg，补位后总长 64 + mlen */
      blk.fill(0);
      blk.set(msg, 0);
      blk[mlen] = 0x80;
      writeU64(blk, 56, (64 + mlen) * 8);
      mid.set(inBase);
      compress(mid, blk, 0, W);

      /* 外层：oPad(已压缩) + innerHash(32) */
      blk.fill(0);
      stateToBytes(mid, blk, 0);
      blk[32] = 0x80;
      writeU64(blk, 56, 768);
      fin.set(outBase);
      compress(fin, blk, 0, W);

      stateToBytes(fin, out32, 0);
    };
  }

  /* ---------- PBKDF2-HMAC-SHA256 ---------- */

  async function pbkdf2(passwordBytes, salt, iterations) {
    const hmac = makeHmac(passwordBytes);
    const u = new Uint8Array(32);
    const t = new Uint8Array(32);

    /* U1 = HMAC(P, salt || INT(1)) */
    const first = new Uint8Array(salt.length + 4);
    first.set(salt, 0);
    first[salt.length + 3] = 1;
    hmac(first, u);
    t.set(u);

    /* U_i = HMAC(P, U_{i-1})，就地覆盖是安全的：
       hmac() 开头就把 msg 复制进内部缓冲，直到最后才写 out32。 */
    for (let i = 1; i < iterations; i += 1) {
      hmac(u, u);
      xorInto(t, u);
      if ((i & 0x3fff) === 0) await yieldToUI();
    }
    return t;
  }

  /* ==================== AES-256 ==================== */

  const SBOX = new Uint8Array([
    0x63, 0x7c, 0x77, 0x7b, 0xf2, 0x6b, 0x6f, 0xc5, 0x30, 0x01, 0x67, 0x2b, 0xfe, 0xd7, 0xab, 0x76,
    0xca, 0x82, 0xc9, 0x7d, 0xfa, 0x59, 0x47, 0xf0, 0xad, 0xd4, 0xa2, 0xaf, 0x9c, 0xa4, 0x72, 0xc0,
    0xb7, 0xfd, 0x93, 0x26, 0x36, 0x3f, 0xf7, 0xcc, 0x34, 0xa5, 0xe5, 0xf1, 0x71, 0xd8, 0x31, 0x15,
    0x04, 0xc7, 0x23, 0xc3, 0x18, 0x96, 0x05, 0x9a, 0x07, 0x12, 0x80, 0xe2, 0xeb, 0x27, 0xb2, 0x75,
    0x09, 0x83, 0x2c, 0x1a, 0x1b, 0x6e, 0x5a, 0xa0, 0x52, 0x3b, 0xd6, 0xb3, 0x29, 0xe3, 0x2f, 0x84,
    0x53, 0xd1, 0x00, 0xed, 0x20, 0xfc, 0xb1, 0x5b, 0x6a, 0xcb, 0xbe, 0x39, 0x4a, 0x4c, 0x58, 0xcf,
    0xd0, 0xef, 0xaa, 0xfb, 0x43, 0x4d, 0x33, 0x85, 0x45, 0xf9, 0x02, 0x7f, 0x50, 0x3c, 0x9f, 0xa8,
    0x51, 0xa3, 0x40, 0x8f, 0x92, 0x9d, 0x38, 0xf5, 0xbc, 0xb6, 0xda, 0x21, 0x10, 0xff, 0xf3, 0xd2,
    0xcd, 0x0c, 0x13, 0xec, 0x5f, 0x97, 0x44, 0x17, 0xc4, 0xa7, 0x7e, 0x3d, 0x64, 0x5d, 0x19, 0x73,
    0x60, 0x81, 0x4f, 0xdc, 0x22, 0x2a, 0x90, 0x88, 0x46, 0xee, 0xb8, 0x14, 0xde, 0x5e, 0x0b, 0xdb,
    0xe0, 0x32, 0x3a, 0x0a, 0x49, 0x06, 0x24, 0x5c, 0xc2, 0xd3, 0xac, 0x62, 0x91, 0x95, 0xe4, 0x79,
    0xe7, 0xc8, 0x37, 0x6d, 0x8d, 0xd5, 0x4e, 0xa9, 0x6c, 0x56, 0xf4, 0xea, 0x65, 0x7a, 0xae, 0x08,
    0xba, 0x78, 0x25, 0x2e, 0x1c, 0xa6, 0xb4, 0xc6, 0xe8, 0xdd, 0x74, 0x1f, 0x4b, 0xbd, 0x8b, 0x8a,
    0x70, 0x3e, 0xb5, 0x66, 0x48, 0x03, 0xf6, 0x0e, 0x61, 0x35, 0x57, 0xb9, 0x86, 0xc1, 0x1d, 0x9e,
    0xe1, 0xf8, 0x98, 0x11, 0x69, 0xd9, 0x8e, 0x94, 0x9b, 0x1e, 0x87, 0xe9, 0xce, 0x55, 0x28, 0xdf,
    0x8c, 0xa1, 0x89, 0x0d, 0xbf, 0xe6, 0x42, 0x68, 0x41, 0x99, 0x2d, 0x0f, 0xb0, 0x54, 0xbb, 0x16
  ]);

  /* Te0..Te3：SubBytes + MixColumns 合成表，一轮只查 16 次表 */
  const Te0 = new Int32Array(256);
  const Te1 = new Int32Array(256);
  const Te2 = new Int32Array(256);
  const Te3 = new Int32Array(256);
  (function buildTables() {
    for (let i = 0; i < 256; i += 1) {
      const s = SBOX[i];
      const s2 = ((s << 1) ^ ((s & 0x80) ? 0x1b : 0)) & 0xff;
      const s3 = s2 ^ s;
      const v = ((s2 << 24) | (s << 16) | (s << 8) | s3) | 0;
      Te0[i] = v;
      Te1[i] = ((v >>> 8) | (v << 24)) | 0;
      Te2[i] = ((v >>> 16) | (v << 16)) | 0;
      Te3[i] = ((v >>> 24) | (v << 8)) | 0;
    }
  }());

  const RCON = new Uint8Array([
    0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36, 0x6c, 0xd8, 0xab, 0x4d
  ]);

  /* AES-256 密钥扩展：32 字节 key → 60 个 32 位轮密钥 */
  function expandKey(key) {
    const w = new Int32Array(60);
    for (let i = 0; i < 8; i += 1) {
      w[i] = ((key[i * 4] << 24) | (key[i * 4 + 1] << 16) | (key[i * 4 + 2] << 8) | key[i * 4 + 3]) | 0;
    }
    for (let i = 8; i < 60; i += 1) {
      let t = w[i - 1];
      if (i % 8 === 0) {
        t = ((SBOX[(t >>> 16) & 0xff] << 24) | (SBOX[(t >>> 8) & 0xff] << 16)
          | (SBOX[t & 0xff] << 8) | SBOX[(t >>> 24) & 0xff]) ^ (RCON[i / 8 - 1] << 24);
      } else if (i % 8 === 4) {
        t = (SBOX[(t >>> 24) & 0xff] << 24) | (SBOX[(t >>> 16) & 0xff] << 16)
          | (SBOX[(t >>> 8) & 0xff] << 8) | SBOX[t & 0xff];
      }
      w[i] = (w[i - 8] ^ t) | 0;
    }
    return w;
  }

  /* 加密一个 16 字节块 —— GCM 走 CTR，只需要加密方向 */
  function encryptBlock(rk, inp, off, out, ooff) {
    let s0 = (((inp[off] << 24) | (inp[off + 1] << 16) | (inp[off + 2] << 8) | inp[off + 3]) ^ rk[0]) | 0;
    let s1 = (((inp[off + 4] << 24) | (inp[off + 5] << 16) | (inp[off + 6] << 8) | inp[off + 7]) ^ rk[1]) | 0;
    let s2 = (((inp[off + 8] << 24) | (inp[off + 9] << 16) | (inp[off + 10] << 8) | inp[off + 11]) ^ rk[2]) | 0;
    let s3 = (((inp[off + 12] << 24) | (inp[off + 13] << 16) | (inp[off + 14] << 8) | inp[off + 15]) ^ rk[3]) | 0;

    let k = 4;
    for (let r = 1; r < 14; r += 1) {
      const t0 = Te0[s0 >>> 24] ^ Te1[(s1 >>> 16) & 0xff] ^ Te2[(s2 >>> 8) & 0xff] ^ Te3[s3 & 0xff] ^ rk[k];
      const t1 = Te0[s1 >>> 24] ^ Te1[(s2 >>> 16) & 0xff] ^ Te2[(s3 >>> 8) & 0xff] ^ Te3[s0 & 0xff] ^ rk[k + 1];
      const t2 = Te0[s2 >>> 24] ^ Te1[(s3 >>> 16) & 0xff] ^ Te2[(s0 >>> 8) & 0xff] ^ Te3[s1 & 0xff] ^ rk[k + 2];
      const t3 = Te0[s3 >>> 24] ^ Te1[(s0 >>> 16) & 0xff] ^ Te2[(s1 >>> 8) & 0xff] ^ Te3[s2 & 0xff] ^ rk[k + 3];
      s0 = t0 | 0; s1 = t1 | 0; s2 = t2 | 0; s3 = t3 | 0;
      k += 4;
    }

    /* 最后一轮：无 MixColumns */
    out[ooff] = SBOX[(s0 >>> 24) & 0xff] ^ ((rk[k] >>> 24) & 0xff);
    out[ooff + 1] = SBOX[(s1 >>> 16) & 0xff] ^ ((rk[k] >>> 16) & 0xff);
    out[ooff + 2] = SBOX[(s2 >>> 8) & 0xff] ^ ((rk[k] >>> 8) & 0xff);
    out[ooff + 3] = SBOX[s3 & 0xff] ^ (rk[k] & 0xff);

    out[ooff + 4] = SBOX[(s1 >>> 24) & 0xff] ^ ((rk[k + 1] >>> 24) & 0xff);
    out[ooff + 5] = SBOX[(s2 >>> 16) & 0xff] ^ ((rk[k + 1] >>> 16) & 0xff);
    out[ooff + 6] = SBOX[(s3 >>> 8) & 0xff] ^ ((rk[k + 1] >>> 8) & 0xff);
    out[ooff + 7] = SBOX[s0 & 0xff] ^ (rk[k + 1] & 0xff);

    out[ooff + 8] = SBOX[(s2 >>> 24) & 0xff] ^ ((rk[k + 2] >>> 24) & 0xff);
    out[ooff + 9] = SBOX[(s3 >>> 16) & 0xff] ^ ((rk[k + 2] >>> 16) & 0xff);
    out[ooff + 10] = SBOX[(s0 >>> 8) & 0xff] ^ ((rk[k + 2] >>> 8) & 0xff);
    out[ooff + 11] = SBOX[s1 & 0xff] ^ (rk[k + 2] & 0xff);

    out[ooff + 12] = SBOX[(s3 >>> 24) & 0xff] ^ ((rk[k + 3] >>> 24) & 0xff);
    out[ooff + 13] = SBOX[(s0 >>> 16) & 0xff] ^ ((rk[k + 3] >>> 16) & 0xff);
    out[ooff + 14] = SBOX[(s1 >>> 8) & 0xff] ^ ((rk[k + 3] >>> 8) & 0xff);
    out[ooff + 15] = SBOX[s2 & 0xff] ^ (rk[k + 3] & 0xff);
  }

  function inc32(counter) {
    for (let i = 15; i >= 12; i -= 1) {
      counter[i] = (counter[i] + 1) & 0xff;
      if (counter[i] !== 0) break;
    }
  }

  /* ==================== GHASH（GF(2^128) 乘法）==================== */

  /* GF(2^128) 乘法，NIST SP 800-38D 约定：
     位 0 是最高位，所以「乘 x」= 右移一位，最低位溢出时补 R = 11100001||0^120 */
  function gmulInto(dst, doff, x, y) {
    const v = Uint8Array.from(y);
    const z = new Uint8Array(16);
    for (let i = 0; i < 128; i += 1) {
      if (x[i >> 3] & (0x80 >> (i & 7))) {
        for (let j = 0; j < 16; j += 1) z[j] ^= v[j];
      }
      const lsb = v[15] & 1;
      for (let j = 15; j > 0; j -= 1) {
        v[j] = ((v[j] >>> 1) | ((v[j - 1] & 1) << 7)) & 0xff;
      }
      v[0] = v[0] >>> 1;
      if (lsb) v[0] ^= 0xe1;
    }
    for (let j = 0; j < 16; j += 1) dst[doff + j] = z[j];
  }

  /* 4-bit 表法：128 位 = 32 个 nibble，每个 nibble 位置一张 16 项表（共 8 KB），
     一次块乘只查 32 次表。
     表项用位法直接算出来 —— 手推 nibble 与指数的对应关系极易搞反方向，
     这里一次性花几十毫秒换取「不可能搞错」。 */
  function ghashInit(H) {
    const M = new Uint8Array(32 * 16 * 16);
    for (let i = 0; i < 32; i += 1) {
      for (let v = 1; v < 16; v += 1) {
        const blk = new Uint8Array(16);
        blk[i >> 1] = (i & 1) ? v : (v << 4);
        gmulInto(M, (i * 16 + v) * 16, blk, H);
      }
    }
    return M;
  }

  const GHASH_TMP = new Uint8Array(16);

  /* z = (z ^ x) · H */
  function ghashMul(z, x, M) {
    for (let i = 0; i < 16; i += 1) z[i] ^= x[i];
    GHASH_TMP.fill(0);
    for (let i = 0; i < 16; i += 1) {
      const hi = (z[i] >> 4) & 0x0f;
      const lo = z[i] & 0x0f;
      const a = (2 * i) * 256 + hi * 16;
      const b = (2 * i + 1) * 256 + lo * 16;
      for (let j = 0; j < 16; j += 1) GHASH_TMP[j] ^= M[a + j] ^ M[b + j];
    }
    z.set(GHASH_TMP);
  }

  /* ==================== AES-256-GCM 解密 ==================== */

  async function gcmDecrypt(keyBytes, iv, data) {
    if (keyBytes.length !== 32) throw new Error('密钥长度不是 32 字节');
    if (iv.length !== 12) throw new Error('IV 长度不是 12 字节');
    const cLen = data.length - 16;
    if (cLen < 0) throw new Error('密文太短');

    const rk = expandKey(keyBytes);

    const H = new Uint8Array(16);
    encryptBlock(rk, H, 0, H, 0);          /* H = E_K(0^128) */
    const M = ghashInit(H);

    /* J0 = IV || 0x00000001 */
    const J0 = new Uint8Array(16);
    J0.set(iv, 0);
    J0[15] = 1;

    /* 认证：先算 tag，验过了再吐明文（防伪造） */
    const z = new Uint8Array(16);
    const blk = new Uint8Array(16);
    for (let off = 0; off < cLen; off += 16) {
      blk.fill(0);
      const n = Math.min(16, cLen - off);
      blk.set(data.subarray(off, off + n), 0);
      ghashMul(z, blk, M);
    }
    blk.fill(0);
    writeU64(blk, 0, 0);                    /* AAD 长度（本方案不使用 AAD） */
    writeU64(blk, 8, cLen * 8);
    ghashMul(z, blk, M);

    const ekJ0 = new Uint8Array(16);
    encryptBlock(rk, J0, 0, ekJ0, 0);

    let diff = 0;
    for (let i = 0; i < 16; i += 1) diff |= ekJ0[i] ^ z[i] ^ data[cLen + i];
    if (diff !== 0) throw new Error('口令不对，或内容已被改动');

    /* 解密：CTR counter 从 J0+1 起 */
    const out = new Uint8Array(cLen);
    const counter = new Uint8Array(16);
    counter.set(J0, 0);
    inc32(counter);
    const ks = new Uint8Array(16);
    for (let off = 0; off < cLen; off += 16) {
      encryptBlock(rk, counter, 0, ks, 0);
      inc32(counter);
      const n = Math.min(16, cLen - off);
      for (let i = 0; i < n; i += 1) out[off + i] = data[off + i] ^ ks[i];
      if ((off & 0xfffff) === 0 && off > 0) await yieldToUI();
    }
    return out;
  }

  /* ==================== 对外 ==================== */

  /* 返回原始密钥字节（32 字节），与 WebCrypto 的 deriveBits 等价 */
  async function deriveKey(password, salt, iterations) {
    const pw = new TextEncoder().encode(password);
    await yieldToUI();   /* 先让「正在解密…」渲染出来 */
    return pbkdf2(pw, salt, Number(iterations) || 600000);
  }

  function decrypt(keyBytes, iv, data) {
    return gcmDecrypt(keyBytes, iv, new Uint8Array(data));
  }

  global.TZVaultPure = {
    deriveKey,
    decrypt,
    supported: true,
    /* 仅给 tools/test-vault-pure.js 做逐层对照，生产代码不碰 */
    _internals: { expandKey, encryptBlock, ghashInit, ghashMul, inc32, sha256Bytes, writeU64 }
  };
}(typeof globalThis !== 'undefined' ? globalThis : window));
