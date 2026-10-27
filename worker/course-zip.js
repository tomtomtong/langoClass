// Streaming ZIP for course backups. Reading uses the central directory and
// byte ranges, so each file is inflated on its own; writing stores files
// uncompressed with data descriptors, so nothing waits for a whole file.

const EOCD = 0x06054b50;
const ZIP64_LOCATOR = 0x07064b50;
const ZIP64_EOCD = 0x06064b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const DESCRIPTOR = 0x08074b50;
const MAX32 = 0xffffffff;

// source: { size, bytes(start, end) -> Uint8Array, stream(start, end) -> ReadableStream }
export async function readZipEntries(source) {
  const tailLength = Math.min(source.size, 22 + 0xffff);
  if (tailLength < 22) throw new Error("Invalid ZIP file.");
  const tailStart = source.size - tailLength;
  const tail = await source.bytes(tailStart, source.size);
  let at = -1;
  for (let i = tail.length - 22; i >= 0; i -= 1) {
    if (u32(tail, i) === EOCD) {
      at = i;
      break;
    }
  }
  if (at < 0) throw new Error("Invalid ZIP file.");

  let count = u16(tail, at + 10);
  let cdSize = u32(tail, at + 12);
  let cdOffset = u32(tail, at + 16);
  if (count === 0xffff || cdSize === MAX32 || cdOffset === MAX32) {
    const locatorAt = tailStart + at - 20;
    const locator = await source.bytes(locatorAt, locatorAt + 20);
    if (u32(locator, 0) !== ZIP64_LOCATOR) throw new Error("Invalid ZIP file.");
    const recordAt = u64(locator, 8);
    const record = await source.bytes(recordAt, recordAt + 56);
    if (u32(record, 0) !== ZIP64_EOCD) throw new Error("Invalid ZIP file.");
    count = u64(record, 32);
    cdSize = u64(record, 40);
    cdOffset = u64(record, 48);
  }
  if (cdOffset + cdSize > source.size) throw new Error("Invalid ZIP file.");

  const cd = await source.bytes(cdOffset, cdOffset + cdSize);
  const entries = [];
  let p = 0;
  for (let n = 0; n < count; n += 1) {
    if (u32(cd, p) !== CENTRAL) throw new Error("Invalid ZIP file.");
    const method = u16(cd, p + 10);
    let compressedSize = u32(cd, p + 20);
    let size = u32(cd, p + 24);
    const nameLength = u16(cd, p + 28);
    const extraLength = u16(cd, p + 30);
    const commentLength = u16(cd, p + 32);
    let offset = u32(cd, p + 42);
    const name = new TextDecoder().decode(cd.subarray(p + 46, p + 46 + nameLength));
    let e = p + 46 + nameLength;
    const extraEnd = e + extraLength;
    while (e + 4 <= extraEnd) {
      const id = u16(cd, e);
      const length = u16(cd, e + 2);
      if (id === 0x0001) {
        let q = e + 4;
        if (size === MAX32) { size = u64(cd, q); q += 8; }
        if (compressedSize === MAX32) { compressedSize = u64(cd, q); q += 8; }
        if (offset === MAX32) { offset = u64(cd, q); q += 8; }
      }
      e += 4 + length;
    }
    entries.push({ name: name.replace(/\\/g, "/").replace(/^\/+/, ""), method, compressedSize, size, offset });
    p = extraEnd + commentLength;
  }
  return entries.filter((entry) => !entry.name.endsWith("/"));
}

export async function openZipEntry(source, entry) {
  const header = await source.bytes(entry.offset, entry.offset + 30);
  if (u32(header, 0) !== LOCAL) throw new Error(`Invalid ZIP entry ${entry.name}.`);
  const start = entry.offset + 30 + u16(header, 26) + u16(header, 28);
  const raw = source.stream(start, start + entry.compressedSize);
  if (entry.method === 0) return raw;
  if (entry.method === 8) return raw.pipeThrough(new DecompressionStream("deflate-raw"));
  throw new Error(`Unsupported compression in ${entry.name}.`);
}

export async function readZipText(source, entry) {
  return new Response(await openZipEntry(source, entry)).text();
}

// Writes a ZIP to writer. Every file is stored (method 0); course media is
// already compressed, and storing keeps CPU time low.
export class ZipWriter {
  constructor(writer) {
    this.writer = writer;
    this.offset = 0;
    this.central = [];
  }

  async add(name, data) {
    const nameBytes = new TextEncoder().encode(name);
    const start = this.offset;
    const header = new Uint8Array(30 + nameBytes.length);
    const view = new DataView(header.buffer);
    view.setUint32(0, LOCAL, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0x0808, true);
    header.set(nameBytes, 30);
    view.setUint16(26, nameBytes.length, true);
    await this.#write(header);

    let crc = 0xffffffff;
    let size = 0;
    const chunks = typeof data === "string" || data instanceof Uint8Array ? null : data.getReader();
    if (!chunks) {
      const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
      crc = crc32(crc, bytes);
      size = bytes.length;
      await this.#write(bytes);
    } else {
      for (;;) {
        const { value, done } = await chunks.read();
        if (done) break;
        const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
        crc = crc32(crc, bytes);
        size += bytes.length;
        await this.#write(bytes);
      }
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    if (size > MAX32 || start > MAX32) throw new Error("Export is too large.");

    const descriptor = new Uint8Array(16);
    const d = new DataView(descriptor.buffer);
    d.setUint32(0, DESCRIPTOR, true);
    d.setUint32(4, crc, true);
    d.setUint32(8, size, true);
    d.setUint32(12, size, true);
    await this.#write(descriptor);
    this.central.push({ nameBytes, crc, size, start });
  }

  async finish() {
    const cdStart = this.offset;
    for (const entry of this.central) {
      const record = new Uint8Array(46 + entry.nameBytes.length);
      const view = new DataView(record.buffer);
      view.setUint32(0, CENTRAL, true);
      view.setUint16(4, 20, true);
      view.setUint16(6, 20, true);
      view.setUint16(8, 0x0808, true);
      view.setUint32(16, entry.crc, true);
      view.setUint32(20, entry.size, true);
      view.setUint32(24, entry.size, true);
      view.setUint16(28, entry.nameBytes.length, true);
      view.setUint32(42, entry.start, true);
      record.set(entry.nameBytes, 46);
      await this.#write(record);
    }
    const cdSize = this.offset - cdStart;
    if (this.central.length > 0xffff || cdStart > MAX32) throw new Error("Export is too large.");
    const end = new Uint8Array(22);
    const view = new DataView(end.buffer);
    view.setUint32(0, EOCD, true);
    view.setUint16(8, this.central.length, true);
    view.setUint16(10, this.central.length, true);
    view.setUint32(12, cdSize, true);
    view.setUint32(16, cdStart, true);
    await this.#write(end);
    await this.writer.close();
  }

  async #write(bytes) {
    this.offset += bytes.length;
    await this.writer.write(bytes);
  }
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(crc, bytes) {
  let c = crc;
  for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return c >>> 0;
}

function u16(bytes, at) {
  return bytes[at] | (bytes[at + 1] << 8);
}

function u32(bytes, at) {
  return (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 0;
}

function u64(bytes, at) {
  return u32(bytes, at) + u32(bytes, at + 4) * 0x100000000;
}
