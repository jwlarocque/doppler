// ES5 port of lz4 HC by Yann Collet, BSD 2-Clause License.
// https://github.com/lz4/lz4


var MINMATCH = 4;
var ML_MASK = 15;
var RUN_MASK = 15;
var LASTLITERALS = 5;
var MFLIMIT = 12;
var MINLENGTH = MFLIMIT + 1;
var DISTANCE_MAX = 65535;
var OPTIMAL_ML = (ML_MASK - 1) + MINMATCH;

var HASH_LOG = 15;
var HASH_SIZE = 1 << HASH_LOG;
var CHAIN_SIZE = 1 << 16;
var CHAIN_MASK = CHAIN_SIZE - 1;
var INDEX_BASE = 1 << 16;

var SEARCHES_BY_LEVEL = [0, 4, 4, 4, 8, 16, 32, 64, 128, 256];
var DEFAULT_LEVEL = 9;

var hashTable = new Uint32Array(HASH_SIZE);
var chainTable = new Uint16Array(CHAIN_SIZE);

function compressBound(length) {
  return (length + (length / 255) + 16) | 0;
}

function clearTables() {
  var i;
  for (i = 0; i < HASH_SIZE; i++) hashTable[i] = 0;
  for (i = 0; i < CHAIN_SIZE; i++) chainTable[i] = 0xffff;
}

// 32-bit multiply with float-only arithmetic
function imul32(a, b) {
  var al = a & 65535;
  var ah = (a >>> 16) & 65535;
  var bl = b & 65535;
  var bh = (b >>> 16) & 65535;
  return (al * bl + (((ah * bl + al * bh) << 16) >>> 0)) | 0;
}

function read16(src, i) {
  return src[i] | (src[i + 1] << 8);
}

function read32(src, i) {
  return (src[i] | (src[i + 1] << 8) | (src[i + 2] << 16) | (src[i + 3] << 24)) >>> 0;
}

// LZ4HC_hashPtr
function hashPtr(src, i) {
  return (imul32(read32(src, i), 2654435761) >>> ((MINMATCH * 8) - HASH_LOG)) & (HASH_SIZE - 1);
}

// LZ4_count
function countMatches(src, p, q, limit) {
  var start = p;
  while (p + 4 <= limit && read32(src, p) === read32(src, q)) {
    p += 4;
    q += 4;
  }
  while (p < limit && src[p] === src[q]) {
    p++;
    q++;
  }
  return p - start;
}

// LZ4HC_countBack
function countBack(src, ip, matchPos, iMin, mMin) {
  var back = 0;
  var min = Math.max(iMin - ip, mMin - matchPos);
  while ((back - min) > 3) {
    var v = (read32(src, ip + back - 4) ^ read32(src, matchPos + back - 4)) >>> 0;
    if (v !== 0) return back - nbCommonBytes(v);
    back -= 4;
  }
  while (back > min && src[ip + back - 1] === src[matchPos + back - 1]) back--;
  return back;
}

// count of common bytes from the high end of nonzero v
function nbCommonBytes(v) {
  if ((v & 0xff000000) !== 0) return 0;
  if ((v & 0xffff0000) !== 0) return 1;
  if ((v & 0xffffff00) !== 0) return 2;
  return 3;
}

// LZ4HC_countPattern
function countPattern(src, ip, iEnd, pattern) {
  var start = ip;
  while (ip + 4 <= iEnd && read32(src, ip) === pattern) ip += 4;
  while (ip < iEnd && src[ip] === ((pattern >>> (((ip - start) & 3) << 3)) & 255)) ip++;
  return ip - start;
}

// LZ4HC_reverseCountPattern
function reverseCountPattern(src, ip, iLow, pattern) {
  var start = ip;
  while (ip >= iLow + 4 && read32(src, ip - 4) === pattern) ip -= 4;
  while (ip > iLow && src[ip - 1] === ((pattern >>> ((3 - ((start - ip) & 3)) << 3)) & 255)) ip--;
  return start - ip;
}

// LZ4HC_protectDictEnd
// (always true)
function protectDictEnd(prefixIdx, matchIndex) {
  return (((prefixIdx - 1 - matchIndex) >>> 0) >= 3);
}

// LZ4HC_Insert
function hcInsert(hc, src, ip) {
  var target = ip + hc.prefixIdx;
  var idx = hc.nextToUpdate;
  while (idx < target) {
    var h = hashPtr(src, idx - hc.prefixIdx);
    var delta = idx - hashTable[h];
    if (delta > DISTANCE_MAX) delta = DISTANCE_MAX;
    chainTable[idx & CHAIN_MASK] = delta;
    hashTable[h] = idx;
    idx++;
  }
  hc.nextToUpdate = target;
}

function noMatch() {
  return { len: 0, off: 0, back: 0 };
}

// C structs copy
function dupMatch(m) {
  return { len: m.len, off: m.off, back: m.back };
}

// LZ4HC_InsertAndGetWiderMatch
// returns { len, off, back }.
function insertAndGetWiderMatch(hc, src, ip, iLowLimit, iHighLimit, longest,
    maxNbAttempts, patternAnalysis) {
  var prefixIdx = hc.prefixIdx;
  var ipIndex = ip + prefixIdx;
  var lowestMatchIndex = (hc.lowLimit + (DISTANCE_MAX + 1) > ipIndex) ?
    hc.lowLimit : ipIndex - DISTANCE_MAX;
  var lookBackLength = ip - iLowLimit;
  var nbAttempts = maxNbAttempts;
  var pattern = read32(src, ip);
  var offset = 0;
  var back = 0;
  var repeat = 0; // 0 untested, 1 not a repeat, 2 confirmed repeat
  var srcPatternLength = 0;

  hcInsert(hc, src, ip);
  var matchIndex = hashTable[hashPtr(src, ip)];

  while (matchIndex >= lowestMatchIndex && nbAttempts > 0) {
    var matchLength = 0;
    nbAttempts--;
    var matchPos = matchIndex - prefixIdx;
    if (matchPos >= 0 && longest >= 1 &&
        read16(src, iLowLimit + longest - 1) === read16(src, matchPos - lookBackLength + longest - 1) &&
        read32(src, matchPos) === pattern) {
      var countBackLen = lookBackLength !== 0 ?
        countBack(src, ip, matchPos, iLowLimit, 0) : 0;
      matchLength = MINMATCH + countMatches(src, ip + MINMATCH, matchPos + MINMATCH, iHighLimit);
      matchLength -= countBackLen;
      if (matchLength > longest) {
        longest = matchLength;
        offset = ipIndex - matchIndex;
        back = countBackLen;
      }
    }

    var distNext = chainTable[matchIndex & CHAIN_MASK];
    if (patternAnalysis !== 0 && distNext === 1) {
      var matchCandidateIdx = matchIndex - 1;
      if (repeat === 0) {
        if (((pattern & 65535) === (pattern >>> 16)) &&
            ((pattern & 255) === (pattern >>> 24))) {
          repeat = 2;
          srcPatternLength = countPattern(src, ip + MINMATCH, iHighLimit, pattern) + MINMATCH;
        } else {
          repeat = 1;
        }
      }
      if (repeat === 2 && matchCandidateIdx >= lowestMatchIndex &&
          protectDictEnd(prefixIdx, matchCandidateIdx)) {
        var candidatePos = matchCandidateIdx - prefixIdx;
        if (candidatePos >= 0 && read32(src, candidatePos) === pattern) {
          var forwardPatternLength = countPattern(src, candidatePos + MINMATCH, iHighLimit, pattern) + MINMATCH;
          var backLength = reverseCountPattern(src, candidatePos, 0, pattern);
          backLength = matchCandidateIdx - Math.max(matchCandidateIdx - backLength, lowestMatchIndex);
          var currentSegmentLength = backLength + forwardPatternLength;
          if (currentSegmentLength >= srcPatternLength &&
              forwardPatternLength <= srcPatternLength) {
            var newMatchIndex = matchCandidateIdx + forwardPatternLength - srcPatternLength;
            matchIndex = protectDictEnd(prefixIdx, newMatchIndex) ? newMatchIndex : prefixIdx;
          } else {
            var farMatchIndex = matchCandidateIdx - backLength;
            if (!protectDictEnd(prefixIdx, farMatchIndex)) {
              matchIndex = prefixIdx;
            } else {
              matchIndex = farMatchIndex;
              if (lookBackLength === 0) {
                var maxMl = currentSegmentLength < srcPatternLength ?
                  currentSegmentLength : srcPatternLength;
                if (longest < maxMl) {
                  if (ip - (matchIndex - prefixIdx) > DISTANCE_MAX) break;
                  longest = maxMl;
                  offset = ipIndex - matchIndex;
                }
                var distToNext = chainTable[matchIndex & CHAIN_MASK];
                if (distToNext > matchIndex) break;
                matchIndex -= distToNext;
              }
            }
          }
          continue;
        }
      }
    }

    matchIndex -= chainTable[matchIndex & CHAIN_MASK];
  }

  return { len: longest, off: offset, back: back };
}

// LZ4HC_InsertAndFindBestMatch
function insertAndFindBestMatch(hc, src, ip, iLimit, maxNbAttempts, patternAnalysis) {
  return insertAndGetWiderMatch(hc, src, ip, ip, iLimit, MINMATCH - 1,
    maxNbAttempts, patternAnalysis);
}

// LZ4HC_encodeSequence
function encodeSequence(src, dst, st, matchLength, offset) {
  var tokenPos = st.op++;
  var litLen = st.ip - st.anchor;
  if (litLen >= RUN_MASK) {
    var len = litLen - RUN_MASK;
    dst[tokenPos] = RUN_MASK << 4;
    for (; len >= 255; len -= 255) dst[st.op++] = 255;
    dst[st.op++] = len;
  } else {
    dst[tokenPos] = litLen << 4;
  }
  for (var i = 0; i < litLen; i++) dst[st.op++] = src[st.anchor + i];
  dst[st.op++] = offset & 255;
  dst[st.op++] = (offset >>> 8) & 255;
  var mlCode = matchLength - MINMATCH;
  if (mlCode >= ML_MASK) {
    dst[tokenPos] += ML_MASK;
    mlCode -= ML_MASK;
    for (; mlCode >= 510; mlCode -= 510) {
      dst[st.op++] = 255;
      dst[st.op++] = 255;
    }
    if (mlCode >= 255) {
      mlCode -= 255;
      dst[st.op++] = 255;
    }
    dst[st.op++] = mlCode;
  } else {
    dst[tokenPos] += mlCode;
  }
  st.ip += matchLength;
  st.anchor = st.ip;
}

// LZ4HC_compress_hashChain
// dst must be compressBound(src.length) bytes
// returns output length
function compressHashChain(hc, src, dst, maxNbAttempts, patternAnalysis) {
  var inputSize = src.length;
  var ip = 0;
  var anchor = 0;
  var op = 0;
  var iend = inputSize;
  var mflimit = iend - MFLIMIT;
  var matchlimit = iend - LASTLITERALS;
  var st = { ip: 0, op: 0, anchor: 0 };
  var m1;
  var m2;
  var m3;
  var start0;
  var start2;
  var start3;
  var m0;

  function emit(match) {
    st.ip = ip;
    st.op = op;
    st.anchor = anchor;
    encodeSequence(src, dst, st, match.len, match.off);
    ip = st.ip;
    op = st.op;
    anchor = st.anchor;
  }

main:
  while (ip <= mflimit) {
    m1 = insertAndFindBestMatch(hc, src, ip, matchlimit, maxNbAttempts, patternAnalysis);
    if (m1.len < MINMATCH) {
      ip++;
      continue;
    }
    start0 = ip;
    m0 = dupMatch(m1);
  search2:
    for (;;) {
      if (ip + m1.len <= mflimit) {
        start2 = ip + m1.len - 2;
        m2 = insertAndGetWiderMatch(hc, src, start2, ip, matchlimit, m1.len,
          maxNbAttempts, patternAnalysis);
        start2 += m2.back;
      } else {
        m2 = noMatch();
      }
      if (m2.len <= m1.len) {
        emit(m1);
        continue main;
      }
      if (start0 < ip && start2 < ip + m0.len) {
        ip = start0;
        m1 = dupMatch(m0);
      }
      if ((start2 - ip) < 3) {
        ip = start2;
        m1 = dupMatch(m2);
        continue search2;
      }
      for (;;) {
        if ((start2 - ip) < OPTIMAL_ML) {
          var newMl = m1.len > OPTIMAL_ML ? OPTIMAL_ML : m1.len;
          if (ip + newMl > start2 + m2.len - MINMATCH) {
            newMl = (start2 - ip) + m2.len - MINMATCH;
          }
          var correction = newMl - (start2 - ip);
          if (correction > 0) {
            start2 += correction;
            m2.len -= correction;
          }
        }
        if (start2 + m2.len <= mflimit) {
          start3 = start2 + m2.len - 3;
          m3 = insertAndGetWiderMatch(hc, src, start3, start2, matchlimit, m2.len,
            maxNbAttempts, patternAnalysis);
          start3 += m3.back;
        } else {
          m3 = noMatch();
        }
        if (m3.len <= m2.len) {
          if (start2 < ip + m1.len) m1.len = start2 - ip;
          emit(m1);
          ip = start2;
          emit(m2);
          continue main;
        }
        if (start3 < ip + m1.len + 3) {
          if (start3 >= ip + m1.len) {
            if (start2 < ip + m1.len) {
              var squeeze = (ip + m1.len) - start2;
              start2 += squeeze;
              m2.len -= squeeze;
              if (m2.len < MINMATCH) {
                start2 = start3;
                m2 = dupMatch(m3);
              }
            }
            emit(m1);
            ip = start3;
            m1 = dupMatch(m3);
            start0 = start2;
            m0 = dupMatch(m2);
            continue search2;
          }
          start2 = start3;
          m2 = dupMatch(m3);
          continue;
        }
        if (start2 < ip + m1.len) {
          if ((start2 - ip) < OPTIMAL_ML) {
            if (m1.len > OPTIMAL_ML) m1.len = OPTIMAL_ML;
            if (ip + m1.len > start2 + m2.len - MINMATCH) {
              m1.len = (start2 - ip) + m2.len - MINMATCH;
            }
            var fix = m1.len - (start2 - ip);
            if (fix > 0) {
              start2 += fix;
              m2.len -= fix;
            }
          } else {
            m1.len = start2 - ip;
          }
        }
        emit(m1);
        ip = start2;
        m1 = dupMatch(m2);
        start2 = start3;
        m2 = dupMatch(m3);
      }
    }
  }

  var lastRun = iend - anchor;
  if (lastRun >= RUN_MASK) {
    var acc = lastRun - RUN_MASK;
    dst[op++] = RUN_MASK << 4;
    for (; acc >= 255; acc -= 255) dst[op++] = 255;
    dst[op++] = acc;
  } else {
    dst[op++] = lastRun << 4;
  }
  for (var k = 0; k < lastRun; k++) dst[op++] = src[anchor + k];
  return op;
}

function searchesForLevel(level) {
  if (typeof level !== 'number' || level !== level) return SEARCHES_BY_LEVEL[DEFAULT_LEVEL];
  if (level < 1) return SEARCHES_BY_LEVEL[DEFAULT_LEVEL];
  if (level > DEFAULT_LEVEL) return SEARCHES_BY_LEVEL[DEFAULT_LEVEL];
  return SEARCHES_BY_LEVEL[level | 0];
}

// if compressor found no matches, send all-literals
function literalsOnly(data, dst) {
  var dIndex = 0;
  if (data.length < 15) {
    dst[dIndex++] = data.length << 4;
  } else {
    dst[dIndex++] = 0xf0;
    var remaining = data.length - 15;
    while (remaining >= 0xff) {
      dst[dIndex++] = 0xff;
      remaining -= 0xff;
    }
    dst[dIndex++] = remaining;
  }
  dst.set(data, dIndex);
  return dIndex + data.length;
}

// compress one block with lz4 HC
function compress(raw, level) {
  var data = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
  var maxNbAttempts = searchesForLevel(level);
  var patternAnalysis = maxNbAttempts > 128 ? 1 : 0;
  clearTables();
  var hc = { prefixIdx: INDEX_BASE, lowLimit: INDEX_BASE, nextToUpdate: INDEX_BASE };
  var dst = new Uint8Array(compressBound(data.length));
  var size = compressHashChain(hc, data, dst, maxNbAttempts, patternAnalysis);
  if (size === 0) size = literalsOnly(data, dst);
  return dst.slice(0, size);
}

// raw LZ4 block decompressor (for testing)
// returns the decompressed length
function decompressBlock(src, dst, sIndex, sLength, dIndex) {
  var sEnd = sIndex + sLength;
  while (sIndex < sEnd) {
    var token = src[sIndex++];
    var literalCount = token >>> 4;
    if (literalCount !== 0) {
      if (literalCount === 15) {
        var b;
        do {
          b = src[sIndex++];
          literalCount += b;
        } while (b === 255);
      }
      for (var n = sIndex + literalCount; sIndex < n;) dst[dIndex++] = src[sIndex++];
    }
    if (sIndex >= sEnd) break;
    var mOffset = src[sIndex++] | (src[sIndex++] << 8);
    var mLength = token & 15;
    if (mLength === 15) {
      var c;
      do {
        c = src[sIndex++];
        mLength += c;
      } while (c === 255);
    }
    mLength += MINMATCH;
    for (var i = dIndex - mOffset, end = i + mLength; i < end;) dst[dIndex++] = dst[i++] | 0;
  }
  return dIndex;
}

function decompress(block, uncompressedLength) {
  var data = block instanceof Uint8Array ? block : new Uint8Array(block);
  var dst = new Uint8Array(uncompressedLength);
  var size = decompressBlock(data, dst, 0, data.length, 0);
  if (size !== uncompressedLength) {
    throw new Error('lz4 length mismatch: got ' + size + ', want ' + uncompressedLength);
  }
  return dst;
}

module.exports = {
  compressBound: compressBound,
  compress: compress,
  decompress: decompress
};
