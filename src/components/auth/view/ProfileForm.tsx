import { useCallback, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';

export default function ProfileForm() {
  const { user, updateProfile, uploadAvatar } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [nickname, setNickname] = useState(user?.nickname || user?.username || '');
  const [isSaving, setIsSaving] = useState(false);
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
