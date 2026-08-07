import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUpRight, Users } from 'lucide-react';
import { COMMUNITY_WECHAT_QR_API_PATH, buildSessionImageApiUrl } from '@lody/shared';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/ui';
import { API_BASE_URL } from '@/lib';
import { LODY_DISCORD_URL } from '@/lib/lody-urls';
import { openExternalUrl } from '@/lib/native-browser';

// The server worker serves the ops-managed WeChat group QR image (see
// packages/shared/src/community.ts); a missing upload surfaces as the
// onError fallback below instead of a broken image.
const DEFAULT_WECHAT_QR_URL = buildSessionImageApiUrl(API_BASE_URL, COMMUNITY_WECHAT_QR_API_PATH);

export function JoinCommunityDialog({
  open,
  onOpenChange,
  wechatQrUrl = DEFAULT_WECHAT_QR_URL,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  wechatQrUrl?: string;
}) {
  const { t } = useTranslation();
  const [internalOpen, setInternalOpen] = useState(false);
  const [qrLoadFailed, setQrLoadFailed] = useState(false);
  const isOpen = open ?? internalOpen;
  const setIsOpen = onOpenChange ?? setInternalOpen;

  const handleJoinDiscord = () => {
    void openExternalUrl(LODY_DISCORD_URL);
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 px-2.5">
          <Users className="mr-1 h-3.5 w-3.5" />
          {t('settings.about.joinCommunity', 'Join community')}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {t('settings.about.communityDialogTitle', 'Join the Lody community')}
          </DialogTitle>
          <DialogDescription>
            {t(
              'settings.about.communityDialogDescription',
              'Chat with the team and other users, get help, and share feedback.'
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col items-center gap-3 rounded-lg border border-border/70 bg-card/70 p-4">
            {qrLoadFailed ? (
              <div className="flex h-48 w-48 items-center justify-center rounded-md border border-dashed border-border/70 px-4 text-center text-xs text-muted-foreground">
                {t(
                  'settings.about.wechatQrUnavailable',
                  'The QR code is unavailable right now. Please try again later.'
                )}
              </div>
            ) : (
              <img
                src={wechatQrUrl}
                alt={t('settings.about.wechatGroupQrAlt', 'Lody WeChat group QR code')}
                className="h-48 w-48 rounded-md bg-white object-contain"
                onError={() => setQrLoadFailed(true)}
              />
            )}
            <div className="text-center">
              <p className="text-sm font-medium text-foreground">
                {t('settings.about.wechatGroup', 'WeChat group')}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t(
                  'settings.about.wechatGroupHint',
                  'Scan the QR code with WeChat to join the group.'
                )}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleJoinDiscord}
            className="flex min-h-40 flex-col items-center justify-center gap-3 rounded-lg border border-border/70 bg-card/70 p-4 transition-colors hover:bg-hover"
          >
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
              <ArrowUpRight className="h-6 w-6 text-muted-foreground" />
            </span>
            <span className="text-sm font-medium text-foreground">
              {t('settings.about.joinDiscord', 'Join Discord')}
            </span>
            <span className="text-xs text-muted-foreground">
              {t('settings.about.joinDiscordHint', 'Opens discord.gg in your browser.')}
            </span>
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
