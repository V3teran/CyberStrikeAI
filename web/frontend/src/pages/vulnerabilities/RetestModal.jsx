/** 复测漏洞：从原始对话创建独立分支并跳转聊天页一键执行（POST /vulnerabilities/:id/retest）。 */
import { useEffect, useId, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Form, Typography } from '@douyinfe/semi-ui';
import { api } from '../../lib/http';
import { useT } from '../../lib/i18n';
import { Drawer, ErrorBanner } from '../../components/ui';
import { queueRetestAutosend } from '../../lib/retest';

const { Text } = Typography;
const MAX_PROMPT = 20000;

export function retestPromptDraft(vuln, t) {
    // 不传 vars，保留 {{vulnerability_id}} 等占位符由服务端在创建分支时解析。
    const base = t('vulnerabilityRetest.defaultPrompt', null,
        '请帮我对漏洞 {{vulnerability_id}} 进行验证，确认是否已修复。完成后更新该漏洞状态。');
    const guidance = String(vuln?.retest_notes || '').trim();
    if (!guidance) return base;
    return `${base}\n\n${t('vulnerabilityRetest.guidanceHeading', null, '验证方式（来自漏洞记录的复测方式）：')}\n${guidance}`;
}

export default function RetestModal({ visible, vuln, onClose }) {
    const t = useT();
    const navigate = useNavigate();
    const formId = useId();
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => { setError(null); }, [visible, vuln?.id]);

    const submit = async values => {
        if (saving || !vuln?.id) return;
        setSaving(true);
        setError(null);
        try {
            const result = await api.post(`/vulnerabilities/${encodeURIComponent(vuln.id)}/retest`, {
                prompt: String(values.prompt || '').trim()
            });
            // 服务端已解析占位符；交给聊天页在分支上自动发送。
            queueRetestAutosend(result.conversation.id, result.prompt);
            onClose?.();
            navigate(`/chat?conversation=${encodeURIComponent(result.conversation.id)}`);
        } catch (err) {
            setError(err);
        } finally {
            setSaving(false);
        }
    };

    return (
        <Drawer
            visible={visible}
            width={640}
            closable={!saving}
            closeOnEsc={!saving}
            onCancel={saving ? undefined : onClose}
            cancelButtonProps={{ disabled: saving }}
            title={t('vulnerabilityRetest.title', null, '复测漏洞')}
            formId={formId}
            okText={t('vulnerabilityRetest.confirm', null, '确认并开始复测')}
            confirmLoading={saving}
        >
            <Text strong>{vuln?.title}</Text>
            <Text type="tertiary" size="small">
                {t('vulnerabilityRetest.hint', null, '每次确认都会从原始对话创建独立分支，继承原项目和历史，可继续多轮验证。')}
            </Text>
            <Form id={formId} key={`${visible}-${vuln?.id || ''}`} onSubmit={submit}
                initValues={{ prompt: retestPromptDraft(vuln, t) }}>
                <Form.TextArea
                    id={`${formId}-prompt`}
                    field="prompt"
                    rows={8}
                    maxCount={MAX_PROMPT}
                    autosize
                    label={t('vulnerabilityRetest.promptLabel', null, '复测提示词')}
                    extraText={t('vulnerabilityRetest.placeholderHint', null, '占位符发送时自动替换，也支持在后续对话中手动输入。')}
                    rules={[{
                        required: true,
                        whitespace: true,
                        message: t('vulnerabilityRetest.promptRequired', null, '请输入复测提示词。')
                    }]}
                />
                <ErrorBanner error={error} />
            </Form>
        </Drawer>
    );
}
