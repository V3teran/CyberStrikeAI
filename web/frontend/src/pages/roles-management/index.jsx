import { useMemo, useState } from 'react';
import { Button, Input, Space, Tag, Typography } from '@douyinfe/semi-ui';
import { IconDelete, IconEdit, IconPlus, IconRefresh, IconSearch } from '@douyinfe/semi-icons';
import { api } from '../../lib/http';
import { useAuth } from '../../lib/auth';
import { useT } from '../../lib/i18n';
import { useResource } from '../../components/hooks';
import {
    DataTable, ErrorBanner, PageHeader, SectionCard, confirmAction, toastError, toastSuccess
} from '../../components/ui';
import RoleEditorDrawer, { DEFAULT_ROLE_NAME, formatRoleIcon } from './role-editor-drawer';
import './page.css';

const { Text } = Typography;

function sortRoles(list) {
    return [...list].sort((a, b) => {
        if (a?.name === DEFAULT_ROLE_NAME && b?.name !== DEFAULT_ROLE_NAME) return -1;
        if (b?.name === DEFAULT_ROLE_NAME && a?.name !== DEFAULT_ROLE_NAME) return 1;
        return String(a?.name || '').localeCompare(String(b?.name || ''), 'zh-CN');
    });
}

export default function RolesManagementPage() {
    const t = useT();
    const { hasPermission } = useAuth();
    const canWrite = hasPermission('roles:write');
    const canDelete = hasPermission('roles:delete');

    const [search, setSearch] = useState('');
    const [editorState, setEditorState] = useState(null); // null | { role: object | null }

    const roles = useResource(() => api.get('/roles'), []);
    const rows = useMemo(() => {
        const list = Array.isArray(roles.data?.roles) ? sortRoles(roles.data.roles) : [];
        if (!search.trim()) return list;
        const needle = search.trim().toLowerCase();
        return list.filter(role =>
            [role.name, role.description, role.workflow_id].some(value => String(value || '').toLowerCase().includes(needle))
        );
    }, [roles.data, search]);

    const remove = role => confirmAction({
        title: `删除角色「${role.name}」？`,
        content: '已绑定该角色的对话将失去对应提示词与工具配置。',
        onOk: async () => {
            try {
                await api.del(`/roles/${encodeURIComponent(role.name)}`);
                toastSuccess('已删除');
                roles.reload();
            } catch (error) {
                toastError(error, '删除角色失败');
            }
        }
    });

    const columns = [
        {
            title: '角色', dataIndex: 'name', render: (value, record) => {
                const isDefault = value === DEFAULT_ROLE_NAME;
                const icon = formatRoleIcon(record.icon) || (isDefault ? '🔵' : '👤');
                return (
                    <div className="cs-role-name-cell">
                        <span className="cs-role-icon-badge" aria-hidden="true">{icon}</span>
                        <Space vertical spacing={0} align="start">
                            <Space spacing={6}>
                                <Text strong>{value}</Text>
                                {isDefault && <Tag size="small" color="blue">默认</Tag>}
                                {record.enabled === false && <Tag size="small" color="grey">已停用</Tag>}
                            </Space>
                            <Text type="tertiary" ellipsis={{ showTooltip: true }} style={{ maxWidth: 460 }}>
                                {record.description || '—'}
                            </Text>
                        </Space>
                    </div>
                );
            }
        },
        {
            title: '工具', dataIndex: 'tools', width: 260,
            render: (value, record) => {
                if (record.name === DEFAULT_ROLE_NAME) {
                    return <Text type="tertiary">全部工具</Text>;
                }
                return Array.isArray(value) && value.length
                    ? (
                        <Space wrap spacing={4}>
                            {value.slice(0, 4).map(tool => <Tag size="small" key={tool}>{tool}</Tag>)}
                            {value.length > 4 && <Text type="tertiary">+{value.length - 4}</Text>}
                        </Space>
                    )
                    : <Text type="tertiary">全部工具</Text>;
            }
        },
        {
            title: '工作流', dataIndex: 'workflow_id', width: 180,
            render: (value, record) => (value ? (
                <Space spacing={4} wrap>
                    <Text>{value}</Text>
                    {record.workflow_policy === 'off' && <Tag size="small" color="grey">关闭自动</Tag>}
                </Space>
            ) : '—')
        }
    ];

    if (canWrite || canDelete) {
        columns.push({
            title: '操作', width: 150, render: (_, record) => (
                <Space>
                    {canWrite && (
                        <Button
                            size="small"
                            theme="borderless"
                            icon={<IconEdit />}
                            onClick={() => setEditorState({ role: record })}
                        >
                            编辑
                        </Button>
                    )}
                    {canDelete && record.name !== DEFAULT_ROLE_NAME && (
                        <Button
                            size="small"
                            theme="borderless"
                            type="danger"
                            icon={<IconDelete />}
                            aria-label={`删除 ${record.name}`}
                            onClick={() => remove(record)}
                        />
                    )}
                </Space>
            )
        });
    }

    return (
        <div>
            <PageHeader
                title={t('roles.title', null, '角色管理')}
                description="角色定义对话的系统提示词、可用工具与绑定工作流。"
                extra={(
                    <Space>
                        <Button icon={<IconRefresh />} onClick={() => roles.reload()} loading={roles.loading}>刷新</Button>
                        {canWrite && (
                            <Button
                                theme="solid"
                                type="primary"
                                icon={<IconPlus />}
                                onClick={() => setEditorState({ role: null })}
                            >
                                新建角色
                            </Button>
                        )}
                    </Space>
                )}
            />
            <SectionCard title={`角色（${rows.length}）`}>
                <ErrorBanner error={roles.error} onRetry={() => roles.reload()} />
                <DataTable
                    columns={columns}
                    dataSource={rows}
                    rowKey="name"
                    loading={roles.loading}
                    pagination={{ pageSize: 20 }}
                    toolbar={
                        <Input
                            prefix={<IconSearch />}
                            value={search}
                            onChange={setSearch}
                            placeholder="搜索角色名称"
                            showClear
                            style={{ width: 260 }}
                        />
                    }
                />
            </SectionCard>

            <RoleEditorDrawer
                visible={Boolean(editorState)}
                role={editorState?.role || null}
                onCancel={() => setEditorState(null)}
                onSaved={() => {
                    setEditorState(null);
                    roles.reload();
                }}
            />
        </div>
    );
}
