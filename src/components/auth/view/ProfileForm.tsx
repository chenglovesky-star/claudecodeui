import { useCallback, useRef, useState } from 'react';
import { Shield, Code, Bug, Layers, Palette } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const BMAD_ROLES = [
  { key: 'pm', label: '产品经理', icon: Shield },
  { key: 'developer', label: '开发者', icon: Code },
  { key: 'qa', label: '质量保证', icon: Bug },
  { key: 'architect', label: '架构师', icon: Layers },
  { key: 'ux-designer', label: 'UX 设计师', icon: Palette },
] as const;

export default function ProfileForm() {
  const { user, updateProfile, uploadAvatar, updateRoles } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [nickname, setNickname] = useState(user?.nickname || user?.username || '');
  const [selectedRoles, setSelectedRoles] = useState<string[]>(user?.roles || []);
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingRoles, setIsSavingRoles] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const handleSaveNickname = useCallback(async () => {
    setMessage(null);
    setIsSaving(true);
    try {
      const result = await updateProfile(nickname);
      if (result.success) {
        setMessage({ type: 'success', text: '昵称更新成功' });
      } else {
        setMessage({ type: 'error', text: result.error });
      }
    } finally {
      setIsSaving(false);
    }
  }, [nickname, updateProfile]);

  const handleAvatarClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleAvatarChange = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!['image/jpeg', 'image/png'].includes(file.type)) {
      setMessage({ type: 'error', text: '仅支持 jpg/png 格式的图片' });
      return;
    }

    // Validate file size (2MB)
    if (file.size > 2 * 1024 * 1024) {
      setMessage({ type: 'error', text: '头像文件大小不能超过2MB' });
      return;
    }

    setMessage(null);
    setIsUploading(true);

    try {
      const formData = new FormData();
      formData.append('avatar', file);

      const result = await uploadAvatar(formData);
      if (result.success) {
        setMessage({ type: 'success', text: '头像上传成功' });
      } else {
        setMessage({ type: 'error', text: result.error });
      }
    } finally {
      setIsUploading(false);
    }

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [uploadAvatar]);

  const handleToggleRole = useCallback((roleKey: string) => {
    setSelectedRoles((prev) => {
      if (prev.includes(roleKey)) {
        // Don't allow removing the last role
        if (prev.length <= 1) return prev;
        return prev.filter((r) => r !== roleKey);
      }
      return [...prev, roleKey];
    });
  }, []);

  const handleSaveRoles = useCallback(async () => {
    if (selectedRoles.length === 0) {
      setMessage({ type: 'error', text: '至少需要选择一个角色' });
      return;
    }
    setMessage(null);
    setIsSavingRoles(true);
    try {
      const result = await updateRoles(selectedRoles);
      if (result.success) {
        setMessage({ type: 'success', text: '角色更新成功' });
      } else {
        setMessage({ type: 'error', text: result.error });
      }
    } finally {
      setIsSavingRoles(false);
    }
  }, [selectedRoles, updateRoles]);

  const avatarUrl = user?.avatar_url;
  const displayName = user?.nickname || user?.username || '';

  return (
    <div className="space-y-6">
      <h3 className="text-lg font-medium text-foreground">个人资料</h3>

      {/* Avatar section */}
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={handleAvatarClick}
          disabled={isUploading}
          className="relative flex h-16 w-16 flex-shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-dashed border-border bg-muted transition-colors hover:border-blue-500 hover:bg-muted/80 disabled:opacity-50"
          title="点击上传头像"
        >
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={displayName}
              className="h-full w-full object-cover"
            />
          ) : (
            <span className="text-2xl font-medium text-muted-foreground">
              {displayName.charAt(0).toUpperCase()}
            </span>
          )}
          {isUploading && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/40">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
            </div>
          )}
        </button>
        <div className="text-sm text-muted-foreground">
          <p>点击头像上传新图片</p>
          <p>支持 jpg/png 格式，最大 2MB</p>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png"
          onChange={handleAvatarChange}
          className="hidden"
        />
      </div>

      {/* Nickname section */}
      <div className="space-y-2">
        <label htmlFor="nickname" className="block text-sm font-medium text-foreground">
          昵称
        </label>
        <div className="flex gap-2">
          <input
            id="nickname"
            type="text"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            placeholder="输入昵称 (2-20个字符)"
            maxLength={20}
            className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-foreground focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={isSaving}
          />
          <button
            type="button"
            onClick={handleSaveNickname}
            disabled={isSaving || nickname.trim().length < 2}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:bg-blue-400 disabled:cursor-not-allowed"
          >
            {isSaving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>

      {/* Role selection */}
      <div className="space-y-2">
        <label className="block text-sm font-medium text-foreground">角色标签</label>
        <p className="text-xs text-muted-foreground">选择你在团队中的角色（至少选择一个）</p>
        <div className="flex flex-wrap gap-2">
          {BMAD_ROLES.map(({ key, label, icon: Icon }) => {
            const isSelected = selectedRoles.includes(key);
            return (
              <button
                key={key}
                type="button"
                onClick={() => handleToggleRole(key)}
                disabled={isSavingRoles}
                className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors ${
                  isSelected
                    ? 'border-blue-500 bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-700'
                    : 'border-border bg-background text-muted-foreground hover:border-blue-300 hover:text-foreground'
                } disabled:opacity-50`}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={handleSaveRoles}
          disabled={isSavingRoles || selectedRoles.length === 0}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:bg-blue-400 disabled:cursor-not-allowed"
        >
          {isSavingRoles ? '保存中...' : '保存角色'}
        </button>
      </div>

      {/* Message */}
      {message && (
        <p className={`text-sm ${message.type === 'success' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
          {message.text}
        </p>
      )}

      {/* User info */}
      <div className="space-y-1 text-sm text-muted-foreground">
        <p>邮箱: {user?.email || '-'}</p>
        <p>用户名: {user?.username || '-'}</p>
      </div>
    </div>
  );
}
