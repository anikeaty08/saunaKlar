import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { api } from '../../api/client.ts';
import { useT } from '../../i18n/i18n.ts';
import { toast } from '../../design/components/Toast.tsx';
import { errorText } from '../../i18n/errorText.ts';

/**
 * Sends a configuration as a request and navigates by the request the API
 * returns. When the submitted price had expired the API re-prices into a new
 * locked copy, so `configuration.id` may differ from the id we sent.
 */
export function useSubmitRequest(opts: { onSent?: () => void } = {}) {
  const { t } = useT();
  const qc = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: async ({ id, message }: { id: string | Promise<string>; message?: string }) => {
      const configurationId = await id;
      const req = await api('submitRequest', { params: { id: configurationId }, body: message?.trim() ? { message: message.trim() } : {} });
      return { req, configurationId };
    },
    onSuccess: ({ req, configurationId }) => {
      opts.onSent?.();
      if (req.configuration.id !== configurationId) toast(t('configure.pricesUpdated'), t('configure.pricesUpdatedBody'));
      else toast(t('configure.requestSent'), t('configure.requestSentBody'));
      qc.setQueryData(['request', req.id], req);
      void qc.invalidateQueries({ queryKey: ['requests'] });
      void qc.invalidateQueries({ queryKey: ['configurations'] });
      navigate(`/account/requests/${req.id}`);
    },
    onError: e => toast.error(t('errors.title'), errorText(t, e)),
  });
}
