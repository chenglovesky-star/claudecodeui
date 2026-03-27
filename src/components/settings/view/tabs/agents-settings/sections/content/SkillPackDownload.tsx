import { useState, useEffect } from 'react';
import { Download, Laptop, Monitor } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../../../../../../shared/view/ui';

type SkillPackInfo = {
    commands: number;
    skills: number;
    mcpServers: number;
};

export default function SkillPackDownload() {
    const { t } = useTranslation('settings');
    const [info, setInfo] = useState<SkillPackInfo | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetch('/api/skill-pack/info')
            .then((res) => res.json())
            .then((data) => {
                setInfo(data);
                setLoading(false);
            })
            .catch(() => setLoading(false));
    }, []);

    if (loading) {
        return (
            <div className="mb-4 rounded-lg border border-dashed border-gray-300 p-4 dark:border-gray-600">
                <p className="text-sm text-gray-500">{t('skillPack.loading')}</p>
            </div>
        );
    }

    const total = (info?.commands ?? 0) + (info?.skills ?? 0);
    const mcp = info?.mcpServers ?? 0;

    if (total === 0 && mcp === 0) {
        return null;
    }

    const handleDownload = (platform: 'mac' | 'windows') => {
        window.location.href = `/api/skill-pack/download?platform=${platform}`;
    };

    return (
        <div className="mb-4 rounded-lg border border-purple-200 bg-purple-50 p-4 dark:border-purple-800 dark:bg-purple-950/30">
            <div className="flex items-center gap-2 mb-2">
                <Download className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                <h4 className="font-medium text-gray-900 dark:text-gray-100">
                    {t('skillPack.title')}
                </h4>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                {t('skillPack.description', { total, mcp })}
            </p>
            <div className="flex gap-2 mb-2">
                <Button
                    size="sm"
                    className="bg-purple-600 text-white hover:bg-purple-700"
                    onClick={() => handleDownload('mac')}
                >
                    <Laptop className="mr-1 h-4 w-4" />
                    {t('skillPack.downloadMac')}
                </Button>
                <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleDownload('windows')}
                >
                    <Monitor className="mr-1 h-4 w-4" />
                    {t('skillPack.downloadWindows')}
                </Button>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-500">
                {t('skillPack.hint')}
            </p>
        </div>
    );
}
