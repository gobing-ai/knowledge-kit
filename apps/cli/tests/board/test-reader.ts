import { type BoardRoutingOptions, createBoardHandler } from '../../src/board/reader';

const handlers = new Map<string, ReturnType<typeof createBoardHandler>>();
let next = 0;

export function registerTestReader(options: BoardRoutingOptions) {
    const url = `http://board-test-${++next}.invalid`;
    const handler = createBoardHandler(options);
    handlers.set(url, handler);
    return { url, stop: () => void handlers.delete(url) };
}

export async function fetchTestReader(input: string, init?: RequestInit): Promise<Response> {
    const handler = handlers.get(new URL(input).origin);
    if (handler === undefined) return fetch(input, init);
    return handler.fetch(new Request(input, init));
}
