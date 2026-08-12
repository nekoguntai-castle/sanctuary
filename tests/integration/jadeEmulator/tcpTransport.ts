import net from 'node:net';
import { Readable, Writable } from 'node:stream';

export interface JadeTcpTransport {
  reader: ReadableStreamDefaultReader<Uint8Array>;
  writer: WritableStreamDefaultWriter<Uint8Array>;
  invalidate: () => void;
}

export async function openJadeTcpTransport(host: string, port: number): Promise<JadeTcpTransport> {
  const socket = net.createConnection({ host, port });
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  });
  socket.setNoDelay(true);
  const readable = Readable.toWeb(socket) as ReadableStream<Uint8Array>;
  const writable = Writable.toWeb(socket) as WritableStream<Uint8Array>;
  return {
    reader: readable.getReader(),
    writer: writable.getWriter(),
    invalidate: () => socket.destroy(),
  };
}
