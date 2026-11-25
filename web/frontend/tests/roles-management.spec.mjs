import { test, expect, ready, UI_PERMISSIONS } from './fixtures.mjs';

test.use({ appPermissions: [...UI_PERMISSIONS, 'roles:write', 'roles:delete'] });

const INITIAL_ROLES = [
    {
        name: 'Web应用扫描',
        description: 'Web漏洞检测专家',
        user_prompt: '优先关注 OWASP Top 10',
        icon: '\\U0001F310',
        tools: ['nmap_scan'],
        workflow_id: 'wf-web',
        workflow_version: 'v2',
        workflow_policy: 'auto',
        enabled: true
    },
    {
        name: '默认',
        description: '默认角色',
        user_prompt: '',
        icon: '🔵',
        tools: [],
        enabled: true
    }
];

const MOCK_TOOLS = [
    { name: 'nmap_scan', description: '端口扫描工具', enabled: true },
    { name: 'nuclei_scan', description: '漏洞模板扫描', enabled: true },
    { name: 'query_asset', description: '外部资产查询', enabled: false, is_external: true, external_mcp: 'asm' }
];

const MOCK_WORKFLOWS = [
    { id: 'wf-web', name: 'Web标准流程', enabled: true },
    { id: 'wf-api', name: 'API检测流程', enabled: true }
];

test('supports editing default role, full editing with tools/workflow, creating, and deleting roles', async ({ page, mockApi }) => {
    let roles = INITIAL_ROLES.map(r => ({ ...r }));

    mockApi.respond('GET', '/api/roles', () => ({ json: { roles } }));
    mockApi.respond('GET', '/api/config/tools', () => ({
        json: {
            tools: MOCK_TOOLS,
            total: MOCK_TOOLS.length,
            total_enabled: 2,
            page: 1,
            page_size: 20,
            total_pages: 1
        }
    }));
    mockApi.respond('GET', '/api/workflows', () => ({ json: { workflows: MOCK_WORKFLOWS } }));
    mockApi.respond('PUT', `/api/roles/${encodeURIComponent('默认')}`, ({ body }) => {
        roles = roles.map(r => (r.name === '默认' ? { ...body } : r));
        return { json: { message: '角色已更新', role: body } };
    });
    mockApi.respond('PUT', `/api/roles/${encodeURIComponent('Web应用扫描')}`, ({ body }) => {
        roles = roles.map(r => (r.name === 'Web应用扫描' ? { ...body } : r));
        return { json: { message: '角色已更新', role: body } };
    });
    mockApi.respond('POST', '/api/roles', ({ body }) => {
        roles = [...roles, { ...body }];
        return { json: { message: '角色已创建', role: body } };
    });
    mockApi.respond('DELETE', `/api/roles/${encodeURIComponent('API测试角色')}`, () => {
        roles = roles.filter(r => r.name !== 'API测试角色');
        return { json: { message: '角色已删除' } };
    });

    await page.goto('/static/app/#/roles-management');
    const main = await ready(page);

    // 默认角色排第一，有编辑按钮但没有删除按钮
    const rows = main.locator('tbody tr');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText('默认');
    await expect(rows.nth(0).getByRole('button', { name: '编辑' })).toBeVisible();
    await expect(rows.nth(0).getByRole('button', { name: /删除/ })).toHaveCount(0);

    // 1. 编辑默认角色：名称禁用、提示使用全部工具
    await rows.nth(0).getByRole('button', { name: '编辑' }).click();
    const drawer = page.getByRole('dialog');
    await expect(drawer).toBeVisible();
    await expect(drawer.locator('#cs-role-name-input')).toBeDisabled();
    await expect(drawer).toContainText('默认角色使用所有工具');
    await drawer.locator('#cs-role-desc-input').fill('更新后的默认角色说明');
    await drawer.getByRole('button', { name: '保存' }).click();
    await expect(drawer).toBeHidden();

    const defaultUpdate = mockApi.writes().find(w => w.method === 'PUT' && w.path === `/api/roles/${encodeURIComponent('默认')}`);
    expect(defaultUpdate?.body).toMatchObject({
        name: '默认',
        description: '更新后的默认角色说明',
        tools: [],
        enabled: true
    });

    // 2. 编辑普通角色：解码后的图标可见、保留 workflow_version、可勾选外部工具
    await rows.nth(1).getByRole('button', { name: '编辑' }).click();
    await expect(drawer).toBeVisible();
    await expect(drawer.locator('#cs-role-icon-input')).toHaveValue('🌐');
    await drawer.locator('.cs-role-tool-item', { hasText: 'query_asset' }).click();
    await drawer.getByRole('button', { name: '保存' }).click();
    await expect(drawer).toBeHidden();

    const webUpdate = mockApi.writes().find(w => w.method === 'PUT' && w.path === `/api/roles/${encodeURIComponent('Web应用扫描')}`);
    expect(webUpdate?.body).toMatchObject({
        name: 'Web应用扫描',
        icon: '🌐',
        workflow_id: 'wf-web',
        workflow_version: 'v2',
        workflow_policy: 'auto',
        tools: ['nmap_scan', 'asm::query_asset']
    });

    // 3. 新建角色
    await main.getByRole('button', { name: '新建角色' }).click();
    await expect(drawer).toBeVisible();
    await drawer.locator('#cs-role-name-input').fill('API测试角色');
    await drawer.locator('#cs-role-icon-input').fill('📡');
    await drawer.locator('#cs-role-desc-input').fill('专注接口安全');
    await drawer.locator('#cs-role-prompt-input').fill('检查鉴权与越权');
    await drawer.locator('.cs-role-tool-item', { hasText: 'nuclei_scan' }).click();
    await drawer.getByRole('button', { name: '保存' }).click();
    await expect(drawer).toBeHidden();

    const createWrite = mockApi.writes().find(w => w.method === 'POST' && w.path === '/api/roles');
    expect(createWrite?.body).toMatchObject({
        name: 'API测试角色',
        icon: '📡',
        description: '专注接口安全',
        user_prompt: '检查鉴权与越权',
        tools: ['nuclei_scan'],
        enabled: true
    });
    await expect(rows).toHaveCount(3);

    // 4. 删除普通角色
    const apiRow = main.locator('tbody tr', { hasText: 'API测试角色' });
    await apiRow.getByRole('button', { name: '删除 API测试角色' }).click();
    await page.getByRole('button', { name: '确定' }).click();
    await expect(rows).toHaveCount(2);
    expect(mockApi.writes().some(w => w.method === 'DELETE' && w.path === `/api/roles/${encodeURIComponent('API测试角色')}`)).toBe(true);
});
