import { useEffect, useMemo, useState } from 'react';
import {
    Banner, Button, Checkbox, Empty, Input, Pagination, Radio, RadioGroup, Select, Space, Spin, Switch, Tag, TextArea, Typography
} from '@douyinfe/semi-ui';
import { IconSearch } from '@douyinfe/semi-icons';
import { api } from '../../lib/http';
import { useAuth } from '../../lib/auth';
import { useDebounced } from '../../components/hooks';
import { Drawer, toastError, toastSuccess } from '../../components/ui';

const { Text } = Typography;

export const DEFAULT_ROLE_NAME = '默认';

export function formatRoleIcon(icon) {
    if (!icon || typeof icon !== 'string') return '';
    const trimmed = icon.trim();
    const unicodeMatch = trimmed.match(/^"?\\U([0-9A-F]{8})"?$/i);
    if (unicodeMatch) {
        try {
            return String.fromCodePoint(parseInt(unicodeMatch[1], 16));
        } catch {
            return trimmed;
        }
    }
    return trimmed;
}

function getToolKey(tool) {
    if (tool?.is_external && tool?.external_mcp) {
        return `${tool.external_mcp}::${tool.name}`;
    }
    return tool?.name || '';
}

function normalizeTools(list) {
    if (!Array.isArray(list)) return [];
    const seen = new Set();
    const out = [];
    for (const item of list) {
        const key = String(item || '').trim();
        if (key && !seen.has(key)) {
            seen.add(key);
            out.push(key);
        }
    }
    return out;
}

const TOOL_PAGE_SIZE = 20;

export default function RoleEditorDrawer({ visible, role, onCancel, onSaved }) {
    const { hasPermission } = useAuth();
    const canReadTools = hasPermission('mcp:read') || hasPermission('config:read');
    const canReadWorkflows = hasPermission('workflow:read');

    const isEdit = Boolean(role);
    const isDefaultRole = role?.name === DEFAULT_ROLE_NAME;

    const [name, setName] = useState('');
    const [icon, setIcon] = useState('');
    const [description, setDescription] = useState('');
    const [userPrompt, setUserPrompt] = useState('');
    const [workflowId, setWorkflowId] = useState('');
    const [workflowPolicy, setWorkflowPolicy] = useState('auto');
    const [enabled, setEnabled] = useState(true);
    const [selectedTools, setSelectedTools] = useState([]);
    const [manualToolsText, setManualToolsText] = useState('');
    const [nameError, setNameError] = useState('');
    const [saving, setSaving] = useState(false);

    // Workflows dropdown state
    const [workflows, setWorkflows] = useState([]);
    const [workflowsLoading, setWorkflowsLoading] = useState(false);

    // Tool picker state
    const [toolSearch, setToolSearch] = useState('');
    const debouncedToolSearch = useDebounced(toolSearch, 250);
    const [toolScope, setToolScope] = useState('all'); // 'all' | 'selected'
    const [toolPage, setToolPage] = useState(1);
    const [toolList, setToolList] = useState([]);
    const [toolTotal, setToolTotal] = useState(0);
    const [toolsLoading, setToolsLoading] = useState(false);
    const [toolsError, setToolsError] = useState(null);

    useEffect(() => {
        if (!visible) return;
        setName(role?.name || '');
        setIcon(formatRoleIcon(role?.icon));
        setDescription(role?.description || '');
        setUserPrompt(role?.user_prompt || '');
        setWorkflowId(role?.workflow_id || '');
        setWorkflowPolicy(role?.workflow_policy || 'auto');
        setEnabled(role ? role.enabled !== false : true);
        const initialTools = normalizeTools(role?.tools);
        setSelectedTools(initialTools);
        setManualToolsText(initialTools.join(', '));
        setNameError('');
        setToolSearch('');
        setToolScope('all');
        setToolPage(1);
    }, [visible, role]);

    // Fetch workflows when drawer opens
    useEffect(() => {
        if (!visible || !canReadWorkflows) return undefined;
        let cancelled = false;
        setWorkflowsLoading(true);
        api.get('/workflows', { includeDisabled: 'true' })
            .then(res => {
                if (!cancelled) {
                    setWorkflows(Array.isArray(res?.workflows) ? res.workflows : []);
                }
            })
            .catch(() => {
                if (!cancelled) setWorkflows([]);
            })
            .finally(() => {
                if (!cancelled) setWorkflowsLoading(false);
            });
        return () => { cancelled = true; };
    }, [visible, canReadWorkflows]);

    // Reset tool page when search changes
    useEffect(() => {
        setToolPage(1);
    }, [debouncedToolSearch]);

    // Fetch paginated tools when drawer opens for non-default role
    useEffect(() => {
        if (!visible || isDefaultRole || !canReadTools || toolScope !== 'all') return undefined;
        let cancelled = false;
        setToolsLoading(true);
        setToolsError(null);
        api.get('/config/tools', {
            page: toolPage,
            page_size: TOOL_PAGE_SIZE,
            search: debouncedToolSearch.trim() || undefined
        })
            .then(res => {
                if (cancelled) return;
                setToolList(Array.isArray(res?.tools) ? res.tools : []);
                setToolTotal(Number(res?.total) || 0);
            })
            .catch(err => {
                if (cancelled) return;
                setToolsError(err);
                setToolList([]);
                setToolTotal(0);
            })
            .finally(() => {
                if (!cancelled) setToolsLoading(false);
            });
        return () => { cancelled = true; };
    }, [visible, isDefaultRole, canReadTools, toolScope, toolPage, debouncedToolSearch]);

    const selectedToolSet = useMemo(() => new Set(selectedTools), [selectedTools]);

    const filteredSelectedTools = useMemo(() => {
        const needle = toolSearch.trim().toLowerCase();
        if (!needle) return selectedTools;
        return selectedTools.filter(key => key.toLowerCase().includes(needle));
    }, [selectedTools, toolSearch]);

    const workflowOptions = useMemo(() => {
        const opts = workflows.map(wf => ({
            value: wf.id,
            label: wf.name ? `${wf.name} (${wf.id})` : wf.id
        }));
        if (workflowId && !opts.some(opt => opt.value === workflowId)) {
            opts.unshift({ value: workflowId, label: workflowId });
        }
        return opts;
    }, [workflows, workflowId]);

    const toggleTool = (toolKey) => {
        if (!toolKey) return;
        setSelectedTools(prev => (
            prev.includes(toolKey)
                ? prev.filter(item => item !== toolKey)
                : [...prev, toolKey]
        ));
    };

    const selectCurrentPage = () => {
        const keys = toolList.map(getToolKey).filter(Boolean);
        setSelectedTools(prev => normalizeTools([...prev, ...keys]));
    };

    const deselectCurrentPage = () => {
        const pageKeys = new Set(toolList.map(getToolKey).filter(Boolean));
        setSelectedTools(prev => prev.filter(key => !pageKeys.has(key)));
    };

    const handleSave = async () => {
        const trimmedName = name.trim();
        if (!trimmedName) {
            setNameError('请输入角色名称');
            return;
        }
        setNameError('');
        setSaving(true);
        try {
            const toolsPayload = isDefaultRole
                ? []
                : (canReadTools
                    ? selectedTools
                    : normalizeTools(manualToolsText.split(',')));

            const trimmedWorkflowId = String(workflowId || '').trim();
            const payload = {
                name: isDefaultRole ? DEFAULT_ROLE_NAME : trimmedName,
                description: description.trim(),
                user_prompt: userPrompt,
                icon: icon.trim(),
                tools: toolsPayload,
                enabled: Boolean(enabled)
            };

            if (trimmedWorkflowId) {
                payload.workflow_id = trimmedWorkflowId;
                payload.workflow_policy = workflowPolicy || 'auto';
                if (role?.workflow_id === trimmedWorkflowId && role?.workflow_version) {
                    payload.workflow_version = role.workflow_version;
                }
            }

            if (isEdit) {
                await api.put(`/roles/${encodeURIComponent(role.name)}`, payload);
            } else {
                await api.post('/roles', payload);
            }
            toastSuccess('角色已保存');
            onSaved?.();
        } catch (error) {
            toastError(error, '保存角色失败');
        } finally {
            setSaving(false);
        }
    };

    const previewIcon = formatRoleIcon(icon) || (isDefaultRole ? '🔵' : '👤');

    return (
        <Drawer
            title={isEdit ? `编辑角色：${role.name}` : '新建角色'}
            visible={visible}
            onCancel={onCancel}
            onOk={handleSave}
            okText="保存"
            confirmLoading={saving}
            width={760}
        >
            <div className="cs-role-editor-form">
                <div className="cs-role-editor-grid">
                    <div className="cs-role-field">
                        <label className="cs-role-field-label" htmlFor="cs-role-name-input">
                            <span className="cs-role-field-required">角色名称</span>
                        </label>
                        <Input
                            id="cs-role-name-input"
                            value={name}
                            onChange={val => {
                                setName(val);
                                if (nameError) setNameError('');
                            }}
                            disabled={isDefaultRole}
                            placeholder="例如：Web应用扫描"
                            validateStatus={nameError ? 'error' : 'default'}
                        />
                        {nameError && <Text type="danger" size="small">{nameError}</Text>}
                        {isDefaultRole && <span className="cs-role-field-hint">默认角色名称不可修改。</span>}
                    </div>

                    <div className="cs-role-field">
                        <label className="cs-role-field-label" htmlFor="cs-role-icon-input">角色图标</label>
                        <div className="cs-role-icon-input-row">
                            <span className="cs-role-icon-badge" aria-hidden="true">{previewIcon}</span>
                            <Input
                                id="cs-role-icon-input"
                                value={icon}
                                onChange={setIcon}
                                placeholder="Emoji，如 🔍"
                            />
                        </div>
                    </div>
                </div>

                <div className="cs-role-field">
                    <label className="cs-role-field-label" htmlFor="cs-role-desc-input">角色描述</label>
                    <Input
                        id="cs-role-desc-input"
                        value={description}
                        onChange={setDescription}
                        placeholder="简要说明该角色的职责与适用场景"
                    />
                </div>

                <div className="cs-role-field">
                    <label className="cs-role-field-label" htmlFor="cs-role-prompt-input">用户提示词</label>
                    <TextArea
                        id="cs-role-prompt-input"
                        value={userPrompt}
                        onChange={setUserPrompt}
                        autosize={{ minRows: 5, maxRows: 14 }}
                        placeholder="追加到用户消息前的角色提示词（留空则不额外追加）"
                    />
                </div>

                <div className="cs-role-editor-workflow-grid">
                    <div className="cs-role-field">
                        <span className="cs-role-field-label">绑定工作流</span>
                        {canReadWorkflows ? (
                            <Select
                                value={workflowId || undefined}
                                onChange={val => {
                                    const next = val || '';
                                    setWorkflowId(next);
                                    if (next && !workflowPolicy) setWorkflowPolicy('auto');
                                }}
                                optionList={workflowOptions}
                                loading={workflowsLoading}
                                filter
                                showClear
                                placeholder="不绑定工作流"
                                style={{ width: '100%' }}
                            />
                        ) : (
                            <Input
                                value={workflowId}
                                onChange={setWorkflowId}
                                placeholder="不绑定工作流（缺少 workflow:read 权限，可手动输入 ID 或留空）"
                            />
                        )}
                    </div>

                    <div className="cs-role-field">
                        <span className="cs-role-field-label">工作流策略</span>
                        <Select
                            value={workflowPolicy || 'auto'}
                            onChange={val => setWorkflowPolicy(val || 'auto')}
                            disabled={!workflowId}
                            optionList={[
                                { value: 'auto', label: '自动触发（默认）' },
                                { value: 'off', label: '关闭自动触发' }
                            ]}
                            style={{ width: '100%' }}
                        />
                    </div>
                </div>

                <div className="cs-role-field">
                    <span className="cs-role-field-label">关联工具</span>
                    {isDefaultRole ? (
                        <Banner
                            type="info"
                            fullMode={false}
                            closeIcon={null}
                            title="默认角色使用所有工具"
                            description="默认角色会自动使用 MCP 管理中启用的所有工具，无需单独配置。"
                        />
                    ) : canReadTools ? (
                        <div className="cs-role-tools-panel">
                            <div className="cs-role-tools-header">
                                <Space wrap>
                                    {selectedTools.length > 0 ? (
                                        <Tag color="blue">已勾选 {selectedTools.length} 个工具</Tag>
                                    ) : (
                                        <Tag color="grey">未限制（默认使用全部已启用工具）</Tag>
                                    )}
                                </Space>
                                {selectedTools.length > 0 && (
                                    <Button size="small" theme="borderless" type="danger" onClick={() => setSelectedTools([])}>
                                        清空（使用全部）
                                    </Button>
                                )}
                            </div>

                            {selectedTools.length > 0 && (
                                <div className="cs-role-tools-selected" aria-label="已勾选工具列表">
                                    {selectedTools.map(toolKey => (
                                        <Tag
                                            key={toolKey}
                                            size="small"
                                            closable
                                            onClose={() => toggleTool(toolKey)}
                                        >
                                            {toolKey}
                                        </Tag>
                                    ))}
                                </div>
                            )}

                            <div className="cs-role-tools-toolbar">
                                <Input
                                    prefix={<IconSearch />}
                                    value={toolSearch}
                                    onChange={setToolSearch}
                                    placeholder="搜索工具名称或描述"
                                    showClear
                                    style={{ width: 240 }}
                                />
                                <Space wrap>
                                    <RadioGroup
                                        type="button"
                                        buttonSize="small"
                                        value={toolScope}
                                        onChange={e => setToolScope(e.target.value)}
                                    >
                                        <Radio value="all">全部工具</Radio>
                                        <Radio value="selected">仅已勾选 ({selectedTools.length})</Radio>
                                    </RadioGroup>
                                    {toolScope === 'all' && toolList.length > 0 && (
                                        <>
                                            <Button size="small" onClick={selectCurrentPage}>全选本页</Button>
                                            <Button size="small" onClick={deselectCurrentPage}>取消本页</Button>
                                        </>
                                    )}
                                </Space>
                            </div>

                            {toolScope === 'all' ? (
                                <>
                                    {toolsError && (
                                        <Banner
                                            type="warning"
                                            fullMode={false}
                                            closeIcon={null}
                                            description="加载工具列表失败，请稍后重试。"
                                        />
                                    )}
                                    <Spin spinning={toolsLoading}>
                                        <div className="cs-role-tools-list">
                                            {toolList.length === 0 && !toolsLoading ? (
                                                <Empty description="没有匹配的工具" style={{ padding: 24 }} />
                                            ) : (
                                                toolList.map(tool => {
                                                    const key = getToolKey(tool);
                                                    const checked = selectedToolSet.has(key);
                                                    return (
                                                        <div
                                                            key={key}
                                                            className="cs-role-tool-item"
                                                            onClick={() => toggleTool(key)}
                                                        >
                                                            <Checkbox
                                                                checked={checked}
                                                                onChange={() => {}}
                                                                onClick={e => {
                                                                    e.stopPropagation();
                                                                    toggleTool(key);
                                                                }}
                                                                aria-label={key}
                                                            />
                                                            <div className="cs-role-tool-meta">
                                                                <div className="cs-role-tool-head">
                                                                    <Text strong size="small">{tool.name}</Text>
                                                                    {tool.is_external && tool.external_mcp && (
                                                                        <Tag size="small" color="cyan">{tool.external_mcp}</Tag>
                                                                    )}
                                                                    {tool.enabled === false && (
                                                                        <Tag size="small" color="orange">MCP 未启用</Tag>
                                                                    )}
                                                                </div>
                                                                {tool.description && (
                                                                    <span className="cs-role-tool-desc" title={tool.description}>
                                                                        {tool.description}
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </div>
                                                    );
                                                })
                                            )}
                                        </div>
                                    </Spin>
                                    {toolTotal > TOOL_PAGE_SIZE && (
                                        <div className="cs-role-tools-footer">
                                            <Text type="tertiary" size="small">共 {toolTotal} 个工具</Text>
                                            <Pagination
                                                size="small"
                                                total={toolTotal}
                                                pageSize={TOOL_PAGE_SIZE}
                                                currentPage={toolPage}
                                                onPageChange={setToolPage}
                                            />
                                        </div>
                                    )}
                                </>
                            ) : (
                                <div className="cs-role-tools-list">
                                    {filteredSelectedTools.length === 0 ? (
                                        <Empty description="暂无已勾选工具" style={{ padding: 24 }} />
                                    ) : (
                                        filteredSelectedTools.map(key => (
                                            <div
                                                key={key}
                                                className="cs-role-tool-item"
                                                onClick={() => toggleTool(key)}
                                            >
                                                <Checkbox
                                                    checked
                                                    onChange={() => {}}
                                                    onClick={e => {
                                                        e.stopPropagation();
                                                        toggleTool(key);
                                                    }}
                                                    aria-label={key}
                                                />
                                                <div className="cs-role-tool-meta">
                                                    <Text strong size="small">{key}</Text>
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                            )}
                            <span className="cs-role-field-hint">
                                留空工具列表表示不限制（使用 MCP 管理中全部已启用工具）；MCP 全局开关请在 MCP 管理中调整。
                            </span>
                        </div>
                    ) : (
                        <>
                            <Input
                                value={manualToolsText}
                                onChange={setManualToolsText}
                                placeholder="toolName, mcpName::toolName（留空表示不限制）"
                            />
                            <span className="cs-role-field-hint">
                                当前账号缺少工具列表读取权限，可直接按逗号分隔填写工具 key。
                            </span>
                        </>
                    )}
                </div>

                <div className="cs-role-switch-row">
                    <div>
                        <Text strong>启用此角色</Text>
                        <div className="cs-role-field-hint">停用后该角色不会出现在对话角色选择器中。</div>
                    </div>
                    <Switch checked={enabled} onChange={setEnabled} aria-label="启用此角色" />
                </div>
            </div>
        </Drawer>
    );
}
