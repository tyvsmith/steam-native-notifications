/** Minimal request/event CDP transport. Every request is bounded and closed on disconnect. */
export class CDP {
    private next = 0;
    private pending = new Map<number, { resolve(value: any): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
    onEvent: (message: any) => void = () => {};
    readonly closed: Promise<void>;
    private finish!: () => void;
    private constructor(private socket: WebSocket) {
        this.closed = new Promise(resolve => { this.finish = resolve; });
        socket.addEventListener('message', event => {
            try {
                const message = JSON.parse(String(event.data));
                if (!message.id) { this.onEvent(message); return; }
                const request = this.pending.get(message.id);
                if (!request) return;
                clearTimeout(request.timer); this.pending.delete(message.id);
                if (message.error) request.reject(new Error(message.error.message));
                else request.resolve(message.result);
            } catch { /* malformed messages never dispatch host calls */ }
        });
        socket.addEventListener('close', () => this.dispose());
        socket.addEventListener('error', () => this.close());
    }
    static async connect(url: string): Promise<CDP> {
        const socket = new WebSocket(url);
        const client = new CDP(socket);
        await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => { client.close(); reject(new Error('CDP connection timeout')); }, 3000);
            socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
            socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('CDP connection failed')); }, { once: true });
        });
        return client;
    }
    call(method: string, params: Record<string, unknown> = {}): Promise<any> {
        if (this.socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error('CDP disconnected'));
        const id = ++this.next;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} timeout`)); }, 3000);
            this.pending.set(id, { resolve, reject, timer });
            try { this.socket.send(JSON.stringify({ id, method, params })); }
            catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
        });
    }
    private dispose(): void {
        for (const request of this.pending.values()) {
            clearTimeout(request.timer); request.reject(new Error('CDP disconnected'));
        }
        this.pending.clear(); this.finish();
    }
    close(): void { this.dispose(); this.socket.close(); }
}

export function endpoint(port: number): string {
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port must be an integer from 1 to 65535');
    return `http://127.0.0.1:${port}`;
}
export function targetSocket(target: any, port: number): string | null {
    if (target?.type !== 'page' || !['SharedJSContext', 'Steam Shared Context presented by Valve™', 'Steam', 'SP'].includes(target?.title)) return null;
    try {
        const page = new URL(target.url);
        if (page.hostname !== 'steamloopback.host' || (!['/index.html', '/sharedjscontext.html'].includes(page.pathname) && !page.pathname.startsWith('/routes/'))) return null;
        const socket = new URL(target.webSocketDebuggerUrl);
        if (socket.protocol !== 'ws:' || !['localhost', '127.0.0.1', '[::1]'].includes(socket.hostname) || Number(socket.port) !== port) return null;
        // Pin both discovery and websocket traffic to loopback; never trust an advertised remote endpoint.
        socket.hostname = '127.0.0.1'; return socket.href;
    } catch { return null; }
}
