import { test, expect, ready, CONVERSATION, label } from './fixtures.mjs';

const calls = [
    { eventType: 'tool_call', data: { toolName: 'execute', toolCallId: 'pi-call', agentName: 'main', arguments: { command: 'fixture command' } } },
    { eventType: 'tool_call', data: { toolName: 'read_file', argumentsObj: null, arguments: '{"path":"fixture.txt"}' } },
    { eventType: 'tool_result', data: { toolName: 'read_file', result: { content: 'fixture file' }, success: false } },
    { eventType: 'tool_result', message: 'fixture output', data: { toolName: 'execute', toolCallId: 'pi-call', result: 'fixture output', success: true } }
];

async function expectToolCalls(row) {
    const tools = row.locator('.chat-tool');
    await expect(tools).toHaveCount(2);
    const execute = tools.filter({ hasText: 'execute (1/2)' });
    await expect(execute).toContainText('完成');
    await execute.locator('.semi-collapse-header').click();
    await expect(execute.locator('pre').nth(0)).toHaveText(/"command": "fixture command"/);
    await expect(execute.locator('pre').nth(1)).toHaveText('fixture output');

    const read = tools.filter({ hasText: 'read_file (2/2)' });
    await expect(read).toContainText('失败');
    await read.locator('.semi-collapse-header').click();
    await expect(read.locator('pre').nth(0)).toHaveText(/"path": "fixture.txt"/);
    await expect(read.locator('pre').nth(1)).toHaveText(/"content":\s*"fixture file"/);
}

test('shows tool call counts and details in the stream and in restored history', async ({ page, mockApi }) => {
    const reply = '已完成示例检查';
    const messageId = 'fixture-tool-assistant';
    const path = `/api/conversations/${CONVERSATION.id}`;
    const completed = { ...CONVERSATION, messages: [
        ...CONVERSATION.messages,
        { id: 'fixture-tool-user', role: 'user', content: '检查示例文件' },
        { id: messageId, role: 'assistant', content: reply, processDetails: calls }
    ] };
    mockApi.respond('GET', '/api/agent-loop/tasks', { json: { tasks: [] } });

    let showHistory;
    const historyGate = new Promise(resolve => { showHistory = resolve; });
    mockApi.respond('POST', '/api/agent/stream', () => {
        mockApi.respond('GET', path, async () => {
            await historyGate;
            return { json: completed };
        });
        const events = [
            ...calls.map(({ eventType, message, data }) => {
                const { result, ...summary } = data;
                return { type: eventType, message: message ?? JSON.stringify(result), data: { ...summary, _payloadDeferred: true } };
            }),
            { type: 'response', message: reply, data: { messageId, conversationId: CONVERSATION.id, finalizable: true } },
            { type: 'done', data: {} }
        ];
        return { contentType: 'text/event-stream; charset=utf-8', body: events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('') };
    });

    await page.goto(`/static/app/#/chat?conversation=${CONVERSATION.id}`);
    const main = await ready(page);
    const live = main.locator('.chat-msg-live');
    try {
        await main.getByRole('textbox', { name: label('chat.composerLabel', '对话内容'), exact: true }).fill('检查示例文件');
        await main.getByRole('button', { name: label('chat.send', '发送'), exact: true }).click();
        await expectToolCalls(live);
    } finally {
        showHistory();
    }
    await expect(live).toHaveCount(0);
    await page.reload();
    await ready(page);
    await expectToolCalls(main.locator('.chat-msg-assistant').last());
    expect(mockApi.writes().map(write => write.path)).toEqual(['/api/agent/stream']);
});
