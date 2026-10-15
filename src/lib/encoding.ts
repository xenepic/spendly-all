export interface DecodedText {
  text: string
  encoding: 'utf-8' | 'utf-16le' | 'utf-16be' | 'shift_jis'
}

/** BOM と内容から文字コードを判定してデコードする */
export function decodeCsv(buf: ArrayBuffer | Uint8Array): DecodedText {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: new TextDecoder('utf-16le').decode(bytes.subarray(2)), encoding: 'utf-16le' }
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { text: new TextDecoder('utf-16be').decode(bytes.subarray(2)), encoding: 'utf-16be' }
  }
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: new TextDecoder('utf-8').decode(bytes.subarray(3)), encoding: 'utf-8' }
  }
  // BOM なし UTF-16: ASCII 部分で偶数/奇数バイトに 0x00 が多く現れる
  const sample = bytes.subarray(0, Math.min(bytes.length, 2000))
  let evenZero = 0
  let oddZero = 0
  for (let i = 0; i < sample.length; i++) {
    if (sample[i] === 0) i % 2 === 0 ? evenZero++ : oddZero++
  }
  if (sample.length >= 4) {
    if (oddZero > sample.length / 8 && evenZero < oddZero / 4) {
      return { text: new TextDecoder('utf-16le').decode(bytes), encoding: 'utf-16le' }
    }
    if (evenZero > sample.length / 8 && oddZero < evenZero / 4) {
      return { text: new TextDecoder('utf-16be').decode(bytes), encoding: 'utf-16be' }
    }
  }
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8' }
  } catch {
    return { text: new TextDecoder('shift_jis').decode(bytes), encoding: 'shift_jis' }
  }
}
