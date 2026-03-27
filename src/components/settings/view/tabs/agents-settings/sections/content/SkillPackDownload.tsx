import { useState, useEffect, useCallback } from 'react';
import { Download, Laptop, Monitor, Copy, Check, Terminal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../../../../../../shared/view/ui';
import { authenticatedFetch } from '../../../../../../../utils/api';

type SkillPackInfo = {
    commands: number;
    skills: number;
    mcpServers: number;
};

export default function SkillPackDownload() {
    const { t } = useTranslation('settings');
    const [info, setInfo] = useState<SkillPackInfo | null>(null);
    const [loading, setLoading] = useState(true);
    const [downloaded, setDownloaded] = useState<'mac' | 'windows' | null>(null);
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        authenticatedFetch('/api/skill-pack/info')
            .then((res) => res.json())
            .then((data) => {
                setInfo(data);
                setLoading(false);
            })
            .catch(() => setLoading(false));
    }, []);

    const handleDownload = useCallback(async (platform: 'mac' | 'windows') => {
        try {
            const res = await authenticatedFetch(`/api/skill-pack/download?platform=${platform}`);
            const blob = await res.blob();
            const filename = platform === 'mac'
                ? 'install-claude-skills.command'
                : 'install-claude-skills.bat';
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            a.click();
            URL.revokeObjectURL(url);
            setDownloaded(platform);
        } catch {
            // download failed silently
        }
    }, []);

    const handleCopyCommand = useCallback((platform: 'mac' | 'windows') => {
        const cmd = platform === 'mac'
            ? 'bash ~/Downloads/install-claude-skills.command'
            : 'powershell -ExecutionPolicy Bypass -File %USERPROFILE%\\Downloads\\install-claude-skills.bat';
        navigator.clipboard.writeText(cmd);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
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

            {downloaded && (
                <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/30">
                    <p className="text-xs font-medium text-amber-800 dark:text-amber-300 mb-2">
                        {t('skillPack.runHint')}
                    </p>
                    <div className="flex items-center gap-2">
                        <div className="flex-1 flex items-center gap-2 rounded bg-gray-900 px-3 py-1.5 font-mono text-xs text-green-400">
                            <Terminal className="h-3 w-3 shrink-0 text-gray-500" />
                            <span className="truncate">
                                {downloaded === 'mac'
                                    ? 'bash ~/Downloads/install-claude-skills.command'
                                    : 'powershell -ExecutionPolicy Bypass -File %USERPROFILE%\\Downloads\\install-claude-skills.bat'
                                }
                            </span>
                        </div>
                        <Button
                            size="sm"
                            variant="outline"
                            className="shrink-0 h-7 px-2"
                            onClick={() => handleCopyCommand(downloaded)}
                        >
                            {copied
                                ? <Check className="h-3.5 w-3.5 text-green-600" />
                                : <Copy className="h-3.5 w-3.5" />
                            }
                        </Button>
                    </div>
                </div>
            )}

            {!downloaded && (
                <p className="text-xs text-gray-500 dark:text-gray-500">
                    {t('skillPack.hint')}
                </p>
            )}
        </div>
    );
}
