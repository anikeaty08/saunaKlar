import { useEffect, useRef, useState } from 'react';
import { ScanLine } from 'lucide-react';
import { api } from '../api/client.ts';
import { useT } from '../i18n/i18n.ts';
import { Button } from '../design/components/Button.tsx';
import { toast } from '../design/components/Toast.tsx';

declare module 'react' {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      'model-viewer': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        src?: string;
        'ios-src'?: string;
        ar?: boolean | '';
        'ar-modes'?: string;
        'ar-scale'?: string;
        alt?: string;
        reveal?: string;
        loading?: string;
      };
    }
  }
}

interface ModelViewerElement extends HTMLElement {
  activateAR: () => Promise<void>;
  canActivateAR: boolean;
}

/**
 * AR hand-off (design 10.4). `<model-viewer>` is loaded only when the button
 * is pressed; the API returns short-lived signed URLs for the GLB (Android
 * Scene Viewer / WebXR) and the USDZ (iOS Quick Look). Without AR sources the
 * button is not rendered at all.
 */
export function ArButton({ saunaModelId, name, enabled, shareToken }: { saunaModelId: string; name: string; enabled: boolean; shareToken?: string }) {
  const { t } = useT();
  const [src, setSrc] = useState<{ glb: string | null; usdz: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const mv = useRef<ModelViewerElement>(null);

  useEffect(() => {
    if (!src || !mv.current) return;
    const el = mv.current;
    const go = async () => {
      await customElements.whenDefined('model-viewer');
      if (el.canActivateAR) await el.activateAR();
      else toast(t('detail.arUnavailable'));
    };
    if ((el as unknown as { loaded?: boolean }).loaded) void go();
    else el.addEventListener('load', () => void go(), { once: true });
  }, [src, t]);

  if (unavailable || !enabled) return null;

  const start = async () => {
    setBusy(true);
    try {
      const [, urls] = await Promise.all([
        import('@google/model-viewer'),
        api('assetAr', { body: shareToken ? { saunaModelId, shareToken } : { saunaModelId } }),
      ]);
      if (!urls.glbUrl && !urls.usdzUrl) {
        setUnavailable(true);
        toast(t('detail.arUnavailable'));
        return;
      }
      setSrc({ glb: urls.glbUrl, usdz: urls.usdzUrl });
    } catch {
      toast.error(t('errors.title'), t('detail.arUnavailable'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button variant="ghost" icon={ScanLine} onClick={() => void start()} loading={busy}>
        {t('detail.ar')}
      </Button>
      {src && (
        <model-viewer
          ref={mv as never}
          src={src.glb ?? undefined}
          ios-src={src.usdz ?? undefined}
          ar=""
          ar-modes="webxr scene-viewer quick-look"
          ar-scale="fixed"
          alt={name}
          loading="eager"
          style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
        />
      )}
    </>
  );
}
