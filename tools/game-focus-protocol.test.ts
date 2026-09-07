import {test, expect} from 'bun:test';
import {createServer} from 'node:net';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const u = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const str = (s: string) => {
  const b = Buffer.from(s + '\0');
  return Buffer.concat([u(b.length), b, Buffer.alloc((4 - b.length % 4) % 4)]);
};
const msg = (id: number, op: number, ...args: Buffer[]) => {
  const b = Buffer.concat(args);
  return Buffer.concat([u(id), u(((b.length + 8) << 16) | op), b]);
};

async function probe(mode: 'active' | 'background' | 'unsupported' | 'disconnect' | 'timeout' | 'malformed') {
  const dir = await mkdtemp(join(tmpdir(), 'snn-wayland-test-'));
  const path = join(dir, 'socket');
  const server = createServer(socket => {
    let input = Buffer.alloc(0);
    socket.on('error', () => {});
    socket.on('data', data => {
      input = Buffer.concat([input, data]);
      while (input.length >= 8 && input.length >= input.readUInt32LE(4) >>> 16) {
        const id = input.readUInt32LE(0), op = input.readUInt16LE(4), size = input.readUInt32LE(4) >>> 16;
        const request = input.subarray(0, size);
        input = input.subarray(size);
        if (mode === 'disconnect') { socket.end(); return; }
        if (mode === 'timeout') continue;
        let reply = Buffer.alloc(0);
        if (id === 1 && op === 1 && mode !== 'unsupported') {
          reply = msg(2, 0, u(9), str('zwlr_foreign_toplevel_manager_v1'), u(3));
        } else if (id === 1 && op === 0) {
          reply = msg(request.readUInt32LE(8), 0, u(0));
        } else if (id === 2 && op === 0) {
          if (mode === 'malformed') reply = Buffer.concat([u(4), u(4 << 16)]);
          else reply = Buffer.concat([
            msg(4, 0, u(0xff000000)),
            msg(0xff000000, 1, str('gamescope')),
            msg(0xff000000, 4, mode === 'active' ? u(4) : u(0), ...(mode === 'active' ? [u(2)] : [])),
            msg(0xff000000, 5),
            msg(4, 0, u(0xff000001)),
            msg(0xff000001, 1, str('terminal')),
            msg(0xff000001, 4, mode === 'background' ? u(4) : u(0), ...(mode === 'background' ? [u(2)] : [])),
            msg(0xff000001, 5),
          ]);
        }
        // Small writes exercise stream framing without implementing it in Lua.
        for (let i = 0; i < reply.length; i += 3) socket.write(reply.subarray(i, i + 3));
      }
    });
  });
  await new Promise<void>(resolve => server.listen(path, resolve));
  try {
    const child = Bun.spawn(['luajit', '-e', `package.path='./backend/?.lua;'..package.path; local f=require('game_focus'); local w=f.snapshot(); print(f.select(553850,w,{553850}))`], {
      env: {...process.env, WAYLAND_DISPLAY: path, XDG_RUNTIME_DIR: dir}, stdout: 'pipe', stderr: 'pipe',
    });
    const output = await new Response(child.stdout).text();
    const error = await new Response(child.stderr).text();
    expect(await child.exited).toBe(0);
    return {output: output.trim(), error};
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(dir, {recursive: true});
  }
}

test('native protocol snapshot chooses active Gamescope', async () => expect((await probe('active')).output).toBe('game'));
test('native protocol snapshot chooses desktop for background Gamescope', async () => expect((await probe('background')).output).toBe('desktop'));
for (const mode of ['unsupported', 'disconnect', 'timeout', 'malformed'] as const) {
  test(`native protocol ${mode} stays unknown`, async () => expect((await probe(mode)).output).toBe('unknown'));
}
